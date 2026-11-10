import "server-only";
import { requireStaff } from "@/lib/authz";
import { chatStaffId, isChatId } from "@/lib/chat";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";

type Group = { id: string; members: string[]; staff_id: string };

export async function groupViewer() {
  const profile = await getCurrentProfile();
  if (!profile || profile.access_blocked) return null;
  if (profile.role === "client") {
    if (profile.approval_status !== "approved") return null;
    return { id: profile.id, staff: false };
  }
  if (!["owner", "trainer"].includes(profile.role)) return null;
  const staff = await requireStaff();
  return { id: chatStaffId(staff.id)!, staff: true };
}

export function groupDb() {
  return createAdminClient() as any;
}

export async function groupContext(id: string) {
  if (!isChatId(id)) return null;
  const viewer = await groupViewer();
  if (!viewer) return null;
  const db = groupDb();
  const { data } = await db.from("leap_group_chats").select("id,members,staff_id").eq("id", id).maybeSingle();
  const group = data as Group | null;
  if (!group || !(viewer.staff ? group.staff_id === viewer.id : group.members.includes(viewer.id))) return null;
  return { db, group, viewer };
}

export async function groupForBooking(booking: string) {
  if (!isChatId(booking)) return null;
  const viewer = await groupViewer();
  if (!viewer) return null;
  const db = groupDb();
  const { data: row } = await db.from("bookings")
    .select("client_id,partner_client_id,partner2_client_id,trainers!inner(profile_id)").eq("id", booking).maybeSingle();
  if (!row || !(viewer.staff ? chatStaffId(row.trainers.profile_id) === viewer.id :
    [row.client_id,row.partner_client_id,row.partner2_client_id].includes(viewer.id))) return null;
  const { data } = await db.rpc("leap_group_for_booking", { p_booking: booking });
  return typeof data === "string" ? data : null;
}

export async function groupNames(db: ReturnType<typeof groupDb>, group: Group) {
  const { data } = await db.from("profiles").select("id,full_name").in("id", [...group.members,group.staff_id]);
  return Object.fromEntries((data ?? []).map((p: { id: string; full_name: string | null }) => [
    p.id, p.full_name?.trim().toLowerCase() === "admin" ? "PT - João Pedro" : p.full_name ?? "LEAP",
  ])) as Record<string,string>;
}


export async function loadGroupInbox(account: string, staff: boolean) {
  const { data, error } = await groupDb().rpc("leap_group_inbox", { p_account: account, p_staff: staff });
  return { rows: ((data ?? []) as import("@/components/conversation-list").Conversation[]).map(row => ({ ...row, group: true })), error };
}
