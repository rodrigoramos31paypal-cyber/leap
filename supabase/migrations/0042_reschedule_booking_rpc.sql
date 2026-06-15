-- ════════════════════════════════════════════════════════════════
-- 0042_reschedule_booking
--
-- Reagendar de forma ATÓMICA: devolve o crédito da sessão antiga,
-- cancela-a, e cria a nova — tudo numa só transação. Assim nunca fica
-- "cancelada mas sem nova marcação", e é neutro em créditos (devolve +1,
-- desconta -1), por isso funciona mesmo quando o cliente não tem saldo
-- livre (o crédito da sessão antiga financia a nova).
--
-- Baseado em create_booking (0025) + lógica de cancelamento. Mesmas
-- validações: lock por trainer, slot livre (exceto a própria), bloqueios,
-- reservas, duração permitida.
--
-- REVERT: drop function if exists reschedule_booking(uuid, timestamptz, integer);
-- ════════════════════════════════════════════════════════════════
create or replace function reschedule_booking(
  p_old_booking_id uuid,
  p_starts_at timestamptz,
  p_duration_min integer
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
  v_trainer_profile uuid;
  v_client_name text;
  v_when text := to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');
begin
  select * into v_old from bookings where id = p_old_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  -- Autorização: dono, admin com acesso ao trainer, ou service role.
  if auth.uid() is null then
    null;
  elsif v_old.client_id = auth.uid() then
    null;
  elsif is_admin() and _trainer_is_accessible(v_old.trainer_id) then
    null;
  else
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

  -- Serializa marcações por trainer (igual a create_booking).
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
  -- Sobreposição com OUTRAS marcações (exclui a própria que vai ser cancelada).
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

  -- Devolve o crédito da sessão antiga ANTES de marcar a nova, para que
  -- pick_purchase_for_booking encontre o crédito disponível (neutro).
  if v_old.credit_charged and v_old.purchase_id is not null then
    update purchases set sessions_remaining = sessions_remaining + 1 where id = v_old.purchase_id;
    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_old.purchase_id, p_old_booking_id, 1, 'cancel_refund', auth.uid(), 'Reagendamento — devolução');
  end if;

  -- Cancela a antiga.
  update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancellation_reason = 'Reagendada pelo cliente',
        confirmed_at = null,
        confirmed_by = null,
        credit_charged = false
  where id = p_old_booking_id;

  -- Marca a nova (mesma lógica de create_booking).
  v_purchase_id := pick_purchase_for_booking(v_client, v_type, v_trainer);
  if v_purchase_id is null then
    raise exception 'Sem sessões para reagendar.';
  end if;

  v_status := case when v_settings.auto_confirm_bookings then 'confirmed'::booking_status
                   else 'booked'::booking_status end;

  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status, credit_charged, confirmed_at, confirmed_by
  ) values (
    v_client, v_trainer, v_purchase_id, v_type,
    p_starts_at, v_ends_at, v_status, true,
    case when v_settings.auto_confirm_bookings then now() else null end,
    case when v_settings.auto_confirm_bookings then v_client else null end
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
  values (v_purchase_id, v_new_id, -1, 'booking_deduction', v_client);

  -- Notifica o cliente só se ficar pendente (auto-confirm = redundante).
  if not v_settings.auto_confirm_bookings then
    insert into notifications (user_id, type, title, body, link)
    values (v_client, 'booking_created', 'Sessão reagendada',
            'A tua sessão foi reagendada para ' || v_when || ' (a aguardar aceitação).',
            '/app/agenda');
  end if;

  -- Notifica o trainer.
  select profile_id into v_trainer_profile from trainers where id = v_trainer;
  select full_name into v_client_name from profiles where id = v_client;
  if v_trainer_profile is not null then
    insert into notifications (user_id, type, title, body, link)
    values (v_trainer_profile, 'booking_created_admin', 'Sessão reagendada',
            split_part(coalesce(v_client_name, 'Cliente'), ' ', 1) || ' reagendou para ' || v_when || '.',
            '/admin/agenda');
  end if;

  return v_new_id;
end;
$$;

revoke all on function reschedule_booking(uuid, timestamptz, integer) from public, anon;
grant execute on function reschedule_booking(uuid, timestamptz, integer) to authenticated, service_role;
