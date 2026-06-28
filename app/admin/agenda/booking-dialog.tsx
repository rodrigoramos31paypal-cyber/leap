"use client";

// ════════════════════════════════════════════════════════════════
// BookingDialog · marcar uma sessão a partir da Agenda.
//
// - Abre via botão "Nova marcação" (vista de dia / geral) OU ao clicar
//   num horário vazio da grelha da semana (evento `agenda:newbooking`
//   despoletado pelo SlotClickLayer, com { date, time }).
// - Permite escolher um cliente JÁ existente (typeahead) ou criar um
//   NOVO cliente no momento (nome obrigatório; email/telefone opcionais).
// - O trainer escolhe se desconta 1 sessão do saldo do cliente ou se a
//   marca como sessão grátis.
// ════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, CalendarPlus, Package, Search, UserPlus, X } from "lucide-react";
import { eur } from "@/lib/utils";
import { searchClientsAction, type ClientHit } from "@/app/admin/clientes/search-action";
import { createAgendaBookingAction, createBusyAction, getBookingClientHintsAction } from "./actions";

type PackLite = { id: string; name: string; sessions: number; price_cents: number };

const TIME_OPTIONS = Array.from({ length: 59 }, (_, i) => {
  const total = 7 * 60 + i * 15; // 07:00 → 21:30, passos de 15 min
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}); // 07:00 → 21:30

// Horas 00:00 → 23:45 (separador "Ocupado", que cobre o dia todo), passos de 15 min.
const BUSY_TIMES = Array.from({ length: 96 }, (_, i) => {
  const total = i * 15;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

// 0 = domingo … 6 = sábado (convenção de trainer_availability / Postgres dow).
const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
function weekdayOf(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? 1 : d.getUTCDay();
}

export function BookingDialog({
  trainerId,
  durations,
  defaultDuration,
  viewedDate,
  packs,
  hideTrigger = false,
}: {
  trainerId: string;
  durations: number[];
  defaultDuration: number;
  viewedDate: string; // ISO yyyy-mm-dd
  packs: PackLite[];
  // Quando true, não renderiza o botão "Nova marcação" — o diálogo
  // só abre via evento `agenda:newbooking` (clique num slot da grelha).
  hideTrigger?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Separador principal: marcar uma sessão vs marcar tempo ocupado.
  const [tab, setTab] = useState<"session" | "busy">("session");

  // Campos
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [date, setDate] = useState(viewedDate);
  const [time, setTime] = useState("08:00");

  // Separador "Ocupado"
  const [busyFrom, setBusyFrom] = useState("11:00");
  const [busyTo, setBusyTo] = useState("17:00");
  // Pausa livre dentro do bloqueio ("split-on-save"). Aplica-se a todos
  // os âmbitos (só este dia / intervalo / semanal).
  const [busyHasFree, setBusyHasFree] = useState(false);
  const [busyFreeFrom, setBusyFreeFrom] = useState("12:30");
  const [busyFreeTo, setBusyFreeTo] = useState("14:00");
  const [busyReason, setBusyReason] = useState("");
  const [busyScope, setBusyScope] = useState<"single" | "range" | "recurring">("single");
  const [busyDateFrom, setBusyDateFrom] = useState(viewedDate);
  const [busyDateTo, setBusyDateTo] = useState(viewedDate);
  const [busyWeekdays, setBusyWeekdays] = useState<Set<number>>(new Set([weekdayOf(viewedDate)]));
  const [replaceRecurring, setReplaceRecurring] = useState(false);
  const [duration, setDuration] = useState(String(defaultDuration));
  const [sessionType, setSessionType] = useState<"individual" | "dupla">("individual");
  const [deduct, setDeduct] = useState(true);

  // Cliente existente (typeahead)
  const [picked, setPicked] = useState<ClientHit | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [listOpen, setListOpen] = useState(false);

  // Cliente novo
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");

  // Adicionar sessões/pack
  const hasPacks = packs.length > 0;
  const [grant, setGrant] = useState(false);
  const [grantMode, setGrantMode] = useState<"pack" | "custom">(hasPacks ? "pack" : "custom");
  const [grantPackId, setGrantPackId] = useState(hasPacks ? packs[0].id : "");
  const [grantSessions, setGrantSessions] = useState("1");
  const [grantPrice, setGrantPrice] = useState("0");
  const [grantMethod, setGrantMethod] = useState("manual_mbway");

  function reset() {
    setTab("session");
    setBusyFrom("11:00");
    setBusyTo("17:00");
    setBusyHasFree(false);
    setBusyFreeFrom("12:30");
    setBusyFreeTo("14:00");
    setBusyReason("");
    setBusyScope("single");
    setBusyDateFrom(viewedDate);
    setBusyDateTo(viewedDate);
    setBusyWeekdays(new Set([weekdayOf(viewedDate)]));
    setReplaceRecurring(false);
    setMode("existing");
    setDate(viewedDate);
    setTime("08:00");
    setDuration(String(defaultDuration));
    setSessionType("individual");
    setDeduct(true);
    setPicked(null);
    setQ("");
    setHits([]);
    setListOpen(false);
    setNewName("");
    setNewEmail("");
    setNewPhone("");
    setGrant(false);
    setGrantMode(hasPacks ? "pack" : "custom");
    setGrantPackId(hasPacks ? packs[0].id : "");
    setGrantSessions("1");
    setGrantPrice("0");
    setGrantMethod("manual_mbway");
    setError(null);
  }

  // Abrir a partir de clique num horário da grelha (SlotClickLayer)
  useEffect(() => {
    function onNewBooking(e: Event) {
      const detail = (e as CustomEvent).detail as { date?: string; time?: string };
      reset();
      if (detail?.date) {
        setDate(detail.date);
        setBusyWeekdays(new Set([weekdayOf(detail.date)]));
      }
      if (detail?.time) setTime(detail.time);
      setOpen(true);
    }
    window.addEventListener("agenda:newbooking", onNewBooking as EventListener);
    return () => window.removeEventListener("agenda:newbooking", onNewBooking as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedDate, defaultDuration]);

  // Fecho com Esc
  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open]);

  // Typeahead de clientes (debounced)
  useEffect(() => {
    if (mode !== "existing") return;
    const term = q.trim();
    if (term.length === 0) {
      setHits([]);
      setListOpen(false);
      return;
    }
    const id = window.setTimeout(() => {
      startTransition(async () => {
        try {
          const r = await searchClientsAction(term);
          setHits(r);
          setListOpen(true);
        } catch {
          setHits([]);
        }
      });
    }, 200);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, mode]);

  // DUO: ao escolher um cliente com PAR activo, arranca o dropdown "Tipo"
  // em "Dupla" — assume-se que o trainer está a marcar uma sessão dupla
  // para o par. O admin pode mudar para "Individual" no dropdown se for
  // mesmo uma sessão individual (nesse caso desconta só ao próprio).
  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    (async () => {
      try {
        const hints = await getBookingClientHintsAction(picked.id, trainerId);
        if (cancelled) return;
        if (hints.hasPartner) {
          setSessionType("dupla");
        }
      } catch {
        /* silencioso — fica no default actual */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked?.id, trainerId]);

  // Quando troca para "novo cliente", a sessão grátis é o default
  // (cliente acabado de criar não tem pack). Para existente, descontar.
  function switchMode(next: "existing" | "new") {
    setMode(next);
    setError(null);
    // Novo cliente começa sem saldo → por defeito adicionamos sessões.
    setGrant(next === "new");
    setDeduct(true);
  }

  function submit() {
    setError(null);

    if (mode === "existing" && !picked) {
      setError("Escolhe um cliente.");
      return;
    }
    if (mode === "new" && !newName.trim()) {
      setError("Indica o nome do novo cliente.");
      return;
    }
    if (grant && grantMode === "custom" && (!Number(grantSessions) || Number(grantSessions) <= 0)) {
      setError("Indica um número de sessões válido para adicionar.");
      return;
    }
    if (grant && grantMode === "pack" && !grantPackId) {
      setError("Escolhe um pack para adicionar.");
      return;
    }

    const fd = new FormData();
    fd.set("trainerId", trainerId);
    fd.set("mode", mode);
    fd.set("date", date);
    fd.set("time", time);
    fd.set("durationMin", duration);
    fd.set("sessionType", sessionType);
    fd.set("deduct", deduct ? "true" : "false");
    if (mode === "existing") {
      fd.set("clientId", picked!.id);
    } else {
      fd.set("new_name", newName.trim());
      fd.set("new_email", newEmail.trim());
      fd.set("new_phone", newPhone.trim());
    }
    fd.set("grant", grant ? "true" : "false");
    if (grant) {
      fd.set("grant_mode", grantMode);
      fd.set("grant_pack_id", grantPackId);
      fd.set("grant_sessions", grantSessions);
      fd.set("grant_price_euros", grantPrice);
      fd.set("grant_method", grantMethod);
    }

    startTransition(async () => {
      const res = await createAgendaBookingAction(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  function submitBusy() {
    setError(null);
    if (busyTo <= busyFrom) {
      setError("A hora de fim tem de ser depois do início.");
      return;
    }
    if (busyHasFree) {
      if (busyFreeTo <= busyFreeFrom) {
        setError("A pausa livre: o fim tem de ser depois do início.");
        return;
      }
      if (busyFreeFrom < busyFrom || busyFreeTo > busyTo) {
        setError("A pausa livre tem de estar dentro do intervalo ocupado.");
        return;
      }
      if (busyFreeFrom === busyFrom && busyFreeTo === busyTo) {
        setError("A pausa livre não pode cobrir todo o intervalo.");
        return;
      }
    }
    if (busyScope === "recurring" && busyWeekdays.size === 0) {
      setError("Escolhe pelo menos um dia da semana.");
      return;
    }
    if (busyScope === "range") {
      if (!busyDateFrom || !busyDateTo) {
        setError("Indica as datas de início e fim.");
        return;
      }
      if (busyDateTo < busyDateFrom) {
        setError("A data de fim tem de ser igual ou depois da de início.");
        return;
      }
    }
    const fd = new FormData();
    fd.set("trainerId", trainerId);
    fd.set("mode", busyScope);
    fd.set("date", date);
    fd.set("from", busyFrom);
    fd.set("to", busyTo);
    if (busyHasFree) {
      fd.set("freeFrom", busyFreeFrom);
      fd.set("freeTo", busyFreeTo);
    }
    fd.set("reason", busyReason.trim());
    if (busyScope === "recurring") {
      fd.set("weekdays", Array.from(busyWeekdays).join(","));
    } else if (busyScope === "range") {
      fd.set("dateFrom", busyDateFrom);
      fd.set("dateTo", busyDateTo);
    } else if (replaceRecurring) {
      fd.set("replaceRecurring", "true");
    }
    startTransition(async () => {
      const res = await createBusyAction(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  function toggleWeekday(dow: number) {
    setBusyWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(dow)) next.delete(dow);
      else next.add(dow);
      return next;
    });
  }

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(true);
          }}
          className="btn-primary inline-flex items-center gap-1.5"
        >
          <CalendarPlus size={16} /> Nova marcação
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-ink-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">
                {tab === "busy" ? "Marcar indisponível" : "Marcar sessão"}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-ink-500 hover:bg-ink-900/5"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {/* Separador principal: Sessão vs Ocupado */}
            <div className="mb-4 inline-flex w-full items-center gap-1 rounded-lg border border-ink-900/10 bg-bone-50 p-1 text-sm dark:border-white/10 dark:bg-ink-900">
              <button
                type="button"
                onClick={() => { setTab("session"); setError(null); }}
                className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                  tab === "session" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                }`}
              >
                Sessão
              </button>
              <button
                type="button"
                onClick={() => { setTab("busy"); setError(null); }}
                className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                  tab === "busy" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                }`}
              >
                Ocupado
              </button>
            </div>

            {tab === "session" && (
            <>
            {/* Modo: cliente existente vs novo */}
            <div className="mb-4 inline-flex w-full items-center gap-1 rounded-lg border border-ink-900/10 bg-bone-50 p-1 text-sm dark:border-white/10 dark:bg-ink-900">
              <button
                type="button"
                onClick={() => switchMode("existing")}
                className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                  mode === "existing" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                }`}
              >
                Cliente existente
              </button>
              <button
                type="button"
                onClick={() => switchMode("new")}
                className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                  mode === "new" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                }`}
              >
                Novo cliente
              </button>
            </div>

            {/* Selecção / criação do cliente */}
            {mode === "existing" ? (
              <div className="relative mb-4">
                <label className="label">Cliente</label>
                {picked ? (
                  <div className="flex items-center justify-between rounded-lg border border-ink-900/10 bg-bone-50 px-3 py-2 dark:border-white/10 dark:bg-ink-900">
                    <div>
                      <div className="text-sm font-semibold">{picked.full_name || "(sem nome)"}</div>
                      {picked.email && <div className="text-xs text-ink-500">{picked.email}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(null);
                        setQ("");
                      }}
                      className="text-xs font-medium text-ink-500 hover:text-ink-900"
                    >
                      Mudar
                    </button>
                  </div>
                ) : (
                  <>
                    <Search size={16} className="absolute left-3 top-[34px] text-ink-500" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onFocus={() => hits.length > 0 && setListOpen(true)}
                      placeholder="Procurar por nome, email ou telefone…"
                      autoComplete="off"
                      className="input pl-9"
                    />
                    {listOpen && hits.length > 0 && (
                      <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-ink-900/10 bg-white shadow-lg dark:border-white/10 dark:bg-ink-800">
                        <ul>
                          {hits.map((h) => (
                            <li key={h.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setPicked(h);
                                  setListOpen(false);
                                }}
                                className="block w-full border-b border-ink-900/5 px-3 py-2 text-left text-sm last:border-0 hover:bg-ink-900/5"
                              >
                                <div className="font-semibold">{h.full_name || "(sem nome)"}</div>
                                {h.email && <div className="text-xs text-ink-500">{h.email}</div>}
                                {h.phone && <div className="text-xs text-ink-500">{h.phone}</div>}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="mb-4 space-y-3">
                <div>
                  <label className="label" htmlFor="new_name">Nome *</label>
                  <input
                    id="new_name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Nome do cliente"
                    className="input"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="new_email">Email (opcional)</label>
                    <input
                      id="new_email"
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="email@exemplo.pt"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="new_phone">Telefone (opcional)</label>
                    <input
                      id="new_phone"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="9xx xxx xxx"
                      className="input"
                    />
                  </div>
                </div>
                <p className="inline-flex items-start gap-1.5 text-[11px] text-ink-500">
                  <UserPlus size={12} className="mt-0.5 shrink-0" />
                  O cliente é criado sem necessidade de login. Podes enviar-lhe acesso mais tarde.
                </p>
              </div>
            )}

            {/* Dia + hora */}
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="label" htmlFor="bk_date">Dia</label>
                <input
                  id="bk_date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input block min-w-0 max-w-full appearance-none"
                />
              </div>
              <div className="min-w-0">
                <label className="label" htmlFor="bk_time">Hora</label>
                <select id="bk_time" value={time} onChange={(e) => setTime(e.target.value)} className="input">
                  {/* garante que uma hora vinda do clique (mesmo fora da lista) aparece */}
                  {!TIME_OPTIONS.includes(time) && <option value={time}>{time}</option>}
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Duração + tipo */}
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="bk_dur">Duração</label>
                <select id="bk_dur" value={duration} onChange={(e) => setDuration(e.target.value)} className="input">
                  {durations.map((d) => (
                    <option key={d} value={d}>{d} min</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="bk_type">Tipo</label>
                <select
                  id="bk_type"
                  value={sessionType}
                  onChange={(e) => setSessionType(e.target.value as "individual" | "dupla")}
                  className="input"
                >
                  <option value="individual">Individual</option>
                  <option value="dupla">Dupla</option>
                </select>
              </div>
            </div>

            {/* Adicionar sessões / pack */}
            <div className="mb-3 rounded-lg border border-ink-900/10 bg-bone-50 p-3 dark:border-white/10 dark:bg-ink-900">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={grant}
                  onChange={(e) => setGrant(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-ink-900/30"
                />
                <span>
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Package size={13} /> Adicionar sessões a este cliente
                  </span>
                  <span className="block text-[11px] text-ink-500">
                    Atribui um pack ou um número de sessões e regista o pagamento.
                  </span>
                </span>
              </label>

              {grant && (
                <div className="mt-3 space-y-3 border-t border-ink-900/10 pt-3">
                  {/* Pack existente vs número personalizado */}
                  <div className="inline-flex items-center gap-1 rounded-lg border border-ink-900/10 bg-white p-1 text-xs dark:border-white/10 dark:bg-ink-800">
                    <button
                      type="button"
                      onClick={() => setGrantMode("pack")}
                      disabled={!hasPacks}
                      className={`rounded-md px-2.5 py-1 font-medium transition disabled:opacity-40 ${
                        grantMode === "pack" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                      }`}
                    >
                      Pack existente
                    </button>
                    <button
                      type="button"
                      onClick={() => setGrantMode("custom")}
                      className={`rounded-md px-2.5 py-1 font-medium transition ${
                        grantMode === "custom" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                      }`}
                    >
                      Nº personalizado
                    </button>
                  </div>

                  {grantMode === "pack" ? (
                    hasPacks ? (
                      <div>
                        <label className="label" htmlFor="grant_pack">Pack</label>
                        <select
                          id="grant_pack"
                          value={grantPackId}
                          onChange={(e) => setGrantPackId(e.target.value)}
                          className="input"
                        >
                          {packs.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} — {p.sessions} {p.sessions === 1 ? "sessão" : "sessões"} · {eur(p.price_cents)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <p className="text-[11px] text-ink-500">
                        Sem packs activos. Usa "Nº personalizado".
                      </p>
                    )
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label" htmlFor="grant_sessions">Nº de sessões</label>
                        <input
                          id="grant_sessions"
                          type="number"
                          min={1}
                          value={grantSessions}
                          onChange={(e) => setGrantSessions(e.target.value)}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label" htmlFor="grant_price">Preço total (€)</label>
                        <input
                          id="grant_price"
                          type="number"
                          min={0}
                          step="0.01"
                          value={grantPrice}
                          onChange={(e) => setGrantPrice(e.target.value)}
                          placeholder="0 = oferta"
                          className="input"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="label" htmlFor="grant_method">Pagamento</label>
                    <select
                      id="grant_method"
                      value={grantMethod}
                      onChange={(e) => setGrantMethod(e.target.value)}
                      className="input"
                    >
                      <option value="manual_mbway">MB Way</option>
                      <option value="manual_revolut">Revolut</option>
                      <option value="manual_cash">Dinheiro</option>
                      <option value="complimentary">Cortesia (oferta — sem pagamento)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Descontar sessão */}
            <label className="mb-4 flex items-start gap-2 rounded-lg border border-ink-900/10 bg-bone-50 p-3 text-sm dark:border-white/10 dark:bg-ink-900">
              <input
                type="checkbox"
                checked={deduct}
                onChange={(e) => setDeduct(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-ink-900/30"
              />
              <span>
                <span className="font-medium">Descontar 1 sessão desta marcação</span>
                <span className="block text-[11px] text-ink-500">
                  {grant
                    ? "Ligado = usa 1 das sessões adicionadas. Desligado = sessão grátis (mantém o saldo completo)."
                    : "Desligado = sessão grátis (não mexe no saldo). Necessário para clientes sem pack."}
                </span>
              </span>
            </label>
            </>
            )}

            {tab === "busy" && (
              <div className="mb-4 space-y-4">
                <p className="rounded-lg border border-ink-900/10 bg-bone-50 px-3 py-2 text-[12px] text-ink-600 dark:border-white/10 dark:bg-ink-900">
                  Marca um intervalo como indisponível para marcações de clientes. Podes
                  sempre sobrepor uma sessão por cima, arrastando ou clicando.
                </p>

                {/* Intervalo de horas */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <label className="label" htmlFor="busy_from">Das</label>
                    <select
                      id="busy_from"
                      value={busyFrom}
                      onChange={(e) => setBusyFrom(e.target.value)}
                      className="input"
                    >
                      {BUSY_TIMES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0">
                    <label className="label" htmlFor="busy_to">Até</label>
                    <select
                      id="busy_to"
                      value={busyTo}
                      onChange={(e) => setBusyTo(e.target.value)}
                      className="input"
                    >
                      {BUSY_TIMES.slice(1).map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Pausa livre dentro do bloqueio (split-on-save) */}
                <div className="rounded-lg border border-ink-900/10 bg-bone-50 p-3 dark:border-white/10 dark:bg-ink-900">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={busyHasFree}
                      onChange={(e) => setBusyHasFree(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-ink-900/30"
                    />
                    <span>
                      <span className="font-medium">Deixar um intervalo livre (pausa)</span>
                      <span className="block text-[11px] text-ink-500">
                        Mantém este período livre para marcações dentro do bloqueio. Ex: ocupado 11:00–17:00 mas livre 12:30–14:00.
                      </span>
                    </span>
                  </label>

                  {busyHasFree && (
                    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-ink-900/10 pt-3">
                      <div className="min-w-0">
                        <label className="label" htmlFor="busy_free_from">Livre das</label>
                        <select
                          id="busy_free_from"
                          value={busyFreeFrom}
                          onChange={(e) => setBusyFreeFrom(e.target.value)}
                          className="input"
                        >
                          {BUSY_TIMES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                      <div className="min-w-0">
                        <label className="label" htmlFor="busy_free_to">Até</label>
                        <select
                          id="busy_free_to"
                          value={busyFreeTo}
                          onChange={(e) => setBusyFreeTo(e.target.value)}
                          className="input"
                        >
                          {BUSY_TIMES.slice(1).map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Âmbito: só este dia · intervalo de dias · semanal */}
                <div className="inline-flex w-full items-center gap-1 rounded-lg border border-ink-900/10 bg-bone-50 p-1 text-xs dark:border-white/10 dark:bg-ink-900">
                  <button
                    type="button"
                    onClick={() => setBusyScope("single")}
                    className={`flex-1 rounded-md px-2 py-1.5 font-medium transition ${
                      busyScope === "single" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                    }`}
                  >
                    Só este dia
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (busyScope !== "range") {
                        setBusyDateFrom(date);
                        setBusyDateTo(date);
                      }
                      setBusyScope("range");
                    }}
                    className={`flex-1 rounded-md px-2 py-1.5 font-medium transition ${
                      busyScope === "range" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                    }`}
                  >
                    Intervalo
                  </button>
                  <button
                    type="button"
                    onClick={() => setBusyScope("recurring")}
                    className={`flex-1 rounded-md px-2 py-1.5 font-medium transition ${
                      busyScope === "recurring" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                    }`}
                  >
                    Semanal
                  </button>
                </div>

                {busyScope === "single" && (
                  <>
                    <p className="text-[12px] text-ink-500">
                      Dia: <span className="font-medium text-ink-700">{date}</span>
                    </p>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={replaceRecurring}
                        onChange={(e) => setReplaceRecurring(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-ink-900/30"
                      />
                      <span>
                        <span className="font-medium">Substituir o horário ocupado recorrente neste dia</span>
                        <span className="block text-[11px] text-ink-500">
                          Liga isto se queres ajustar/limpar a recorrência apenas neste dia.
                        </span>
                      </span>
                    </label>
                  </>
                )}

                {busyScope === "range" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="min-w-0">
                        <label className="label" htmlFor="busy_date_from">De</label>
                        <input
                          id="busy_date_from"
                          type="date"
                          value={busyDateFrom}
                          onChange={(e) => setBusyDateFrom(e.target.value)}
                          className="input block min-w-0 max-w-full appearance-none"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="label" htmlFor="busy_date_to">Até</label>
                        <input
                          id="busy_date_to"
                          type="date"
                          value={busyDateTo}
                          min={busyDateFrom}
                          onChange={(e) => setBusyDateTo(e.target.value)}
                          className="input block min-w-0 max-w-full appearance-none"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-ink-500">
                      Marca como ocupado todos os dias entre as duas datas (inclusive), com as mesmas horas.
                    </p>
                  </>
                )}

                {busyScope === "recurring" && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="label mb-0">Repetir em</div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setBusyWeekdays(new Set([0, 1, 2, 3, 4, 5, 6]))}
                          className="rounded-md border border-ink-900/15 px-2 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-900/5"
                        >
                          Todos os dias
                        </button>
                        <button
                          type="button"
                          onClick={() => setBusyWeekdays(new Set())}
                          className="rounded-md border border-ink-900/15 px-2 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-900/5"
                        >
                          Limpar
                        </button>
                      </div>
                    </div>
                    {/* Ordem Seg→Dom (como a grelha). dow mantém 0=Dom. */}
                    <div className="flex flex-wrap gap-1.5">
                      {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
                        const on = busyWeekdays.has(dow);
                        return (
                          <button
                            key={dow}
                            type="button"
                            onClick={() => toggleWeekday(dow)}
                            aria-pressed={on}
                            className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                              on
                                ? "border-ink-900 bg-ink-900 text-white dark:border-bone-50 dark:bg-bone-50 dark:text-ink-900"
                                : "border-ink-900/15 text-ink-600 hover:bg-ink-900/5"
                            }`}
                          >
                            {WEEKDAY_LABELS[dow]}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-[11px] text-ink-500">
                      {busyWeekdays.size === 0
                        ? "Escolhe pelo menos um dia."
                        : `Selecionados: ${busyWeekdays.size} dia${busyWeekdays.size > 1 ? "s" : ""}. Repete todas as semanas até removeres.`}
                    </p>
                  </div>
                )}

                {/* Motivo */}
                <div>
                  <label className="label" htmlFor="busy_reason">Motivo (opcional)</label>
                  <input
                    id="busy_reason"
                    value={busyReason}
                    onChange={(e) => setBusyReason(e.target.value)}
                    placeholder="Ex: outro emprego, almoço, formação…"
                    className="input"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-outline"
                disabled={pending}
              >
                Cancelar
              </button>
              {tab === "busy" ? (
                <button
                  type="button"
                  onClick={submitBusy}
                  disabled={pending}
                  className="btn-primary inline-flex items-center gap-1.5"
                >
                  <Ban size={16} />
                  {pending ? "A guardar…" : "Marcar ocupado"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending}
                  className="btn-primary inline-flex items-center gap-1.5"
                >
                  <CalendarPlus size={16} />
                  {pending ? "A marcar…" : "Marcar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
