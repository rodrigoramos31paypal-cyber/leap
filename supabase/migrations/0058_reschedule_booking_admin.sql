-- ════════════════════════════════════════════════════════════════
-- 0058_reschedule_booking_admin
--
-- Reagendamento por ADMIN (trainer/owner), usado pelo drag-and-drop na
-- Agenda. Baseado em reschedule_booking (0042), com 3 diferenças:
--
--   1. Autorização: SÓ admin com acesso ao trainer (ou service role) —
--      não é o caminho do cliente.
--   2. PRESERVA o estado da sessão: se estava 'confirmed', continua
--      'confirmed' no novo horário (arrastar não deve voltar a pôr
--      pendente uma sessão já aceite). Mantém confirmed_at/by.
--   3. p_notify_client controla se o cliente recebe notificação in-app
--      (e, por consequência, push). Com false → movimento silencioso.
--      O email é tratado na server action (também condicionado).
--
-- Continua atómico e neutro em créditos (devolve +1 da antiga, desconta
-- -1 na nova), tal como 0042.
--
-- REVERT: drop function if exists reschedule_booking_admin(uuid, timestamptz, integer, boolean);
-- ════════════════════════════════════════════════════════════════
create or replace function reschedule_booking_admin(
  p_old_booking_id uuid,
  p_starts_at timestamptz,
  p_duration_min integer,
  p_notify_client boolean default true
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

  -- Autorização: SÓ admin com acesso ao trainer (ou service role).
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

  -- Validar o novo slot.
  if p_starts_at <= now() then
    raise exception 'A marcação tem de ser no futuro.';
  end if;
  if not (p_duration_min = any(v_settings.slot_durations_min)) then
    raise exception 'Duração % min não permitida.', p_duration_min;
  end if;
  if exists (
    select 1 from trainer_blocked_times
    where trainer_id = v_trainer
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Horário não disponível (bloqueado).';
  end if;
  if exists (
    select 1 from bookings
    where trainer_id = v_trainer
      and id <> p_old_booking_id
      and status in ('booked', 'confirmed')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Já existe uma marcação neste horário.';
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

  -- Cancela a antiga.
  update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = v_actor,
        cancellation_reason = 'Reagendada pelo treinador',
        confirmed_at = null,
        confirmed_by = null,
        credit_charged = false
  where id = p_old_booking_id;

  -- Marca a nova — PRESERVA o estado original (confirmada continua confirmada).
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

  -- Notifica o cliente apenas se pedido (in-app → push). Email é tratado
  -- na server action, também condicionado a notify.
  if p_notify_client then
    insert into notifications (user_id, type, title, body, link)
    values (v_client, 'booking_created', 'Sessão reagendada',
            'A tua sessão foi reagendada para ' || v_when || '.',
            '/app/agenda');
  end if;

  return v_new_id;
end;
$$;

revoke all on function reschedule_booking_admin(uuid, timestamptz, integer, boolean) from public, anon;
grant execute on function reschedule_booking_admin(uuid, timestamptz, integer, boolean) to authenticated, service_role;
