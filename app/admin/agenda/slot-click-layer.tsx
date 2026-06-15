"use client";

// ════════════════════════════════════════════════════════════════
// SlotClickLayer · camada transparente sobre uma coluna-dia da
// grelha da semana. Ao clicar num espaço vazio, calcula a hora a
// partir da posição vertical do clique e abre o BookingDialog via
// evento `agenda:newbooking` com { date, time }.
//
// Modo "proportional" (durante drag, ou se mode não for passado):
//   snap a 30 min com base na posição vertical / hourHeight.
// Modo "band" (padrão na vista de semana após o refactor das bandas):
//   o Y do clique cai numa banda de hora — devolve sempre :00 dessa
//   hora (precisão de 1 h, simples e previsível para o utilizador).
//
// Fica POR BAIXO dos blocos de marcação/bloqueio (que vêm depois
// no DOM), portanto cliques sobre uma sessão existente continuam
// a abrir o popover dessa sessão — só o espaço vazio dispara uma
// nova marcação.
// ════════════════════════════════════════════════════════════════
export function SlotClickLayer({
  dateIso,
  hourStart,
  hourEnd,
  hourHeight,
  mode = "proportional",
  bandTops,
  bandHeights,
}: {
  dateIso: string;
  hourStart: number;
  hourEnd: number;
  hourHeight: number;
  mode?: "band" | "proportional";
  bandTops?: number[];
  bandHeights?: number[];
}) {
  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;

    let totalMin: number;
    const maxMin = (hourEnd - hourStart) * 60 - 30; // última hora de início (ex: 21:30)

    if (mode === "band" && bandTops && bandHeights) {
      // Encontra a banda em que o Y caiu — devolve sempre :00 dessa hora.
      let hi = 0;
      for (let i = 0; i < bandTops.length; i++) {
        const bandTop = bandTops[i];
        const bandBot = bandTop + bandHeights[i];
        if (offsetY >= bandTop && offsetY < bandBot) {
          hi = i;
          break;
        }
        if (i === bandTops.length - 1 && offsetY >= bandBot) {
          hi = i;
        }
      }
      totalMin = Math.max(0, Math.min(maxMin, hi * 60));
    } else {
      const rawMin = (offsetY / hourHeight) * 60;
      // snap a 30 min
      let snapped = Math.round(rawMin / 30) * 30;
      snapped = Math.max(0, Math.min(maxMin, snapped));
      totalMin = snapped;
    }

    const totalAbsMin = hourStart * 60 + totalMin;
    const hh = Math.floor(totalAbsMin / 60);
    const mm = totalAbsMin % 60;
    const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
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
