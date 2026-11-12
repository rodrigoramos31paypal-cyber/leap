"use server";

import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { avatarTable, getAvatarAccount } from "./leap-profile-avatar-data";

export async function saveProfileAvatar(form: FormData) {
  const account = await getAvatarAccount();
  if (!account) return { error: "Esta conta não pode alterar o avatar." };

  const choice = form.get("choice");
  if (typeof choice !== "string" || !/^(initials|photo|portrait-([1-9]|1[0-9]|20))$/.test(choice)) {
    return { error: "Escolhe um avatar válido." };
  }

  let photo: string | null = null;
  if (choice === "photo") {
    const file = form.get("photo");
    if (!(file instanceof File)) {
      const { data, error } = await avatarTable().select("choice").eq("profile_id", account.id).maybeSingle();
      return !error && data?.choice === "photo" ? {} : { error: "Escolhe uma foto primeiro." };
    }
    if (file.type !== "image/jpeg" || file.size < 4 || file.size > 256 * 1024) {
      return { error: "A foto preparada tem de ser JPEG e ter até 256 KB." };
    }

    try {
      const input = await file.arrayBuffer();
      const image = sharp(input, { limitInputPixels: 224 * 224, failOn: "warning" });
      const metadata = await image.metadata();
      if (metadata.format !== "jpeg" || metadata.width !== 224 || metadata.height !== 224) {
        return { error: "A foto tem de ter 224 × 224 píxeis." };
      }
      const clean = await image.rotate().jpeg({ quality: 88 }).toBuffer();
      photo = clean.toString("base64");
    } catch {
      return { error: "Não foi possível validar a foto. Escolhe outro ficheiro." };
    }
  }

  const { error } = await avatarTable().upsert({ profile_id: account.id, choice, photo });
  if (error) return { error: "Não foi possível guardar o avatar. Tenta novamente." };

  revalidatePath(account.role === "client" ? "/app/perfil" : "/admin/definicoes");
  return {};
}
