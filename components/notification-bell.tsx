"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { typesForCategories } from "@/lib/notifications-config";

// PERF: realtime channel ja apanha eventos quase instantaneamente.
// Polling e so um fallback para casos em que o canal falha (free tier,
// rede instavel, etc.). Q3: subimos 30s -> 120s — realtime + o refresh
// no visibilitychange ja cobrem o essencial; isto corta ~4x as queries
// em idle por pagina aberta, sem perda real de UX.
const POLL_MS = 120000;

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
  // Tipos a OCULTAR do sino — categorias com push desligado. O sino
  // espelha o push (ver lib/notifications-config). Carregado uma vez no
  // mount; lido lazy nos refresh/realtime, por isso é um ref.
  const hiddenTypes = useRef<Set<string>>(new Set());

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

    // Carrega as categorias com push DESLIGADO → tipos a ocultar do sino.
    // Fail-open: erro deixa o set vazio (mostra tudo).
    async function loadHidden() {
      // `as any`: notification_preferences ainda não está nos tipos
      // gerados do Supabase (igual ao resto do código que lê esta tabela).
      const { data } = await (supabase as any)
        .from("notification_preferences")
        .select("kind, push_enabled")
        .eq("user_id", userId)
        .eq("push_enabled", false);
      hiddenTypes.current = new Set(
        typesForCategories(((data as any[]) ?? []).map((r) => r.kind as string)),
      );
    }

    async function refresh() {
      // A tabela está podada a ≤10 linhas por utilizador (trigger 0111),
      // por isso lemos os `type` das não-lidas e contamos já filtrado —
      // o badge tem de bater certo com a lista (push off ⇒ não conta).
      const { data: rows } = await supabase
        .from("notifications")
        .select("id, type")
        .eq("user_id", userId)
        .is("read_at", null);
      if (Date.now() < suppressUntil.current) return;
      if (onNotifPage) {
        setUnread(0);
        return;
      }
      const count = ((rows as any[]) ?? []).filter(
        (r) => !r.type || !hiddenTypes.current.has(r.type),
      ).length;
      setUnread(count);
    }

    // PERF (QW-9, jun/2026): layouts deixaram de fazer a query de
    // notificações para acelerar o paint do shell. Fazemos uma chamada
    // imediata aqui — não bloqueia o render, popula o badge em <100 ms.
    // Carrega primeiro os tipos ocultos, depois conta.
    loadHidden().then(refresh);

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
        (payload) => {
          if (onNotifPage) return;
          // Categoria com push off não conta para o badge (espelha o push).
          const t = (payload as any)?.new?.type as string | undefined;
          if (t && hiddenTypes.current.has(t)) return;
          setUnread((c) => c + 1);
          // Sem new Notification() aqui: as notificações de sistema são
          // entregues por Web Push (service worker), com título/corpo ricos
          // e mesmo com a app fechada. Este handler só actualiza o badge ao
          // vivo — evita uma notificação genérica e duplicada quando a app
          // está aberta.
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
    //
    // PERF (QW-5 audit jun/2026): pausa quando o separador está em
    // background. Para um user com a app aberta 8h em segundo plano,
    // poupa ~240 queries por dia.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);

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
