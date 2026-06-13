import { createClient } from "@/lib/supabase/server";

// ════════════════════════════════════════════════════════════════
// Streak semanal · cálculo a partir de bookings (sem estado persistente).
//
// Semana: SEGUNDA–DOMINGO (ISO). Uma semana "conta" se o cliente teve
// pelo menos uma sessão CONFIRMED que ACABOU dentro desse intervalo.
//
// Streak (semantics):
//   • Conta a sequência mais recente de semanas consecutivas com ≥1
//     sessão. A sequência "está viva" se o cliente treinou nesta
//     semana OU na semana passada (margem de uma semana para não
//     interromper o streak por causa de 4 dias entre sessões).
//   • Se a sequência mais recente terminou há ≥2 semanas, streak = 0.
//
// Usado em dois sítios:
//   • Dashboard cliente — para mostrar "X semanas consecutivas".
//   • Cron weekly-streaks — Segunda-feira parabeniza pela semana fechada.
// ════════════════════════════════════════════════════════════════

const MS_DAY = 86_400_000;
const MS_WEEK = 7 * MS_DAY;

/** Devolve a data (00:00 UTC) da segunda-feira da semana que contém `d`. */
export function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay(); // 0=Dom..6=Sáb
  const delta = day === 0 ? -6 : 1 - day;
  x.setUTCDate(x.getUTCDate() + delta);
  return x;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Conta o streak dado o conjunto de semanas (chaves ISO da segunda-feira)
 *  com pelo menos 1 sessão. Usa `referenceDate` para saber "esta semana"
 *  vs "semana passada". */
export function streakFromWeekKeys(weekKeys: Set<string>, referenceDate: Date = new Date()) {
  const thisMon = mondayOf(referenceDate);
  const lastMon = new Date(thisMon.getTime() - MS_WEEK);

  // Escolhe o ponto de partida: esta semana, depois a anterior. Se nem
  // uma nem outra tiverem sessão, o streak está partido.
  let cursor: Date;
  if (weekKeys.has(isoDate(thisMon))) cursor = thisMon;
  else if (weekKeys.has(isoDate(lastMon))) cursor = lastMon;
  else return { weeks: 0, latestWeekStart: thisMon };

  let weeks = 0;
  while (weekKeys.has(isoDate(cursor))) {
    weeks++;
    cursor = new Date(cursor.getTime() - MS_WEEK);
  }
  return { weeks, latestWeekStart: thisMon };
}

/** Conta semanas consecutivas (Seg–Dom) com ≥1 sessão confirmed do
 *  utilizador. Olha 52 semanas para trás no máximo. */
export async function getCurrentStreak(
  userId: string,
  referenceDate: Date = new Date(),
): Promise<{ weeks: number; latestWeekStart: Date }> {
  const supabase = createClient();
  const horizon = new Date(referenceDate.getTime() - 365 * MS_DAY);

  const { data: rows } = await supabase
    .from("bookings")
    .select("ends_at")
    .eq("client_id", userId)
    .eq("status", "confirmed")
    .gte("ends_at", horizon.toISOString())
    .lte("ends_at", referenceDate.toISOString());

  const weekKeys = new Set<string>();
  for (const r of ((rows ?? []) as any[])) {
    weekKeys.add(isoDate(mondayOf(new Date(r.ends_at))));
  }
  return streakFromWeekKeys(weekKeys, referenceDate);
}

/** Mensagem de parabéns adaptada ao número de semanas. */
export function streakCongratsBody(weeks: number): string {
  if (weeks >= 12) return `Incrível — ${weeks} semanas seguidas de treino. Continua assim!`;
  if (weeks >= 8) return `${weeks} semanas seguidas. Estás imparável.`;
  if (weeks >= 4) return `Boa! Já vais em ${weeks} semanas consecutivas. Continua.`;
  return `Mais uma semana de treino concluída — vais em ${weeks} seguidas.`;
}
