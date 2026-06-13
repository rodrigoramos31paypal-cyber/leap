"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Home, Calendar, ShoppingBag, User } from "lucide-react";

// Navegação do cliente para DESKTOP. No mobile usa-se a BottomNav
// (md:hidden); esta barra é md:block. Sem isto, no desktop os clientes
// não tinham forma de chegar ao Perfil / Agenda / Packs.
const items = [
  { href: "/app/dashboard", label: "Início", icon: Home },
  { href: "/app/agenda", label: "Agenda", icon: Calendar },
  { href: "/app/comprar", label: "Packs", icon: ShoppingBag },
  { href: "/app/perfil", label: "Perfil", icon: User },
];

export function ClientTopNav() {
  const path = usePathname();
  return (
    <nav className="hidden border-b border-ink-900/5 bg-bone-50/60 backdrop-blur dark:border-white/5 dark:bg-ink-900/60 md:block">
      <ul className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2">
        {items.map((it) => {
          const active = path?.startsWith(it.href) ?? false;
          const Icon = it.icon;
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
                  active
                    ? "bg-ink-900/10 text-ink-900 dark:bg-white/10 dark:text-bone-50"
                    : "text-ink-600 hover:bg-ink-900/5 hover:text-ink-900 dark:text-bone-100 dark:hover:bg-white/10",
                )}
              >
                <Icon size={16} /> {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
