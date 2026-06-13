import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendEmail, emailTemplates } from "@/lib/email";
import { formatDateTime } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Cron · re-engagement (saldo baixo / sem sessões / pack a expirar).
//
// Cadência recomendada: DIÁRIA. Disparado com header
// `Authorization: Bearer ${CRON_SECRET}` (mesmo segredo do /reminders).
//
// Canais: in-app (sempre) + email (se Resend configurado). NÃO sai
// cedo quando o email está desativado — a notificação in-app continua
// a ser criada. Respeita o opt-out (notification_preferences kind
// 'credit_alert') e faz dedup via engagement_alerts.
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Mesmos defaults que a UI: saldo baixo <= 2; pack a expirar em 7 dias;
// cooldown de 14 dias no aviso de saldo para não repetir todos os dias.
const LOW_CREDIT_THRESHOLD = 2;
const EXPIRY_WINDOW_DAYS = 7;
const LOW_CREDIT_COOLDOWN_DAYS = 14;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const SENTINEL = "00000000-0000-0000-0000-000000000000";

  // ── Recolha de dados ────────────────────────────────────────────
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

  // Saldo activo por cliente (exclui compras expiradas). everPurchased
  // garante que só falamos com quem já comprou (não spammar registos novos).
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

  // ── Perfis + opt-outs ───────────────────────────────────────────
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

  // ── 1) Saldo baixo / sem sessões (com cooldown) ─────────────────
  const cooldownSince = new Date(now.getTime() - LOW_CREDIT_COOLDOWN_DAYS * 86400000).toISOString();
  for (const c of lowClients) {
    if (disabled.has(c.id)) continue;
    const prof = profileMap.get(c.id);
    if (!prof) continue;

    // Cooldown: já avisámos nos últimos N dias?
    const { data: recent } = await (supabase as any)
      .from("engagement_alerts")
      .select("id")
      .eq("user_id", c.id)
      .eq("kind", "credit_low")
      .gte("sent_at", cooldownSince)
      .limit(1)
      .maybeSingle();
    if (recent) continue;

    await (supabase as any)
      .from("engagement_alerts")
      .insert({ user_id: c.id, kind: "credit_low" });

    await supabase.from("notifications").insert({
      user_id: c.id,
      type: "credit_alert",
      title: c.total <= 0 ? "Ficaste sem sessões" : "Sessões a acabar",
      body:
        c.total <= 0
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

    // Claim dedup por compra; se a inserção der conflito, já foi avisado.
    const { data: claimed, error: claimErr } = await (supabase as any)
      .from("engagement_alerts")
      .insert({ user_id: p.client_id, kind: "pack_expiring", ref_id: p.id })
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) continue;

    const when = formatDateTime(p.expires_at);
    const packName = (p.pack_snapshot as any)?.name ?? "pack";

    await supabase.from("notifications").insert({
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
