"use client";

// ════════════════════════════════════════════════════════════════
// AgendaZoom · controlo −/%/+ para o trainer ajustar a densidade da
// grelha (altura das horas). O valor é memorizado num cookie
// `leap_agenda_zoom` (por dispositivo, entre sessões) e lido no
// servidor por `AdminAgendaPage`, que o passa a `buildRowLayout`.
// Como todas as posições/alturas (e o drag) derivam desse layout, o
// zoom mantém-se sempre alinhado — ao contrário de um scale CSS.
// ════════════════════════════════════════════════════════════════
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ZoomIn, ZoomOut } from "lucide-react";

const MIN = 0.7;
const MAX = 1.6;
const STEP = 0.15;
const ONE_YEAR = 60 * 60 * 24 * 365;

export function AgendaZoom({ current }: { current: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setZoom(next: number) {
    const z = Math.min(MAX, Math.max(MIN, Math.round(next * 100) / 100));
    // Cookie não-httpOnly (é só uma preferência de UI) — lido no servidor.
    document.cookie = `leap_agenda_zoom=${z}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  const pct = Math.round(current * 100);

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-ink-900/10 bg-white px-0.5 py-0.5 text-ink-600 dark:border-white/10 dark:bg-ink-800">
      <button
        type="button"
        aria-label="Reduzir zoom"
        disabled={pending || current <= MIN}
        onClick={() => setZoom(current - STEP)}
        className="rounded p-1 transition hover:bg-ink-900/5 disabled:opacity-40 dark:hover:bg-white/10"
      >
        <ZoomOut size={14} />
      </button>
      <span className="min-w-[30px] text-center text-[10px] font-semibold tabular-nums">
        {pct}%
      </span>
      <button
        type="button"
        aria-label="Aumentar zoom"
        disabled={pending || current >= MAX}
        onClick={() => setZoom(current + STEP)}
        className="rounded p-1 transition hover:bg-ink-900/5 disabled:opacity-40 dark:hover:bg-white/10"
      >
        <ZoomIn size={14} />
      </button>
    </div>
  );
}
