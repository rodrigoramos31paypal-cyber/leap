"use client";

// ════════════════════════════════════════════════════════════════
// Pill da Sequência no perfil do cliente (admin), agora clicável:
// o trainer pode ajustar manualmente o valor da sequência. O ajuste é
// um "baseline" — a partir dali continua a contar ao vivo (ver 0168).
// O viewer (só-consulta) vê a pill mas não a pode editar.
// ════════════════════════════════════════════════════════════════

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Flame, X, Pencil } from "lucide-react";
import { levelForStreak, LEVEL_LABEL } from "@/lib/streak";
import { useIsViewer } from "@/components/viewer-mode";
import { setClientStreakAction, clearClientStreakAction } from "./actions";

function toast(title: string, kind: "success" | "error" = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("leap:toast", { detail: { title, kind } }));
}

export function StreakPill({ clientId, weeks }: { clientId: string; weeks: number }) {
  const router = useRouter();
  const isViewer = useIsViewer();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState<string>(String(weeks));
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const label = (
    <>
      <Flame size={14} className="text-gold-500" />
      Sequência:{" "}
      <strong className="font-semibold text-ink-900 dark:text-bone-50">
        {weeks} {weeks === 1 ? "semana" : "semanas"}
      </strong>
      <span className="text-ink-400">· {LEVEL_LABEL[levelForStreak(weeks)]}</span>
    </>
  );

  const pillClass =
    "mt-2 inline-flex items-center gap-1.5 rounded-full border border-gold-300 bg-gold-50 px-3 py-1 text-[13px] text-ink-700 dark:border-gold-400/40 dark:bg-gold-400/10 dark:text-bone-100";

  // viewer: pill estática, sem edição.
  if (isViewer) {
    return <div className={pillClass}>{label}</div>;
  }

  function save() {
    setErr(null);
    const n = Number(val);
    if (!Number.isInteger(n) || n < 0 || n > 520) {
      setErr("Indica um número inteiro entre 0 e 520.");
      return;
    }
    startTransition(async () => {
      const res = await setClientStreakAction({ clientId, value: n });
      if ("error" in res) {
        setErr(res.error);
        return;
      }
      setOpen(false);
      toast("Sequência atualizada");
      router.refresh();
    });
  }

  function resetAuto() {
    setErr(null);
    startTransition(async () => {
      const res = await clearClientStreakAction({ clientId });
      if ("error" in res) {
        setErr(res.error);
        return;
      }
      setOpen(false);
      toast("Sequência reposta para automático");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setVal(String(weeks));
          setErr(null);
          setOpen(true);
        }}
        className={`${pillClass} group cursor-pointer transition hover:border-gold-400 hover:bg-gold-100 dark:hover:bg-gold-400/20`}
        title="Ajustar sequência"
      >
        {label}
        <Pencil size={12} className="ml-0.5 text-ink-400 group-hover:text-gold-600" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-sm text-ink-900 shadow-xl dark:bg-ink-800 dark:text-bone-50">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="inline-flex items-center gap-2 font-display text-base font-bold">
                <Flame size={16} className="text-gold-500" /> Ajustar sequência
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

            <p className="mb-3 text-xs text-ink-500 dark:text-bone-100/70">
              Define o número de semanas da sequência deste cliente. A partir daqui
              continua a contar sozinha (sobe se treinar, parte se faltar ou passar
              uma semana sem treino nem atividade aprovada).
            </p>

            <label className="label" htmlFor="streak-val">
              Semanas
            </label>
            <input
              id="streak-val"
              type="number"
              min={0}
              max={520}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              className="input"
              autoFocus
            />

            {err && (
              <div className="mt-3 rounded-md bg-red-100 px-3 py-2 text-xs text-red-800 dark:bg-red-900/30 dark:text-red-200">
                {err}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={resetAuto}
                disabled={pending}
                className="rounded-md border border-ink-900/15 px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-900/5 disabled:opacity-50 dark:border-white/15 dark:text-bone-100"
                title="Remover o ajuste manual e voltar ao cálculo automático"
              >
                Repor automático
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="btn-primary"
              >
                {pending ? "A guardar…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
