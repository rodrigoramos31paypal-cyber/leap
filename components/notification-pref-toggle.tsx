"use client";

import { useState, useTransition } from "react";
import { setNotificationPref } from "@/lib/notification-actions";

// Toggle instantâneo (sem botão Guardar). Optimista: muda já, e reverte
// se o server action falhar. `kind` mapeia para notification_preferences.
export function NotificationPrefToggle({
  kind,
  initial,
  label,
  desc,
}: {
  kind: string;
  initial: boolean;
  label: string;
  desc?: string;
}) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const r = await setNotificationPref(kind, next);
      if (!r?.ok) setOn(!next); // reverte em caso de erro
    });
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="mt-0.5 text-xs text-ink-500">{desc}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={pending}
        onClick={toggle}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          on ? "bg-gold-400" : "bg-ink-900/15 dark:bg-white/15"
        } ${pending ? "opacity-60" : ""}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#fff] shadow transition-all ${
            on ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
