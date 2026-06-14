"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Home,
  Calendar,
  ShoppingBag,
  User,
  LayoutDashboard,
  Users,
  CreditCard,
  Settings,
  Package,
  NotebookPen,
  BarChart3,
  UserCog,
  MoreHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";

// H4: usar `LucideIcon` em vez de `React.ComponentType<{ size?: number }>`
// — o tipo dos icons lucide-react inclui propTypes que não casam com
// um ComponentType genérico, causando TS2322 cascaded em todos os usos.
type Item = { href: string; label: string; icon: LucideIcon };

const clientItems: Item[] = [
  { href: "/app/dashboard", label: "Início", icon: Home },
  { href: "/app/agenda", label: "Agenda", icon: Calendar },
  { href: "/app/comprar", label: "Packs", icon: ShoppingBag },
  { href: "/app/perfil", label: "Perfil", icon: User },
];

// As 4 mais frequentes ficam na barra; o resto fica no overflow "Mais".
// Definicoes > Pagamentos em frequencia de uso, por isso fica na barra.
const adminItems: Item[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/agenda", label: "Agenda", icon: Calendar },
  { href: "/admin/clientes", label: "Clientes", icon: Users },
  { href: "/admin/definicoes", label: "Defin.", icon: Settings },
];

const adminOverflow: Item[] = [
  { href: "/admin/pagamentos", label: "Pagamentos", icon: CreditCard },
  { href: "/admin/packs", label: "Packs", icon: Package },
  { href: "/admin/notas", label: "Notas", icon: NotebookPen },
  { href: "/admin/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/admin/equipa", label: "Equipa", icon: UserCog },
];

export function BottomNav({ variant }: { variant: "client" | "admin" }) {
  const path = usePathname();
  const items = variant === "client" ? clientItems : adminItems;
  const [moreOpen, setMoreOpen] = useState(false);

  // Fecha o overflow ao mudar de pagina.
  useEffect(() => {
    setMoreOpen(false);
  }, [path]);

  // Permite fechar com ESC.
  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const moreActive =
    variant === "admin" && adminOverflow.some((it) => path?.startsWith(it.href));

  return (
    <>
      {/* Sheet de overflow para admin - so visivel em mobile */}
      {variant === "admin" && moreOpen && (
        <>
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm md:hidden"
          />
          <div
            role="dialog"
            aria-label="Mais opções"
            className="safe-bottom fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl border-t border-ink-900/10 bg-white px-4 pt-3 pb-6 shadow-2xl dark:border-white/10 dark:bg-ink-800 md:hidden"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                Mais
              </span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Fechar"
                className="rounded-md p-1.5 text-ink-500 hover:bg-ink-900/5 dark:text-bone-100 dark:hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>
            <ul className="grid grid-cols-3 gap-1">
              {adminOverflow.map((it) => {
                const active = path?.startsWith(it.href);
                const Icon = it.icon;
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-md px-2 py-3 text-[11px] font-medium transition",
                        active
                          ? "bg-ink-900/10 text-ink-900 dark:bg-white/10 dark:text-bone-50"
                          : "text-ink-600 hover:bg-ink-900/5 hover:text-ink-900 dark:text-bone-100 dark:hover:bg-white/5 dark:hover:text-bone-50",
                      )}
                    >
                      <Icon size={20} />
                      <span>{it.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      {/* PERF: prefetch default (auto) - pre-carrega apenas o shell estatico
          + loading.tsx das rotas vizinhas quando os links entram em viewport.
          Nao definir prefetch={true} (forcaria correr as queries RSC de cada
          vizinho no mount, gastando bateria).
          NOTA (C1): o middleware corre getClaims() TAMBEM nos prefetches. Com
          signing keys ASSIMETRICAS no Supabase, getClaims valida o JWT
          localmente (sem round-trip); em HS256 cada prefetch custa uma chamada
          ao GoTrue. Migrar as keys e o que torna este prefetch barato. */}
      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-ink-900/10 bg-white/95 backdrop-blur dark:border-white/10 dark:bg-ink-900/95 md:hidden">
        <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 py-1.5">
          {items.map((it) => {
            const active = path?.startsWith(it.href);
            const Icon = it.icon;
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-md px-3 py-1.5 text-[10px] font-medium transition",
                    active
                      ? "bg-ink-900/10 text-ink-900 dark:bg-white/10 dark:text-bone-50"
                      : "text-ink-500 hover:bg-ink-900/5 hover:text-ink-900 dark:text-bone-100/70 dark:hover:bg-white/5 dark:hover:text-bone-50",
                  )}
                >
                  <Icon size={20} />
                  <span>{it.label}</span>
                </Link>
              </li>
            );
          })}
          {variant === "admin" && (
            <li>
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                aria-expanded={moreOpen}
                aria-label="Mais opções"
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-md px-3 py-1.5 text-[10px] font-medium transition",
                  moreActive || moreOpen
                    ? "bg-ink-900/10 text-ink-900 dark:bg-white/10 dark:text-bone-50"
                    : "text-ink-500 hover:bg-ink-900/5 hover:text-ink-900 dark:text-bone-100/70 dark:hover:bg-white/5 dark:hover:text-bone-50",
                )}
              >
                <MoreHorizontal size={20} />
                <span>Mais</span>
              </button>
            </li>
          )}
        </ul>
      </nav>
    </>
  );
}
