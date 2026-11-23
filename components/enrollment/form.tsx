"use client";
import { useActionState } from "react";
import { ENROLLMENT_INTERESTS, ENROLLMENT_GOALS, type Enrollment } from "@/lib/enrollment-options";
export type EnrollmentResult = { error?: string; ok?: boolean };
export function EnrollmentForm({ initial, action }: { initial?: Enrollment | null; action: (state: EnrollmentResult, form: FormData) => Promise<EnrollmentResult> }) {
  const [state, submit, pending] = useActionState(action, {});
  return <form action={submit} className="space-y-4">
    <div><h1 className="font-display text-xl font-bold">Vamos conhecer-te melhor</h1><p className="mt-1 text-sm text-ink-500">Três respostas rápidas para percebermos como te podemos ajudar.</p></div>
    <label className="block text-sm font-semibold">O que procuras?
      <select className="input mt-1 w-full" name="interest" required defaultValue={initial?.interest ?? ""} disabled={pending}>
        <option value="" disabled>Escolhe uma opção</option>{ENROLLMENT_INTERESTS.map(x => <option key={x}>{x}</option>)}
      </select>
    </label>
    <label className="block text-sm font-semibold">Qual é o teu objetivo?
      <select className="input mt-1 w-full" name="goal" required defaultValue={initial?.goal ?? ""} disabled={pending}>
        <option value="" disabled>Escolhe uma opção</option>{ENROLLMENT_GOALS.map(x => <option key={x}>{x}</option>)}
      </select>
    </label>
    <label className="block text-sm font-semibold">Quando tens disponibilidade para treinar?
      <textarea className="input mt-1 w-full" name="availability" required minLength={3} maxLength={300} rows={3} defaultValue={initial?.availability} placeholder="Ex.: segundas e quartas, depois das 18h" disabled={pending} />
      <span className="mt-1 block text-xs font-normal text-ink-500">Indica os dias e períodos que te dão mais jeito.</span>
    </label>
    {state.error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{state.error}</p>}
    {state.ok && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Respostas guardadas.</p>}
    <button className="btn-primary w-full" disabled={pending}>{pending ? "A guardar…" : initial ? "Guardar alterações" : "Enviar pré-inscrição"}</button>
    <p className="text-xs text-ink-500">A equipa analisa o teu pedido antes de dar acesso à app.</p>
  </form>;
}
