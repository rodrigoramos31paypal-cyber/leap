"use server";

import { chatContext, isChatId } from "@/lib/chat";
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

  const comment = form.get("comment");
  if (comment !== null && (typeof comment !== "string" || comment.trim().length > 300)) {
    return { error: "O comentário pode ter até 300 caracteres." };
  }

  const minutes = Number(form.get("minutes"));
  const distanceText = String(form.get("distance") ?? "").trim().replace(",", ".");
  const distance = distanceText ? Number(distanceText) : null;
  const submission = form.get("submission");
  if (type === "cardio" && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440 ||
      (distance !== null && (!Number.isFinite(distance) || distance <= 0 || distance > 1000)) || !isChatId(submission))) {
    return { error: "Indica os minutos e uma distância válida, se a preencheres." };
  }
  const context = type === "cardio" && typeof comment === "string" && comment.trim() ? await chatContext() : null;
  if (type === "cardio" && typeof comment === "string" && comment.trim() && !context) {
    return { error: "Não foi possível associar o comentário ao chat. Tenta novamente." };
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
  const params = {
    p_client: account.id, p_type: type, p_jpeg: jpeg.toString("base64"),
    p_comment: typeof comment === "string" ? comment.trim() : null,
  };
  const { error } = type === "cardio"
    ? await db.rpc("log_cardio_with_proof", {
        p_client: account.id, p_jpeg: params.p_jpeg, p_comment: params.p_comment,
        p_minutes: minutes, p_distance: distance, p_submission: submission, p_staff: context?.staffId ?? null,
      })
    : await db.rpc("log_activity_with_proof", params);
  if (error) return { error: "Não foi possível registar a atividade. Tenta novamente." };
  revalidatePath("/app/mensagens");
  revalidatePath("/admin/mensagens");
  revalidatePath("/admin/leaderboard");
  revalidatePath("/app/dashboard");
  revalidatePath("/app/perfil");
  revalidatePath("/app/historico");
  return { ok: true as const };
}
