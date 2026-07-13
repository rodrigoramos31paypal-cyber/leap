-- ════════════════════════════════════════════════════════════════
-- 0100 · Sessão PT Dupla EXIGE contas ligadas (par duo activo)
--
-- Antes: um cliente com pack PT Dupla mas SEM par ligado conseguia
-- marcar uma sessão dupla "a solo" (descontava só a ele). Agora não:
-- marcar PT Dupla exige um par duo activo. Sem ligação → recusa, mesmo
-- que já tenha comprado o pack. O admin liga as duas contas primeiro.
--
-- Redefine create_booking / create_booking_admin (base: 0098) só com o
-- guard novo. Append-only.
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
  v_status booking_status;
  v_local_start timestamp := p_starts_at at time zone 'Europe/Lisbon';
  v_local_end timestamp := v_ends_at at time zone 'Europe/Lisbon';
  -- DUO
  v_session_type session_type := p_session_type;
  v_partner uuid;
  v_partner_purchase_id uuid;
  v_partner_remaining integer;
begin
  if not _is_service_or_admin() and v_client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_trainer_id::text, 0));

  select * into v_settings from trainer_settings where trainer_id = p_trainer_id;
  if not found then
    raise exception 'Trainer não encontrado';
  end if;

  -- DUO: a sessão só conta para as duas contas quando o cliente marca
  -- COM créditos duplos (p_session_type = 'dupla') E tem um par activo.
  -- Uma sessão individual (mesmo estando ligado) é normal e só o desconta
  -- a ele. Um pack 'dupla' sem par ligado também é uma sessão de uma
  -- pessoa (comportamento já existente).
  if p_session_type = 'dupla' then
    v_partner := duo_partner_of(v_client_id);
    if v_partner is null then
      raise exception 'As contas não estão ligadas. Pede ao teu treinador para ligar as duas contas antes de marcar uma sessão PT Dupla.';
    end if;
  end if;

  v_purchase_id := pick_purchase_for_booking(v_client_id, v_session_type, p_trainer_id);
  if v_purchase_id is null then
    if v_session_type = 'dupla' then
      raise exception 'Sem sessões duplas para este treinador. Compra um pack PT Dupla deste treinador para marcar.';
    else
      raise exception 'Sem sessões para este treinador. Compra um pack deste treinador para marcar.';
    end if;
  end if;

  -- DUO: o par também precisa de uma sessão dupla disponível.
  if v_partner is not null then
    v_partner_purchase_id := pick_purchase_for_booking(v_partner, 'dupla', p_trainer_id);
    if v_partner_purchase_id is null then
      raise exception 'A conta ligada não tem sessões duplas disponíveis para este treinador.';
    end if;
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
    select 1 from trainer_recurring_blocks rb
    where rb.trainer_id = p_trainer_id
      and rb.active
      and rb.day_of_week = extract(dow from v_local_start)::int
      and rb.start_time < v_local_end::time
      and rb.end_time > v_local_start::time
      and not exists (
        select 1 from trainer_recurring_block_skips s
        where s.trainer_id = p_trainer_id
          and s.skip_date = v_local_start::date
      )
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
    confirmed_at, confirmed_by,
    partner_client_id, partner_purchase_id           -- DUO
  ) values (
    v_client_id, p_trainer_id, v_purchase_id, v_session_type,
    p_starts_at, v_ends_at, v_status, true,
    case when v_settings.auto_confirm_bookings then now() else null end,
    case when v_settings.auto_confirm_bookings then v_client_id else null end,
    v_partner, v_partner_purchase_id                 -- DUO
  )
  returning id into v_booking_id;

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

  -- DUO: desconta também ao par.
  if v_partner is not null then
    update purchases
      set sessions_remaining = sessions_remaining - 1
      where id = v_partner_purchase_id
        and sessions_remaining > 0
      returning sessions_remaining into v_partner_remaining;

    if v_partner_remaining is null then
      raise exception 'Sem sessões disponíveis para descontar à conta ligada.' using errcode = '23514';
    end if;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by)
    values (v_partner_purchase_id, v_booking_id, -1, 'booking_deduction', v_client_id);
  end if;

  insert into notifications (user_id, type, title, body, link)
  values (v_client_id, 'booking_created',
          case when v_settings.auto_confirm_bookings then 'Marcação confirmada'
               else 'Marcação a aguardar aceitação' end,
          case when v_settings.auto_confirm_bookings
               then 'A tua sessão está marcada e confirmada.'
               else 'A tua marcação está pendente. O trainer vai aceitar em breve.' end,
          '/app/sessao/' || v_booking_id);

  -- DUO: notifica o par de que ficou com uma sessão marcada.
  if v_partner is not null then
    insert into notifications (user_id, type, title, body, link)
    values (v_partner, 'booking_created',
            case when v_settings.auto_confirm_bookings then 'Sessão duo confirmada'
                 else 'Sessão duo a aguardar aceitação' end,
            'A tua conta ligada marcou uma sessão duo — também conta para ti.',
            '/app/sessao/' || v_booking_id);
  end if;

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

revoke all on function create_booking(uuid, timestamptz, integer, session_type, uuid) from public, anon;
grant execute on function create_booking(uuid, timestamptz, integer, session_type, uuid) to authenticated, service_role;

create or replace function create_booking_admin(
  p_trainer_id uuid,
  p_starts_at timestamptz,
  p_duration_min integer,
  p_session_type session_type default 'individual',
  p_client_id uuid default null,
  p_deduct boolean default true
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_ends_at timestamptz := p_starts_at + (p_duration_min || ' minutes')::interval;
  v_purchase_id uuid;
  v_booking_id uuid;
  v_settings trainer_settings%rowtype;
  v_remaining integer;
  v_status booking_status;
  v_actor uuid := auth.uid();
  v_when text := to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');
  -- DUO
  v_session_type session_type := p_session_type;
  v_partner uuid;
  v_partner_purchase_id uuid;
  v_partner_remaining integer;
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'Cliente em falta.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_trainer_id::text, 0));

  select * into v_settings from trainer_settings where trainer_id = p_trainer_id;
  if not found then
    raise exception 'Trainer não encontrado';
  end if;

  if p_starts_at <= now() then
    raise exception 'A marcação tem de ser no futuro.';
  end if;

  if not (p_duration_min = any(v_settings.slot_durations_min)) then
    raise exception 'Duração % min não permitida.', p_duration_min;
  end if;

  if exists (
    select 1 from bookings
    where trainer_id = p_trainer_id
      and status in ('booked', 'confirmed')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Já existe uma marcação neste horário.';
  end if;

  if is_reserved_slot_blocked(p_trainer_id, p_client_id, p_starts_at, v_ends_at) then
    raise exception 'Horário reservado para outro cliente.';
  end if;

  -- DUO: partilhada só quando o admin marca uma sessão DUPLA e o cliente
  -- tem par activo. (Sessão individual não toca no par, mesmo ligado.)
  if p_session_type = 'dupla' then
    v_partner := duo_partner_of(p_client_id);
    if v_partner is null then
      raise exception 'As contas não estão ligadas. Liga as duas contas (Par Duo) antes de marcar uma sessão PT Dupla.';
    end if;
  end if;

  if p_deduct then
    v_purchase_id := pick_purchase_for_booking(p_client_id, v_session_type, p_trainer_id);
    if v_purchase_id is null then
      raise exception 'Sem sessões para descontar. Marca como sessão grátis ou atribui um pack ao cliente.'
        using errcode = 'P0001';
    end if;
    if v_partner is not null then
      v_partner_purchase_id := pick_purchase_for_booking(v_partner, 'dupla', p_trainer_id);
      if v_partner_purchase_id is null then
        raise exception 'A conta ligada não tem sessões duplas. Marca como sessão grátis ou atribui um pack duo.'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  v_status := case when v_settings.auto_confirm_bookings then 'confirmed'::booking_status
                   else 'booked'::booking_status end;

  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status, credit_charged,
    confirmed_at, confirmed_by,
    partner_client_id, partner_purchase_id           -- DUO
  ) values (
    p_client_id, p_trainer_id, v_purchase_id, v_session_type,
    p_starts_at, v_ends_at, v_status, (v_purchase_id is not null),
    case when v_settings.auto_confirm_bookings then now() else null end,
    case when v_settings.auto_confirm_bookings then coalesce(v_actor, p_client_id) else null end,
    v_partner, v_partner_purchase_id                 -- DUO
  )
  returning id into v_booking_id;

  if v_purchase_id is not null then
    update purchases
      set sessions_remaining = sessions_remaining - 1
      where id = v_purchase_id
        and sessions_remaining > 0
      returning sessions_remaining into v_remaining;

    if v_remaining is null then
      raise exception 'Sem sessões disponíveis para descontar.' using errcode = '23514';
    end if;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by)
    values (v_purchase_id, v_booking_id, -1, 'booking_deduction', coalesce(v_actor, p_client_id));
  end if;

  -- DUO: desconta ao par (só quando há desconto e há pack do par).
  if v_partner_purchase_id is not null then
    update purchases
      set sessions_remaining = sessions_remaining - 1
      where id = v_partner_purchase_id
        and sessions_remaining > 0
      returning sessions_remaining into v_partner_remaining;

    if v_partner_remaining is null then
      raise exception 'Sem sessões disponíveis para descontar à conta ligada.' using errcode = '23514';
    end if;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by)
    values (v_partner_purchase_id, v_booking_id, -1, 'booking_deduction', coalesce(v_actor, p_client_id));
  end if;

  insert into notifications (user_id, type, title, body, link)
  values (p_client_id, 'booking_created',
          'Sessão marcada pelo treinador',
          'O teu treinador marcou-te uma sessão para ' || v_when || '.',
          '/app/sessao/' || v_booking_id);

  -- DUO: notifica o par.
  if v_partner is not null then
    insert into notifications (user_id, type, title, body, link)
    values (v_partner, 'booking_created',
            'Sessão duo marcada pelo treinador',
            'O teu treinador marcou uma sessão duo para ' || v_when || ' — também conta para ti.',
            '/app/sessao/' || v_booking_id);
  end if;

  return v_booking_id;
end;
$$;

revoke all on function create_booking_admin(uuid, timestamptz, integer, session_type, uuid, boolean) from public, anon;
grant execute on function create_booking_admin(uuid, timestamptz, integer, session_type, uuid, boolean) to authenticated, service_role;
