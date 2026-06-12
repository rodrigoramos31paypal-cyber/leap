-- ════════════════════════════════════════════════════════════════
-- LEAP-FITNESS STUDIO · Booking flow update
-- - Crédito é debitado IMEDIATAMENTE ao marcar (não na confirmação).
-- - Cancelamento devolve o crédito (excepto cancelamento tardio).
-- - confirm_booking_attendance apenas marca como confirmed.
-- - mark_no_show devolve crédito se charge_no_show=false.
-- - create_booking notifica também o trainer.
-- ════════════════════════════════════════════════════════════════

create or replace function create_booking(
  p_trainer_id uuid,
  p_starts_at timestamptz,
  p_duration_min integer,
  p_session_type session_type default 'individual',
  p_client_id uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_client_id uuid := coalesce(p_client_id, auth.uid());
  v_ends_at timestamptz := p_starts_at + (p_duration_min || ' minutes')::interval;
  v_purchase_id uuid;
  v_booking_id uuid;
  v_settings trainer_settings%rowtype;
  v_trainer_profile uuid;
  v_client_name text;
  v_remaining integer;
  v_threshold integer;
begin
  select * into v_settings from trainer_settings where trainer_id = p_trainer_id;
  if not found then
    raise exception 'Trainer não encontrado';
  end if;

  -- cliente tem créditos?
  v_purchase_id := pick_purchase_for_booking(v_client_id, p_session_type);
  if v_purchase_id is null then
    raise exception 'Sem créditos disponíveis para % sessões.', p_session_type;
  end if;

  -- starts_at no futuro?
  if p_starts_at <= now() then
    raise exception 'A marcação tem de ser no futuro.';
  end if;

  -- duração permitida?
  if not (p_duration_min = any(v_settings.slot_durations_min)) then
    raise exception 'Duração % min não permitida.', p_duration_min;
  end if;

  -- bloqueado?
  if exists (
    select 1 from trainer_blocked_times
    where trainer_id = p_trainer_id
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Horário não disponível (bloqueado).';
  end if;

  -- conflito com outra marcação ativa?
  if exists (
    select 1 from bookings
    where trainer_id = p_trainer_id
      and status in ('booked', 'confirmed')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Já existe uma marcação neste horário.';
  end if;

  -- cria booking JÁ com crédito descontado (credit_charged = true)
  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status, credit_charged
  ) values (
    v_client_id, p_trainer_id, v_purchase_id, p_session_type,
    p_starts_at, v_ends_at, 'booked', true
  )
  returning id into v_booking_id;

  -- desconta crédito imediatamente
  update purchases
    set sessions_remaining = sessions_remaining - 1
    where id = v_purchase_id
    returning sessions_remaining into v_remaining;

  insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by)
  values (v_purchase_id, v_booking_id, -1, 'booking_deduction', v_client_id);

  -- notificação ao cliente
  insert into notifications (user_id, type, title, body, link)
  values (v_client_id, 'booking_created', 'Marcação criada',
          'A tua sessão foi marcada. Crédito descontado.', '/app/agenda');

  -- avisos de saldo baixo / zero
  select low_credits_threshold into v_threshold
    from trainer_settings where trainer_id = p_trainer_id;

  if v_remaining = coalesce(v_threshold, 2) then
    insert into notifications (user_id, type, title, body, link)
    values (v_client_id, 'low_credits',
            'Restam ' || v_remaining || ' sessões',
            'Renova o teu pack para continuares.',
            '/app/comprar');
  elsif v_remaining = 0 then
    insert into notifications (user_id, type, title, body, link)
    values (v_client_id, 'no_credits',
            'Sem sessões disponíveis',
            'Compra um novo pack para marcar mais sessões.',
            '/app/comprar');
  end if;

  -- notificação ao trainer (admin)
  select profile_id into v_trainer_profile from trainers where id = p_trainer_id;
  select full_name into v_client_name from profiles where id = v_client_id;
  if v_trainer_profile is not null then
    insert into notifications (user_id, type, title, body, link)
    values (v_trainer_profile, 'booking_created_admin',
            'Nova marcação',
            coalesce(v_client_name, 'Cliente') || ' marcou uma sessão para ' ||
              to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM HH24:MI') || '.',
            '/admin/agenda');
  end if;

  return v_booking_id;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- confirm_booking_attendance · só marca confirmed (sem segundo débito)
-- ────────────────────────────────────────────────────────────────
create or replace function confirm_booking_attendance(p_booking_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;
  if v_booking.status = 'confirmed' then return; end if;
  if v_booking.status <> 'booked' then
    raise exception 'Só marcações ativas podem ser confirmadas.';
  end if;

  update bookings
    set status = 'confirmed',
        confirmed_at = now(),
        confirmed_by = auth.uid()
    where id = p_booking_id;

  -- aviso ao cliente
  insert into notifications (user_id, type, title, body, link)
  values (v_booking.client_id, 'booking_confirmed',
          'Presença confirmada',
          'A tua sessão foi confirmada pelo treinador.',
          '/app/historico');
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- cancel_booking · devolve crédito (excepto cancelamento tardio se configurado)
-- ────────────────────────────────────────────────────────────────
create or replace function cancel_booking(
  p_booking_id uuid,
  p_reason text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_settings trainer_settings%rowtype;
  v_hours_to_session numeric;
  v_refund boolean := true;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;
  if v_booking.status in ('cancelled', 'no_show') then return; end if;
  if v_booking.status = 'confirmed' then
    raise exception 'Não é possível cancelar uma sessão já confirmada.';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_booking.trainer_id;

  v_hours_to_session := extract(epoch from (v_booking.starts_at - now())) / 3600.0;

  -- cancelamento tardio? então NÃO devolve crédito
  if v_settings.charge_late_cancel and v_hours_to_session < v_settings.cancellation_window_hours then
    v_refund := false;
  end if;

  update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancellation_reason = p_reason,
        credit_charged = not v_refund
    where id = p_booking_id;

  -- devolve crédito se não foi cancelamento tardio
  if v_refund and v_booking.credit_charged then
    update purchases
      set sessions_remaining = sessions_remaining + 1
      where id = v_booking.purchase_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_booking.purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
            'Devolução de crédito por cancelamento');
  end if;

  insert into notifications (user_id, type, title, body)
  values (v_booking.client_id, 'booking_cancelled', 'Marcação cancelada',
          case when not v_refund
               then 'Cancelaste com menos de ' || v_settings.cancellation_window_hours || 'h — 1 sessão foi descontada.'
               else 'A tua sessão foi cancelada e o crédito devolvido.' end);
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- mark_no_show · se não cobra, devolve o crédito
-- ────────────────────────────────────────────────────────────────
create or replace function mark_no_show(p_booking_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_settings trainer_settings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;
  if v_booking.status <> 'booked' then
    raise exception 'Só marcações ativas podem ser marcadas como falta.';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_booking.trainer_id;

  update bookings
    set status = 'no_show',
        credit_charged = v_settings.charge_no_show
    where id = p_booking_id;

  -- se NÃO cobra no-show, devolve o crédito já debitado na marcação
  if not v_settings.charge_no_show and v_booking.credit_charged then
    update purchases
      set sessions_remaining = sessions_remaining + 1
      where id = v_booking.purchase_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_booking.purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
            'No-show sem cobrança');
  end if;
end;
$$;
