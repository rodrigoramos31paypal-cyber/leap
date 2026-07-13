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
  const supabase = await createClient();

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
    (supabase as any)
      .from("trainer_settings")
      .select("buffer_between_sessions_min, min_booking_notice_hours")
      .eq("trainer_id", trainerId)
      .single(),
  ]);

  if (!avail || avail.length === 0) return [];
  const buffer = settings?.buffer_between_sessions_min ?? 0;
  // Antecedência mínima de marcação (cliente). Slots a menos de N horas
  // do agora não são oferecidos. Default 12h; 0 = sem mínimo.
  const noticeHraw = Number((settings as any)?.min_booking_notice_hours);
  const noticeHours = Number.isFinite(noticeHraw) && noticeHraw >= 0 ? noticeHraw : 12;

  // marcações ativas + bloqueios
  // SEC/CORRECÇÃO: lê de `public_busy_times` (vista) e NÃO de `bookings`.
  // A query corre sob a RLS do utilizador, e em `bookings` cada cliente
  // só vê as SUAS marcações — por isso as sessões de outros clientes não
  // bloqueavam os slots e apareciam horários que se sobrepunham. A vista
  // expõe apenas os intervalos ocupados (sem identidade) a authenticated.
  // (`as any` porque a vista não está nos tipos gerados — ver 0064.)
  // ── Bloqueios RECORRENTES (semanais) ────────────────────────────
  // Repetem-se no mesmo dia-da-semana/horas até serem removidos. Não se
  // aplicam num dia concreto se houver um "skip" para essa data (o
  // trainer limpou/ajustou a recorrência nesse dia).
  const dateStr = `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  // PERF (P-22): estes 4 reads (marcações + bloqueios + recorrentes +
  // skips) são todos independentes — eram 2 batches Promise.all em série.
  // Fundidos num único Promise.all → poupa 1 round-trip por chamada a
  // getAvailableSlots (i.e. por troca de dia no fluxo de marcação).
  const [{ data: bookings }, { data: blocks }, { data: recurring }, { data: skips }] =
    await Promise.all([
      (supabase as any)
        .from("public_busy_times")
        .select("starts_at, ends_at")
        .eq("trainer_id", trainerId)
        .gte("starts_at", dayStart.toISOString())
        .lt("starts_at", dayEnd.toISOString()),
      // SEC: lê da vista pública (sem `reason`) — base table é admin-only.
      supabase
        .from("public_blocked_times")
        .select("starts_at, ends_at")
        .eq("trainer_id", trainerId)
        .lt("starts_at", dayEnd.toISOString())
        .gt("ends_at", dayStart.toISOString()),
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
  const bookableFrom = now + noticeHours * 3_600_000;

  // Janelas de disponibilidade do dia (em ms), calculadas uma só vez.
  const windows = avail.map((a) => {
    const [sh, sm] = a.start_time.split(":").map(Number);
    const [eh, em] = a.end_time.split(":").map(Number);
    return {
      start: wallToUtc(y, mo, d, sh, sm).getTime(),
      end: wallToUtc(y, mo, d, eh, em).getTime(),
    };
  });

  const bufferMs = buffer * 60_000;

  for (const win of windows) {
    // Um cursor avança pela janela. Em condições normais isto é apenas a
    // grelha de (duração + buffer) a partir do início da janela: 07:15,
    // 08:00, 08:45, … (com 45 min e buffer 0).
    //
    // SINCRONIZAÇÃO APÓS ARRASTO DO ADMIN (jun/2026): sempre que o cursor
    // colide com um intervalo ocupado, RE-ANCORA no fim desse intervalo
    // (+ buffer) e continua a contar a partir daí. Assim, se uma sessão for
    // arrastada para fora da grelha (ex.: 19:15→19:00, passando a terminar às
    // 19:45), os horários seguintes passam a ser 19:45, 20:30, 21:15… até a
    // janela fechar — o ponto antigo da grelha (20:00) deixa de aparecer.
    // Como uma sessão "on-grid" termina num ponto da grelha, o re-âncora
    // coincide com a grelha e, sem arrastos, nada muda.
    let cursor = win.start;
    // Guarda anti-loop: o cursor é estritamente crescente (hit.end > cursor,
    // ou += stepMs > 0), por isso isto nunca dispara com dados sãos.
    let guard = 0;
    while (cursor + slotMs <= win.end && guard++ < 10_000) {
      const slotEnd = cursor + slotMs;
      const hit = busy.find((b) => !(slotEnd <= b.start || cursor >= b.end));
      if (hit) {
        cursor = hit.end + bufferMs; // re-ancora no fim da sessão/bloqueio
        continue;
      }
      if (cursor >= bookableFrom) {
        slots.push({ startsAt: new Date(cursor), endsAt: new Date(slotEnd) });
      }
      cursor += stepMs;
    }
  }

  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return slots;
}


// ══════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════
// Antecedência mínima de marcação (defesa server-side).
// Devolve uma mensagem de erro amigável se `startsAtIso` for demasiado
// cedo face à regra do trainer; caso contrário null. Usado pelas server
// actions do CLIENTE (app/app/agenda) — os admins marcam por outro
// caminho e não passam por aqui.
// ════════════════════════════════════════════════════════════════
export async function bookingNoticeError(
  trainerId: string,
  startsAtIso: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await (supabase as any)
    .from("trainer_settings")
    .select("min_booking_notice_hours")
    .eq("trainer_id", trainerId)
    .maybeSingle();
  const raw = Number((data as any)?.min_booking_notice_hours);
  const hours = Number.isFinite(raw) && raw >= 0 ? raw : 12;
  if (hours <= 0) return null;
  const startMs = new Date(startsAtIso).getTime();
  if (!Number.isFinite(startMs)) return null;
  if (startMs < Date.now() + hours * 3_600_000) {
    return `As marcações têm de ser feitas com pelo menos ${hours}h de antecedência.`;
  }
  return null;
}
