import Link from "next/link";
import Image from "next/image";
import { LogOut } from "lucide-react";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";

export function TopBar({
  title,
  unread = 0,
  back,
  right,
  notifLink = "/app/notificacoes",
  userId,
  homeHref = "/",
  wide = false,
}: {
  title?: string;
  unread?: number;
  back?: string;
  right?: React.ReactNode;
  notifLink?: string;
  userId?: string;
  /** Destino do logótipo. Em layouts autenticados, aponta para o
   *  dashboard correspondente (cliente ou admin) em vez da landing. */
  homeHref?: string;
  /** Alinha o conteúdo do header com o container largo (max-w-7xl) do
   *  admin, para o logótipo ficar por cima da sidebar. Cliente usa o
   *  container normal (max-w-6xl). */
  wide?: boolean;
}) {
  return (
    <header id="app-top-bar" className="safe-top sticky top-0 z-30 border-b border-ink-900/5 bg-bone-50/80 backdrop-blur dark:border-white/5 dark:bg-ink-900/80">
      <div className={`mx-auto flex items-center justify-between gap-3 px-4 py-3 ${wide ? "max-w-7xl" : "max-w-6xl"}`}>
        <div className="flex items-center gap-2">
          {back ? (
            <Link href={back} className="rounded-md p-1 text-ink-500 hover:bg-ink-900/5 dark:text-bone-100 dark:hover:bg-white/10">
              ←
            </Link>
          ) : (
            <Link href={homeHref} className="flex items-center gap-2">
              <Image
                src="/images/logo.png"
                alt="LEAP Fitness Studio"
                width={44}
                height={44}
                sizes="44px"
                priority
                className="h-11 w-11 dark:invert"
              />
              <span className="font-display text-sm font-semibold tracking-tight hidden sm:inline">
                LEAP·FITNESS
              </span>
            </Link>
          )}
          {title && <span className="ml-2 text-sm font-medium text-ink-900 dark:text-bone-50">{title}</span>}
        </div>
        <div className="flex items-center gap-1">
          {right}
          <ThemeToggle />
          {userId ? (
            <NotificationBell userId={userId} initialUnread={unread} notifLink={notifLink} />
          ) : (
            <Link href={notifLink} className="relative rounded-md p-2 text-ink-500 hover:bg-ink-900/5 dark:text-bone-100 dark:hover:bg-white/10">
              <span className="block h-[18px] w-[18px]" />
            </Link>
          )}
          <form action="/auth/logout" method="post">
            <button className="rounded-md p-2 text-ink-500 hover:bg-ink-900/5 dark:text-bone-100 dark:hover:bg-white/10" aria-label="Sair">
              <LogOut size={18} />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
