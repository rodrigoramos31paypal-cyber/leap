"use client";

import { useActionState } from "react";
import { Megaphone, CalendarClock } from "lucide-react";
import { anunciarVagaAction, type AnunciarState } from "./actions";

export function AnunciarForm() {
  const [state, action, pending] = useActionState<AnunciarState, FormData>(
    anunciarVagaAction,
    {},
  );

  return (
    <div className="card p-4">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-900 text-gold-400 dark:bg-white/10">
          <Megaphone size={19} />
        </span>
        <div>
          <div className="text-[13.5px] font-medium text-ink-900 dark:text-bone-50">Chega a todos os clientes</div>
          <div className="text-[11.5px] text-ink-500">No sininho da app e por push a quem o tem ativo</div>
        </div>
      </div>

      <form action={action} className="space-y-4">
        <div>
          <label className="label">
            Horário da vaga <span className="font-normal text-ink-400">(opcional)</span>
          </label>
          <div className="relative">
            <CalendarClock size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              type="datetime-local"
              name="when"
              className="input h-11 pl-10 [color-scheme:light] dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:transition-opacity [&::-webkit-calendar-picker-indicator:hover]:opacity-100"
            />
          </div>
          <p className="mt-1 text-xs text-ink-500">Se preencheres, entra automaticamente na mensagem.</p>
        </div>

        <div>
          <label className="label">
            Mensagem <span className="font-normal text-ink-400">(opcional)</span>
          </label>
          <textarea
            name="message"
            rows={3}
            maxLength={300}
            placeholder="Ex: Abriu uma vaga hoje às 18h. Quem quer treinar?"
            className="input"
          />
          <p className="mt-1 text-xs text-ink-500">Se vazia, é gerada a partir do horário acima.</p>
        </div>

        {state?.error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{state.error}</div>
        )}
        {state?.ok && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            {state.count === 0
              ? "Nenhum cliente elegível (todos desligaram este aviso)."
              : `Anúncio enviado a ${state.count} cliente(s). Aparece no sininho e por push.`}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink-900 px-4 py-3 text-sm font-semibold text-bone-50 transition hover:bg-ink-700 disabled:opacity-60 dark:bg-bone-50 dark:text-ink-900 dark:hover:bg-bone-100"
        >
          <Megaphone size={16} /> {pending ? "A enviar…" : "Anunciar a todos os clientes"}
        </button>
      </form>
    </div>
  );
}
