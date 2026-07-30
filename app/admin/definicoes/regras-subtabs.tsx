"use client";

// ════════════════════════════════════════════════════════════════
// Sub-abas das Regras. Barra segmentada no topo; só a aba ativa fica visível.
//
// O FORMULÁRIO das definições (saveSettingsAction) vive AQUI e envolve os
// campos de todas as abas (`formContent`) — que ficam sempre montados (hidden)
// para submeterem juntos num só "Guardar".
//
// `extraContent` (por aba) é renderizado FORA do formulário — para conteúdo
// que tem os SEUS PRÓPRIOS formulários (ex.: Horários/Bloqueios na aba Agenda),
// que não pode ser aninhado dentro do formulário das definições.
// ════════════════════════════════════════════════════════════════

import { useState } from "react";
import type { ReactNode, ComponentProps } from "react";

type Section = {
  id: string;
  label: string;
  formContent: ReactNode;
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

      <form action={settingsAction} className="space-y-4">
        <input type="hidden" name="trainerId" value={trainerId} />
        {sections.map((s) => (
          <div key={s.id} hidden={s.id !== active}>
            {s.formContent}
          </div>
        ))}
        <button className="btn-primary w-full sm:w-auto">Guardar</button>
      </form>

      {sections.map((s) =>
        s.extraContent ? (
          <div key={s.id} hidden={s.id !== active} className="mt-5">
            {s.extraContent}
          </div>
        ) : null,
      )}
    </div>
  );
}
