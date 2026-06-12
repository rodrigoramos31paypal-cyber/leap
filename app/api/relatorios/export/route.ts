import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "trainer" && profile?.role !== "owner") return new NextResponse("Forbidden", { status: 403 });

  // SEC: limitar exportações ao scope do trainer/owner — antes um trainer
  // podia descarregar dados de TODOS os outros trainers via este endpoint.
  const trainerIds = await getAccessibleTrainerIds();
  const trainerScope = trainerIds.length > 0 ? trainerIds : [""];

  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") ?? "purchases";
  const from = sp.get("from") ?? new Date(0).toISOString();
  const to = sp.get("to") ?? new Date().toISOString();

  let rows: any[] = [];
  let header = "";
  let body = "";

  if (type === "purchases") {
    const { data } = await supabase
      .from("purchases")
      .select("created_at, confirmed_at, status, payment_method, amount_cents, sessions_total, sessions_remaining, pack_snapshot, profiles:client_id(full_name, email)")
      .in("trainer_id", trainerScope)
      .gte("created_at", from)
      .lte("created_at", to);
    rows = data ?? [];
    header = "Data;Confirmada;Cliente;Email;Pack;Sessões;Restantes;Valor€;Método;Status";
    body = rows
      .map((r) =>
        [
          fmtCsv(r.created_at),
          fmtCsv(r.confirmed_at),
          esc((r as any).profiles?.full_name),
          esc((r as any).profiles?.email),
          esc(r.pack_snapshot?.name),
          r.sessions_total,
          r.sessions_remaining,
          (r.amount_cents / 100).toFixed(2),
          esc(r.payment_method),
          esc(r.status),
        ].join(";"),
      )
      .join("\n");
  } else if (type === "bookings") {
    const { data } = await supabase
      .from("bookings")
      .select("starts_at, ends_at, status, session_type, credit_charged, profiles:client_id(full_name, email)")
      .in("trainer_id", trainerScope)
      .gte("starts_at", from)
      .lte("starts_at", to);
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

  const csv = "﻿" + header + "\n" + body;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leap-${type}-${Date.now()}.csv"`,
    },
  });
}

function esc(v: any) {
  if (v == null) return "";
  return String(v).replaceAll(";", ",").replaceAll("\n", " ");
}
function fmtCsv(v: any) {
  if (!v) return "";
  return new Date(v).toLocaleString("pt-PT");
}
