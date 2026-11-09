import "server-only";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/authz";
import { getTrainerForClient } from "@/lib/trainer";

export type ChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  booking_id: string | null;
  read_at: string | null;
  booking_starts_at: string | null;
};

export function isChatId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

export async function chatContext(clientId?: string) {
  const profile = await getCurrentProfile();
  if (!profile || profile.access_blocked) return null;
  const db = createAdminClient();
  if (clientId !== undefined) {
    if (!isChatId(clientId)) return null;
    const staff = await requireStaff();
    const { data: client } = await db.from("profiles")
      .select("id,full_name,role").eq("id", clientId).eq("role", "client").maybeSingle();
    if (!client) return null;
    // A staff member can open a thread only if assigned or already a participant.
    const trainerId = await getTrainerForClient(clientId);
    const { data: trainer } = trainerId
      ? await db.from("trainers").select("profile_id").eq("id", trainerId).eq("active", true).maybeSingle()
      : { data: null };
    if (trainer?.profile_id !== staff.id) {
      const { data } = await (db as any).from("leap_chat_messages").select("id")
        .eq("client_id", clientId).eq("staff_id", staff.id).limit(1).maybeSingle();
      if (!data) return null;
    }
    return { db, clientId, staffId: staff.id, userId: staff.id, name: client.full_name, staff: true };
  }
  if (profile.role !== "client" || profile.approval_status !== "approved") return null;
  const trainerId = await getTrainerForClient(profile.id);
  if (!trainerId) return null;
  const { data: trainer } = await db.from("trainers").select("profile_id").eq("id", trainerId).eq("active", true).maybeSingle();
  if (!trainer) return null;
  const { data: staff } = await db.from("profiles").select("id,full_name,role,access_blocked").eq("id", trainer.profile_id).maybeSingle();
  if (!staff || staff.access_blocked || !["owner", "trainer"].includes(staff.role)) return null;
  return { db, clientId: profile.id, staffId: staff.id, userId: profile.id, name: staff.full_name, staff: false };
}

export async function getChatBooking(context: NonNullable<Awaited<ReturnType<typeof chatContext>>>, id: string) {
  if (!isChatId(id)) return null;
  const { data } = await (context.db as any).from("bookings")
    .select("id,starts_at,trainers!inner(profile_id)")
    .eq("id", id)
    .eq("trainers.profile_id", context.staffId)
    .or(`client_id.eq.${context.clientId},partner_client_id.eq.${context.clientId},partner2_client_id.eq.${context.clientId}`)
    .maybeSingle();
  return data as { id: string; starts_at: string } | null;
}
