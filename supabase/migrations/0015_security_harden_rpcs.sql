-- ════════════════════════════════════════════════════════════════
-- 0015 · Endurecimento de segurança das funções SECURITY DEFINER
--
-- Estas funções correm como dono (bypass de RLS) e estão expostas via
-- PostgREST a qualquer utilizador autenticado. Antes não validavam o
-- caller, o que permitia que um cliente malicioso chamasse, p.ex.,
-- `adjust_credits` ou `confirm_purchase` directamente do browser e
-- ganhasse créditos infinitos.
--
-- Política implementada:
--  • Funções "só admin"  →  is_admin() OBRIGATÓRIO (ou service_role)
--  • Funções "próprio ou admin"  →  caller = client_id OU is_admin()
--  • service_role (webhooks, jobs) passa sempre  →  auth.uid() = NULL
--
-- IMPORTANTE: cada função abaixo replica o corpo da versão mais
-- recente das migrações anteriores e apenas acrescenta a verificação
-- de autorização no topo. Não há alterações funcionais.
-- ════════════════════════════════════════════════════════════════

-- Helper: deve a chamada actual ser tratada como service-role / job?
-- auth.uid() devolve NULL quando o JWT é service_role.
create or replace function _is_service_or_admin()
returns boolean
language sql stable security definer
as $$
  select auth.uid() is null or is_admin();
$$;

-- ────────────────────────────────────────────────────────────────
-- confirm_purchase · só admin/webhook (body = 0002)
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
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

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

  insert into credit_transactions (purchase_id, delta, reason, created_by, notes)
  values (p_purchase_id, v_purchase.sessions_total, 'purchase',
          coalesce(p_confirmed_by, auth.uid()),
          'Pack confirmado');

  update payments
    set status = 'paid',
        paid_at = now()
    where purchase_id = p_purchase_id and status = 'pending';

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
-- reject_purchase · só admin (body = 0002)
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
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

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
-- adjust_credits · só admin (CRÍTICO — antes permitia créditos infinitos)
-- (body = 0002)
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
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_purchase from purchases where id = p_purchase_id for update;
  if not found then raise exception 'Compra não encontrada'; end if;

  update purchases
    set sessions_remaining = greatest(sessions_remaining + p_delta, 0)
    where id = p_purchase_id;

  insert into credit_transactions (purchase_id, delta, reason, created_by, notes)
  values (p_purchase_id, p_delta, 'admin_adjust', auth.uid(), p_reason);
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- confirm_booking_attendance · só admin (body = 0005)
-- ────────────────────────────────────────────────────────────────
create or replace function confirm_booking_attendance(p_booking_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

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

  insert into notifications (user_id, type, title, body, link)
  values (v_booking.client_id, 'booking_confirmed',
          'Presença confirmada',
          'A tua sessão foi confirmada pelo treinador.',
          '/app/historico');
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- mark_no_show · só admin (body = 0005)
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
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

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

-- ────────────────────────────────────────────────────────────────
-- cancel_booking · cliente da própria marcação OU admin (body = 0008)
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

  -- autorização: cliente da própria marcação OU admin/service
  if not _is_service_or_admin() and v_booking.client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_booking.status in ('cancelled', 'no_show') then return; end if;

  if v_booking.starts_at <= now() then
    raise exception 'Não é possível cancelar uma sessão que já decorreu.';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_booking.trainer_id;

  v_hours_to_session := extract(epoch from (v_booking.starts_at - now())) / 3600.0;

  if v_settings.charge_late_cancel and v_hours_to_session < v_settings.cancellation_window_hours then
    v_refund := false;
  end if;

  update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancellation_reason = p_reason,
        confirmed_at = null,
        confirmed_by = null,
        credit_charged = not v_refund
    where id = p_booking_id;

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
-- create_booking · cliente para si próprio OU admin para qualquer cliente
-- (antes: qualquer cliente podia marcar em nome de outro consumindo
--  os créditos dele.)
-- (body = 0011)
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
  v_trainer_profile uuid;
  v_client_name text;
  v_remaining integer;
  v_threshold integer;
begin
  -- autorização: cliente só pode marcar para si próprio
  if not _is_service_or_admin() and v_client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_settings from trainer_settings where trainer_id = p_trainer_id;
  if not found then
    raise exception 'Trainer não encontrado';
  end if;

  v_purchase_id := pick_purchase_for_booking(v_client_id, p_session_type, p_trainer_id);
  if v_purchase_id is null then
    raise exception 'Sem créditos para este treinador. Compra um pack deste treinador para marcar.';
  end if;

  if p_starts_at <= now() then
    raise exception 'A marcação tem de ser no futuro.';
  end if;

  if not (p_duration_min = any(v_settings.slot_durations_min)) then
    raise exception 'Duração % min não permitida.', p_duration_min;
  end if;

  if exists (
    select 1 from trainer_blocked_times
    where trainer_id = p_trainer_id
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Horário não disponível (bloqueado).';
  end if;

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
    starts_at, ends_at, status, credit_charged
  ) values (
    v_client_id, p_trainer_id, v_purchase_id, p_session_type,
    p_starts_at, v_ends_at, 'booked', true
  )
  returning id into v_booking_id;

  update purchases
    set sessions_remaining = sessions_remaining - 1
    where id = v_purchase_id
    returning sessions_remaining into v_remaining;

  insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by)
  values (v_purchase_id, v_booking_id, -1, 'booking_deduction', v_client_id);

  insert into notifications (user_id, type, title, body, link)
  values (v_client_id, 'booking_created', 'Marcação criada',
          'A tua sessão foi marcada. Crédito descontado.', '/app/agenda');

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
-- create_purchase · cliente para si próprio OU admin (body = 0002)
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
  -- autorização: cliente só pode comprar em nome próprio
  if not _is_service_or_admin() and v_client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_pack from packs where id = p_pack_id and active = true;
  if not found then
    raise exception 'Pack não encontrado ou inativo';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_pack.trainer_id;

  if not exists (select 1 from profiles where id = v_client_id) then
    raise exception 'Cliente inválido';
  end if;

  v_validity_days := coalesce(v_pack.validity_days, v_settings.default_pack_validity_days);
  if v_validity_days is not null then
    v_expires_at := now() + (v_validity_days || ' days')::interval;
  end if;

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
    v_pack.sessions,
    v_pack.price_cents,
    v_status,
    p_payment_method,
    v_expires_at
  )
  returning id into v_purchase_id;

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
