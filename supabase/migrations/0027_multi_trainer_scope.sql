-- ════════════════════════════════════════════════════════════════
-- 0027 · Scope check multi-trainer (C4 do audit de segurança)
--
-- Antes: as RPCs SECURITY DEFINER que mexem em bookings/purchases
-- verificavam apenas `is_admin()` (trainer OU owner). Num estúdio
-- com vários trainers, trainer A podia chamar `cancel_booking` /
-- `confirm_booking_attendance` / `adjust_credits` / etc. com IDs
-- pertencentes a trainer B e a função aceitava (porque ambos são
-- "admins").
--
-- Esta migração introduz `_trainer_is_accessible(trainer_id)` e
-- aplica-o em todas as RPCs onde um admin manipula recursos de um
-- trainer específico:
--
--   • cancel_booking (de 0022)
--   • confirm_booking_attendance (de 0015)
--   • mark_no_show (de 0015)
--   • confirm_purchase (de 0015)
--   • reject_purchase (de 0015)
--   • adjust_credits (de 0015)
--   • create_purchase (de 0015) — só quando admin grant para outro client
--   • create_custom_purchase (de 0021)
--
-- Regras:
--   • Service role (auth.uid() IS NULL) → sempre acessível (webhooks/jobs)
--   • owner → acesso a qualquer trainer
--   • trainer → acesso só ao seu próprio (trainers.profile_id = auth.uid())
--   • cliente → não passa pelo helper (auth check separado mantém o caso
--     "cliente cancela própria marcação")
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- Helper: o caller pode mexer em recursos deste trainer?
-- ────────────────────────────────────────────────────────────────
create or replace function _trainer_is_accessible(p_trainer_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    -- service role: sem auth.uid()
    auth.uid() is null
    -- owner: vê tudo
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
    -- trainer: só o seu próprio
    or exists (
      select 1 from trainers t
      where t.id = p_trainer_id and t.profile_id = auth.uid()
    ),
    false
  )
$$;

comment on function _trainer_is_accessible(uuid) is
  'C4 hardening: devolve true se o utilizador autenticado pode manipular recursos do trainer indicado. Service role e owners têm acesso total; trainers individuais só têm acesso ao seu próprio registo.';

-- ════════════════════════════════════════════════════════════════
-- cancel_booking · admin caller tem de ter acesso ao trainer
-- (body baseado em 0022_cancel_notification_reason.sql)
-- ════════════════════════════════════════════════════════════════
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
  v_by_admin boolean;
  v_user_reason text;
  v_notif_body text;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  -- ── Autorização ───────────────────────────────────────────────
  -- 1) service role (auth.uid() NULL) → ok
  -- 2) cliente da própria marcação → ok
  -- 3) admin → tem de ter acesso ao trainer da marcação (C4)
  -- 4) qualquer outro → 42501
  if auth.uid() is null then
    null; -- service: ok
  elsif v_booking.client_id = auth.uid() then
    null; -- cliente cancela própria marcação: ok
  elsif is_admin() then
    if not _trainer_is_accessible(v_booking.trainer_id) then
      raise exception 'access denied' using errcode = '42501';
    end if;
  else
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_booking.status in ('cancelled', 'no_show') then return; end if;

  if v_booking.starts_at <= now() then
    raise exception 'Não é possível cancelar uma sessão que já decorreu.';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_booking.trainer_id;

  v_hours_to_session := extract(epoch from (v_booking.starts_at - now())) / 3600.0;

  v_by_admin := auth.uid() is null
                or _is_service_or_admin()
                or auth.uid() <> v_booking.client_id;

  if not v_by_admin
     and v_settings.charge_late_cancel
     and v_hours_to_session < v_settings.cancellation_window_hours then
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

  if v_by_admin and p_reason is not null then
    if position('—' in p_reason) > 0 then
      v_user_reason := trim(both ' ' from split_part(p_reason, '—', 2));
    else
      v_user_reason := p_reason;
    end if;
    if v_user_reason = '' then
      v_user_reason := null;
    end if;
  end if;

  if v_by_admin then
    v_notif_body :=
      'A tua sessão foi cancelada pelo trainer e foi devolvida à tua conta.'
      || case when v_user_reason is not null
              then ' Motivo: ' || v_user_reason
              else '' end;
  else
    v_notif_body := case
      when not v_refund then
        'Cancelaste com menos de ' || v_settings.cancellation_window_hours
        || 'h — 1 sessão foi descontada.'
      else
        'A tua sessão foi cancelada e foi devolvida à tua conta.'
    end;
  end if;

  insert into notifications (user_id, type, title, body)
  values (v_booking.client_id, 'booking_cancelled', 'Marcação cancelada', v_notif_body);
end;
$$;

-- ════════════════════════════════════════════════════════════════
-- confirm_booking_attendance · só admin com acesso ao trainer
-- (body baseado em 0015_security_harden_rpcs.sql)
-- ════════════════════════════════════════════════════════════════
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

  -- ── Autorização (C4) ──────────────────────────────────────────
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if auth.uid() is not null and not _trainer_is_accessible(v_booking.trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

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

-- ════════════════════════════════════════════════════════════════
-- mark_no_show · só admin com acesso ao trainer
-- (body baseado em 0015)
-- ════════════════════════════════════════════════════════════════
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

  -- ── Autorização (C4) ──────────────────────────────────────────
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if auth.uid() is not null and not _trainer_is_accessible(v_booking.trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

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

-- ════════════════════════════════════════════════════════════════
-- confirm_purchase · só admin com acesso ao trainer da purchase
-- (body baseado em 0015)
-- ════════════════════════════════════════════════════════════════
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

  -- ── C4 scope check ────────────────────────────────────────────
  if auth.uid() is not null and not _trainer_is_accessible(v_purchase.trainer_id) then
    raise exception 'access denied' using errcode = '42501';
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

-- ════════════════════════════════════════════════════════════════
-- reject_purchase · só admin com acesso ao trainer da purchase
-- (body baseado em 0015)
-- ════════════════════════════════════════════════════════════════
create or replace function reject_purchase(
  p_purchase_id uuid,
  p_reason text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_purchase purchases%rowtype;
  v_client_id uuid;
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  -- Carrega para validar scope antes de mexer
  select * into v_purchase from purchases where id = p_purchase_id;
  if not found then
    raise exception 'Compra não encontrada';
  end if;

  if auth.uid() is not null and not _trainer_is_accessible(v_purchase.trainer_id) then
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

-- ════════════════════════════════════════════════════════════════
-- adjust_credits · só admin com acesso ao trainer da purchase
-- (body baseado em 0015)
-- ════════════════════════════════════════════════════════════════
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

  -- ── C4 scope check ────────────────────────────────────────────
  if auth.uid() is not null and not _trainer_is_accessible(v_purchase.trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  update purchases
    set sessions_remaining = greatest(sessions_remaining + p_delta, 0)
    where id = p_purchase_id;

  insert into credit_transactions (purchase_id, delta, reason, created_by, notes)
  values (p_purchase_id, p_delta, 'admin_adjust', auth.uid(), p_reason);
end;
$$;

-- ════════════════════════════════════════════════════════════════
-- create_purchase · admin a comprar para outro cliente tem de ter
-- acesso ao trainer do pack
-- (body baseado em 0015)
-- ════════════════════════════════════════════════════════════════
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
  if not _is_service_or_admin() and v_client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_pack from packs where id = p_pack_id and active = true;
  if not found then
    raise exception 'Pack não encontrado ou inativo';
  end if;

  -- ── C4: admin a granjear para outro cliente tem de ter acesso
  -- ao trainer do pack. Self-purchase (client buying for themselves)
  -- não passa por aqui — v_client_id = auth.uid().
  if auth.uid() is not null
     and v_client_id <> auth.uid()
     and not _trainer_is_accessible(v_pack.trainer_id) then
    raise exception 'access denied' using errcode = '42501';
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

-- ════════════════════════════════════════════════════════════════
-- create_custom_purchase · admin tem de ter acesso ao trainer
-- (body baseado em 0021)
-- ════════════════════════════════════════════════════════════════
create or replace function create_custom_purchase(
  p_client_id uuid,
  p_trainer_id uuid,
  p_sessions integer,
  p_price_cents integer,
  p_session_type session_type,
  p_payment_method payment_method,
  p_name text default null,
  p_validity_days integer default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_settings trainer_settings%rowtype;
  v_purchase_id uuid;
  v_validity_days integer;
  v_expires_at timestamptz;
  v_status purchase_status;
  v_name text := coalesce(nullif(trim(p_name), ''),
                          'Avulso · ' || p_sessions || ' ' ||
                          case when p_sessions = 1 then 'sessão' else 'sessões' end);
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  -- ── C4 scope check ────────────────────────────────────────────
  if auth.uid() is not null and not _trainer_is_accessible(p_trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if p_sessions <= 0 then
    raise exception 'Número de sessões tem de ser > 0';
  end if;
  if p_price_cents < 0 then
    raise exception 'Preço não pode ser negativo';
  end if;

  if not exists (select 1 from profiles where id = p_client_id) then
    raise exception 'Cliente inválido';
  end if;
  if not exists (select 1 from trainers where id = p_trainer_id) then
    raise exception 'Trainer inválido';
  end if;

  select * into v_settings from trainer_settings where trainer_id = p_trainer_id;
  v_validity_days := coalesce(p_validity_days, v_settings.default_pack_validity_days);
  if v_validity_days is not null then
    v_expires_at := now() + (v_validity_days || ' days')::interval;
  end if;

  if p_payment_method in ('manual_mbway', 'manual_cash', 'manual_transfer', 'complimentary') then
    v_status := 'awaiting_confirmation';
  else
    v_status := 'pending_payment';
  end if;

  insert into purchases (
    client_id, trainer_id, pack_id, pack_snapshot, session_type,
    sessions_total, sessions_remaining, amount_cents, status,
    payment_method, expires_at
  ) values (
    p_client_id,
    p_trainer_id,
    null,
    jsonb_build_object(
      'name', v_name,
      'sessions', p_sessions,
      'price_cents', p_price_cents,
      'session_type', p_session_type,
      'custom', true
    ),
    p_session_type,
    p_sessions,
    p_sessions,
    p_price_cents,
    v_status,
    p_payment_method,
    v_expires_at
  )
  returning id into v_purchase_id;

  insert into payments (purchase_id, method, amount_cents, status, gateway)
  values (
    v_purchase_id,
    p_payment_method,
    p_price_cents,
    'pending',
    'manual'::payment_gateway
  );

  return v_purchase_id;
end;
$$;

-- ════════════════════════════════════════════════════════════════
-- Permissões — manter idênticas
-- ════════════════════════════════════════════════════════════════
revoke all on function _trainer_is_accessible(uuid) from public, anon;
grant execute on function _trainer_is_accessible(uuid) to authenticated, service_role;
