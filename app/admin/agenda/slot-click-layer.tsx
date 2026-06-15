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
export function SlotClickLayer({
  dateIso,
  hourStart,
  hourEnd,
  hourHeight,
}: {
  dateIso: string;
  hourStart: number;
  hourEnd: number;
  hourHeight: number;
}) {
  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const rawMin = (offsetY / hourHeight) * 60;
    // snap a 30 min
    let snapped = Math.round(rawMin / 30) * 30;
    const minMin = 0;
    const maxMin = (hourEnd - hourStart) * 60 - 30; // última hora de início (ex: 21:30)
    snapped = Math.max(minMin, Math.min(maxMin, snapped));
    const totalMin = hourStart * 60 + snapped;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
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
