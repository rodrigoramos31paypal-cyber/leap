// ════════════════════════════════════════════════════════════════
// Cálculo de slots disponíveis para um trainer num dado dia.
// ════════════════════════════════════════════════════════════════
import { createClient } from "@/lib/supabase/server";

export type Slot = { startsAt: Date; endsAt: Date };

export async function getAvailableSlots(args: {
  trainerId: string;
  date: Date;
  durationMin: number;
}): Promise<Slot[]> {
  const { trainerId, date, durationMin } = args;
  const supabase = createClient();

  // dia da semana (0-6)
  const dow = date.getDay();
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // disponibilidades nesse dia
  const { data: avail } = await supabase
    .from("trainer_availability")
    .select("start_time, end_time, active")
    .eq("trainer_id", trainerId)
    .eq("day_of_week", dow)
    .eq("active", true);

  if (!avail || avail.length === 0) return [];

  // settings (buffer)
  const { data: settings } = await supabase
    .from("trainer_settings")
    .select("buffer_between_sessions_min")
    .eq("trainer_id", trainerId)
    .single();
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
    busy.push({ start: new Date(b.starts_at).getTime(), end: new Date(b.ends_at).getTime() });
  }

  const slots: Slot[] = [];
  const slotMs = durationMin * 60_000;
  const stepMs = (durationMin + buffer) * 60_000;
  const now = Date.now();

  for (const a of avail) {
    const [sh, sm] = a.start_time.split(":").map(Number);
    const [eh, em] = a.end_time.split(":").map(Number);
    const startBoundary = new Date(date);
    startBoundary.setHours(sh, sm, 0, 0);
    const endBoundary = new Date(date);
    endBoundary.setHours(eh, em, 0, 0);

    for (let t = startBoundary.getTime(); t + slotMs <= endBoundary.getTime(); t += stepMs) {
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
