import "server-only";
import { requireStaff } from "@/lib/authz";
import { isChatId } from "@/lib/chat";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import type { WeighIn } from "./weigh-in-metrics";

export async function weighInAccess(clientId?: string) {
  const viewer = await getCurrentProfile();
  if (!viewer || viewer.access_blocked) return null;
  const db = createAdminClient() as any;
  if (viewer.role === "client") {
    if (viewer.approval_status !== "approved" || (clientId && clientId !== viewer.id)) return null;
    return { db, viewerId: viewer.id, clientId: viewer.id };
  }
  if (!isChatId(clientId) || !["owner","trainer"].includes(viewer.role)) return null;
  await requireStaff();
  const { data: client } = await db.from("profiles").select("id,trainer_id")
    .eq("id", clientId).eq("role","client").not("email","ilike","%@removido.invalid").maybeSingle();
  if (!client) return null;
  if (viewer.role === "trainer" && !(await getAccessibleTrainerIds()).includes(client.trainer_id ?? "")) return null;
  return { db, viewerId: viewer.id, clientId };
}

export async function loadWeighIns(clientId?: string): Promise<WeighIn[] | null> {
  const access = await weighInAccess(clientId);
  if (!access) return null;
  const entries: WeighIn[] = [];
  const pageSize = 250;
  while (true) {
    const { data, error } = await access.db.from("leap_weigh_ins").select(
      "id,measured_on,weight,muscle,fat_mass,fat_percent,total_muscle,water,visceral_fat,note,source"
    ).eq("client_id", access.clientId)
      .order("measured_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(entries.length, entries.length + pageSize - 1);
    if (error) throw new Error("Não foi possível carregar as pesagens.");
    entries.push(...(data ?? []));
    if (!data || data.length < pageSize) return entries;
  }
}
