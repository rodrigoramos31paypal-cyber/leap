"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/authz";
import { isChatId } from "@/lib/chat";
import { getTrainerForClient } from "@/lib/trainer";
import { getReactivationAlert, reactivationDb, reactivationScope } from "@/lib/reactivation";

export async function claimReactivationPopup(week: string) {
  const staff = await requireStaff();
  const db = reactivationDb();
  const { data: latest } = await db.from("leap_reactivation_weeks").select("week_at")
    .order("week_at", { ascending: false }).limit(1).maybeSingle();
  if (latest?.week_at !== week) return false;
  const { data, error } = await db.from("leap_reactivation_seen").upsert(
    { staff_id: staff.id, week_at: week }, { onConflict: "staff_id,week_at", ignoreDuplicates: true }
  ).select("week_at");
  return !error && !!data?.length;
}

export async function snoozeReactivation(id: string, duration: "week" | "month") {
  await requireStaff();
  if (duration !== "week" && duration !== "month") return false;
  const row = await getReactivationAlert(id);
  if (!row) return false;
  const db = reactivationDb();
  const { data: latest } = await db.from("leap_reactivation_weeks").select("week_at")
    .order("week_at", { ascending: false }).limit(1).maybeSingle();
  if (latest?.week_at !== row.week_at) return false;
  // Next scan may be one hour earlier UTC when summer time starts.
  const until = duration === "week" ? Date.parse(row.week_at) + (7 * 24 - 2) * 3600000 : Date.now() + 30 * 86400000;
  const { error } = await db.from("leap_reactivation_preferences")
    .upsert({ client_id: row.client_id, snooze_until: new Date(until).toISOString() }, { onConflict: "client_id" });
  if (!error) revalidatePath("/admin/dashboard");
  return !error;
}

export async function setReactivationPreference(form: FormData) {
  await requireStaff();
  const id = form.get("clientId");
  const scope = await reactivationScope();
  if (!isChatId(id) || !scope) return;
  if (scope.trainers && !scope.trainers.includes((await getTrainerForClient(id)) ?? "")) return;
  const db = reactivationDb();
  const { data: client } = await db.from("profiles").select("id").eq("role", "client").eq("id", id).maybeSingle();
  if (!client) return;
  const { error } = await db.from("leap_reactivation_preferences").upsert(
    { client_id: id, disabled: form.get("disabled") === "true" }, { onConflict: "client_id" }
  );
  if (error) throw new Error("Não foi possível guardar a preferência de alertas.");
  revalidatePath(`/admin/clientes/${id}`);
  revalidatePath("/admin/dashboard");
}
