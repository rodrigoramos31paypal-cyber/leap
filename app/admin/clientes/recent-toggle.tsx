"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// RecentToggle · alterna a ordenação da vista "Todos os clientes" entre
// alfabética (default) e "Últimos clientes" (mais recentes primeiro).
//
// EFÉMERO por design: "Últimos clientes" só fica ativo quando é o
// utilizador a escolhê-lo. Um refresh ou sair-e-voltar repõe "Todos os
// clientes". Conseguimos isto com uma flag ao nível do MÓDULO, que:
//   • persiste durante navegação SPA (clicar no botão → mantém-se),
//   • REINICIA num carregamento a frio / refresh (o módulo é recarregado).
// Assim, se chegarmos a ?tab=recent sem ter sido uma escolha nesta sessão
// (refresh, link direto), voltamos a ?tab=todos.
// ════════════════════════════════════════════════════════════════

let activatedInSession = false;

export function RecentToggle({ tab }: { tab: "todos" | "recent" }) {
  const router = useRouter();

  useEffect(() => {
    if (tab === "recent" && !activatedInSession) {
      router.replace("/admin/clientes?tab=todos");
    }
    // Só na montagem: distingue carregamento a frio de navegação SPA.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (value: "todos" | "recent") => {
    activatedInSession = true;
    router.push(`/admin/clientes?tab=${value}`);
  };

  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="mr-1 text-ink-500">Ordenar:</span>
      <Pill active={tab === "todos"} label="Todos os clientes" onClick={() => go("todos")} />
      <Pill active={tab === "recent"} label="Últimos clientes" onClick={() => go("recent")} />
    </div>
  );
}

function Pill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md px-3 py-1.5 font-medium transition",
        active
          ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900"
          : "text-ink-600 hover:bg-ink-900/5 dark:text-bone-100 dark:hover:bg-white/10",
      )}
    >
      {label}
    </button>
  );
}
