-- ════════════════════════════════════════════════════════════════
-- 0099 · Marcação em série (recorrente) nunca é PT Dupla
--
-- Uma sessão duo tem de descontar 1 sessão a CADA conta do par; o fluxo
-- recorrente não suporta esse desconto duplo. A UI já esconde a opção
-- recorrente para sessões duplas — este guard é a defesa server-side
-- para garantir que ninguém contorna a regra "ambos precisam de crédito".
--
-- Redefine create_recurring_booking (base: 0080) só com um guard novo
-- no topo. Append-only.
-- ════════════════════════════════════════════════════════════════

create or replace function create_recurring_booking(
  p_trainer_id uuid,
  p_starts_at timestamptz,
  p_duration_min integer,
  p_sessions_count integer,
  p_session_type session_type default 'individual',
  p_client_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_client_id uuid := coalesce(p_client_id, auth.uid());
  v_settings trainer_settings%rowtype;
  v_booking_id uuid;
  v_series_id uuid;
  v_series_purchase uuid;
  v_week_purchase uuid;
  v_total_available integer;
  v_occ_starts timestamptz;
  v_occ_ends timestamptz;
  v_conflicts jsonb := '[]'::jsonb;
  v_free_weeks integer[] := array[]::integer[];
  v_booking_ids uuid[] := array[]::uuid[];
  v_trainer_profile uuid;
  v_client_name text;
  v_booked_count integer;
  v_first_free timestamptz;
  v_last_free timestamptz;
  i integer;
  v_idx integer;
  v_wk integer;
begin
  if not _is_service_or_admin() and v_client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if p_sessions_count <= 0 then
    raise exception 'Contagem de sessões tem de ser > 0';
  end if;

  -- DUO: sessões PT Dupla não podem ser marcadas em série (o desconto
  -- tem de ser feito às DUAS contas do par). Defesa server-side.
  if p_session_type = 'dupla' then
    raise exception 'Sessões PT Dupla não podem ser marcadas em série. Marca uma de cada vez.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_trainer_id::text, 0));

  select * into v_settings from trainer_settings where trainer_id = p_trainer_id;
  if not found then
    raise exception 'Trainer não encontrado';
  end if;

  if not (p_duration_min = any(v_settings.slot_durations_min)) then
    raise exception 'Duração % min não permitida.', p_duration_min;
  end if;

  if p_starts_at <= now() then
    raise exception 'A primeira marcação tem de ser no futuro.';
  end if;

  for i in 0 .. (p_sessions_count - 1) loop
    v_occ_starts := p_starts_at + (i || ' weeks')::interval;
    v_occ_ends := v_occ_starts + (p_duration_min || ' minutes')::interval;

    if exists (
      select 1 from bookings
      where trainer_id = p_trainer_id
        and status in ('booked', 'confirmed')
        and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_occ_starts, v_occ_ends, '[)')
    ) then
      v_conflicts := v_conflicts || jsonb_build_object(
        'week', i + 1, 'starts_at', v_occ_starts, 'reason', 'booking');
    elsif exists (
      select 1 from trainer_blocked_times
      where trainer_id = p_trainer_id
        and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_occ_starts, v_occ_ends, '[)')
    ) then
      v_conflicts := v_conflicts || jsonb_build_object(
        'week', i + 1, 'starts_at', v_occ_starts, 'reason', 'blocked');
    elsif is_reserved_slot_blocked(p_trainer_id, v_client_id, v_occ_starts, v_occ_ends) then
      v_conflicts := v_conflicts || jsonb_build_object(
        'week', i + 1, 'starts_at', v_occ_starts, 'reason', 'reserved');
    else
      v_free_weeks := v_free_weeks || i;
    end if;
  end loop;

  v_booked_count := coalesce(array_length(v_free_weeks, 1), 0);

  if v_booked_count = 0 then
    return jsonb_build_object(
      'ok', false,
      'series_id', null,
      'booking_ids', '[]'::jsonb,
      'conflicts', v_conflicts,
      'booked_count', 0,
      'requested_count', p_sessions_count
    );
  end if;

  v_first_free := p_starts_at + (v_free_weeks[1] || ' weeks')::interval;

  select coalesce(sum(sessions_remaining), 0) into v_total_available
  from purchases
  where client_id = v_client_id
    and trainer_id = p_trainer_id
    and status = 'confirmed'
    and session_type = p_session_type
    and sessions_remaining > 0
    and (expires_at is null or expires_at > v_first_free);

  if v_total_available < v_booked_count then
    for v_idx in (v_total_available + 1) .. v_booked_count loop
      v_wk := v_free_weeks[v_idx];
      v_conflicts := v_conflicts || jsonb_build_object(
        'week', v_wk + 1,
        'starts_at', p_starts_at + (v_wk || ' weeks')::interval,
        'reason', 'no_credit');
    end loop;
    v_free_weeks := v_free_weeks[1 : greatest(v_total_available, 0)];
    v_booked_count := coalesce(array_length(v_free_weeks, 1), 0);
  end if;

  if v_booked_count = 0 then
    return jsonb_build_object(
      'ok', false,
      'series_id', null,
      'booking_ids', '[]'::jsonb,
      'conflicts', v_conflicts,
      'booked_count', 0,
      'requested_count', p_sessions_count
    );
  end if;

  v_last_free := p_starts_at + (v_free_weeks[array_upper(v_free_weeks, 1)] || ' weeks')::interval;

  select id into v_series_purchase
  from purchases
  where client_id = v_client_id
    and trainer_id = p_trainer_id
    and status = 'confirmed'
    and session_type = p_session_type
    and sessions_remaining > 0
    and (expires_at is null or expires_at > v_first_free)
  order by coalesce(expires_at, 'infinity'::timestamptz) asc, created_at asc
  limit 1;

  insert into booking_series (
    client_id, trainer_id, purchase_id, session_type,
    duration_min, first_starts_at, last_starts_at, status
  ) values (
    v_client_id, p_trainer_id, v_series_purchase, p_session_type,
    p_duration_min, v_first_free, v_last_free, 'active'
  ) returning id into v_series_id;

  foreach i in array v_free_weeks loop
    v_occ_starts := p_starts_at + (i || ' weeks')::interval;
    v_occ_ends := v_occ_starts + (p_duration_min || ' minutes')::interval;

    v_week_purchase := null;
    update purchases
      set sessions_remaining = sessions_remaining - 1
      where id = (
        select id from purchases
        where client_id = v_client_id
          and trainer_id = p_trainer_id
          and status = 'confirmed'
          and session_type = p_session_type
          and sessions_remaining > 0
          and (expires_at is null or expires_at > v_occ_starts)
        order by coalesce(expires_at, 'infinity'::timestamptz) asc, created_at asc
        limit 1
        for update
      )
      returning id into v_week_purchase;

    if v_week_purchase is null then
      v_conflicts := v_conflicts || jsonb_build_object(
        'week', i + 1,
        'starts_at', v_occ_starts,
        'reason', 'no_credit');
      continue;
    end if;

    -- Sempre confirmed (decisão de produto). confirmed_at/by preenchidos.
    insert into bookings (
      client_id, trainer_id, purchase_id, series_id, session_type,
      starts_at, ends_at, status, credit_charged,
      confirmed_at, confirmed_by
    ) values (
      v_client_id, p_trainer_id, v_week_purchase, v_series_id, p_session_type,
      v_occ_starts, v_occ_ends, 'confirmed', true,
      now(), v_client_id
    ) returning id into v_booking_id;

    v_booking_ids := v_booking_ids || v_booking_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_week_purchase, v_booking_id, -1, 'booking_deduction', v_client_id, 'Recorrente · sem ' || (i + 1));
  end loop;

  v_booked_count := coalesce(array_length(v_booking_ids, 1), 0);

  if v_booked_count = 0 then
    delete from booking_series where id = v_series_id;
    return jsonb_build_object(
      'ok', false,
      'series_id', null,
      'booking_ids', '[]'::jsonb,
      'conflicts', v_conflicts,
      'booked_count', 0,
      'requested_count', p_sessions_count
    );
  end if;

  update booking_series
    set last_starts_at = (
      select max(starts_at) from bookings where series_id = v_series_id
    )
    where id = v_series_id;

  insert into notifications (user_id, type, title, body, link)
  values (v_client_id, 'booking_created',
          'Marcações recorrentes criadas',
          'Foram marcadas ' || v_booked_count || ' de ' || p_sessions_count ||
            ' sessões semanais. Vê o teu histórico.',
          '/app/agenda');

  select profile_id into v_trainer_profile from trainers where id = p_trainer_id;
  select full_name into v_client_name from profiles where id = v_client_id;
  if v_trainer_profile is not null then
    insert into notifications (user_id, type, title, body, link)
    values (v_trainer_profile, 'booking_created_admin',
            'Nova série recorrente',
            coalesce(v_client_name, 'Cliente') || ' marcou ' || v_booked_count || ' de ' ||
              p_sessions_count || ' sessões semanais a começar ' ||
              to_char(v_first_free at time zone 'Europe/Lisbon', 'DD/MM HH24:MI') || '.',
            '/admin/agenda');
  end if;

  return jsonb_build_object(
    'ok', true,
    'series_id', v_series_id,
    'booking_ids', to_jsonb(v_booking_ids),
    'conflicts', v_conflicts,
    'booked_count', v_booked_count,
    'requested_count', p_sessions_count
  );
end;
$$;

revoke all on function create_recurring_booking(uuid, timestamptz, integer, integer, session_type, uuid) from public, anon;
grant execute on function create_recurring_booking(uuid, timestamptz, integer, integer, session_type, uuid) to authenticated, service_role;
