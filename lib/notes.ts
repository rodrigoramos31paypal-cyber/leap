// ════════════════════════════════════════════════════════════════
// Notas por sessão · cada autor vê só as próprias.
// ════════════════════════════════════════════════════════════════
import { createClient } from "@/lib/supabase/server";

export type SessionNote = {
  id: string;
  booking_id: string | null;
  subject_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string;
};

/** Obtém a nota do autor para um booking (ou null). */
export async function getMyNoteForBooking(bookingId: string): Promise<SessionNote | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("session_notes")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();
  return ((data as unknown) as SessionNote) ?? null;
}

/**
 * Lista todas as minhas notas + metadados do booking + subject (para /notas).
 *
 * PERF: o `body` pode ter até 5000 chars; com 500 notas isto eram ~2.5 MB
 * de payload só para mostrar bolhas. Agora o caller pede explicitamente
 * o que precisa via `include`:
 *   - "meta" → sem body (lista de bolhas)
 *   - "full" → com body (editor por cliente)
 */
export async function listMyNotes(opts?: {
  clientId?: string;
  limit?: number;
  include?: "meta" | "full";
}) {
  const include = opts?.include ?? "full";
  const supabase = await createClient();
  const cols =
    include === "meta"
      ? "id, booking_id, subject_id, created_at, updated_at, bookings:booking_id(id, starts_at, client_id, profiles:client_id(full_name, email, phone)), subject:subject_id(id, full_name, email, phone)"
      : "*, bookings:booking_id(id, starts_at, ends_at, session_type, status, client_id, trainer_id, profiles:client_id(full_name, email, phone)), subject:subject_id(id, full_name, email, phone, role)";

  // PERF: quando temos clientId, fazemos duas queries focadas em paralelo
  // (general notes via subject_id, e booking notes via lista de bookings
  // desse cliente). Antes trazíamos 500 notas e filtrávamos em memória.
  if (opts?.clientId) {
    const cid = opts.clientId;
    const lim = opts?.limit ?? 100;
    const [{ data: byBookingIds }] = await Promise.all([
      supabase.from("bookings").select("id").eq("client_id", cid),
    ]);
    const bookingIds = (byBookingIds ?? []).map((b: any) => b.id);

    const [{ data: general }, { data: byBooking }] = await Promise.all([
      supabase
        .from("session_notes")
        .select(cols)
        .eq("subject_id", cid)
        .is("booking_id", null)
        .order("created_at", { ascending: false })
        .limit(lim),
      bookingIds.length > 0
        ? supabase
            .from("session_notes")
            .select(cols)
            .in("booking_id", bookingIds)
            .order("created_at", { ascending: false })
            .limit(lim)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const merged = ([...(general ?? []), ...(byBooking ?? [])] as any[]).sort(
      (a, b) => (a.created_at < b.created_at ? 1 : -1),
    );
    return merged;
  }

  // Vista geral (índice por bolhas).
  const { data } = await supabase
    .from("session_notes")
    .select(cols)
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  return (data ?? []) as any[];
}

/** Últimas N sessões entre um cliente e um trainer (qualquer status). */
export async function getRecentSessionsBetween(
  clientId: string,
  trainerId: string,
  limit = 3,
) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("id, starts_at, session_type, status")
    .eq("client_id", clientId)
    .eq("trainer_id", trainerId)
    .order("starts_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** Últimas N sessões de um cliente (qualquer trainer no scope). */
export async function getRecentSessionsForClient(
  clientId: string,
  trainerIds: string[],
  limit = 3,
) {
  if (trainerIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("id, starts_at, session_type, status, trainer_id")
    .eq("client_id", clientId)
    .in("trainer_id", trainerIds)
    .order("starts_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** Mapa booking_id → minha nota, para listas como histórico/agenda.
 *  PERF: a agenda só consome `note.body` (prefill do editor + indicador "✓").
 *  Pedimos apenas `booking_id, body` em vez de `*` — deixamos de transferir
 *  id/subject_id/author_id/created_at/updated_at para cada nota da range
 *  visível. Comportamento idêntico: o editor continua a receber o body. */
/** Mapa booking_id → nota do CLIENTE (apenas leitura para o trainer).
 *  Usa a policy 0078 que deixa o trainer ler as notas que o cliente
 *  escreveu nas sessões dele. */
export async function getClientNotesMapForBookings(
  bookingIds: string[],
  clientId: string,
): Promise<Map<string, SessionNote>> {
  const map = new Map<string, SessionNote>();
  if (bookingIds.length === 0) return map;
  const supabase = await createClient();
  const { data } = await supabase
    .from("session_notes")
    .select("booking_id, body")
    .in("booking_id", bookingIds)
    .eq("author_id", clientId);
  for (const row of (data ?? []) as unknown as SessionNote[]) {
    if (row.booking_id) map.set(row.booking_id, row);
  }
  return map;
}

/**
 * Notas do CLIENTE para um conjunto de marcações de vários clientes.
 *
 * Usada pela agenda admin: o trainer vê dezenas de bookings com clientes
 * diferentes e queremos saber, por booking, se o cliente desse booking
 * deixou nota e qual o body. A RLS 0078 já restringe o trainer a ler
 * apenas notas em que `author_id = bookings.client_id` na sessão dele,
 * portanto basta filtrar pelo conjunto de booking_ids — o filtro de
 * autoria é implícito via policy.
 *
 * Uma única query para todos os bookings (em vez de N por cliente).
 */
export async function getClientNotesByBookings(
  bookings: { id: string; clientId: string }[],
): Promise<Map<string, SessionNote>> {
  const map = new Map<string, SessionNote>();
  if (bookings.length === 0) return map;
  const supabase = await createClient();
  // Filtramos por (booking_id, author_id) — author_id = client_id do
  // booking — para impedir que uma nota do trainer ao próprio booking
  // (booking-bound, autoria do trainer) apareça aqui como "nota do cliente".
  const clientIdByBooking = new Map(bookings.map((b) => [b.id, b.clientId]));
  const { data } = await supabase
    .from("session_notes")
    .select("booking_id, author_id, body")
    .in(
      "booking_id",
      bookings.map((b) => b.id),
    );
  for (const row of (data ?? []) as unknown as SessionNote[]) {
    if (!row.booking_id) continue;
    const expectedAuthor = clientIdByBooking.get(row.booking_id);
    if (!expectedAuthor || row.author_id !== expectedAuthor) continue;
    map.set(row.booking_id, row);
  }
  return map;
}

export async function getMyNotesMapForBookings(bookingIds: string[]): Promise<Map<string, SessionNote>> {
  const map = new Map<string, SessionNote>();
  if (bookingIds.length === 0) return map;
  const supabase = await createClient();
  const { data } = await supabase
    .from("session_notes")
    .select("booking_id, body")
    .in("booking_id", bookingIds);
  for (const row of (data ?? []) as unknown as SessionNote[]) {
    if (row.booking_id) map.set(row.booking_id, row);
  }
  return map;
}
