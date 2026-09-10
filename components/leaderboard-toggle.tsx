"use client";

import { useState, useTransition } from "react";
import { Trophy } from "lucide-react";
import { setLeaderboardVisibilityAction } from "@/app/app/perfil/actions";

// Interruptor "Aparecer no ranking LEAP" (opt-in por defeito). Atualiza
// otimisticamente e persiste via server action.
export function LeaderboardToggle({ initialVisible }: { initialVisible: boolean }) {
  const [visible, setVisible] = useState(initialVisible);
  const [pending, start] = useTransition();

  function onChange(next: boolean) {
    setVisible(next);
    start(async () => {
      try {
        await setLeaderboardVisibilityAction(next);
      } catch {
        setVisible(!next); // reverte em falha
      }
    });
  }

  return (
    <label className="card flex items-start gap-3 p-4 text-sm">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gold-50 text-gold-600 dark:bg-gold-400/10 dark:text-gold-300">
        <Trophy size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-semibold">Aparecer no ranking LEAP</span>
        <span className="block text-[11px] text-ink-500">
          Mostra o teu nome próprio + inicial e a tua sequência aos outros clientes. A tua sequência continua visível só para ti, mesmo que saias.
        </span>
      </span>
      <input
        type="checkbox"
        checked={visible}
        disabled={pending}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-ink-900/30 accent-gold-500"
      />
    </label>
  );
}
