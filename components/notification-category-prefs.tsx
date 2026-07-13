"use client";

import { useState, useTransition } from "react";
import { setNotificationChannelPref } from "@/lib/notification-actions";
import { enablePushForToggle } from "@/lib/push-client";
import type { NotifCategory } from "@/lib/notifications-config";

export type CategoryPrefs = Record<string, { email: boolean; push: boolean }>;

// Toggles por categoria × canal (Push / Email). O in-app é sempre ON.
// Optimista: muda já, reverte se o server action falhar.
export function NotificationCategoryPrefs({
  categories,
  initial,
}: {
  categories: NotifCategory[];
  initial: CategoryPrefs;
}) {
  const [prefs, setPrefs] = useState<CategoryPrefs>(() => {
    const base: CategoryPrefs = {};
    for (const c of categories) base[c.key] = initial[c.key] ?? { email: true, push: true };
    return base;
  });

  function update(key: string, channel: "email" | "push", value: boolean) {
    setPrefs((p) => ({ ...p, [key]: { ...p[key], [channel]: value } }));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-6 pr-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        <span className="w-10 text-center">Push</span>
        <span className="w-10 text-center">Email</span>
      </div>
      {categories.map((c) => (
        <div
          key={c.key}
          className="flex items-center justify-between gap-4 rounded-lg border border-ink-900/10 p-3"
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold">{c.label}</div>
            <div className="mt-0.5 text-xs text-ink-500">{c.desc}</div>
          </div>
          <div className="flex items-center gap-6">
            <ChannelSwitch
              category={c.key}
              channel="push"
              on={prefs[c.key].push}
              onChange={(v) => update(c.key, "push", v)}
            />
            {c.pushOnly ? (
              // Categoria só-push (ex.: vagas): o canal email não existe, por
              // isso mostramos um traço alinhado com a coluna Email.
              <span className="w-10 text-center text-ink-400" aria-hidden="true">
                —
              </span>
            ) : (
              <ChannelSwitch
                category={c.key}
                channel="email"
                on={prefs[c.key].email}
                onChange={(v) => update(c.key, "email", v)}
              />
            )}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-ink-500">
        As notificações dentro da app (sininho) estão sempre ativas.
      </p>
    </div>
  );
}

function ChannelSwitch({
  category,
  channel,
  on,
  onChange,
}: {
  category: string;
  channel: "email" | "push";
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  function toggle() {
    const next = !on;
    onChange(next);
    startTransition(async () => {
      const r = await setNotificationChannelPref(category, channel, next);
      if (!r?.ok) {
        onChange(!next);
        return;
      }
      // Ligar o push tem de RE-ESTABELECER a subscrição do browser — mudar
      // só a flag não chega se a subscrição tiver morrido (ver push-client).
      if (channel === "push" && next) {
        void enablePushForToggle();
      }
    });
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={channel}
      disabled={pending}
      onClick={toggle}
      className={`relative h-6 w-10 shrink-0 rounded-full transition ${
        on ? "bg-gold-400" : "bg-ink-900/15 dark:bg-white/15"
      } ${pending ? "opacity-60" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#fff] shadow transition-all ${
          on ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
