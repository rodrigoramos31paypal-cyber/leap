"use client";

// ════════════════════════════════════════════════════════════════
// Sub-abas das Regras.
//
// Nível 1 (RegrasSubtabs): Marcações · Cancelamentos · Packs · Agenda.
// O FORMULÁRIO das definições (id="regras-settings") envolve os campos de
// todas as abas (formContent), sempre montados (hidden) → guardam juntos.
// `extraContent` (por aba) é renderizado ANTES do formulário e FORA dele —
// para conteúdo com os SEUS PRÓPRIOS formulários (Horários/Bloqueios), que
// não pode ser aninhado. O botão Guardar fica no fim (dentro do form).
//
// Nível 2 (AgendaSubtabs): dentro da aba Agenda → Agenda · Horários ·
// Bloqueios. A definição "mostrar canceladas" liga-se ao formulário via
// atributo `form="regras-settings"` (submete com o resto, apesar de estar
// fora do form no DOM). Horários/Bloqueios guardam-se sozinhos.
// ════════════════════════════════════════════════════════════════

import { useState } from "react";
import type { ReactNode, ComponentProps } from "react";

const SETTINGS_FORM_ID = "regras-settings";

type Section = {
  id: string;
  label: string;
  formContent?: ReactNode;
  extraContent?: ReactNode;
};

export function RegrasSubtabs({
  sections,
  settingsAction,
  trainerId,
}: {
  sections: Section[];
  settingsAction: ComponentProps<"form">["action"];
  trainerId: string;
}) {
  const [active, setActive] = useState(sections[0]?.id);

  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-[10px] border border-ink-900/[0.07] bg-ink-900/[0.03] p-[3px] dark:border-white/10 dark:bg-white/5">
        {sections.map((s) => {
          const on = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              aria-pressed={on}
              className={`flex-none whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] transition ${
                on
                  ? "bg-white font-semibold text-ink-900 shadow-sm dark:bg-ink-700 dark:text-bone-50"
                  : "font-medium text-ink-500 hover:text-ink-900 dark:hover:text-bone-100"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {sections.map((s) =>
        s.extraContent ? (
          <div key={s.id} hidden={s.id !== active} className="mb-4">
            {s.extraContent}
          </div>
        ) : null,
      )}

      <form id={SETTINGS_FORM_ID} action={settingsAction} className="space-y-4">
        <input type="hidden" name="trainerId" value={trainerId} />
        {sections.map((s) => (
          <div key={s.id} hidden={s.id !== active}>
            {s.formContent}
          </div>
        ))}
        <button className="btn-primary w-full sm:w-auto">Guardar</button>
      </form>
    </div>
  );
}

// ── Nível 2 (dentro da aba Agenda) ──────────────────────────────────
export function AgendaSubtabs({
  showCancelledDefault,
  horarios,
  bloqueios,
}: {
  showCancelledDefault: boolean;
  horarios: ReactNode;
  bloqueios: ReactNode;
}) {
  const [active, setActive] = useState<"agenda" | "horarios" | "bloqueios">("agenda");

  const Tab = ({ id, label }: { id: "agenda" | "horarios" | "bloqueios"; label: string }) => {
    const on = active === id;
    return (
      <button
        type="button"
        onClick={() => setActive(id)}
        aria-pressed={on}
        className={`-mb-px border-b-2 px-1 pb-2 pt-1 text-sm transition ${
          on
            ? "border-gold-500 font-semibold text-ink-900 dark:border-gold-400 dark:text-bone-50"
            : "border-transparent font-medium text-ink-500 hover:text-ink-800 dark:hover:text-bone-100"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div>
      <div className="mb-4 flex gap-5 border-b border-ink-900/10 dark:border-white/10">
        <Tab id="agenda" label="Agenda" />
        <Tab id="horarios" label="Horários" />
        <Tab id="bloqueios" label="Bloqueios" />
      </div>

      <div hidden={active !== "agenda"}>
        <div className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Agenda</h2>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="show_cancelled_in_calendar"
              form={SETTINGS_FORM_ID}
              defaultChecked={showCancelledDefault}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold">Mostrar sessões canceladas na agenda</span>
              <span className="block text-xs text-ink-500">
                Desligado (default), as sessões canceladas não aparecem no calendário.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div hidden={active !== "horarios"}>{horarios}</div>
      <div hidden={active !== "bloqueios"}>{bloqueios}</div>
    </div>
  );
}
