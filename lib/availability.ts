// ════════════════════════════════════════════════════════════════
// Cálculo de slots disponíveis para um trainer num dado dia.
//
// FUSO: tudo é calculado no fuso do estúdio (Europe/Lisbon), não no
// fuso do servidor (Vercel corre em UTC). Sem isto, o dia-da-semana e
// as horas dos slots saíam trocados (ex.: Segunda tratada como Domingo
// no Verão, marcações a cair no dia anterior).
//
// O `date` recebido representa a meia-noite UTC do dia-calendário
// escolhido (vem de uma string "YYYY-MM-DD"), por isso lemos os seus
// componentes em UTC.
// ════════════════════════════════════════════════════════════════
import { createClient } from "@/lib/supabase/server";

const STUDIO_TZ = "Europe/Lisbon";

export type Slot = { startsAt: Date; endsAt: Date };

// Offset (minutos) tal que horaLocal = UTC + offset, para o tz no instante dado.
function tzOffsetMinutes(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - date.getTime()) / 60000;
}

// Converte uma hora "de parede" no fuso do estúdio para o instante UTC correcto
// (trata DST automaticamente via o offset do próprio dia).
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo, d, h, mi, 0);
  const off = tzOffsetMinutes(new Date(guess), STUDIO_TZ);
  return new Date(guess - off * 60000);
}

export async function getAvailableSlots(args: {
  trainerId: string;
  date: Date;
  durationMin: number;
}): Promise<Slot[]> {
  const { trainerId, date, durationMin } = args;
  const supabase = createClient();

  // Componentes do dia-calendário (date = meia-noite UTC de "YYYY-MM-DD").
  const y = date.getUTCFullYear();
  const mo = date.getUTCMonth();
  const d = date.getUTCDate();

  // dia da semana (0-6) do dia-calendário — estável, independente do fuso do servidor.
  const dow = new Date(Date.UTC(y, mo, d)).getUTCDay();

  // Fronteiras do dia no fuso do estúdio, convertidas para UTC.
  const dayStart = wallToUtc(y, mo, d, 0, 0);
  const dayEnd = wallToUtc(y, mo, d + 1, 0, 0);

  // disponibilidades nesse dia
  // PERF (C3): availability + settings em PARALELO. Eram 2 round-trips em
  // série, mas settings (buffer) não depende de availability. Custo: uma
  // query settings "a mais" nos dias sem disponibilidade — desprezável
  // face ao ganho no caminho comum (dias com horários).
  const [{ data: avail }, { data: settings }] = await Promise.all([
    supabase
      .from("trainer_availability")
      .select("start_time, end_time, active")
      .eq("trainer_id", trainerId)
      .eq("day_of_week", dow)
      .eq("active", true),
    supabase
      .from("trainer_settings")
      .select("buffer_between_sessions_min")
      .eq("trainer_id", trainerId)
      .single(),
  ]);

  if (!avail || avail.length === 0) return [];
  const buffer = settings?.buffer_between_sessions_min ?? 0;

  // marcações ativas + bloqueios
  const [{ data: bookings }, { data: blocks }] = await Promise.all([
    supabase
      .from("bookings")
      .select("starts_at, ends_at, status")
      .eq("trainer_id", trainerId)
      .in("status", ["booked", "confirmed"])
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString()),
    // SEC: lê da vista pública (sem `reason`) — base table é admin-only.
    supabase
      .from("public_blocked_times")
      .select("starts_at, ends_at")
      .eq("trainer_id", trainerId)
      .lt("starts_at", dayEnd.toISOString())
      .gt("ends_at", dayStart.toISOString()),
  ]);

  const busy: Array<{ start: number; end: number }> = [];
  for (const b of bookings ?? []) {
    busy.push({ start: new Date(b.starts_at).getTime(), end: new Date(b.ends_at).getTime() });
  }
  for (const b of blocks ?? []) {
    // H4: assertion non-null. `public_blocked_times` é uma vista; o
    // Supabase generator marca colunas de views como nullable por
    // omissão, mas a vista deriva de colunas NOT NULL na base table.
    busy.push({ start: new Date(b.starts_at!).getTime(), end: new Date(b.ends_at!).getTime() });
  }

  // ── Bloqueios RECORRENTES (semanais) ────────────────────────────
  // Repetem-se no mesmo dia-da-semana/horas até serem removidos. Não se
  // aplicam num dia concreto se houver um "skip" para essa data (o
  // trainer limpou/ajustou a recorrência nesse dia).
  const dateStr = `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const [{ data: recurring }, { data: skips }] = await Promise.all([
    (supabase as any)
      .from("public_recurring_blocks")
      .select("start_time, end_time")
      .eq("trainer_id", trainerId)
      .eq("day_of_week", dow),
    (supabase as any)
      .from("public_recurring_block_skips")
      .select("skip_date")
      .eq("trainer_id", trainerId)
      .eq("skip_date", dateStr),
  ]);
  if (((skips ?? []) as any[]).length === 0) {
    for (const rb of (recurring ?? []) as any[]) {
      const [rsh, rsm] = String(rb.start_time).split(":").map(Number);
      const [reh, rem] = String(rb.end_time).split(":").map(Number);
      busy.push({
        start: wallToUtc(y, mo, d, rsh, rsm).getTime(),
        end: wallToUtc(y, mo, d, reh, rem).getTime(),
      });
    }
  }

  const slots: Slot[] = [];
  const slotMs = durationMin * 60_000;
  const stepMs = (durationMin + buffer) * 60_000;
  const now = Date.now();

  for (const a of avail) {
    const [sh, sm] = a.start_time.split(":").map(Number);
    const [eh, em] = a.end_time.split(":").map(Number);
    const startBoundary = wallToUtc(y, mo, d, sh, sm).getTime();
    const endBoundary = wallToUtc(y, mo, d, eh, em).getTime();

    for (let t = startBoundary; t + slotMs <= endBoundary; t += stepMs) {
      if (t <= now) continue;
      const slotEnd = t + slotMs;
      const overlaps = busy.some((b) => !(slotEnd <= b.start || t >= b.end));
      if (overlaps) continue;
      slots.push({ startsAt: new Date(t), endsAt: new Date(slotEnd) });
    }
  }

  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return slots;
}
