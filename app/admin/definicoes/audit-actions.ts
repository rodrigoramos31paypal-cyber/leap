"use server";

// ════════════════════════════════════════════════════════════════
// Detalhe de uma marcação para o modal do Registo de atividade.
//
// Chamada quando o admin toca numa linha de sessão (criada/movida/
// cancelada). Devolve os dados da sessão atual e — para reagendamentos —
// os horários da sessão ANTERIOR (para mostrar "de → para").
//
// SEC: requireStaff() no boundary; as queries usam o cliente com sessão
// (RLS de admin). Um trainer fora do scope da sessão recebe "não
// encontrada" em vez de dados — degradação graciosa, não fuga.
// ════════════════════════════════════════════════════════════════

import { requireStaff } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

export type BookingSlot = { startsAt: string; endsAt: string };

export type BookingAuditDetail = {
  ok: boolean;
  error?: string;
  clientName?: string | null;
  trainerName?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  sessionType?: string | null;
  status?: string | null;
  /** Só preenchido em reagendamentos: horário da sessão anterior. */
  previous?: BookingSlot | null;
};

async function fetchBooking(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
) {
  const { data } = await supabase
    .from("bookings")
    .select("id, starts_at, ends_at, session_type, status, client_id, trainer_id")
    .eq("id", id)
    .maybeSingle();
  return data as any;
}

async function fetchProfileName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string | null | undefined,
): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", id)
    .maybeSingle();
  return ((data as any)?.full_name as string | undefined) ?? null;
}

async function fetchTrainerName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  trainerId: string | null | undefined,
): Promise<string | null> {
  if (!trainerId) return null;
  const { data: tr } = await supabase
    .from("trainers")
    .select("profile_id")
    .eq("id", trainerId)
    .maybeSingle();
  return fetchProfileName(supabase, (tr as any)?.profile_id);
}

export async function getBookingAuditDetail(
  bookingId: string,
  fromBookingId?: string,
): Promise<BookingAuditDetail> {
  try {
    await requireStaff();
    if (!bookingId) return { ok: false, error: "Sessão não identificada." };

    const supabase = await createClient();
    const b = await fetchBooking(supabase, bookingId);
    if (!b) return { ok: false, error: "Sessão não encontrada." };

    const [clientName, trainerName] = await Promise.all([
      fetchProfileName(supabase, b.client_id),
      fetchTrainerName(supabase, b.trainer_id),
    ]);

    let previous: BookingSlot | null = null;
    if (fromBookingId && fromBookingId !== bookingId) {
      const prev = await fetchBooking(supabase, fromBookingId);
      if (prev) previous = { startsAt: prev.starts_at, endsAt: prev.ends_at };
    }

    return {
      ok: true,
      clientName,
      trainerName,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      sessionType: b.session_type,
      status: b.status,
      previous,
    };
  } catch (e) {
    logError("getBookingAuditDetail", e);
    return { ok: false, error: "Sem permissão ou erro ao carregar os detalhes." };
  }
}
