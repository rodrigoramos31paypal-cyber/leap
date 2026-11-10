import { reactivationDb, reactivationScope, type ReactivationAlert } from "@/lib/reactivation";
import { ReactivationPanel, type ReactivationRow } from "./reactivation-panel";

export async function ReactivationDashboard() {
  const scope = await reactivationScope();
  if (!scope) return null;
  const db = reactivationDb();
  const [{ data: latest, error }, { data: summary, error: summaryError }] = await Promise.all([
    db.from("leap_reactivation_weeks").select("week_at").order("week_at", { ascending: false }).limit(1).maybeSingle(),
    db.rpc("leap_reactivation_summary", { p_trainers: scope.trainers }),
  ]);
  if (error || summaryError) return <p className="card p-3 text-sm">Reativação indisponível.</p>;
  if (!latest) return <ReactivationPanel rows={[]} summary={summary} />;
  let query = db.from("leap_reactivation_alerts").select("*").eq("week_at", latest.week_at);
  if (scope.trainers?.length) query = query.in("trainer_id", scope.trainers);
  const { data, error: alertsError } = scope.trainers?.length === 0 ? { data: [], error: null } : await query;
  if (alertsError) return <p className="card p-3 text-sm">Não foi possível carregar os alertas.</p>;
  const alerts = (data ?? []) as ReactivationAlert[];
  const ids = alerts.map(row => row.client_id);
  if (!ids.length) return <ReactivationPanel rows={[]} summary={summary} />;
  const [profiles, preferences, messages, upcoming] = await Promise.all([
    db.from("profiles").select("id,full_name").in("id", ids).eq("approval_status", "approved").or("access_blocked.is.null,access_blocked.eq.false"),
    db.from("leap_reactivation_preferences").select("client_id,disabled,snooze_until").in("client_id", ids),
    db.from("leap_reactivation_messages").select("client_id").in("client_id", ids)
      .gte("sent_at", new Date(Math.min(Date.parse(latest.week_at), Date.now()-7*86400000)).toISOString()),
    db.rpc("leap_reactivation_clients_with_bookings", { p_clients: ids }),
  ]);
  if (profiles.error || preferences.error || messages.error || upcoming.error) return <p className="card p-3 text-sm">Não foi possível carregar os alertas.</p>;
  const names = new Map<string, string>(profiles.data.map((row: { id: string; full_name: string }) => [row.id, row.full_name]));
  const hidden = new Set(preferences.data.filter((row: { disabled: boolean; snooze_until: string | null }) =>
    row.disabled || (row.snooze_until && Date.parse(row.snooze_until) > Date.now())).map((row: { client_id: string }) => row.client_id));
  const sent = new Set(messages.data.map((row: { client_id: string }) => row.client_id));
  const booked = new Set<string>(upcoming.data ?? []);
  const rows: ReactivationRow[] = alerts.filter(row => names.has(row.client_id) && !hidden.has(row.client_id) && !booked.has(row.client_id))
    .map(row => ({ ...row, name: names.get(row.client_id) || "Cliente", sent: sent.has(row.client_id) }));
  const order = ["level3", "level2", "level1", "empty", "low", "misses"];
  rows.sort((a,b) => order.indexOf(a.reasons[0])-order.indexOf(b.reasons[0]) || a.name.localeCompare(b.name,"pt"));
  return <ReactivationPanel week={latest.week_at} rows={rows} summary={summary} />;
}
