import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Lista de clientes — DESIGN PREMIUM (alinhado com o fitnessv2).
// Uma folha agrupada (não cartões a flutuar): linhas separadas por
// hairlines, estado por ponto de cor discreto (verde ≥3 · amarelo 1–2 ·
// vermelho 0) e o nº de sessões em destaque monocromático. Sem avatares.
// Componente de apresentação (server-safe: Link + SVG).
// ════════════════════════════════════════════════════════════════

type Row = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

// Ponto de estado + halo suave. 0 = vermelho, 1–2 = amarelo, 3+ = verde.
const DOT: Record<"ok" | "warn" | "danger", string> = {
  ok: "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]",
  warn: "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.16)]",
  danger: "bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.15)]",
};

function toneOf(n: number): "ok" | "warn" | "danger" {
  if (n === 0) return "danger";
  if (n <= 2) return "warn";
  return "ok";
}

// Mostra só o primeiro e o último nome (descarta nomes do meio).
function shortName(name: string | null): string {
  const n = (name ?? "").trim();
  if (!n) return "(sem nome)";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return n;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

export function PremiumClientList({
  clients,
  sessions,
  showSessions = true,
}: {
  clients: Row[];
  sessions: Map<string, number>;
  showSessions?: boolean;
}) {
  return (
    <div className="card overflow-hidden">
      {clients.map((c, i) => {
        const n = sessions.get(c.id) ?? 0;
        const tone = toneOf(n);
        // Só o email por baixo do nome (sem telefone).
        const contact = c.email ?? "";
        return (
          <div key={c.id}>
            {i > 0 && <div className="mx-4 h-px bg-ink-900/[0.06] dark:bg-white/[0.07]" />}
            <Link
              href={`/admin/clientes/${c.id}`}
              className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-ink-900/[0.02] dark:hover:bg-white/[0.03]"
            >
              <div className="min-w-0 flex-1">
                <div className="font-display truncate text-[15px] font-semibold tracking-[-0.01em] text-ink-900 dark:text-bone-50">
                  {shortName(c.full_name)}
                </div>
                {contact && (
                  <div className="mt-0.5 truncate text-xs text-[#a3a39a] dark:text-bone-100/45">
                    {contact}
                  </div>
                )}
              </div>

              {showSessions && (
                <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                  <span className={cn("h-[7px] w-[7px] rounded-full", DOT[tone])} />
                  <span
                    className={cn(
                      "text-[13px]",
                      n === 0 ? "text-ink-500" : "text-ink-600",
                    )}
                  >
                    <b className="font-semibold text-ink-900 dark:text-bone-50">{n}</b>{" "}
                    {n === 1 ? "sessão" : "sessões"}
                  </span>
                </div>
              )}

              <ChevronRight
                size={17}
                className="shrink-0 text-[#cfcec6] transition-transform duration-200 group-hover:translate-x-0.5 dark:text-bone-100/25"
              />
            </Link>
          </div>
        );
      })}
    </div>
  );
}
