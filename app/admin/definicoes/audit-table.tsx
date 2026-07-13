"use client";

import { useState } from "react";
import { X, ChevronRight, ArrowRight } from "lucide-react";
import { auditActionLabel } from "./audit-log-labels";
import { getBookingAuditDetail, type BookingAuditDetail } from "./audit-actions";

export type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  actor_name: string | null;
  target_table: string | null;
  target_id: string | null;
  client_name: string | null;
  ip_address: string | null;
  payload: any;
};

// ────────────────────────────────────────────────────────────────
// Formatação (Europe/Lisbon).
// ────────────────────────────────────────────────────────────────
function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-PT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Europe/Lisbon",
    });
  } catch {
    return iso;
  }
}

function fmtDay(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-PT", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Europe/Lisbon",
    });
  } catch {
    return iso;
  }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("pt-PT", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Europe/Lisbon",
    });
  } catch {
    return iso;
  }
}

function fmtSlot(startsAt: string, endsAt: string): string {
  return `${fmtDay(startsAt)} · ${fmtTime(startsAt)}–${fmtTime(endsAt)}`;
}

function durationMin(startsAt: string, endsAt: string): number {
  return Math.max(0, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000));
}

const STATUS_LABELS: Record<string, string> = {
  booked: "Por aceitar",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  no_show: "Falta",
};

const TYPE_LABELS: Record<string, string> = {
  individual: "Individual",
  dupla: "Dupla",
};

// Uma linha é "abrível" (tem detalhes de sessão) quando age sobre uma marcação.
function isBookingRow(r: AuditRow): boolean {
  return r.target_table === "bookings" && !!r.target_id;
}
function isReschedule(r: AuditRow): boolean {
  return r.action.includes("reschedule");
}

// ────────────────────────────────────────────────────────────────
// Modal de detalhe.
// ────────────────────────────────────────────────────────────────
function DetailModal({
  row,
  detail,
  loading,
  onClose,
}: {
  row: AuditRow;
  detail: BookingAuditDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  const reschedule = isReschedule(row);
  // Horário anterior: preferimos o que ficou gravado no payload (funciona
  // mesmo para o reagendamento de ADMIN, que actualiza a marcação no lugar
  // e perderia o "de"). Fallback: o que o servidor conseguir buscar da
  // marcação antiga (rows antigas só têm `from`).
  const payloadPrev =
    reschedule && row.payload?.fromStartsAt && row.payload?.fromEndsAt
      ? {
          startsAt: String(row.payload.fromStartsAt),
          endsAt: String(row.payload.fromEndsAt),
        }
      : null;
  const previous = payloadPrev ?? detail?.previous ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card w-full max-w-md space-y-4 rounded-b-none p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold">{auditActionLabel(row.action)}</h3>
            <p className="text-xs text-ink-500">{fmtDateTime(row.created_at)}</p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-bone-100 dark:hover:bg-white/[0.06]"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        {loading && <p className="text-sm text-ink-500">A carregar detalhes…</p>}

        {!loading && detail && !detail.ok && (
          <p className="text-sm text-red-700">{detail.error ?? "Não foi possível carregar."}</p>
        )}

        {!loading && detail && detail.ok && (
          <div className="space-y-3 text-sm">
            <Field label="Cliente" value={detail.clientName ?? row.client_name ?? "—"} />
            <Field label="Trainer" value={detail.trainerName ?? "—"} />

            {reschedule && previous ? (
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-ink-500">Alteração de horário</div>
                <div className="flex flex-col gap-1 rounded-lg bg-bone-100 p-3 dark:bg-white/[0.04] sm:flex-row sm:items-center sm:gap-2">
                  <span className="text-ink-500 line-through">
                    {fmtSlot(previous.startsAt, previous.endsAt)}
                  </span>
                  <ArrowRight size={14} className="hidden shrink-0 text-ink-500 sm:block" />
                  <span className="font-medium">
                    {detail.startsAt && detail.endsAt
                      ? fmtSlot(detail.startsAt, detail.endsAt)
                      : "—"}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <Field label="Dia" value={detail.startsAt ? fmtDay(detail.startsAt) : "—"} />
                <Field
                  label="Hora"
                  value={
                    detail.startsAt && detail.endsAt
                      ? `${fmtTime(detail.startsAt)}–${fmtTime(detail.endsAt)} (${durationMin(
                          detail.startsAt,
                          detail.endsAt,
                        )} min)`
                      : "—"
                  }
                />
              </>
            )}

            <Field
              label="Tipo"
              value={detail.sessionType ? TYPE_LABELS[detail.sessionType] ?? detail.sessionType : "—"}
            />
            <Field
              label="Estado atual"
              value={detail.status ? STATUS_LABELS[detail.status] ?? detail.status : "—"}
            />
            <Field label="Feito por" value={row.actor_name ?? "Sistema / desconhecido"} />
            <Field label="IP" value={row.ip_address ?? "—"} mono />
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-ink-500">{label}</span>
      <span className={"text-right " + (mono ? "font-mono text-xs" : "")}>{value}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Tabela + cartões.
// ────────────────────────────────────────────────────────────────
export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const [openRow, setOpenRow] = useState<AuditRow | null>(null);
  const [detail, setDetail] = useState<BookingAuditDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const open = async (r: AuditRow) => {
    if (!isBookingRow(r)) return;
    setOpenRow(r);
    setDetail(null);
    setLoading(true);
    try {
      const fromId = isReschedule(r) ? (r.payload?.from as string | undefined) : undefined;
      const d = await getBookingAuditDetail(r.target_id as string, fromId);
      setDetail(d);
    } catch {
      setDetail({ ok: false, error: "Não foi possível carregar os detalhes." });
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setOpenRow(null);
    setDetail(null);
    setLoading(false);
  };

  return (
    <>
      {/* Tabela (desktop) */}
      <div className="card hidden overflow-x-auto p-0 md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink-900/10 text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3 font-medium">Ação</th>
              <th className="px-4 py-3 font-medium">Cliente afetado</th>
              <th className="px-4 py-3 font-medium">Feito por</th>
              <th className="px-4 py-3 font-medium">Data e hora</th>
              <th className="px-4 py-3 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-500">
                  Sem registos para mostrar.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const clickable = isBookingRow(r);
              return (
                <tr
                  key={r.id}
                  onClick={() => open(r)}
                  className={
                    "border-b border-ink-900/5 last:border-0 " +
                    (clickable
                      ? "cursor-pointer hover:bg-bone-100 dark:hover:bg-white/[0.04]"
                      : "")
                  }
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 font-medium">
                      {auditActionLabel(r.action)}
                      {clickable && <ChevronRight size={14} className="text-ink-400" />}
                    </span>
                  </td>
                  <td className="px-4 py-3">{r.client_name ?? "—"}</td>
                  <td className="px-4 py-3">{r.actor_name ?? "Sistema / desconhecido"}</td>
                  <td className="px-4 py-3 tabular-nums">{fmtDateTime(r.created_at)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-500">{r.ip_address ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cartões (mobile) */}
      <div className="space-y-2 md:hidden">
        {rows.length === 0 && (
          <div className="card p-5 text-center text-sm text-ink-500">
            Sem registos para mostrar.
          </div>
        )}
        {rows.map((r) => {
          const clickable = isBookingRow(r);
          return (
            <div
              key={r.id}
              onClick={() => open(r)}
              className={"card space-y-1 p-4 text-sm " + (clickable ? "cursor-pointer" : "")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{auditActionLabel(r.action)}</span>
                {clickable && <ChevronRight size={16} className="shrink-0 text-ink-400" />}
              </div>
              <div className="text-ink-500">
                Cliente: <span className="text-ink-700 dark:text-bone-100">{r.client_name ?? "—"}</span>
              </div>
              <div className="text-ink-500">
                Por: <span className="text-ink-700 dark:text-bone-100">{r.actor_name ?? "Sistema / desconhecido"}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-ink-500">
                <span className="tabular-nums">{fmtDateTime(r.created_at)}</span>
                <span className="font-mono">{r.ip_address ?? "—"}</span>
              </div>
            </div>
          );
        })}
      </div>

      {openRow && (
        <DetailModal row={openRow} detail={detail} loading={loading} onClose={close} />
      )}
    </>
  );
}
