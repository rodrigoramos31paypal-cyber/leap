"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTrainerId, getAccessibleTrainerIds } from "@/lib/trainer";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";

function revalidate() {
  revalidatePath("/admin/promocoes");
  revalidatePath("/app/dashboard");
}

export async function createBannerAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const subtitle = String(formData.get("subtitle") ?? "").trim();
  const imageUrl = String(formData.get("image_url") ?? "").trim();
  const buttonLabel = String(formData.get("button_label") ?? "").trim();
  const linkUrl = String(formData.get("link_url") ?? "").trim();
  if (!title) {
    setFlash("Indica um título", "error");
    return;
  }
  const trainerId = (await getCurrentTrainerId()) ?? (await getAccessibleTrainerIds())[0];
  if (!trainerId) {
    setFlash("Sem trainer associado", "error");
    return;
  }
  const supabase = createClient();
  const { error } = await (supabase as any).from("promo_banners").insert({
    trainer_id: trainerId,
    title,
    subtitle: subtitle || null,
    image_url: imageUrl || null,
    button_label: buttonLabel || null,
    link_url: linkUrl || null,
  });
  if (error) {
    logError("createBannerAction", error);
    setFlash("Não foi possível criar o banner", "error");
  } else {
    setFlash("Banner criado");
  }
  revalidate();
}

export async function toggleBannerAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  if (!id) return;
  const supabase = createClient();
  const { error } = await (supabase as any)
    .from("promo_banners")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    logError("toggleBannerAction", error);
    setFlash("Não foi possível atualizar", "error");
  } else {
    setFlash(active ? "Banner activado" : "Banner desactivado");
  }
  revalidate();
}

export async function deleteBannerAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createClient();
  const { error } = await (supabase as any).from("promo_banners").delete().eq("id", id);
  if (error) {
    logError("deleteBannerAction", error);
    setFlash("Não foi possível remover", "error");
  } else {
    setFlash("Banner removido");
  }
  revalidate();
}
