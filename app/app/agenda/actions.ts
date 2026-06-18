"use server";

import { createBooking, createRecurringBooking, type RecurringBookingResult } from "@/lib/credits";
import { dispatchBookingCreated } from "@/lib/email-dispatch";
import { pushBookingToCalendars, removeBookingFromCalendars } from "@/lib/calendar-sync";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError, userFacingRpcError } from "@/lib/errors";
import { revalidateBookingViews } from "@/lib/revalidate";
import type { SessionType } from "@/types/database";

const NOTE_MAX_LEN = 5000;

/**
 * Guarda a nota opcional escrita pelo cliente no momento da marcação
 * (ligada à `booking_id`, autor = cliente) e dispara uma notificação
 * in-app para o trainer, separada da notificação da marcação em si.
 *
 * Falhas aqui NÃO devem fazer rollback à marcação — daí o try/catch
 * generoso e o `logError` em vez de `throw`. A marcação fica criada;
 * a nota é "best effort".
 */
async function persistClientBookingNote(
  bookingId: string,
  rawNote: string,
): Promise<void> {
  const body = rawNote.trim().slice(0, NOTE_MAX_LEN);
  if (!body) return;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Substitui qualquer nota anterior do mesmo autor para esta sessão
    // (delete-then-insert; o partial unique index não suporta upsert).
    await supabase
      .from("session_notes")
      .delete()
      .eq("booking_id", bookingId)
      .eq("author_id", user.id);
    const { error: insertErr } = await supabase
      .from("session_notes")
      .insert({ booking_id: bookingId, author_id: user.id, body });
    if (insertErr) {
      logError("persistClientBookingNote:insert", insertErr);
      return;
    }

    // Notifica o trainer (em separado da notificação da própria
    // marcação) que o cliente deixou uma nota.
    try {
      const { data: bk } = await supabase
        .from("bookings")
        .select("trainer_id")
        .eq("id", bookingId)
        .maybeSingle();
      if (!bk) return;
      const admin = createAdminClient();
      const [{ data: tr }, { data: prof }] = await Promise.all([
        admin
          .from("trainers")
          .select("profile_id")
          .eq("id", (bk as any).trainer_id)
          .maybeSingle(),
        admin
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .maybeSingle(),
      ]);
      const trainerProfileId = (tr as any)?.profile_id as string | undefined;
      if (!trainerProfileId) return;
      const name = ((prof as any)?.full_name ?? "").split(" ")[0] || "Um cliente";
      await (admin as any).from("notifications").insert({
        user_id: trainerProfileId,
        type: "client_note",
        title: "Nova nota de cliente",
        body: `${name} deixou uma nota na sessão marcada.`,
        link: "/admin/agenda",
      });
    } catch (e) {
      logError("persistClientBookingNote:notify", e);
    }
  } catch (e) {
    logError("persistClientBookingNote", e);
  }
}

// NOTA (C3): a leitura de slots passou a Route Handler GET /api/slots
// (cacheável + paralelizável). A antiga `getSlotsAction` foi removida.

export async function bookAction({
  trainerId,
  startsAtIso,
  durationMin,
  sessionType,
  note,
}: {
  trainerId: string;
  startsAtIso: string;
  durationMin: number;
  sessionType: SessionType;
  /** Nota opcional do cliente para o trainer (≤5000 chars). */
  note?: string;
}): Promise<{ ok?: true; error?: string; pending?: boolean }> {
  try {
    const bookingId = await createBooking({
      trainerId,
      startsAt: new Date(startsAtIso),
      durationMin,
      sessionType,
    });
    // SEC: createBooking (RPC) já validou ownership/regras acima. As
    // chamadas abaixo usam service role mas só sobre um bookingId
    // server-generated — não devolvem dados ao caller.
    //
    // PERF (C2): email + calendário são best-effort e NÃO afectam o registo
    // da marcação (a RPC já fez commit). Disparamo-los em PARALELO — e em
    // paralelo com a leitura do status — em vez de sequencialmente, por isso
    // o utilizador espera max(email, calendário, status) em vez da soma.
    // (Em serverless não podemos "fire-and-forget" de forma fiável sem os
    // perder, por isso aguardamos o batch antes de devolver.)
    const sideEffects = Promise.allSettled([
      dispatchBookingCreated(bookingId),
      pushBookingToCalendars(bookingId),
      // Nota opcional do cliente + notificação para o trainer.
      // Best effort: se falhar, a marcação fica na mesma (a função
      // já trata os próprios erros internamente).
      note ? persistClientBookingNote(bookingId, note) : Promise.resolve(),
    ]);

    // Verifica o status final para a UI mostrar mensagem correcta
    const supabase = await createClient();
    const { data: b } = await supabase
      .from("bookings")
      .select("status")
      .eq("id", bookingId)
      .single();

    await sideEffects;

    const pending = (b as any)?.status === "booked";
    await setFlash(pending ? "Marcação criada — a aguardar aprovação" : "Marcação confirmada");
    revalidateBookingViews();
    return { ok: true, pending };
  } catch (err) {
    logError("bookAction", err);
    const friendly = userFacingRpcError(err);
    await setFlash(friendly ?? "Não foi possível marcar", "error");
    return { error: friendly ?? "Não foi possível marcar. Tenta novamente." };
  }
}

export async function rescheduleAction({
  oldBookingId,
  startsAtIso,
  durationMin,
  note,
}: {
  oldBookingId: string;
  startsAtIso: string;
  durationMin: number;
  /** Nota opcional do cliente para o trainer (ligada à NOVA marcação). */
  note?: string;
}): Promise<{ ok?: true; error?: string; pending?: boolean }> {
  const supabase = await createClient();
  // RPC atómica: devolve crédito da antiga, cancela-a e cria a nova.
  const { data: newId, error } = await (supabase as any).rpc("reschedule_booking", {
    p_old_booking_id: oldBookingId,
    p_starts_at: new Date(startsAtIso).toISOString(),
    p_duration_min: durationMin,
  });
  if (error) {
    logError("rescheduleAction", error);
    const friendly = userFacingRpcError(error);
    return {
      error: friendly ?? "Não foi possível reagendar. O horário pode já estar ocupado.",
    };
  }

  // Best effort: emails + calendários (a antiga sai, a nova entra).
  // PERF (C2): em PARALELO — antes eram 3 awaits sequenciais.
  const sideEffects = Promise.allSettled([
    dispatchBookingCreated(newId as string),
    pushBookingToCalendars(newId as string),
    removeBookingFromCalendars(oldBookingId),
    // Nota opcional do cliente — ligada à NOVA marcação.
    note ? persistClientBookingNote(newId as string, note) : Promise.resolve(),
  ]);

  const { data: b } = await supabase
    .from("bookings")
    .select("status")
    .eq("id", newId as string)
    .single();

  await sideEffects;

  revalidateBookingViews();
  return { ok: true, pending: (b as any)?.status === "booked" };
}

export async function bookRecurringAction({
  trainerId,
  startsAtIso,
  durationMin,
  sessionType,
  sessionsCount,
}: {
  trainerId: string;
  startsAtIso: string;
  durationMin: number;
  sessionType: SessionType;
  sessionsCount: number;
}): Promise<{ ok?: true; error?: string; result?: RecurringBookingResult }> {
  try {
    const result = await createRecurringBooking({
      trainerId,
      startsAt: new Date(startsAtIso),
      durationMin,
      sessionsCount,
      sessionType,
    });

    // PARCIAL: a RPC marca as semanas livres e devolve as restantes em
    // `conflicts`. Disparamos side-effects (email/calendário) só para as
    // marcações criadas — em PARALELO (um único batch).
    if (result.booking_ids.length > 0) {
      await Promise.allSettled(
        result.booking_ids.flatMap((id) => [
          dispatchBookingCreated(id),
          pushBookingToCalendars(id),
        ]),
      );
      revalidateBookingViews();
    }

    // Nenhuma semana disponível → nada marcado (devolvemos os conflitos
    // na mesma para a UI poder sugerir alternativas).
    if (result.booked_count === 0) {
      await setFlash("Nenhuma semana disponível para a série", "error");
      return { error: "Nenhuma semana disponível.", result };
    }

    await setFlash(
      result.conflicts.length > 0
        ? `Marcadas ${result.booked_count} de ${result.requested_count} sessões`
        : `Criadas ${result.booked_count} marcações`,
    );
    return { ok: true, result };
  } catch (err) {
    logError("bookRecurringAction", err);
    const friendly = userFacingRpcError(err);
    await setFlash(friendly ?? "Não foi possível marcar a série", "error");
    return { error: friendly ?? "Não foi possível marcar a série. Tenta novamente." };
  }
}
