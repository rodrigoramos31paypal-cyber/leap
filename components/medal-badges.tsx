// ════════════════════════════════════════════════════════════════
// Troféus acumulados de um cliente (ouro/prata/bronze × contagem).
// Componente puro (sem estado) — serve o ranking do cliente e do admin.
// Só mostra os níveis com contagem > 0. Ex.: 🥇×2 · 🥈×1
// ════════════════════════════════════════════════════════════════
import { Trophy } from "lucide-react";

type Props = {
  gold?: number;
  silver?: number;
  bronze?: number;
  size?: number;
};

const TIERS = [
  { key: "gold", label: "ouro", color: "#B8860B", bg: "#FBF1CE" },
  { key: "silver", label: "prata", color: "#6B7280", bg: "#E9EAEC" },
  { key: "bronze", label: "bronze", color: "#A96A33", bg: "#F3E1D1" },
] as const;

export function MedalBadges({ gold = 0, silver = 0, bronze = 0, size = 11 }: Props) {
  const items = [
    { n: gold, ...TIERS[0] },
    { n: silver, ...TIERS[1] },
    { n: bronze, ...TIERS[2] },
  ].filter((i) => i.n > 0);
  if (items.length === 0) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-1 align-middle">
      {items.map((i) => (
        <span
          key={i.key}
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums"
          style={{ background: i.bg, color: i.color }}
          title={`${i.n}× ${i.label}`}
        >
          <Trophy size={size} strokeWidth={2.3} />
          ×{i.n}
        </span>
      ))}
    </span>
  );
}
