"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { countUnreadStaffMessages } from "@/app/app/mensagens/actions";

export function AdminChatIcon() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    let pending = false;
    async function refresh() {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const count = await countUnreadStaffMessages();
        if (active && count !== null) setUnread(count);
      } catch {
        // Retém o último total se a ligação falhar.
      } finally {
        pending = false;
      }
    }

    void refresh();
    const timer = window.setInterval(refresh, 12000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [pathname]);

  return (
    <Link href="/admin/mensagens"
      aria-label={unread ? `Mensagens, ${unread} por ler` : "Mensagens"}
      className="relative rounded-md p-2 text-ink-500 hover:bg-ink-900/5 dark:text-bone-100 dark:hover:bg-white/10">
      <MessageCircle size={18} aria-hidden="true" />
      {unread > 0 && <span aria-hidden="true" className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-gold-400 px-0.5 text-[9px] font-bold leading-none text-black">{unread > 9 ? "9+" : unread}</span>}
    </Link>
  );
}
