"use client";

// Seletor de mês do ranking. Navega para <basePath>?month=YYYY-MM (ou para
// <basePath> quando se escolhe o mês corrente). Serve cliente e admin.
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

export function MonthSelect({
  selected,
  current,
  options,
  basePath = "/app/leaderboard",
}: {
  selected: string;
  current: string;
  options: { value: string; label: string }[];
  basePath?: string;
}) {
  const router = useRouter();
  return (
    <div className="relative inline-flex">
      <select
        value={selected}
        onChange={(e) => {
          const v = e.target.value;
          router.push(v === current ? basePath : `${basePath}?month=${v}`);
        }}
        className="appearance-none rounded-full border border-ink-900/15 bg-white py-1.5 pl-4 pr-9 text-sm font-semibold text-ink-900 [color-scheme:light] focus:border-gold-400 focus:outline-none dark:border-white/15 dark:bg-ink-800 dark:text-bone-50 dark:[color-scheme:dark]"
        aria-label="Escolher mês do ranking"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400"
      />
    </div>
  );
}
