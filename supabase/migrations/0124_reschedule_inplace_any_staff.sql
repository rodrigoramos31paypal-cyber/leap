-- ════════════════════════════════════════════════════════════════
-- 0124 · reschedule_booking_admin · mover é SÓ mover (in-place) e
--        qualquer staff pode mover qualquer sessão.
--
-- CONTEXTO / BUG
-- A 0089 tinha tornado o reagendamento um simples UPDATE in-place do
-- horário (sem mexer em créditos). A 0123 (override de "Ocupado") foi
-- escrita a partir da 0071 e, sem querer, RE-INTRODUZIU a lógica antiga
-- de "cancela a antiga + cria uma nova", que precisa de um pack de
-- créditos disponível (pick_purchase_for_booking). Quando o cliente não
-- tem crédito livre (pack esgotado/expirado, sessão recorrente ou
-- cortesia), o reagendamento rebenta com "Sem sessões para reagendar."
-- — apesar de o staff ter permissão. Isto é uma REGRESSÃO da 0123.
--
-- DECISÃO (pedido do owner)
--   1. Mover uma sessão é SÓ mover: muda starts_at/ends_at e mais nada.
--      A 1 sessão que já foi descontada quando a marcação foi criada
--      mantém-se descontada. Sem refund, sem novo desconto, sem
--      pick_purchase. Logo NUNCA dá "Sem sessões para reagendar" e
--      funciona mesmo com o cliente a zero créditos.
--   2. Qualquer staff (trainer OU owner) pode mover QUALQUER sessão,
--      incluindo de outro trainer. A autorização deixa de exigir
--      `_trainer_is_accessible` — basta `is_admin()` (staff). Cliente
--      continua de fora (anon/cliente nunca passam is_admin()).
--
-- MANTÉM da 0123:
--   • P0098 — alvo cai sobre "Ocupado" (trainer_blocked_times): aviso
--     confirmável (a UI pergunta "reagendar à mesma?"), salvo p_force.
--   • P0099 — alvo sobrepõe outra sessão activa: aviso confirmável,
--     salvo p_force.
--   • is_reserved_slot_blocked — slot reservado a outro cliente.
--   • Duração livre 5–600 min.
--   • Notificação ao cliente condicionada a p_notify_client.
--
-- COMO a 0089: sem guarda de "já decorreu" nem "tem de ser no futuro" —
-- o staff pode arrastar sessões passadas e para qualquer instante
-- (corrigir registos após o facto).
--
-- REVERT: reaplicar 0123.
-- ════════════════════════════════════════════════════════════════

create or replace function reschedule_booking_admin(
  p_old_booking_id uuid,
  p_starts_at timestamptz,
  p_duration_min integer,
  p_notify_client boolean default true,
  p_force boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old bookings%rowtype;
  v_client uuid;
  v_trainer uuid;
  v_ends_at timestamptz := p_starts_at + (p_duration_min || ' minutes')::interval;
  v_actor uuid := auth.uid();
  v_when text := to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');
begin
  select * into v_old from bookings where id = p_old_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  -- 0124: autorização relaxada — QUALQUER staff (trainer/owner) pode
  -- mover QUALQUER sessão. Deixa de exigir _trainer_is_accessible.
  -- (service role: v_actor null → passa, como antes.)
  if v_actor is not null and not is_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_old.status not in ('booked', 'confirmed') then
    raise exception 'Só sessões ativas podem ser reagendadas.';
  end if;

  v_client := v_old.client_id;
  v_trainer := v_old.trainer_id;

  perform pg_advisory_xact_lock(hashtextextended(v_trainer::text, 0));

  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 600 then
    raise exception 'A duração tem de estar entre 5 e 600 minutos.';
  end if;

  -- "Ocupado" (trainer_blocked_times) → aviso confirmável (P0098).
  if not coalesce(p_force, false) and exists (
    select 1 from trainer_blocked_times
    where trainer_id = v_trainer
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Este horário está ocupado.' using errcode = 'P0098';
  end if;
  -- Sobreposição com OUTRA sessão activa → aviso confirmável (P0099).
  if not coalesce(p_force, false) and exists (
    select 1 from bookings
    where trainer_id = v_trainer
      and id <> p_old_booking_id
      and status in ('booked', 'confirmed')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Esta sessão vai sobrepor outra.' using errcode = 'P0099';
  end if;
  if is_reserved_slot_blocked(v_trainer, v_client, p_starts_at, v_ends_at) then
    raise exception 'Horário reservado para outro cliente.';
  end if;

  -- 0124: UPDATE in-place — só muda o horário e a duração. PRESERVA
  -- purchase_id, credit_charged, status, confirmed_at/by. Neutro em
  -- créditos: a 1 sessão descontada na criação continua descontada.
  -- Nunca toca em purchases nem em pick_purchase → sem "Sem sessões".
  update bookings
    set starts_at = p_starts_at,
        ends_at = v_ends_at
  where id = p_old_booking_id;

  if p_notify_client then
    insert into notifications (user_id, type, title, body, link)
    values (v_client, 'booking_created', 'Sessão reagendada',
            'A tua sessão foi reagendada para ' || v_when || '.',
            '/app/agenda');
  end if;

  return p_old_booking_id;
end;
$$;

revoke all on function reschedule_booking_admin(uuid, timestamptz, integer, boolean, boolean) from public, anon;
grant execute on function reschedule_booking_admin(uuid, timestamptz, integer, boolean, boolean) to authenticated, service_role;
