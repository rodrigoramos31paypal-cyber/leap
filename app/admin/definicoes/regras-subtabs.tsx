"use client";

// ════════════════════════════════════════════════════════════════
// Sub-abas das Regras. Barra segmentada no topo; só a secção ativa fica
// visível. As restantes ficam MONTADAS (hidden) para que TODOS os campos
// continuem a submeter com o mesmo formulário — guardar grava tudo de uma vez.
// ════════════════════════════════════════════════════════════════

import { useState } from "react";

export function RegrasSubtabs({
  sections,
}: {
  sections: { id: string; label: string; content: React.ReactNode }[];
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

      {sections.map((s) => (
        <div key={s.id} hidden={s.id !== active}>
          {s.content}
        </div>
      ))}
    </div>
  );
}
