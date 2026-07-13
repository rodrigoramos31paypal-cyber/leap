"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { syncSessionReminders } from "@/lib/notification-actions";

// In-app reminder: corre UMA vez por sessão de browser. Se criar
// notificações novas (sessões nas próximas 24h), faz refresh para o
// badge do sino aparecer de imediato. A dedup vive na BD, por isso
// reabrir a app não duplica nada. Render null — sem UI própria.
//
// PERF (QW-4 audit jun/2026): antes corria em CADA mount do layout
// (= cada navegação RSC dentro de /app/*). Agora marca-se no
// sessionStorage e fica suprimido para o resto da sessão de browser.
// O reset acontece quando o user fecha o separador.
const SESSION_FLAG = "leap-reminders-synced";

export function ReminderSync() {
  const router = useRouter();
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (sessionStorage.getItem(SESSION_FLAG) === "1") return;
      sessionStorage.setItem(SESSION_FLAG, "1");
    } catch {
      // sessionStorage indisponível (Safari incognito) — continua a
      // correr em cada mount, comportamento anterior.
    }
    let active = true;
    syncSessionReminders()
      .then((created) => {
        if (active && created > 0) router.refresh();
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [router]);
  return null;
}
