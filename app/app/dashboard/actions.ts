"use server";

import sharp from "sharp";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function logActivityAction(type: "autonomous" | "cardio", form: FormData) {
  const account = await getCurrentProfile();
  if (account?.role !== "client" || account.access_blocked || account.approval_status !== "approved") {
    return { error: "Esta conta não pode registar atividades." };
  }
  if (type !== "autonomous" && type !== "cardio") {
    return { error: "Tipo de atividade inválido." };
  }

  const file = form.get("proof");
  if (!(file instanceof File) || !file.size || file.size > 512_000) {
    return { error: "Escolhe uma foto válida para o comprovativo." };
  }

  let jpeg: Buffer;
  try {
    const image = sharp(await file.arrayBuffer(), { limitInputPixels: 4_000_000, failOn: "warning" });
    if (!["jpeg", "png", "webp"].includes((await image.metadata()).format ?? "")) {
      return { error: "Escolhe uma imagem JPEG, PNG ou WebP." };
    }
    jpeg = await image.rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "white" }).jpeg({ quality: 82 }).toBuffer();
    if (jpeg.length > 500_000) return { error: "A imagem é demasiado grande. Experimenta outra foto." };
  } catch {
    return { error: "Não foi possível abrir esta imagem." };
  }

  const db = createAdminClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  const { error } = await db.rpc("log_activity_with_proof", {
    p_client: account.id, p_type: type, p_jpeg: jpeg.toString("base64"),
  });
  if (error) return { error: "Não foi possível registar a atividade. Tenta novamente." };
  revalidatePath("/app/dashboard");
  revalidatePath("/app/perfil");
  revalidatePath("/app/historico");
  return { ok: true as const };
}
