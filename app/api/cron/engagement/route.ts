import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendEmail, emailTemplates } from "@/lib/email";
import { formatDateTime } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Cron · re-engagement (saldo baixo / sem sessões / pack a expirar).
//
// Cadência recomendada: DIÁRIA (ou de hora a hora — é idempotente).
// Header obrigatório: `Authorization: Bearer ${CRON_SECRET}`.
//
// Canais: in-app (sempre) + email (se Resend configurado) + push web
// (automático via Supabase webhook em notifications INSERT, ver
// /api/push/dispatch). NÃO sai cedo quando o email está desactivado.
//
// Regra do aviso de saldo (credit_low):
//   • Threshold-aware: dispara "2" quando saldo == 2 e "0" quando == 0.
//   • Delay de 24h: só dispara 24h depois da última sessão "usada"
//     (booking criado com credit_charged=true). Cliente que apenas
//     tem 2 mas nunca marca não recebe push — só recebe depois de
//     usar uma sessão e ficar perto do fim.
//   • Saltar "2" para "0": se entretanto o saldo bateu 0, fica
//     directamente o aviso "0" (verificamos o threshold actual ao
//     correr o cron, não no momento em que o saldo desceu).
//   • Cooldown por threshold (14d): "2" e "0" têm cooldowns
//     independentes via engagement_alerts.ref_id.
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const LOW_CREDIT_THRESHOLD = 2;
const EXPIRY_WINDOW_DAYS = 7;
const LOW_CREDIT_COOLDOWN_DAYS = 14;
const LOW_CREDIT_DELAY_HOURS = 24;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const SENTINEL = "00000000-0000-0000-0000-000000000000";

  const expiryHorizon = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 86400000);

  const [{ data: expiring }, { data: confirmed }] = await Promise.all([
    supabase
      .from("purchases")
      .select("id, client_id, sessions_remaining, expires_at, pack_snapshot")
      .eq("status", "confirmed")
      .gt("sessions_remaining", 0)
      .not("expires_at", "is", null)
      .gt("expires_at", now.toISOString())
      .lte("expires_at", expiryHorizon.toISOString()),
    supabase
      .from("purchases")
      .select("client_id, sessions_remaining, expires_at")
      .eq("status", "confirmed"),
  ]);

  const everPurchased = new Set<string>();
  const activeTotals = new Map<string, number>();
  for (const p of (confirmed ?? []) as any[]) {
    everPurchased.add(p.client_id);
    if (p.expires_at && new Date(p.expires_at) < now) continue;
    activeTotals.set(p.client_id, (activeTotals.get(p.client_id) ?? 0) + (p.sessions_remaining ?? 0));
  }
  const lowClients = Array.from(everPurchased)
    .map((id) => ({ id, total: activeTotals.get(id) ?? 0 }))
    .filter((c) => c.total <= LOW_CREDIT_THRESHOLD);

  const recipientIds = Array.from(
    new Set<string>([...lowClients.map((c) => c.id), ...((expiring ?? []) as any[]).map((p) => p.client_id)]),
  );
  if (recipientIds.length === 0) {
    return NextResponse.json({ ok: true, lowSent: 0, expirySent: 0 });
  }

  const [{ data: profiles }, { data: prefs }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("id", recipientIds),
    (supabase as any)
      .from("notification_preferences")
      .select("user_id, enabled")
      .eq("kind", "credit_alert")
      .in("user_id", recipientIds),
  ]);
  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  const disabled = new Set(
    ((prefs ?? []) as any[]).filter((p) => p.enabled === false).map((p) => p.user_id),
  );

  let lowSent = 0;
  let expirySent = 0;

  // ── 1) Saldo baixo / sem sessões (delay 24h + threshold-aware) ──
  const cooldownSince = new Date(now.getTime() - LOW_CREDIT_COOLDOWN_DAYS * 86400000).toISOString();
  const delayBoundary = new Date(now.getTime() - LOW_CREDIT_DELAY_HOURS * 3600000);
  for (const c of lowClients) {
    if (disabled.has(c.id)) continue;
    const prof = profileMap.get(c.id);
    if (!prof) continue;

    // Último consumo (booking criado, credit_charged=true).
    const { data: lastBooking } = await (supabase as any)
      .from("bookings")
      .select("created_at")
      .eq("client_id", c.id)
      .eq("credit_charged", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lastBooking) continue;
    if (new Date(lastBooking.created_at) > delayBoundary) continue;

    // Threshold actual — salta "2" automaticamente se o saldo já bateu "0".
    const targetThreshold: "0" | "2" = c.total <= 0 ? "0" : "2";

    // Cooldown por threshold.
    const { data: recent } = await (supabase as any)
      .from("engagement_alerts")
      .select("id")
      .eq("user_id", c.id)
      .eq("kind", "credit_low")
      .eq("ref_id", targetThreshold)
      .gte("sent_at", cooldownSince)
      .limit(1)
      .maybeSingle();
    if (recent) continue;

    await (supabase as any)
      .from("engagement_alerts")
      .insert({ user_id: c.id, kind: "credit_low", ref_id: targetThreshold });

    // Notification INSERT → webhook dispara push automaticamente.
    await (supabase as any).from("notifications").insert({
      user_id: c.id,
      type: "credit_alert",
      title: targetThreshold === "0" ? "Ficaste sem sessões" : "Sessões a acabar",
      body:
        targetThreshold === "0"
          ? "Já não tens sessões disponíveis. Compra um pack para voltares a marcar."
          : `Restam-te ${c.total} ${c.total === 1 ? "sessão" : "sessões"}. Renova o teu pack.`,
      link: "/app/comprar",
    });

    const tpl = emailTemplates.creditLow({ clientName: prof.full_name ?? "atleta", total: c.total });
    const res = await sendEmail({ to: prof.email, ...tpl });
    if (res.ok) lowSent++;
  }

  // ── 2) Packs a expirar (uma vez por compra) ─────────────────────
  for (const p of (expiring ?? []) as any[]) {
    if (disabled.has(p.client_id)) continue;
    const prof = profileMap.get(p.client_id);
    if (!prof) continue;

    const { data: claimed, error: claimErr } = await (supabase as any)
      .from("engagement_alerts")
      .insert({ user_id: p.client_id, kind: "pack_expiring", ref_id: p.id })
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) continue;

    const when = formatDateTime(p.expires_at);
    const packName = (p.pack_snapshot as any)?.name ?? "pack";

    await (supabase as any).from("notifications").insert({
      user_id: p.client_id,
      type: "credit_alert",
      title: "Pack a expirar",
      body: `O teu pack expira a ${when} e ainda tens ${p.sessions_remaining} ${
        p.sessions_remaining === 1 ? "sessão" : "sessões"
      } por usar.`,
      link: "/app/comprar",
    });

    const tpl = emailTemplates.packExpiring({
      clientName: prof.full_name ?? "atleta",
      remaining: p.sessions_remaining,
      when,
      packName,
    });
    const res = await sendEmail({ to: prof.email, ...tpl });
    if (res.ok) expirySent++;
  }

  return NextResponse.json({
    ok: true,
    lowCandidates: lowClients.length,
    expiringCandidates: (expiring ?? []).length,
    lowSent,
    expirySent,
  });
}
