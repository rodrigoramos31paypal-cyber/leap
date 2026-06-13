"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { syncSessionReminders } from "@/lib/notification-actions";

// In-app reminder: corre UMA vez por abertura da app. Se criar
// notificações novas (sessões nas próximas 24h), faz refresh para o
// badge do sino aparecer de imediato. A dedup vive na BD, por isso
// reabrir a app não duplica nada. Render null — sem UI própria.
export function ReminderSync() {
  const router = useRouter();
  useEffect(() => {
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
