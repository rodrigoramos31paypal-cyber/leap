-- ════════════════════════════════════════════════════════════════
-- 0037_enrich_booking_notifications
--
-- Enriquece o TEXTO das notificações de marcação com a data/hora da
-- sessão (e primeiro nome do cliente nas notificações para o trainer).
-- Como o push lê directamente de notifications.body, isto melhora o
-- sino E o web push de uma só vez.
--
-- Redefine 3 funções, copiando o corpo actual VERBATIM (0025 / 0027) e
-- alterando APENAS as linhas de `insert into notifications`. Toda a
-- lógica de créditos/refund/locking/autorização fica igual.
--
-- Bónus: cancel_booking passa a incluir `link` na notificação (antes
-- não tinha), ficando estruturalmente igual às restantes.
--
-- Formato de data: DD/MM "às" HH24:MI no fuso Europe/Lisbon.
--
-- REVERT: reaplicar 0025 (create_booking) e 0027 (cancel_booking,
-- confirm_booking_attendance).
-- ════════════════════════════════════════════════════════════════

-- ── create_booking (base: 0025) ───────────────────────────────────
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
  v_status booking_status;
  v_when text := to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');
begin
  -- ── Autorização ───────────────────────────────────────────────
  if not _is_service_or_admin() and v_client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  -- ── SEC: serializa marcações por trainer ──────────────────────
  perform pg_advisory_xact_lock(hashtextextended(p_trainer_id::text, 0));

  select * into v_settings from trainer_settings where trainer_id = p_trainer_id;
  if not found then
    raise exception 'Trainer não encontrado';
  end if;

  v_purchase_id := pick_purchase_for_booking(v_client_id, p_session_type, p_trainer_id);
  if v_purchase_id is null then
    raise exception 'Sem sessões para este treinador. Compra um pack deste treinador para marcar.';
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

  if is_reserved_slot_blocked(p_trainer_id, v_client_id, p_starts_at, v_ends_at) then
    raise exception 'Horário reservado para outro cliente.';
  end if;

  v_status := case when v_settings.auto_confirm_bookings then 'confirmed'::booking_status
                   else 'booked'::booking_status end;

  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status, credit_charged,
    confirmed_at, confirmed_by
  ) values (
    v_client_id, p_trainer_id, v_purchase_id, p_session_type,
    p_starts_at, v_ends_at, v_status, true,
    case when v_settings.auto_confirm_bookings then now() else null end,
    case when v_settings.auto_confirm_bookings then v_client_id else null end
  )
  returning id into v_booking_id;

  -- ── SEC: desconto defensivo ───────────────────────────────────
  update purchases
    set sessions_remaining = sessions_remaining - 1
    where id = v_purchase_id
      and sessions_remaining > 0
    returning sessions_remaining into v_remaining;

  if v_remaining is null then
    raise exception 'Sem sessões disponíveis para descontar.' using errcode = '23514';
  end if;

  insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by)
  values (v_purchase_id, v_booking_id, -1, 'booking_deduction', v_client_id);

  insert into notifications (user_id, type, title, body, link)
  values (v_client_id, 'booking_created',
          case when v_settings.auto_confirm_bookings then 'Marcação confirmada'
               else 'Marcação a aguardar aceitação' end,
          case when v_settings.auto_confirm_bookings
               then 'A tua sessão de ' || v_when || ' está marcada e confirmada.'
               else 'A tua sessão de ' || v_when || ' está pendente. O trainer vai aceitar em breve.' end,
          '/app/agenda');

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
            split_part(coalesce(v_client_name, 'Cliente'), ' ', 1) || ' marcou uma sessão para ' ||
              v_when || '.',
            '/admin/agenda');
  end if;

  -- Também notifica todos os owners (caso o owner não seja o trainer)
  insert into notifications (user_id, type, title, body, link)
  select p.id, 'booking_created_admin',
         'Nova marcação',
         split_part(coalesce(v_client_name, 'Cliente'), ' ', 1) || ' marcou uma sessão para ' ||
           v_when || '.',
         '/admin/agenda'
  from profiles p
  where p.role = 'owner'
    and (v_trainer_profile is null or p.id <> v_trainer_profile);

  return v_booking_id;
end;
$$;

-- ── cancel_booking (base: 0027) ───────────────────────────────────
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
  v_when text;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  v_when := to_char(v_booking.starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');

  -- ── Autorização ───────────────────────────────────────────────
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
      'A tua sessão de ' || v_when || ' foi cancelada pelo trainer e foi devolvida à tua conta.'
      || case when v_user_reason is not null
              then ' Motivo: ' || v_user_reason
              else '' end;
  else
    v_notif_body := case
      when not v_refund then
        'A tua sessão de ' || v_when || ' foi cancelada com menos de '
        || v_settings.cancellation_window_hours || 'h — 1 sessão foi descontada.'
      else
        'A tua sessão de ' || v_when || ' foi cancelada e foi devolvida à tua conta.'
    end;
  end if;

  insert into notifications (user_id, type, title, body, link)
  values (v_booking.client_id, 'booking_cancelled', 'Marcação cancelada', v_notif_body, '/app/historico');
end;
$$;

-- ── confirm_booking_attendance (base: 0027) ───────────────────────
create or replace function confirm_booking_attendance(p_booking_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_when text;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  v_when := to_char(v_booking.starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');

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
          'A tua sessão de ' || v_when || ' foi confirmada pelo treinador.',
          '/app/historico');
end;
$$;
