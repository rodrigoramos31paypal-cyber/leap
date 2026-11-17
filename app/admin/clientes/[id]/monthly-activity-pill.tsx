"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dumbbell, Pencil } from "lucide-react";
import { useIsViewer } from "@/components/viewer-mode";
import { saveMonthlyActivityTotal } from "./monthly-activity-actions";

export function MonthlyActivityPill({ clientId, month, total, editable }: {
  clientId: string;
  month: string;
  total: number;
  editable: boolean;
}) {
  const router = useRouter();
  const viewer = useIsViewer();
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(String(total));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const pillClass = "mt-2 inline-flex min-w-0 items-center gap-1.5 rounded-full border border-gold-300 bg-gold-50 px-3 py-1 text-[13px] text-ink-700 dark:border-gold-400/40 dark:bg-gold-400/10 dark:text-bone-100";
  const label = <>
    <Dumbbell size={14} className="shrink-0 text-gold-500" aria-hidden="true" />
    <span className="text-left leading-tight">Atividades deste mês</span>
    <strong className="font-semibold text-ink-900 dark:text-bone-50">{total}</strong>
  </>;

  if (viewer || !editable) return <div className={pillClass}>{label}</div>;

  function save() {
    setError("");
    const next = Number(value);
    if (!value.trim() || !Number.isSafeInteger(next) || next < 0 || next > 100000) {
      setError("Indica um número inteiro entre 0 e 100 000.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveMonthlyActivityTotal({ clientId, month, expected: total, total: next });
        if ("error" in result) {
          setError(result.error);
          router.refresh();
          return;
        }
        dialog.current?.close();
        router.refresh();
      } catch {
        setError("Não foi possível guardar. Tenta novamente.");
      }
    });
  }

  return <>
    <button type="button" className={`${pillClass} hover:border-gold-400`} onClick={() => {
      setValue(String(total));
      setError("");
      dialog.current?.showModal();
    }}>
      {label}<Pencil size={12} className="shrink-0 text-ink-400" aria-hidden="true" />
    </button>
    <dialog ref={dialog} aria-labelledby="monthly-activity-title"
      className="m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-2xl bg-white p-5 text-ink-900 backdrop:bg-black/45 dark:bg-ink-800 dark:text-bone-50"
      onCancel={event => { if (pending) event.preventDefault(); }}>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (!pending) save(); }}>
        <h2 id="monthly-activity-title" className="font-display text-base font-bold">Ajustar atividades deste mês</h2>
        <label className="block text-sm">
          <span className="label">Total no ranking</span>
          <input className="input" type="number" min={0} max={100000} step={1} required
            value={value} disabled={pending} onChange={event => setValue(event.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" disabled={pending} onClick={() => dialog.current?.close()}>Cancelar</button>
          <button className="btn-primary disabled:opacity-50" disabled={pending}>{pending ? "A guardar…" : "Guardar"}</button>
        </div>
      </form>
    </dialog>
  </>;
}
