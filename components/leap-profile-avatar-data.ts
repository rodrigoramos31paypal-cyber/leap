import "server-only";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { isMfaSatisfied } from "@/lib/mfa";

export type ProfileAvatar = { choice: string | null; photo: string | null };

const ownerId = "c4a7bb71-540e-4d41-ad53-c49f7085602b";

export function isMainAvatarOwner(profile: { id: string; role: string }) {
  return profile.id === ownerId && profile.role === "owner";
}

export async function getAvatarAccount() {
  const profile = await getCurrentProfile();
  if (!profile || profile.access_blocked) return null;
  if (profile.role === "client") return profile.approval_status === "approved" ? profile : null;
  return await isMfaSatisfied(profile.id) ? profile : null;
}

// This table is only accessible to the service role. Its payload never goes
// to public athlete profiles or ranking queries.
export function avatarTable() {
  return (createAdminClient() as unknown as import("@supabase/supabase-js").SupabaseClient)
    .from("leap_profile_avatars");
}

export async function loadOwnAvatar(id: string): Promise<ProfileAvatar> {
  const account = await getAvatarAccount();
  if (account?.id !== id) return { choice: null, photo: null };
  const { data } = await avatarTable().select("choice, photo").eq("profile_id", id).maybeSingle();
  return {
    choice: data?.choice ?? null,
    photo: data?.photo ? `data:image/jpeg;base64,${data.photo}` : null,
  };
}

export async function loadVisiblePortrait(id: string): Promise<string | null> {
  const { data } = await avatarTable().select("choice").eq("profile_id", id).like("choice", "portrait-%").maybeSingle();
  return data?.choice ?? null;
}
