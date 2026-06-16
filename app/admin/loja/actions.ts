"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentTrainerId, getAccessibleTrainerIds } from "@/lib/trainer";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";

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

export async function createProductAction(formData: FormData) {
  const category = String(formData.get("category") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const linkUrl = String(formData.get("link_url") ?? "").trim();
  const priceCents = parsePriceCents(String(formData.get("price") ?? ""));
  const file = formData.get("file") as File | null;

  if (!CATEGORIES.includes(category)) {
    setFlash("Categoria inválida", "error");
    return;
  }
  if (!name) {
    setFlash("Indica um nome", "error");
    return;
  }
  const fileErr = validateFile(file);
  if (fileErr) {
    setFlash(fileErr, "error");
    return;
  }

  const scope = await getAccessibleTrainerIds();
  const trainerId = (await getCurrentTrainerId()) ?? scope[0];
  if (!trainerId) {
    setFlash("Sem trainer associado", "error");
    return;
  }

  let imageUrl: string | null = null;
  if (file && file.size > 0) {
    imageUrl = await uploadImage(trainerId, file);
    if (!imageUrl) {
      setFlash("Não foi possível carregar a imagem", "error");
      return;
    }
  }

  const supabase = createClient();
  const { error } = await (supabase as any).from("store_products").insert({
    trainer_id: trainerId,
    category,
    name,
    description: description || null,
    price_cents: priceCents,
    image_url: imageUrl,
    link_url: linkUrl || null,
  });
  if (error) {
    logError("createProductAction", error);
    setFlash("Não foi possível criar o produto", "error");
  } else {
    setFlash("Produto criado");
  }
  revalidate();
}

export async function updateProductAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const category = String(formData.get("category") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const linkUrl = String(formData.get("link_url") ?? "").trim();
  const priceCents = parsePriceCents(String(formData.get("price") ?? ""));
  const file = formData.get("file") as File | null;

  if (!id) return;
  if (!CATEGORIES.includes(category)) {
    setFlash("Categoria inválida", "error");
    return;
  }
  if (!name) {
    setFlash("Indica um nome", "error");
    return;
  }
  const fileErr = validateFile(file);
  if (fileErr) {
    setFlash(fileErr, "error");
    return;
  }

  const patch: Record<string, any> = {
    category,
    name,
    description: description || null,
    price_cents: priceCents,
    link_url: linkUrl || null,
    updated_at: new Date().toISOString(),
  };

  if (file && file.size > 0) {
    const scope = await getAccessibleTrainerIds();
    const trainerId = (await getCurrentTrainerId()) ?? scope[0];
    if (trainerId) {
      const url = await uploadImage(trainerId, file);
      if (!url) {
        setFlash("Não foi possível carregar a imagem", "error");
        return;
      }
      patch.image_url = url;
    }
  }

  const supabase = createClient();
  const { error } = await (supabase as any).from("store_products").update(patch).eq("id", id);
  if (error) {
    logError("updateProductAction", error);
    setFlash("Não foi possível guardar", "error");
  } else {
    setFlash("Produto actualizado");
  }
  revalidate();
}

export async function toggleProductAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  if (!id) return;
  const supabase = createClient();
  const { error } = await (supabase as any)
    .from("store_products")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    logError("toggleProductAction", error);
    setFlash("Não foi possível atualizar", "error");
  } else {
    setFlash(active ? "Produto activado" : "Produto desactivado");
  }
  revalidate();
}

export async function deleteProductAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createClient();

  const { data: row } = await (supabase as any)
    .from("store_products")
    .select("image_url")
    .eq("id", id)
    .maybeSingle();

  const { error } = await (supabase as any).from("store_products").delete().eq("id", id);
  if (error) {
    logError("deleteProductAction", error);
    setFlash("Não foi possível remover", "error");
    revalidate();
    return;
  }

  const path = storagePathFromUrl((row as any)?.image_url ?? null);
  if (path) {
    const admin = createAdminClient();
    const { error: rmErr } = await admin.storage.from(BUCKET).remove([path]);
    if (rmErr) logError("deleteProductAction:storage", rmErr);
  }

  setFlash("Produto removido");
  revalidate();
}
