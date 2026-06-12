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

// Horizonte do feed: passado 7 dias (para histórico recente no
// telemóvel) e futuro 6 meses. Suficiente para um cliente normal.
const PAST_DAYS = 7;
const FUTURE_DAYS = 180;

function toIcsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

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
    `DTSTART:${toIcsDate(e.start)}`,
    `DTEND:${toIcsDate(e.end)}`,
    `SUMMARY:${escapeIcs(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${escapeIcs(e.description)}`] : []),
    `STATUS:${e.status ?? "CONFIRMED"}`,
    "END:VEVENT",
  ].join("\r\n");
}

export async function GET(
  _req: Request,
  { params }: { params: { token: string } },
) {
  // O ficheiro pode chegar como `<uuid>.ics` (apps que requerem
  // extensão na URL) ou só `<uuid>`. Aceitamos ambos.
  const raw = params.token ?? "";
  const token = raw.replace(/\.ics$/i, "");

  // Validação leve para evitar query SQL em lixo. UUID v4: 36 chars.
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return new NextResponse("Invalid token", { status: 404 });
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
  const rangeStart = new Date(now.getTime() - PAST_DAYS * 86_400_000);
  const rangeEnd = new Date(now.getTime() + FUTURE_DAYS * 86_400_000);

  const events: Event[] = [];

  if (profile.role === "trainer" || profile.role === "owner") {
    // Trainer: descobre o(s) trainer_id que o profile representa.
    const { data: trainerRows } = await admin
      .from("trainers")
      .select("id")
      .eq("profile_id", profile.id);
    const trainerIds = (trainerRows ?? []).map((t) => t.id);

    if (trainerIds.length > 0) {
      const [{ data: bookings }, { data: blocks }] = await Promise.all([
        admin
          .from("bookings")
          .select("id, starts_at, ends_at, session_type, status, profiles:client_id(full_name)")
          .in("trainer_id", trainerIds)
          .gte("starts_at", rangeStart.toISOString())
          .lt("starts_at", rangeEnd.toISOString())
          .neq("status", "cancelled"),
        admin
          .from("trainer_blocked_times")
          .select("id, starts_at, ends_at, reason")
          .in("trainer_id", trainerIds)
          .gte("starts_at", rangeStart.toISOString())
          .lt("starts_at", rangeEnd.toISOString()),
      ]);

      for (const b of bookings ?? []) {
        const clientName = (b as any).profiles?.full_name ?? "cliente";
        events.push({
          uid: makeUid("booking", b.id),
          start: new Date(b.starts_at),
          end: new Date(b.ends_at ?? new Date(new Date(b.starts_at).getTime() + 60 * 60 * 1000)),
          summary: `Sessão · ${clientName}`,
          description: `LEAP-FITNESS · ${b.session_type ?? ""} · ${b.status}`,
          status: b.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
        });
      }
      for (const blk of blocks ?? []) {
        events.push({
          uid: makeUid("block", blk.id),
          start: new Date(blk.starts_at),
          end: new Date(blk.ends_at),
          summary: blk.reason ? `Indisponível · ${blk.reason}` : "Indisponível",
          description: "Bloqueio LEAP-FITNESS",
          status: "CONFIRMED",
        });
      }
    }
  } else {
    // Client: as suas próprias sessões.
    const { data: bookings } = await admin
      .from("bookings")
      .select("id, starts_at, ends_at, session_type, status")
      .eq("client_id", profile.id)
      .gte("starts_at", rangeStart.toISOString())
      .lt("starts_at", rangeEnd.toISOString())
      .neq("status", "cancelled");

    for (const b of bookings ?? []) {
      events.push({
        uid: makeUid("booking", b.id),
        start: new Date(b.starts_at),
        end: new Date(b.ends_at ?? new Date(new Date(b.starts_at).getTime() + 60 * 60 * 1000)),
        summary: `LEAP-FITNESS · Sessão de treino`,
        description: `Sessão ${b.session_type ?? ""} · ${b.status}`,
        status: b.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
      });
    }
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LEAP-FITNESS//Portal//PT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:LEAP-FITNESS · ${escapeIcs(profile.full_name ?? "Agenda")}`,
    "X-WR-TIMEZONE:Europe/Lisbon",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events.map((e) => eventToVevent(e, now)),
    "END:VCALENDAR",
  ];

  const ics = lines.join("\r\n");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Não anexar como download — os clients de subscrição precisam
      // de servir como conteúdo direto.
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
