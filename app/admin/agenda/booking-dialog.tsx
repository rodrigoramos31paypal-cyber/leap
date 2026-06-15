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
import { CalendarPlus, Package, Search, UserPlus, X } from "lucide-react";
import { eur } from "@/lib/utils";
import { searchClientsAction, type ClientHit } from "@/app/admin/clientes/search-action";
import { createAgendaBookingAction } from "./actions";

type PackLite = { id: string; name: string; sessions: number; price_cents: number };

const TIME_OPTIONS = Array.from({ length: 30 }, (_, i) => {
  const h = 7 + Math.floor(i / 2);
  const m = (i % 2) * 30;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}); // 07:00 → 21:30

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

  // Campos
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [date, setDate] = useState(viewedDate);
  const [time, setTime] = useState("08:00");
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
      if (detail?.date) setDate(detail.date);
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
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-ink-800 sm:max-w-md sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Marcar sessão</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-ink-500 hover:bg-ink-900/5"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

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
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="btn-primary inline-flex items-center gap-1.5"
              >
                <CalendarPlus size={16} />
                {pending ? "A marcar…" : "Marcar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
