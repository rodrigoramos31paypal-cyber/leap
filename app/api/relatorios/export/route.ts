import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { rateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/errors";

// H7: a exportação devolve PII (nome + email + histórico). Limitamos a
// janela temporal por exportação para minimização de dados (RGPD).
const MAX_WINDOW_DAYS = 366;
const MAX_WINDOW_MS = MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  // H2: limita exportações de PII (CSV caro + PII sensível).
  const rl = await rateLimit("export", `export:rel:${user.id}`);
  if (!rl.success) {
    return new NextResponse("Demasiados pedidos. Tenta novamente mais tarde.", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSeconds) },
    });
  }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "trainer" && profile?.role !== "owner") return new NextResponse("Forbidden", { status: 403 });

  // SEC: limitar exportações ao scope do trainer/owner — antes um trainer
  // podia descarregar dados de TODOS os outros trainers via este endpoint.
  const trainerIds = await getAccessibleTrainerIds();
  const trainerScope = trainerIds.length > 0 ? trainerIds : [""];

  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") ?? "purchases";
  if (type !== "purchases" && type !== "bookings") {
    return new NextResponse("Tipo de exportação inválido.", { status: 400 });
  }

  // H7: validação da janela temporal. Antes `from` defaultava a 1970 e
  // não havia limite — uma exportação devolvia TODO o histórico de PII.
  const now = Date.now();
  const toParam = sp.get("to");
  const fromParam = sp.get("from");
  const to = toParam ? new Date(toParam) : new Date(now);
  const from = fromParam ? new Date(fromParam) : new Date(now - MAX_WINDOW_MS);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return new NextResponse("Datas inválidas.", { status: 400 });
  }
  if (from.getTime() > to.getTime()) {
    return new NextResponse("Intervalo inválido: 'from' é posterior a 'to'.", { status: 400 });
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_MS) {
    return new NextResponse(
      `Intervalo demasiado grande. Máximo ${MAX_WINDOW_DAYS} dias por exportação.`,
      { status: 400 },
    );
  }
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  let rows: any[] = [];
  let header = "";
  let body = "";

  if (type === "purchases") {
    // Só pagamentos CONFIRMADOS (é o que interessa para contabilidade).
    // Excluímos também os de preço 0 (tipicamente cortesias): não têm
    // valor contabilístico e só poluíam o relatório. `gt amount_cents 0`
    // remove-os do CSV — não apaga nada na base de dados.
    const { data } = await supabase
      .from("purchases")
      .select("created_at, payment_method, amount_cents, pack_snapshot, profiles:client_id(full_name, email)")
      .in("trainer_id", trainerScope)
      .eq("status", "confirmed")
      .gt("amount_cents", 0)
      .gte("created_at", fromIso)
      .lte("created_at", toIso);
    rows = data ?? [];
    header = "Data da compra;Cliente;Email;Pack;Preço€;Método de pagamento";
    body = rows
      .map((r) =>
        [
          fmtCsv(r.created_at),
          esc((r as any).profiles?.full_name),
          esc((r as any).profiles?.email),
          esc(r.pack_snapshot?.name),
          (r.amount_cents / 100).toFixed(2),
          esc(paymentMethodLabel(r.payment_method)),
        ].join(";"),
      )
      .join("\n");
  } else if (type === "bookings") {
    const { data } = await supabase
      .from("bookings")
      .select("starts_at, ends_at, status, session_type, credit_charged, profiles:client_id(full_name, email)")
      .in("trainer_id", trainerScope)
      .gte("starts_at", fromIso)
      .lte("starts_at", toIso);
    rows = data ?? [];
    header = "Início;Fim;Cliente;Email;Tipo;Status;SessãoDescontada";
    body = rows
      .map((r) =>
        [
          fmtCsv(r.starts_at),
          fmtCsv(r.ends_at),
          esc((r as any).profiles?.full_name),
          esc((r as any).profiles?.email),
          esc(r.session_type),
          esc(r.status),
          r.credit_charged ? "Sim" : "Não",
        ].join(";"),
      )
      .join("\n");
  }

  // H7: rasto RGPD — regista QUEM exportou, QUANDO e QUANTO, com a janela
  // pedida. Fail-closed: se não conseguirmos auditar, NÃO devolvemos PII.
  const { error: auditErr } = await supabase.rpc("log_audit_event", {
    p_action: "export_pii",
    p_target_table: type,
    p_payload: { type, from: fromIso, to: toIso, rows_exported: rows.length, format: "csv" },
  });
  if (auditErr) {
    logError("relatoriosExport:audit", auditErr);
    return new NextResponse(
      "Não foi possível registar a exportação. Tenta novamente.",
      { status: 500 },
    );
  }

  const fileLabel = type === "purchases" ? "compras" : "marcacoes";
  const csv = "﻿" + header + "\n" + body;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leap-${fileLabel}-${Date.now()}.csv"`,
    },
  });
}

// SEC (H1): defesa contra CSV / formula injection.
//  • Substitui o delimitador `;` e quebras de linha (não partir colunas).
//  • Neutraliza fórmulas: Excel/Sheets EXECUTAM o conteúdo de qualquer
//    célula que comece por `=`, `+`, `-`, `@`, TAB ou CR. Campos como
//    full_name/email são controlados pelo cliente e o ficheiro é aberto
//    pelo owner — um nome `=HYPERLINK(...)`/`=cmd|...` corria na máquina
//    do owner. Prefixamos com aspa simples para forçar texto.
function esc(v: any) {
  if (v == null) return "";
  let s = String(v).replaceAll(";", ",").replaceAll("\n", " ").replaceAll("\r", " ");
  if (/^[=+\-@\t]/.test(s)) s = "'" + s;
  return s;
}
function fmtCsv(v: any) {
  if (!v) return "";
  return new Date(v).toLocaleString("pt-PT");
}

// Rótulos legíveis para o método de pagamento (coerente com a página de
// Pagamentos). Códigos desconhecidos passam tal e qual.
function paymentMethodLabel(m: any) {
  return (
    {
      manual_mbway: "MB Way",
      manual_cash: "Dinheiro",
      manual_transfer: "Transferência",
      manual_revolut: "Revolut",
      complimentary: "Cortesia",
      mbway: "MB Way",
      multibanco: "Multibanco",
      card: "Cartão",
    } as Record<string, string>
  )[String(m)] ?? String(m ?? "");
}
