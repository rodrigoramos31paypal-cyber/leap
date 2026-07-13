"use client";

// ════════════════════════════════════════════════════════════════
// SlotClickLayer · camada transparente sobre uma coluna-dia da grelha
// da semana. Ao clicar num espaço vazio, calcula a hora a partir da
// posição vertical do clique (snap a 30 min) e abre o BookingDialog
// via evento `agenda:newbooking` com { date, time }.
//
// Fica POR BAIXO dos blocos de marcação/bloqueio (que vêm depois no
// DOM), portanto cliques sobre uma sessão existente continuam a abrir
// o popover dessa sessão — só o espaço vazio dispara uma nova marcação.
// ════════════════════════════════════════════════════════════════
// Interpolação linear por troços (min↔px) sobre breakpoints monótonos.
function _interp(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 0;
  while (i < n - 1 && xs[i + 1] < x) i++;
  const x0 = xs[i];
  const x1 = xs[i + 1];
  if (x1 === x0) return ys[i];
  return ys[i] + ((x - x0) / (x1 - x0)) * (ys[i + 1] - ys[i]);
}

export function SlotClickLayer({
  dateIso,
  rowTops,
  rowHeights,
  rowStopsMin,
  rowStopsY,
}: {
  dateIso: string;
  // Layout de altura variável (24 horas). Partilhado com a grelha em
  // page.tsx para que o clique mapeie para a hora certa mesmo quando
  // algumas linhas estão encolhidas.
  rowTops: number[];
  rowHeights: number[];
  // Mapa tempo→px por troços (esticão de intervalos apertados). Quando
  // presente, é a fonte de verdade do px→min; senão, fallback linear/hora.
  rowStopsMin?: number[];
  rowStopsY?: number[];
}) {
  // Inverte uma posição vertical (px) para minutos-desde-meia-noite,
  // percorrendo a tabela de alturas variáveis.
  function yToMinutes(y: number): number {
    if (rowStopsMin && rowStopsY && rowStopsMin.length > 1) {
      return _interp(rowStopsY, rowStopsMin, y);
    }
    let h = 23;
    for (let i = 0; i < 24; i++) {
      if (y < rowTops[i] + rowHeights[i]) {
        h = i;
        break;
      }
    }
    const frac = Math.min(1, Math.max(0, (y - rowTops[h]) / rowHeights[h]));
    return h * 60 + frac * 60;
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const rawMin = yToMinutes(offsetY);
    // snap a 30 min, limitado a 23:30 como última hora de início
    let snapped = Math.round(rawMin / 30) * 30;
    snapped = Math.max(0, Math.min(24 * 60 - 30, snapped));
    const h = Math.floor(snapped / 60);
    const m = snapped % 60;
    const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    window.dispatchEvent(
      new CustomEvent("agenda:newbooking", { detail: { date: dateIso, time } }),
    );
  }

  return (
    <div
      onClick={onClick}
      className="absolute inset-0 cursor-pointer"
      title="Clica para marcar uma sessão"
      aria-label="Marcar sessão neste dia"
    />
  );
}
