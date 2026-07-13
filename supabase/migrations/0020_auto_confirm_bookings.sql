-- ════════════════════════════════════════════════════════════════
-- 0020 · Auto-confirmar marcações
--
-- Adiciona a configuração `auto_confirm_bookings` em trainer_settings.
-- Quando true (default), o cliente faz a marcação e ela já fica com
-- status = 'confirmed' (sem precisar de aprovação do trainer).
-- Quando false, a marcação fica com status = 'booked' até o trainer
-- carregar em "Aceitar" / "Confirmar".
--
-- Nota: o botão "✓ Presente" do trainer na agenda continua a existir
-- e a sua semântica passa a ser "marcar que a sessão aconteceu" (após
-- a hora). Para isso, este migration NÃO altera `confirm_booking_attendance`.
-- ════════════════════════════════════════════════════════════════

alter table trainer_settings
  add column if not exists auto_confirm_bookings boolean not null default true;

-- Actualiza create_booking para respeitar a definição
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
begin
  if not _is_service_or_admin() and v_client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

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

  -- Status inicial depende da configuração
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

  update purchases
    set sessions_remaining = sessions_remaining - 1
    where id = v_purchase_id
    returning sessions_remaining into v_remaining;

  insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by)
  values (v_purchase_id, v_booking_id, -1, 'booking_deduction', v_client_id);

  insert into notifications (user_id, type, title, body, link)
  values (v_client_id, 'booking_created',
          case when v_settings.auto_confirm_bookings then 'Marcação confirmada'
               else 'Marcação a aguardar aceitação' end,
          case when v_settings.auto_confirm_bookings
               then 'A tua sessão está marcada e confirmada.'
               else 'A tua marcação está pendente. O trainer vai aceitar em breve.' end,
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
            coalesce(v_client_name, 'Cliente') || ' marcou uma sessão para ' ||
              to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM HH24:MI') || '.',
            '/admin/agenda');
  end if;

  -- Também notifica todos os owners (caso o owner não seja o trainer)
  insert into notifications (user_id, type, title, body, link)
  select p.id, 'booking_created_admin',
         'Nova marcação',
         coalesce(v_client_name, 'Cliente') || ' marcou uma sessão para ' ||
           to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM HH24:MI') || '.',
         '/admin/agenda'
  from profiles p
  where p.role = 'owner'
    and (v_trainer_profile is null or p.id <> v_trainer_profile);

  return v_booking_id;
end;
$$;
