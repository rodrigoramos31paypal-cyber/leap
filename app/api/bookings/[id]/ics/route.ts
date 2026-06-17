import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function toIcsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, starts_at, ends_at, session_type, status, client_id, trainer_id, profiles:client_id(full_name)")
    .eq("id", params.id)
    .single();

  if (!booking) return new NextResponse("Not found", { status: 404 });

  // verifica acesso (cliente próprio ou trainer)
  if (booking.client_id !== user.id) {
    const { data: trainer } = await supabase
      .from("trainers")
      .select("id")
      .eq("profile_id", user.id)
      .eq("id", booking.trainer_id)
      .maybeSingle();
    if (!trainer) return new NextResponse("Forbidden", { status: 403 });
  }

  const start = new Date(booking.starts_at);
  const end = new Date(booking.ends_at);
  const summary = `LEAP-FITNESS · Sessão ${booking.session_type}`;
  const description = `Sessão de treino com ${(booking as any).profiles?.full_name ?? "cliente"} · Status: ${booking.status}`;
  const location = "LEAP-FITNESS STUDIO";
  const uid = `${booking.id}@leap-fitness.pt`;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LEAP-FITNESS//Portal//PT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `LOCATION:${escapeIcs(location)}`,
    `STATUS:${booking.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "TRIGGER:-PT1H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  // PERF (QW-8 audit jun/2026): o .ics duma sessão passada nunca muda
  // → max-age=86400 immutable. Para sessões futuras dá-se margem para
  // reagendamentos com cache curto (5 min). Cache-Control private
  // porque o ICS contém o nome do cliente.
  const isPast = new Date(booking.starts_at).getTime() < Date.now();
  const cacheControl = isPast
    ? "private, max-age=86400, immutable"
    : "private, max-age=300";

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="leap-session-${booking.id.slice(0, 8)}.ics"`,
      "Cache-Control": cacheControl,
    },
  });
}
