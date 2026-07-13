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
    <div className="card p-6">
      <div className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-500">
        <Megaphone size={14} /> Anunciar vaga
      </div>
      <p className="mt-1 text-sm text-ink-500">
        Avisa todos os clientes de uma vaga de última hora. Aparece no sininho da app e,
        para quem tiver push activo, também como notificação no telemóvel.
      </p>

      <form action={action} className="mt-5 space-y-4">
        <div>
          <label className="label">Horário da vaga (opcional)</label>
          <div className="relative">
            <CalendarClock
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              type="datetime-local"
              name="when"
              className="input h-11 pl-10 [color-scheme:light] dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:transition-opacity [&::-webkit-calendar-picker-indicator:hover]:opacity-100"
            />
          </div>
          <p className="mt-1 text-xs text-ink-500">
            Se preencheres, entra automaticamente na mensagem.
          </p>
        </div>

        <div>
          <label className="label">Mensagem personalizada (opcional)</label>
          <textarea
            name="message"
            rows={3}
            maxLength={300}
            placeholder="Ex: Abriu uma vaga hoje às 18h. Quem quer treinar?"
            className="input"
          />
          <p className="mt-1 text-xs text-ink-500">
            Se vazia, é gerada a partir do horário acima.
          </p>
        </div>

        {state?.error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>
        )}
        {state?.ok && (
          <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {state.count === 0
              ? "Nenhum cliente elegível (todos desligaram este aviso)."
              : `Anúncio enviado a ${state.count} cliente(s). Aparece no sininho e por push (a quem tiver push activo).`}
          </div>
        )}

        <button type="submit" disabled={pending} className="btn-primary w-full">
          <Megaphone size={16} /> {pending ? "A enviar…" : "Anunciar a todos os clientes"}
        </button>
      </form>
    </div>
  );
}
