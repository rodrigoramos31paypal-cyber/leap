import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVITY_TYPE_LABEL,
  ACTIVITY_TYPE_ICON,
  ACTIVITY_STATUS_LABEL,
  ACTIVITY_STATUS_CHIP,
  type ActivityType,
  type ActivityStatus,
} from "@/lib/activities";
import { ActivityDecide } from "./activity-decide";

type ActivitySub = "pendentes" | "historico";

const DATE_FMT = new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function fmtDate(d: string): string {
  // `d` é uma date "YYYY-MM-DD"; ancorar a meio-dia evita saltos de fuso.
  return DATE_FMT.format(new Date(d + "T12:00:00"));
}

export async function ActivitiesAdmin({
  trainerIds,
  sub,
}: {
  trainerIds: string[];
  sub: ActivitySub;
}) {
  const supabase = await createClient();

  let rows: any[] = [];
  if (trainerIds.length > 0) {
    let query = (supabase as any)
      .from("activities")
      .select("id, client_id, type, activity_date, status, decided_at")
      .in("trainer_id", trainerIds);
    query =
      sub === "pendentes"
        ? query.eq("status", "pending").order("activity_date", { ascending: false })
        : query
            .in("status", ["validated", "rejected"])
            .order("decided_at", { ascending: false })
            .limit(60);
    const { data } = await query;
    rows = (data ?? []) as any[];
  }

  // Nomes dos clientes (2ª query — evita ambiguidade das 2 FKs a profiles).
  const nameById = new Map<string, string | null>();
  const ids = Array.from(new Set(rows.map((r) => r.client_id)));
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    (profs ?? []).forEach((p: any) => nameById.set(p.id, p.full_name));
  }

  const subHref = (s: ActivitySub) =>
    `/admin/leaderboard?tab=atividades${s === "historico" ? "&atab=historico" : ""}`;

  return (
    <div className="space-y-4">
      {/* Sub-filtro Pendentes / Histórico */}
      <div className="v2-segment flex gap-1 text-sm">
        <Link
          href={subHref("pendentes")}
          data-active={sub === "pendentes"}
          className={`v2-seg-item flex flex-1 items-center justify-center px-3 py-2 text-center font-semibold ${
            sub === "pendentes" ? "text-ink-900 dark:text-bone-50" : "text-ink-500 dark:text-bone-100"
          }`}
        >
          Pendentes
        </Link>
        <Link
          href={subHref("historico")}
          data-active={sub === "historico"}
          className={`v2-seg-item flex flex-1 items-center justify-center px-3 py-2 text-center font-semibold ${
            sub === "historico" ? "text-ink-900 dark:text-bone-50" : "text-ink-500 dark:text-bone-100"
          }`}
        >
          Histórico
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-500">
          {sub === "pendentes" ? "Sem atividades a aguardar validação." : "Sem histórico de atividades."}
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const type = r.type as ActivityType;
            const status = r.status as ActivityStatus;
            const Icon = ACTIVITY_TYPE_ICON[type];
            const chip = ACTIVITY_STATUS_CHIP[status];
            return (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-xl border border-ink-900/10 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-ink-800"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-900/[0.04] text-ink-500 dark:bg-white/5 dark:text-bone-100">
                  <Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{nameById.get(r.client_id) || "—"}</div>
                  <div className="text-[11px] text-ink-500">
                    {ACTIVITY_TYPE_LABEL[type]} · {fmtDate(r.activity_date)}
                  </div>
                </div>
                {sub === "pendentes" ? (
                  <ActivityDecide id={r.id} />
                ) : (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.bg} ${chip.text}`}>
                    {ACTIVITY_STATUS_LABEL[status]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
