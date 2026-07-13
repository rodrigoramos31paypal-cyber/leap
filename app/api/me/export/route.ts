import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { formatDateTime, eur } from "@/lib/utils";

// RGPD · "Descarregar os meus dados". Exporta os dados pessoais do
// utilizador autenticado num único ficheiro Excel (Perfil, Sessões,
// Compras, Notas). Apenas dados do PRÓPRIO (RLS + filtro por user.id).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  // H2: limita exportações (XLSX é caro em CPU/memória).
  const rl = await rateLimit("export", `export:me:${user.id}`);
  if (!rl.success) {
    return new NextResponse("Demasiados pedidos. Tenta novamente mais tarde.", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSeconds) },
    });
  }

  const [{ data: profile }, { data: bookings }, { data: purchases }, { data: notes }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, email, phone, role, created_at")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("bookings")
        .select("starts_at, ends_at, session_type, status, created_at")
        .eq("client_id", user.id)
        .order("starts_at", { ascending: false }),
      supabase
        .from("purchases")
        .select("pack_snapshot, amount_cents, sessions_total, sessions_remaining, status, created_at")
        .eq("client_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("session_notes")
        .select("body, created_at")
        .eq("author_id", user.id)
        .order("created_at", { ascending: false }),
    ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "LEAP Fitness Studio";
  wb.created = new Date();

  const sP = wb.addWorksheet("Perfil");
  sP.columns = [
    { header: "Campo", key: "k", width: 22 },
    { header: "Valor", key: "v", width: 44 },
  ];
  sP.addRows([
    { k: "Nome", v: profile?.full_name ?? "" },
    { k: "Email", v: profile?.email ?? "" },
    { k: "Telemóvel", v: profile?.phone ?? "" },
    { k: "Tipo de conta", v: profile?.role ?? "" },
    { k: "Registado em", v: profile?.created_at ? formatDateTime(profile.created_at) : "" },
  ]);

  const sB = wb.addWorksheet("Sessões");
  sB.columns = [
    { header: "Início", key: "start", width: 24 },
    { header: "Fim", key: "end", width: 24 },
    { header: "Tipo", key: "type", width: 16 },
    { header: "Estado", key: "status", width: 16 },
  ];
  for (const b of (bookings ?? []) as any[]) {
    sB.addRow({
      start: formatDateTime(b.starts_at),
      end: b.ends_at ? formatDateTime(b.ends_at) : "",
      type: b.session_type,
      status: b.status,
    });
  }

  const sC = wb.addWorksheet("Compras");
  sC.columns = [
    { header: "Pack", key: "pack", width: 30 },
    { header: "Valor", key: "amt", width: 14 },
    { header: "Sessões (rest./total)", key: "sess", width: 20 },
    { header: "Estado", key: "status", width: 20 },
    { header: "Data", key: "date", width: 24 },
  ];
  for (const p of (purchases ?? []) as any[]) {
    sC.addRow({
      pack: (p.pack_snapshot as any)?.name ?? "",
      amt: eur(p.amount_cents),
      sess: `${p.sessions_remaining}/${p.sessions_total}`,
      status: p.status,
      date: formatDateTime(p.created_at),
    });
  }

  const sN = wb.addWorksheet("Notas");
  sN.columns = [
    { header: "Data", key: "date", width: 24 },
    { header: "Nota", key: "body", width: 90 },
  ];
  for (const n of (notes ?? []) as any[]) {
    sN.addRow({ date: formatDateTime(n.created_at), body: n.body });
  }

  // Cabeçalhos a bold em todas as folhas.
  for (const ws of wb.worksheets) ws.getRow(1).font = { bold: true };

  // S-11 (audit jun/2026): paridade RGPD com /api/relatorios/export —
  // qualquer export de PII tem de deixar rasto auditável. Aqui o user
  // exporta os SEUS próprios dados, mas continua a ser PII e a regra
  // RGPD de "registo de tratamentos" aplica-se. Best-effort: se o log
  // falhar não bloqueamos o download do utilizador (consentimento já
  // implícito pela acção), só logamos o erro.
  await supabase.rpc("log_audit_event", {
    p_action: "export_pii_self",
    p_target_table: "profiles",
    p_payload: {
      rows: {
        bookings: bookings?.length ?? 0,
        purchases: purchases?.length ?? 0,
        notes: notes?.length ?? 0,
      },
      format: "xlsx",
    },
  }).then(({ error }) => {
    if (error) console.error("[me/export:audit]", error.message);
  });

  const buf = await wb.xlsx.writeBuffer();
  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf as any, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="leap-os-meus-dados-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
