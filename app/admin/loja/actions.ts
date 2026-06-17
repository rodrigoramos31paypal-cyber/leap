"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentTrainerId, getAccessibleTrainerIds } from "@/lib/trainer";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { requireStaff } from "@/lib/authz";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const BUCKET = "store";
const CATEGORIES = ["ebooks", "roupa", "suplementos"];

function revalidate() {
  revalidatePath("/admin/loja");
  revalidatePath("/app/loja/ebooks");
  revalidatePath("/app/loja/roupa");
  revalidatePath("/app/loja/suplementos");
}

function validateFile(file: File | null): string | null {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_BYTES) return "Imagem demasiado grande (máx. 5 MB)";
  if (!ALLOWED.includes(file.type)) return "Formato não suportado (usa JPG, PNG ou WEBP)";
  return null;
}

// SEC (S-04, audit jun/2026): igual ao safeHttpUrl das promocoes
// (C-B). React renderiza <a href={...}> sem bloquear esquemas
// perigosos (javascript:/data:/vbscript:). Sem este gate, um staff
// podia injectar link_url=javascript:fetch(...) num produto da loja
// e o JS corria no contexto de qualquer cliente do estudio.
function safeHttpUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// Preço em euros (ex: "19,99" ou "19.99") → cêntimos. Vazio → null.
function parsePriceCents(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

async function uploadImage(trainerId: string, file: File): Promise<string | null> {
  const admin = createAdminClient();
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${trainerId}/${randomUUID()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type,
    upsert: true,
    cacheControl: "3600",
  });
  if (error) {
    logError("store.uploadImage", error);
    return null;
  }
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

function storagePathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const after = url.split(`/object/public/${BUCKET}/`)[1];
  if (!after) return null;
  return after.split("?")[0];
}

export async function createProductAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const category = String(formData.get("category") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const linkUrlRaw = String(formData.get("link_url") ?? "").trim();
  const priceCents = parsePriceCents(String(formData.get("price") ?? ""));
  const file = formData.get("file") as File | null;

  if (!CATEGORIES.includes(category)) {
    await setFlash("Categoria inválida", "error");
    return { ok: false, error: "Categoria inválida" };
  }
  if (!name) {
    await setFlash("Indica um nome", "error");
    return { ok: false, error: "Indica um nome" };
  }
  // S-04: rejeita URL nao http(s). null se vazio.
  const linkUrl = linkUrlRaw ? safeHttpUrl(linkUrlRaw) : null;
  if (linkUrlRaw && !linkUrl) {
    await setFlash("Link inválido — usa um URL https://… ou deixa em branco.", "error");
    return { ok: false, error: "Link inválido." };
  }
  const fileErr = validateFile(file);
  if (fileErr) {
    await setFlash(fileErr, "error");
    return { ok: false, error: fileErr };
  }

  const scope = await getAccessibleTrainerIds();
  const trainerId = (await getCurrentTrainerId()) ?? scope[0];
  if (!trainerId) {
    await setFlash("Sem trainer associado", "error");
    return { ok: false, error: "Sem trainer associado" };
  }

  let imageUrl: string | null = null;
  if (file && file.size > 0) {
    imageUrl = await uploadImage(trainerId, file);
    if (!imageUrl) {
      await setFlash("Não foi possível carregar a imagem", "error");
      return { ok: false, error: "Não foi possível carregar a imagem" };
    }
  }

  const supabase = await createClient();
  const { error } = await (supabase as any).from("store_products").insert({
    trainer_id: trainerId,
    category,
    name,
    description: description || null,
    price_cents: priceCents,
    image_url: imageUrl,
    link_url: linkUrl,
  });
  if (error) {
    logError("createProductAction", error);
    await setFlash("Não foi possível criar o produto", "error");
    revalidate();
    return { ok: false, error: "Não foi possível criar o produto" };
  }
  await setFlash("Produto criado");
  revalidate();
  return { ok: true };
}

export async function updateProductAction(formData: FormData) {
  await requireStaff();
  const id = String(formData.get("id") ?? "");
  const category = String(formData.get("category") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const linkUrlRaw = String(formData.get("link_url") ?? "").trim();
  const priceCents = parsePriceCents(String(formData.get("price") ?? ""));
  const file = formData.get("file") as File | null;

  if (!id) return;
  if (!CATEGORIES.includes(category)) {
    await setFlash("Categoria inválida", "error");
    return;
  }
  if (!name) {
    await setFlash("Indica um nome", "error");
    return;
  }
  // S-04: rejeita URL nao http(s). null se vazio.
  const linkUrl = linkUrlRaw ? safeHttpUrl(linkUrlRaw) : null;
  if (linkUrlRaw && !linkUrl) {
    await setFlash("Link inválido — usa um URL https://… ou deixa em branco.", "error");
    return;
  }
  const fileErr = validateFile(file);
  if (fileErr) {
    await setFlash(fileErr, "error");
    return;
  }

  const patch: Record<string, any> = {
    category,
    name,
    description: description || null,
    price_cents: priceCents,
    link_url: linkUrl,
    updated_at: new Date().toISOString(),
  };

  if (file && file.size > 0) {
    const scope = await getAccessibleTrainerIds();
    const trainerId = (await getCurrentTrainerId()) ?? scope[0];
    if (trainerId) {
      const url = await uploadImage(trainerId, file);
      if (!url) {
        await setFlash("Não foi possível carregar a imagem", "error");
        return;
      }
      patch.image_url = url;
    }
  }

  const supabase = await createClient();
  const { error } = await (supabase as any).from("store_products").update(patch).eq("id", id);
  if (error) {
    logError("updateProductAction", error);
    await setFlash("Não foi possível guardar", "error");
  } else {
    await setFlash("Produto actualizado");
  }
  revalidate();
}

export async function toggleProductAction(formData: FormData) {
  await requireStaff();
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  if (!id) return;
  const supabase = await createClient();
  const { error } = await (supabase as any)
    .from("store_products")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    logError("toggleProductAction", error);
    await setFlash("Não foi possível atualizar", "error");
  } else {
    await setFlash(active ? "Produto activado" : "Produto desactivado");
  }
  revalidate();
}

export async function deleteProductAction(formData: FormData) {
  await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();

  const { data: row } = await (supabase as any)
    .from("store_products")
    .select("image_url")
    .eq("id", id)
    .maybeSingle();

  const { error } = await (supabase as any).from("store_products").delete().eq("id", id);
  if (error) {
    logError("deleteProductAction", error);
    await setFlash("Não foi possível remover", "error");
    revalidate();
    return;
  }

  const path = storagePathFromUrl((row as any)?.image_url ?? null);
  if (path) {
    const admin = createAdminClient();
    const { error: rmErr } = await admin.storage.from(BUCKET).remove([path]);
    if (rmErr) logError("deleteProductAction:storage", rmErr);
  }

  await setFlash("Produto removido");
  revalidate();
}
