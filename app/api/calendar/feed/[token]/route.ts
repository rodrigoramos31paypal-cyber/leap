// ════════════════════════════════════════════════════════════════
// Per-user iCal subscription feed
// GET /api/calendar/feed/<calendar_feed_token>.ics
//
// Usado pelo telemóvel do user para subscrever o seu calendário:
//   • iPhone: Settings → Calendar → Accounts → Add Account → Other →
//     Add Subscribed Calendar → cola a URL
//   • Android: abrir webcal://<host>/api/calendar/feed/<token>.ics no
//     Google Calendar / outras apps de calendário
//
// O token é o segredo URL — sem sessão. Não dá acesso à app, só leitura
// dos eventos. Se for comprometido, basta gerar um novo na BD.
//
// O feed inclui:
//   • trainer: todas as suas sessões marcadas + bloqueios (próximos 6m)
//   • client: as suas próprias sessões marcadas (próximos 6m)
// ════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { rateLimit, getRequestIp } from "@/lib/rate-limit";

// Horizonte do feed: passado 7 dias (para histórico recente no
// telemóvel) e futuro 6 meses. Suficiente para um cliente normal.
const PAST_DAYS = 7;
const FUTURE_DAYS = 180;

// SEC (H-D, audit jun/2026): UUID v4 ESTRITO. A regex antiga
// /^[0-9a-f-]{36}$/i aceitava lixo degenerado (ex.: 36 traços) que
// consumia uma query Supabase à toa. Exigimos o formato canónico.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toIcsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// Converte um instante (UTC) para a hora-de-parede de Europe/Lisbon no
// formato ICS local (YYYYMMDDTHHMMSS, sem Z) — usado com TZID=Europe/Lisbon.
function toLisbonLocalIcs(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
}

// VTIMEZONE Europe/Lisbon (regras UE: WEST = UTC+1 no verão, WET = UTC+0).
// Permite que iOS/Android resolvam DTSTART;TZID=Europe/Lisbon sem
// ambiguidade — corrige sessões a aparecer 1h/1 dia ao lado.
const LISBON_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Lisbon",
  "X-LIC-LOCATION:Europe/Lisbon",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0000",
  "TZOFFSETTO:+0100",
  "TZNAME:WEST",
  "DTSTART:19700329T010000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0000",
  "TZNAME:WET",
  "DTSTART:19701025T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];


function escapeIcs(s: string) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function makeUid(kind: string, id: string) {
  return `${kind}-${id}@leap-fitness.pt`;
}

type Event = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  status?: "CONFIRMED" | "CANCELLED" | "TENTATIVE";
};

function eventToVevent(e: Event, now: Date) {
  return [
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${toIcsDate(now)}`,
    `DTSTART;TZID=Europe/Lisbon:${toLisbonLocalIcs(e.start)}`,
    `DTEND;TZID=Europe/Lisbon:${toLisbonLocalIcs(e.end)}`,
    `SUMMARY:${escapeIcs(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${escapeIcs(e.description)}`] : []),
    `STATUS:${e.status ?? "CONFIRMED"}`,
    "END:VEVENT",
  ].join("\r\n");
}

export async function GET(req: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  // O ficheiro pode chegar como `<uuid>.ics` (apps que requerem
  // extensão na URL) ou só `<uuid>`. Aceitamos ambos.
  const raw = params.token ?? "";
  const token = raw.replace(/\.ics$/i, "");

  // SEC (H-D): valida formato UUID v4 estrito ANTES de qualquer query —
  // lixo é rejeitado de imediato sem tocar na BD.
  if (!UUID_RE.test(token)) {
    return new NextResponse("Invalid token", { status: 404 });
  }

  // SEC (H-D): rate-limit por IP. O middleware exclui /api/calendar/feed
  // do rate-limit global (os clientes de calendário fazem GETs
  // frequentes), o que deixava este endpoint aberto a brute-force
  // ilimitado contra o token. Um cliente de calendário legítimo só
  // refresca ~1×/hora (REFRESH-INTERVAL=PT1H), por isso o limite
  // "generic" (30/min) é folgado para uso real mas trava enumeração.
  const ip = getRequestIp(req.headers);
  const rl = await rateLimit("generic", `cal-feed:${ip}`);
  if (!rl.success) {
    return new NextResponse("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSeconds) },
    });
  }

  // Admin client porque não há sessão — autenticamos pelo token URL.
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, full_name, trainer_id")
    .eq("calendar_feed_token", token)
    .maybeSingle();

  if (!profile) {
    return new NextResponse("Not found", { status: 404 });
  }

  const now = new Date();

  // Regista o último fetch do feed. Só um cliente de calendário
  // (iOS/Google/etc.) conhece o token e bate neste endpoint — o browser
  // ao tocar em "Subscrever" abre o app Calendário, que faz logo o 1.º
  // fetch. Assim conseguimos mostrar ao cliente que a subscrição está
  // ativa. Best-effort: nunca bloqueia nem falha o feed.
  try {
    await admin
      .from("profiles")
      .update({ calendar_feed_last_fetched_at: now.toISOString() } as any)
      .eq("id", profile.id);
  } catch {
    // ignora — o feed é o que importa
  }
  const rangeStart = new Date(now.getTime() - PAST_DAYS * 86_400_000);
  const rangeEnd = new Date(now.getTime() + FUTURE_DAYS * 86_400_000);

  const events: Event[] = [];

  if (profile.role === "trainer" || profile.role === "owner") {
    // Scope: o feed é pessoal — owner E trainer só veem o que está
    // marcado contra a sua própria conta. Owners que queiram ver as
    // sessões dos outros trainers usam a app, não o feed do telemóvel.
    const { data: trainerRows } = await admin
      .from("trainers")
      .select("id")
      .eq("profile_id", profile.id);
    const trainerIds = (trainerRows ?? []).map((t) => t.id);

    if (trainerIds.length > 0) {
      // Apenas sessões ativas — bloqueios ("Indisponível") e sessões
      // canceladas ficam fora do feed para manter o calendário do
      // telemóvel limpo e focado no que é real.
      const { data: bookings } = await admin
        .from("bookings")
        .select("id, starts_at, ends_at, session_type, status, profiles:client_id(full_name)")
        .in("trainer_id", trainerIds)
        .gte("starts_at", rangeStart.toISOString())
        .lt("starts_at", rangeEnd.toISOString())
        .neq("status", "cancelled");

      for (const b of bookings ?? []) {
        const clientName = (b as any).profiles?.full_name ?? "cliente";
        events.push({
          uid: makeUid("booking", b.id),
          start: new Date(b.starts_at),
          end: new Date(b.ends_at ?? new Date(new Date(b.starts_at).getTime() + 60 * 60 * 1000)),
          summary: `Sessão · ${clientName}`,
          description: `LEAP Fitness Studio · ${b.session_type ?? ""} · ${b.status}`,
          status: "CONFIRMED",
        });
      }
    }
  } else {
    // Client: as suas próprias sessões.
    // DUO: inclui sessões partilhadas em que sou o parceiro — o feed iCal
    // do par tem de mostrar as sessões duo, não só as que ele marcou.
    const { data: bookings } = await admin
      .from("bookings")
      .select("id, starts_at, ends_at, session_type, status")
      .or(`client_id.eq.${profile.id},partner_client_id.eq.${profile.id}`)
      .gte("starts_at", rangeStart.toISOString())
      .lt("starts_at", rangeEnd.toISOString())
      .neq("status", "cancelled");

    for (const b of bookings ?? []) {
      events.push({
        uid: makeUid("booking", b.id),
        start: new Date(b.starts_at),
        end: new Date(b.ends_at ?? new Date(new Date(b.starts_at).getTime() + 60 * 60 * 1000)),
        summary: `LEAP Fitness Studio · Sessão de treino`,
        description: `Sessão ${b.session_type ?? ""} · ${b.status}`,
        status: b.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
      });
    }
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LEAP Fitness Studio//Portal//PT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:LEAP Fitness Studio · ${escapeIcs(profile.full_name ?? "Agenda")}`,
    "X-WR-TIMEZONE:Europe/Lisbon",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...LISBON_VTIMEZONE,
    ...events.map((e) => eventToVevent(e, now)),
    "END:VCALENDAR",
  ];

  const ics = lines.join("\r\n");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Per-user via token → NÃO partilhar em CDN/proxy intermédio.
      // private + no-store força o consumidor (iOS Calendar, Google
      // Calendar) a manter a sua própria cache local com o ritmo
      // sinalizado pelo REFRESH-INTERVAL dentro do ICS.
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
