import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { mondayOf, streakFromWeekKeys, streakCongratsBody } from "@/lib/streak";

// ════════════════════════════════════════════════════════════════
// Cron · parabéns semanal por streak.
//
// Cadência: SEGUNDA-FEIRA cedo (sugestão: 09:00 UTC = 09–10h Lisboa).
// Header: `Authorization: Bearer ${CRON_SECRET}`.
//
// Lógica:
//   • Para cada cliente com sessões CONFIRMED nas últimas ~16 semanas,
//     contamos o streak (mesma fórmula do dashboard) em relação à
//     SEMANA QUE ACABOU no domingo passado. Isto = referenceDate
//     ajustado para sexta-feira anterior, garantindo que `streakFromWeekKeys`
//     usa lastWeek como ponto de partida.
//   • Se streak ≥ 2 e ainda não enviámos parabéns para esta semana,
//     inserimos notification (push automático via webhook).
//
// Threshold ≥ 2: semana 1 ainda é cedo para parabéns por push.
// IDEMPOTENTE: PK (user_id, week_start) em weekly_streak_alerts.
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_STREAK_TO_NOTIFY = 2;
const HORIZON_DAYS = 16 * 7;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();

  // A "week_start" no nosso registo é a SEGUNDA da semana que acabou
  // (i.e. a segunda passada se hoje for segunda; ou a segunda anterior
  // ao domingo mais recente). Usamos `now - 1 dia` como referenceDate
  // para que o streakFromWeekKeys arranque na semana FECHADA.
  const yesterday = new Date(now.getTime() - 86_400_000);
  const referenceForStreak = mondayOf(yesterday); // = segunda da semana fechada
  const weekStartIso = referenceForStreak.toISOString().slice(0, 10);

  const horizon = new Date(now.getTime() - HORIZON_DAYS * 86_400_000);
  const { data: rows, error } = await supabase
    .from("bookings")
    .select("client_id, ends_at")
    .eq("status", "confirmed")
    .gte("ends_at", horizon.toISOString())
    .lte("ends_at", now.toISOString());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, weekStart: weekStartIso });
  }

  // Agrega: por cliente → set de mondays.
  const perClient = new Map<string, Set<string>>();
  for (const r of rows as any[]) {
    const k = mondayOf(new Date(r.ends_at)).toISOString().slice(0, 10);
    const s = perClient.get(r.client_id) ?? new Set<string>();
    s.add(k);
    perClient.set(r.client_id, s);
  }

  const clientIds = Array.from(perClient.keys());
  const { data: prefs } = await (supabase as any)
    .from("notification_preferences")
    .select("user_id, enabled")
    .eq("kind", "streak_congrats")
    .in("user_id", clientIds);
  const disabled = new Set(
    ((prefs ?? []) as any[]).filter((p) => p.enabled === false).map((p) => p.user_id),
  );

  let sent = 0;
  for (const [clientId, weeks] of perClient) {
    if (disabled.has(clientId)) continue;

    // Usa referência = ontem para que a "semana actual" do helper seja
    // a semana que acabou de fechar, não a que mal começou.
    const { weeks: streak } = streakFromWeekKeys(weeks, referenceForStreak);
    if (streak < MIN_STREAK_TO_NOTIFY) continue;

    const { data: claimed, error: claimErr } = await (supabase as any)
      .from("weekly_streak_alerts")
      .insert({ user_id: clientId, week_start: weekStartIso, streak_weeks: streak })
      .select("user_id")
      .maybeSingle();
    if (claimErr || !claimed) continue;

    await (supabase as any).from("notifications").insert({
      user_id: clientId,
      type: "streak_congrats",
      title: `${streak} semanas seguidas`,
      body: streakCongratsBody(streak),
      link: "/app/dashboard",
    });

    sent++;
  }

  return NextResponse.json({
    ok: true,
    processed: clientIds.length,
    sent,
    weekStart: weekStartIso,
  });
}
