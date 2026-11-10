// ════════════════════════════════════════════════════════════════
// Helpers de períodos (meses) do ranking — partilhados pelo ranking do
// cliente e do admin. Período = 'YYYY-MM'. Os prémios começam em
// AWARDS_START (1º mês completo da feature).
// ════════════════════════════════════════════════════════════════

export const AWARDS_START = "2026-10";
export const RANKING_START_DATE = `${AWARDS_START}-01`;
// Lisboa estava em UTC+1 no dia em que o ranking começou.
export const RANKING_START_LISBON = `${RANKING_START_DATE}T00:00:00+01:00`;

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Mês corrente no fuso de Lisboa, como 'YYYY-MM'. */
export function currentPeriodLisbon(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

/** 'YYYY-MM' → "Outubro 2026". */
export function periodLabel(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return `${MONTHS_PT[m - 1]} ${y}`;
}

/** Lista de meses do corrente até AWARDS_START (descendente). */
export function periodsDownTo(current: string): string[] {
  const [sy, sm] = AWARDS_START.split("-").map(Number);
  let [y, m] = current.split("-").map(Number);
  const out: string[] = [];
  while (y > sy || (y === sy && m >= sm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return out;
}
