-- ════════════════════════════════════════════════════════════════
-- 0071 · Drag-and-drop pode SOBREPOR sessões (com confirmação)
--
-- Mudanças vs 0058:
--   1. p_force boolean — quando o novo horário se sobrepõe a OUTRA
--      sessão activa e p_force=false, NÃO reagenda e devolve um sinal
--      de conflito (raise com errcode 'P0099'). A UI pergunta "vai
--      sobrepor outra sessão, reagendar à mesma?"; se confirmar, chama
--      de novo com p_force=true e a sobreposição é gravada.
--   2. Duração: deixa de exigir slot_durations_min — aceita qualquer
--      valor 5–600 min. Necessário porque uma sessão pode já ter uma
--      duração personalizada (definida no ajuste de duração) e o arrasto
--      preserva-a.
--   3. Bloqueios (trainer_blocked_times) CONTINUAM barreira dura.
--
-- A constraint EXCLUDE bookings_no_overlap foi removida em 0070, por
-- isso a inserção sobreposta passa na BD.
--
-- REVERT: drop function reschedule_booking_admin(uuid,timestamptz,integer,boolean,boolean);
--         e reaplicar 0058.
-- ════════════════════════════════════════════════════════════════

drop function if exists reschedule_booking_admin(uuid, timestamptz, integer, boolean);

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
  -- Bloqueios continuam a ser barreira dura.
  if exists (
    select 1 from trainer_blocked_times
    where trainer_id = v_trainer
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Horário não disponível (bloqueado).';
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
