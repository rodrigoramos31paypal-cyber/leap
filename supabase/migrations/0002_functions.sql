-- ════════════════════════════════════════════════════════════════
-- LEAP Fitness Studio · Funções e triggers de negócio
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- Helper: identifica role do utilizador atual
-- ────────────────────────────────────────────────────────────────
create or replace function current_role_name()
returns user_role
language sql stable security definer
as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function is_admin()
returns boolean
language sql stable security definer
as $$
  select coalesce(
    (select role in ('trainer', 'owner') from profiles where id = auth.uid()),
    false
  )
$$;

create or replace function current_trainer_id()
returns uuid
language sql stable security definer
as $$
  select t.id from trainers t
    inner join profiles p on p.id = t.profile_id
    where p.id = auth.uid()
$$;

-- ────────────────────────────────────────────────────────────────
-- handle_new_user · cria profile quando regista auth.users
-- O role default é 'client'. Trainers são promovidos manualmente.
-- ────────────────────────────────────────────────────────────────
create or replace function handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone',
    'client'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ────────────────────────────────────────────────────────────────
-- create_purchase · cria compra a partir de pack
-- Retorna purchase_id. Status inicial: awaiting_confirmation (manual)
-- ou pending_payment (gateway).
-- ────────────────────────────────────────────────────────────────
create or replace function create_purchase(
  p_pack_id uuid,
  p_payment_method payment_method,
  p_client_id uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_client_id uuid := coalesce(p_client_id, auth.uid());
  v_pack packs%rowtype;
  v_settings trainer_settings%rowtype;
  v_purchase_id uuid;
  v_validity_days integer;
  v_expires_at timestamptz;
  v_status purchase_status;
begin
  -- valida pack
  select * into v_pack from packs where id = p_pack_id and active = true;
  if not found then
    raise exception 'Pack não encontrado ou inativo';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_pack.trainer_id;

  -- valida cliente
  if not exists (select 1 from profiles where id = v_client_id) then
    raise exception 'Cliente inválido';
  end if;

  -- validade: prioridade pack > settings > sem validade
  v_validity_days := coalesce(v_pack.validity_days, v_settings.default_pack_validity_days);
  if v_validity_days is not null then
    v_expires_at := now() + (v_validity_days || ' days')::interval;
  end if;

  -- status inicial conforme método
  if p_payment_method in ('manual_mbway', 'manual_cash', 'manual_transfer') then
    v_status := 'awaiting_confirmation';
  else
    v_status := 'pending_payment';
  end if;

  insert into purchases (
    client_id, trainer_id, pack_id, pack_snapshot, session_type,
    sessions_total, sessions_remaining, amount_cents, status,
    payment_method, expires_at
  ) values (
    v_client_id,
    v_pack.trainer_id,
    v_pack.id,
    jsonb_build_object(
      'name', v_pack.name,
      'sessions', v_pack.sessions,
      'price_cents', v_pack.price_cents,
      'session_type', v_pack.session_type
    ),
    v_pack.session_type,
    v_pack.sessions,
    v_pack.sessions, -- todos os créditos disponíveis ao confirmar (vide confirm_purchase)
    v_pack.price_cents,
    v_status,
    p_payment_method,
    v_expires_at
  )
  returning id into v_purchase_id;

  -- cria payment pending
  insert into payments (purchase_id, method, amount_cents, status, gateway)
  values (
    v_purchase_id,
    p_payment_method,
    v_pack.price_cents,
    'pending',
    case
      when p_payment_method in ('manual_mbway', 'manual_cash', 'manual_transfer') then 'manual'::payment_gateway
      else 'ifthenpay'::payment_gateway
    end
  );

  return v_purchase_id;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- confirm_purchase · confirma compra e regista crédito inicial
-- ────────────────────────────────────────────────────────────────
create or replace function confirm_purchase(
  p_purchase_id uuid,
  p_confirmed_by uuid default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_purchase purchases%rowtype;
begin
  select * into v_purchase from purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'Compra não encontrada';
  end if;
  if v_purchase.status = 'confirmed' then
    return;
  end if;

  update purchases
    set status = 'confirmed',
        confirmed_at = now(),
        confirmed_by = coalesce(p_confirmed_by, auth.uid())
    where id = p_purchase_id;

  -- regista transação de crédito inicial
  insert into credit_transactions (purchase_id, delta, reason, created_by, notes)
  values (p_purchase_id, v_purchase.sessions_total, 'purchase',
          coalesce(p_confirmed_by, auth.uid()),
          'Pack confirmado');

  -- marca payment como pago
  update payments
    set status = 'paid',
        paid_at = now()
    where purchase_id = p_purchase_id and status = 'pending';

  -- notifica cliente
  insert into notifications (user_id, type, title, body, link)
  values (
    v_purchase.client_id,
    'purchase_confirmed',
    'Pack ativo',
    'O teu pack foi confirmado. Já podes marcar sessões.',
    '/app/agenda'
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- reject_purchase
-- ────────────────────────────────────────────────────────────────
create or replace function reject_purchase(
  p_purchase_id uuid,
  p_reason text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  update purchases
    set status = 'rejected',
        rejection_reason = p_reason
    where id = p_purchase_id and status in ('pending_payment', 'awaiting_confirmation')
    returning client_id into v_client_id;

  if v_client_id is not null then
    update payments set status = 'failed' where purchase_id = p_purchase_id and status = 'pending';
    insert into notifications (user_id, type, title, body)
    values (v_client_id, 'purchase_rejected', 'Compra rejeitada',
            coalesce(p_reason, 'A tua compra foi rejeitada. Contacta-nos para mais informações.'));
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- get_active_credits · soma de créditos disponíveis do cliente
-- ────────────────────────────────────────────────────────────────
create or replace function get_active_credits(p_client_id uuid)
returns integer
language sql stable
as $$
  select coalesce(sum(sessions_remaining), 0)::integer
  from purchases
  where client_id = p_client_id
    and status = 'confirmed'
    and sessions_remaining > 0
    and (expires_at is null or expires_at > now())
$$;

-- ────────────────────────────────────────────────────────────────
-- pick_purchase_for_booking · escolhe a purchase mais antiga válida
-- (FIFO — usa primeiro o que expira mais cedo)
-- ────────────────────────────────────────────────────────────────
create or replace function pick_purchase_for_booking(
  p_client_id uuid,
  p_session_type session_type
)
returns uuid
language sql stable
as $$
  select id from purchases
  where client_id = p_client_id
    and session_type = p_session_type
    and status = 'confirmed'
    and sessions_remaining > 0
    and (expires_at is null or expires_at > now())
  order by coalesce(expires_at, 'infinity'::timestamptz) asc, created_at asc
  limit 1
$$;

-- ────────────────────────────────────────────────────────────────
-- create_booking · marca sessão com validações
-- ────────────────────────────────────────────────────────────────
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

  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status
  ) values (
    v_client_id, p_trainer_id, v_purchase_id, p_session_type,
    p_starts_at, v_ends_at, 'booked'
  )
  returning id into v_booking_id;

  -- notifica cliente
  insert into notifications (user_id, type, title, body, link)
  values (v_client_id, 'booking_created', 'Marcação criada',
          'A tua sessão foi marcada.', '/app/agenda');

  return v_booking_id;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- confirm_booking_attendance · admin confirma presença → desconta crédito
-- ────────────────────────────────────────────────────────────────
create or replace function confirm_booking_attendance(p_booking_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_remaining integer;
  v_threshold integer;
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
        confirmed_by = auth.uid(),
        credit_charged = true
    where id = p_booking_id;

  update purchases
    set sessions_remaining = sessions_remaining - 1
    where id = v_booking.purchase_id
    returning sessions_remaining into v_remaining;

  insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by)
  values (v_booking.purchase_id, p_booking_id, -1, 'booking_deduction', auth.uid());

  -- aviso a 2 créditos restantes
  select low_credits_threshold into v_threshold
    from trainer_settings where trainer_id = v_booking.trainer_id;

  if v_remaining = coalesce(v_threshold, 2) then
    insert into notifications (user_id, type, title, body, link)
    values (v_booking.client_id, 'low_credits',
            'Restam ' || v_remaining || ' sessões',
            'Renova o teu pack para continuares.',
            '/app/comprar');
  elsif v_remaining = 0 then
    insert into notifications (user_id, type, title, body, link)
    values (v_booking.client_id, 'no_credits',
            'Sem sessões disponíveis',
            'Compra um novo pack para marcar mais sessões.',
            '/app/comprar');
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- cancel_booking · cliente ou admin cancela
-- Desconta crédito se cancelamento dentro da janela e settings o exigirem
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
  v_charge boolean := false;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;
  if v_booking.status in ('cancelled', 'no_show') then return; end if;
  if v_booking.status = 'confirmed' then
    raise exception 'Não é possível cancelar uma sessão já confirmada.';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_booking.trainer_id;

  v_hours_to_session := extract(epoch from (v_booking.starts_at - now())) / 3600.0;

  -- cancelamento tardio?
  if v_settings.charge_late_cancel and v_hours_to_session < v_settings.cancellation_window_hours then
    v_charge := true;
  end if;

  update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancellation_reason = p_reason,
        credit_charged = v_charge
    where id = p_booking_id;

  if v_charge then
    update purchases
      set sessions_remaining = greatest(sessions_remaining - 1, 0)
      where id = v_booking.purchase_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_booking.purchase_id, p_booking_id, -1, 'late_cancel', auth.uid(),
            'Cancelamento com menos de ' || v_settings.cancellation_window_hours || 'h');
  end if;

  insert into notifications (user_id, type, title, body)
  values (v_booking.client_id, 'booking_cancelled', 'Marcação cancelada',
          case when v_charge
               then 'Cancelaste com menos de ' || v_settings.cancellation_window_hours || 'h — 1 sessão foi descontada.'
               else 'A tua sessão foi cancelada com sucesso.' end);
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- mark_no_show
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

  if v_settings.charge_no_show then
    update purchases
      set sessions_remaining = greatest(sessions_remaining - 1, 0)
      where id = v_booking.purchase_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by)
    values (v_booking.purchase_id, p_booking_id, -1, 'no_show', auth.uid());
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- adjust_credits · admin ajusta créditos manualmente (auditado)
-- ────────────────────────────────────────────────────────────────
create or replace function adjust_credits(
  p_purchase_id uuid,
  p_delta integer,
  p_reason text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_purchase purchases%rowtype;
begin
  select * into v_purchase from purchases where id = p_purchase_id for update;
  if not found then raise exception 'Compra não encontrada'; end if;

  update purchases
    set sessions_remaining = greatest(sessions_remaining + p_delta, 0)
    where id = p_purchase_id;

  insert into credit_transactions (purchase_id, delta, reason, created_by, notes)
  values (p_purchase_id, p_delta, 'admin_adjust', auth.uid(), p_reason);
end;
$$;
