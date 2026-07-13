-- ════════════════════════════════════════════════════════════════
-- 0089 · reschedule_booking_admin · permite passado e origem passada
--
-- Pedido do trainer: poder arrastar QUALQUER sessão na agenda
-- (passado/presente/futuro) para QUALQUER slot (incluindo no passado).
-- Útil para corrigir registos depois do facto (ex.: a sessão foi às 18h
-- em vez das 19h e o trainer só nota mais tarde).
--
-- Atinge SÓ a variante ADMIN (5-param, `p_force` incluído) definida
-- pela última vez em 0080. A variante cliente (`reschedule_booking`,
-- 3-param) mantém as duas restrições: um cliente NÃO pode reagendar
-- sessões passadas nem mover para o passado.
--
-- Diff face a 0080:
--   • REMOVIDO:  if v_old.starts_at <= now() then raise … 'já decorreu' …
--   • REMOVIDO:  if p_starts_at  <= now() then raise … 'tem de ser no futuro' …
--   • Todo o resto (autorização, lock, overlap c/ `p_force`, slot
--     reservado, in-place update, notificação) fica intacto.
--
-- O 4-param `reschedule_booking_admin` introduzido em 0086 (delete-then-
-- create) não é chamado pela app (o wrapper TS passa sempre p_force) e
-- fica como está.
--
-- REVERT: reaplicar 0080.
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
  v_trainer uuid;
  v_client uuid;
  v_ends_at timestamptz := p_starts_at + (p_duration_min || ' minutes')::interval;
  v_actor uuid := auth.uid();
  v_when text := to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');
begin
  select * into v_old from bookings where id = p_old_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  if v_actor is not null and not (is_admin() and _trainer_is_accessible(v_old.trainer_id)) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_old.status not in ('booked', 'confirmed') then
    raise exception 'Só sessões ativas podem ser reagendadas.';
  end if;
  -- 0089: removida a guarda "já decorreu". Trainer pode mexer em sessões
  -- passadas para corrigir registos.

  v_trainer := v_old.trainer_id;
  v_client := v_old.client_id;

  perform pg_advisory_xact_lock(hashtextextended(v_trainer::text, 0));

  -- 0089: removida a guarda "tem de ser no futuro". O alvo pode ser
  -- qualquer instante; o overlap-check e o slot-reservado continuam a
  -- proteger contra colisões com outras sessões activas.
  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 600 then
    raise exception 'A duração tem de estar entre 5 e 600 minutos.';
  end if;
  if exists (
    select 1 from trainer_blocked_times
    where trainer_id = v_trainer
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Horário não disponível (bloqueado).';
  end if;
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

  -- UPDATE in-place: preserva purchase_id, credit_charged, status,
  -- confirmed_at/by. Só muda o horário e a duração. Neutro em créditos.
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
