-- ════════════════════════════════════════════════════════════════
-- 0123 · Staff pode SOBREPOR horários ocupados/bloqueados (com aviso)
--
-- Pedido: quando uma sessão fica por cima de um "Ocupado"
-- (trainer_blocked_times), o staff/admin/owner deve poder na mesma
-- ajustar a duração ou arrastá-la (reagendar). Antes era barreira DURA
-- (raise exception, sem volta a dar):
--
--   • update_booking_duration  (0069) — "A nova duração sobrepõe um
--                                         horário bloqueado."
--   • reschedule_booking_admin (0071) — "Horário não disponível
--                                         (bloqueado)."
--
-- Agora o bloqueio passa a comportar-se como a sobreposição de sessões:
-- um AVISO leve e confirmável ("este horário está ocupado — continuar?").
-- Sem p_force devolve/levanta um sinal de confirmação; com p_force=true
-- grava à mesma. Ambas as RPCs já são staff-only (auth: is_admin() +
-- _trainer_is_accessible, ou service role).
--
--   • update_booking_duration  → jsonb ganha `blocked` (nº de "Ocupado"
--     sobrepostos); conflict=true quando há sessões OU bloqueios.
--   • reschedule_booking_admin → novo errcode 'P0098' para bloqueio
--     (mantém 'P0099' para sobreposição de sessão).
--
-- create_booking_admin (0115) já não tinha verificação de bloqueio,
-- por isso a criação de novas marcações sobre "Ocupado" já funcionava
-- e não é tocada aqui.
--
-- REVERT: reaplicar 0069 e 0071.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1) update_booking_duration — bloqueio passa a aviso confirmável
--    (cópia da 0069; trainer_blocked_times = aviso `blocked`, não barreira)
-- ────────────────────────────────────────────────────────────────
create or replace function update_booking_duration(
  p_booking_id uuid,
  p_duration_min integer,
  p_force boolean default false
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_ends_at timestamptz;
  v_conflicts integer;
  v_blocks integer;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  -- Autorização: só admin com acesso ao trainer (ou service role).
  if auth.uid() is not null
     and not (is_admin() and _trainer_is_accessible(v_booking.trainer_id)) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_booking.status not in ('booked', 'confirmed') then
    raise exception 'Só sessões ativas podem ser ajustadas.';
  end if;

  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 600 then
    raise exception 'A duração tem de estar entre 5 e 600 minutos.';
  end if;

  v_ends_at := v_booking.starts_at + (p_duration_min || ' minutes')::interval;

  perform pg_advisory_xact_lock(hashtextextended(v_booking.trainer_id::text, 0));

  -- 0123: horário ocupado (trainer_blocked_times) deixa de ser barreira
  -- dura — passa a AVISO confirmável, como a sobreposição de sessões.
  select count(*) into v_blocks
  from trainer_blocked_times
  where trainer_id = v_booking.trainer_id
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_booking.starts_at, v_ends_at, '[)');

  -- Sobreposição com OUTRAS sessões activas → AVISO (não barreira).
  select count(*) into v_conflicts
  from bookings
  where trainer_id = v_booking.trainer_id
    and id <> p_booking_id
    and status in ('booked', 'confirmed')
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_booking.starts_at, v_ends_at, '[)');

  if (v_conflicts > 0 or v_blocks > 0) and not coalesce(p_force, false) then
    -- Não grava — devolve o aviso para a UI confirmar (sessões e/ou ocupado).
    return jsonb_build_object('ok', false, 'conflict', true,
      'count', v_conflicts, 'blocked', v_blocks);
  end if;

  update bookings set ends_at = v_ends_at where id = p_booking_id;
  return jsonb_build_object('ok', true, 'conflict', v_conflicts > 0,
    'count', v_conflicts, 'blocked', v_blocks);
end;
$$;

revoke all on function update_booking_duration(uuid, integer, boolean) from public, anon;
grant execute on function update_booking_duration(uuid, integer, boolean) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────
-- 2) reschedule_booking_admin — bloqueio passa a aviso confirmável
--    (cópia da 0071; trainer_blocked_times = aviso P0098, não barreira)
-- ────────────────────────────────────────────────────────────────
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
  v_type session_type;
  v_settings trainer_settings%rowtype;
  v_ends_at timestamptz := p_starts_at + (p_duration_min || ' minutes')::interval;
  v_purchase_id uuid;
  v_remaining integer;
  v_new_id uuid;
  v_status booking_status;
  v_was_confirmed boolean;
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
  if v_old.starts_at <= now() then
    raise exception 'Não é possível reagendar uma sessão que já decorreu.';
  end if;

  v_client := v_old.client_id;
  v_trainer := v_old.trainer_id;
  v_type := v_old.session_type;
  v_was_confirmed := v_old.status = 'confirmed';

  perform pg_advisory_xact_lock(hashtextextended(v_trainer::text, 0));

  select * into v_settings from trainer_settings where trainer_id = v_trainer;
  if not found then raise exception 'Trainer não encontrado'; end if;

  if p_starts_at <= now() then
    raise exception 'A marcação tem de ser no futuro.';
  end if;
  -- Duração livre (5–600), já não restrita às durações pré-definidas.
  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 600 then
    raise exception 'A duração tem de estar entre 5 e 600 minutos.';
  end if;

  -- 0123: horário ocupado (trainer_blocked_times) → AVISO (errcode P0098)
  -- salvo se forçado. Deixa de ser barreira dura: o staff pode arrastar
  -- uma sessão por cima de "Ocupado" depois de confirmar.
  if not coalesce(p_force, false) and exists (
    select 1 from trainer_blocked_times
    where trainer_id = v_trainer
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Este horário está ocupado.' using errcode = 'P0098';
  end if;
  -- Sobreposição com OUTRA sessão → AVISO (errcode P0099) salvo se forçado.
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

  -- Devolve o crédito da sessão antiga ANTES de marcar a nova (neutro).
  if v_old.credit_charged and v_old.purchase_id is not null then
    update purchases set sessions_remaining = sessions_remaining + 1 where id = v_old.purchase_id;
    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_old.purchase_id, p_old_booking_id, 1, 'cancel_refund', v_actor, 'Reagendamento (admin) — devolução');
  end if;

  update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = v_actor,
        cancellation_reason = 'Reagendada pelo treinador',
        confirmed_at = null,
        confirmed_by = null,
        credit_charged = false
  where id = p_old_booking_id;

  v_purchase_id := pick_purchase_for_booking(v_client, v_type, v_trainer);
  if v_purchase_id is null then
    raise exception 'Sem sessões para reagendar.';
  end if;

  v_status := case when v_was_confirmed then 'confirmed'::booking_status
                   else 'booked'::booking_status end;

  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status, credit_charged, confirmed_at, confirmed_by
  ) values (
    v_client, v_trainer, v_purchase_id, v_type,
    p_starts_at, v_ends_at, v_status, true,
    case when v_was_confirmed then now() else null end,
    case when v_was_confirmed then coalesce(v_actor, v_client) else null end
  )
  returning id into v_new_id;

  update purchases
    set sessions_remaining = sessions_remaining - 1
    where id = v_purchase_id and sessions_remaining > 0
    returning sessions_remaining into v_remaining;
  if v_remaining is null then
    raise exception 'Sem sessões disponíveis para descontar.' using errcode = '23514';
  end if;

  insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by)
  values (v_purchase_id, v_new_id, -1, 'booking_deduction', coalesce(v_actor, v_client));

  if p_notify_client then
    insert into notifications (user_id, type, title, body, link)
    values (v_client, 'booking_created', 'Sessão reagendada',
            'A tua sessão foi reagendada para ' || v_when || '.',
            '/app/agenda');
  end if;

  return v_new_id;
end;
$$;

revoke all on function reschedule_booking_admin(uuid, timestamptz, integer, boolean, boolean) from public, anon;
grant execute on function reschedule_booking_admin(uuid, timestamptz, integer, boolean, boolean) to authenticated, service_role;
