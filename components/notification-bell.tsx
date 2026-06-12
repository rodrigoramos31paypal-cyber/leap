"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// PERF: realtime channel ja apanha eventos quase instantaneamente.
// Polling e so um fallback para casos em que o canal falha (free tier,
// rede instavel, etc.). Subir de 4s -> 30s reduz ~14x as queries em
// idle (15/min -> 2/min) por pagina aberta, sem perda real de UX.
const POLL_MS = 30000;

export function NotificationBell({
  userId,
  initialUnread,
  notifLink,
}: {
  userId: string;
  initialUnread: number;
  notifLink: string;
}) {
  const pathname = usePathname();
  const onNotifPage = pathname?.startsWith(notifLink) ?? false;
  // se já estamos na página de notificações, força badge a 0 desde o início.
  const [unread, setUnread] = useState(onNotifPage ? 0 : initialUnread);
  // Evita que `setUnread(initialUnread)` reponha o badge logo depois de
  // o utilizador o ter "consumido" (clique no sino).
  const suppressUntil = useRef<number>(0);

  // Sincroniza com server-rendered count, mas respeita supressão recente
  // e força 0 quando o utilizador está na página de notificações.
  useEffect(() => {
    if (onNotifPage) {
      setUnread(0);
      return;
    }
    if (Date.now() < suppressUntil.current) return;
    setUnread(initialUnread);
  }, [initialUnread, onNotifPage]);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();

    async function refresh() {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("read_at", null);
      if (Date.now() < suppressUntil.current) return;
      if (onNotifPage) {
        setUnread(0);
        return;
      }
      setUnread(count ?? 0);
    }

    // Realtime channel (best effort — pode falhar em alguns ambientes).
    const channel = supabase
      .channel(`notif-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          if (onNotifPage) return;
          setUnread((c) => c + 1);
          if (typeof window !== "undefined" && "Notification" in window) {
            if (Notification.permission === "granted") {
              try {
                new Notification("LEAP-FITNESS", { body: "Nova notificação" });
              } catch {}
            }
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          refresh();
        },
      )
      .subscribe();

    // Fallback de polling — garantia de actualização em tempo "quase-real"
    // mesmo se o canal realtime falhar (rede, free tier limits, etc.).
    const interval = window.setInterval(refresh, POLL_MS);

    // Actualiza imediatamente quando o separador volta a estar visível.
    function onVisible() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, onNotifPage]);

  function handleClick() {
    // Ao clicar, o utilizador vai para a página de notificações onde tudo
    // será marcado como lido. Reseta visualmente já e suprime updates
    // contraditórios durante alguns segundos.
    suppressUntil.current = Date.now() + 5000;
    setUnread(0);
  }

  return (
    <Link
      href={notifLink}
      onClick={handleClick}
      className="relative rounded-md p-2 text-ink-500 hover:bg-ink-900/5 dark:text-bone-100 dark:hover:bg-white/10"
      aria-label="Notificações"
      >
      <Bell size={18} />
      {unread > 0 && (
        <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-gold-400 text-[10px] font-bold text-ink-900">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
