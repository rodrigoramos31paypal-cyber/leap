-- ════════════════════════════════════════════════════════════════
-- 0080 · Polish do workflow administrativo
--
-- 1) cancel_confirmed_purchase  → nova RPC: permite ao admin cancelar
--    uma compra JÁ confirmada (ex: aceitou por engano). A compra fica
--    com status='cancelled', perde as sessões restantes (saldo do
--    cliente desce em conformidade) e o pagamento associado fica
--    marcado como `refunded`. Aparece automaticamente no separador
--    "Rejeitados" da página de pagamentos (que já agrupa rejected +
--    cancelled).
--
-- 2) Bookings deixam de passar por "Marcada" (status=booked). O cliente
--    pediu que as sessões só possam ser: confirmed, cancelled, no_show.
--    Forçamos `confirmed` em create_booking / create_booking_admin /
--    create_recurring_booking, ignorando a flag `auto_confirm_bookings`.
--
-- 3) reschedule_booking_admin (drag-and-drop) deixa de cancelar+criar e
--    passa a fazer UPDATE in-place ao registo da marcação. Razão: o
--    fluxo antigo refundava 1 sessão à compra antiga e descontava 1
--    sessão à compra "picada" para a nova data — partia se o cliente
--    já não tivesse créditos disponíveis (mensagem "Sem sessões para
--    reagendar"). Mas reagendar é NEUTRO em créditos: a sessão é a
--    mesma, só muda de hora. Agora preservamos a `purchase_id` e o
--    `credit_charged` original, e nem a `pick_purchase_for_booking` é
--    chamada — funciona sempre, mesmo com saldo a zero.
--
-- REVERT: reaplicar 0071 + 0063 + 0020. cancel_confirmed_purchase
-- pode ser dropada — não é chamada por nada que estes migrations criem.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1) cancel_confirmed_purchase
-- ────────────────────────────────────────────────────────────────
create or replace function cancel_confirmed_purchase(
  p_purchase_id uuid,
  p_reason text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_purchase purchases%rowtype;
  v_remaining integer;
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_purchase from purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'Compra não encontrada';
  end if;

  if auth.uid() is not null and not _trainer_is_accessible(v_purchase.trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_purchase.status <> 'confirmed' then
    raise exception 'Só compras confirmadas podem ser canceladas aqui. '
                    'Para compras pendentes usa "Rejeitar".';
  end if;

  v_remaining := v_purchase.sessions_remaining;

  -- Esvaziar saldo: leva sessions_remaining a 0 e regista a operação
  -- no audit log de créditos. Bookings já marcadas com este pack ficam
  -- intactas (credit_charged=true, sessão já passou para a sessões da
  -- agenda); só o saldo POR GASTAR é que evapora.
  update purchases
    set status = 'cancelled',
        sessions_remaining = 0,
        rejection_reason = p_reason
    where id = p_purchase_id;

  if v_remaining > 0 then
    insert into credit_transactions (purchase_id, delta, reason, created_by, notes)
    values (
      p_purchase_id,
      -v_remaining,
      'refund',
      auth.uid(),
      coalesce('Cancelamento da compra confirmada — ' || p_reason,
               'Cancelamento da compra confirmada')
    );
  end if;

  -- Pagamentos associados (manual / gateway) ficam marcados como
  -- reembolsados — útil no relatório.
  update payments
    set status = 'refunded'
    where purchase_id = p_purchase_id and status = 'paid';

  insert into notifications (user_id, type, title, body, link)
  values (
    v_purchase.client_id,
    'purchase_rejected',
    'Compra cancelada',
    coalesce(p_reason, 'A tua compra foi cancelada. Contacta-nos para mais informações.'),
    '/app/historico'
  );
end;
$$;

revoke all on function cancel_confirmed_purchase(uuid, text) from public, anon;
grant execute on function cancel_confirmed_purchase(uuid, text) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────
-- 2a) create_booking · status sempre 'confirmed'
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
  v_local_start timestamp := p_starts_at at time zone 'Europe/Lisbon';
  v_local_end timestamp := v_ends_at at time zone 'Europe/Lisbon';
begin
  if not _is_service_or_admin() and v_client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

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

  -- Sempre confirmed: a flag auto_confirm_bookings é ignorada (decisão
  -- de produto — eliminar o estado "Marcada"). Mantém-se o auditoria
  -- via confirmed_at / confirmed_by.
  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status, credit_charged,
    confirmed_at, confirmed_by
  ) values (
    v_client_id, p_trainer_id, v_purchase_id, p_session_type,
    p_starts_at, v_ends_at, 'confirmed', true,
    now(), v_client_id
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

  insert into notifications (user_id, type, title, body, link)
  values (v_client_id, 'booking_created',
          'Marcação confirmada',
          'A tua sessão está marcada e confirmada.',
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


-- ────────────────────────────────────────────────────────────────
-- 2b) create_booking_admin · status sempre 'confirmed'
-- ────────────────────────────────────────────────────────────────
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
  v_actor uuid := auth.uid();
  v_when text := to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');
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

  if p_deduct then
    v_purchase_id := pick_purchase_for_booking(p_client_id, p_session_type, p_trainer_id);
    if v_purchase_id is null then
      raise exception 'Sem sessões para descontar. Marca como sessão grátis ou atribui um pack ao cliente.'
        using errcode = 'P0001';
    end if;
  end if;

  -- Sempre confirmed (decisão de produto).
  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status, credit_charged,
    confirmed_at, confirmed_by
  ) values (
    p_client_id, p_trainer_id, v_purchase_id, p_session_type,
    p_starts_at, v_ends_at, 'confirmed', (v_purchase_id is not null),
    now(), coalesce(v_actor, p_client_id)
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

  insert into notifications (user_id, type, title, body, link)
  values (p_client_id, 'booking_created',
          'Sessão marcada pelo treinador',
          'O teu treinador marcou-te uma sessão para ' || v_when || '.',
          '/app/agenda');

  return v_booking_id;
end;
$$;

revoke all on function create_booking_admin(uuid, timestamptz, integer, session_type, uuid, boolean) from public, anon;
grant execute on function create_booking_admin(uuid, timestamptz, integer, session_type, uuid, boolean) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────
-- 2c) create_recurring_booking · status sempre 'confirmed'
-- ────────────────────────────────────────────────────────────────
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


-- ────────────────────────────────────────────────────────────────
-- 3) reschedule_booking_admin · UPDATE in-place (neutro em créditos)
--
-- Antes: cancelar a antiga + criar nova. Implicava refund + nova
-- escolha de pack via pick_purchase_for_booking — falhava se o
-- cliente já não tinha saldo, dando "Sem sessões para reagendar".
--
-- Agora: UPDATE no mesmo registo. Preserva purchase_id, credit_charged
-- e status; o crédito original mantém-se afecto à sessão. Funciona
-- mesmo com saldo a zero.
--
-- Devolve o id da marcação (igual ao recebido).
-- ────────────────────────────────────────────────────────────────
drop function if exists reschedule_booking_admin(uuid, timestamptz, integer, boolean, boolean);

create or replace function reschedule_booking_admin(
  p_old_booking_id uuid,
  p_starts_at timestamptz,
  p_duration_min integer,
  p_notify_client boolean default true,
  p_force boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old bookings%rowtype;
  v_trainer uuid;
  v_client uuid;
  v_ends_at timestamptz := p_starts_at + (p_duration_min || ' minutes')::interval;
  v_actor uuid := auth.uid();
  v_when text := to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');
begin
  select * into v_old from bookings where id = p_old_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  if v_actor is not null and not (is_admin() and _trainer_is_accessible(v_old.trainer_id)) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_old.status not in ('booked', 'confirmed') then
    raise exception 'Só sessões ativas podem ser reagendadas.';
  end if;
  if v_old.starts_at <= now() then
    raise exception 'Não é possível reagendar uma sessão que já decorreu.';
  end if;

  v_trainer := v_old.trainer_id;
  v_client := v_old.client_id;

  perform pg_advisory_xact_lock(hashtextextended(v_trainer::text, 0));

  if p_starts_at <= now() then
    raise exception 'A marcação tem de ser no futuro.';
  end if;
  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 600 then
    raise exception 'A duração tem de estar entre 5 e 600 minutos.';
  end if;
  if exists (
    select 1 from trainer_blocked_times
    where trainer_id = v_trainer
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Horário não disponível (bloqueado).';
  end if;
  if not coalesce(p_force, false) and exists (
    select 1 from bookings
    where trainer_id = v_trainer
      and id <> p_old_booking_id
      and status in ('booked', 'confirmed')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Esta sessão vai sobrepor outra.' using errcode = 'P0099';
  end if;
  if is_reserved_slot_blocked(v_trainer, v_client, p_starts_at, v_ends_at) then
    raise exception 'Horário reservado para outro cliente.';
  end if;

  -- UPDATE in-place: preserva purchase_id, credit_charged, status,
  -- confirmed_at/by. Só muda o horário e a duração. Neutro em créditos:
  -- o pack que pagou a sessão original continua a pagar a sessão na
  -- nova hora. Funciona com saldo a zero.
  update bookings
    set starts_at = p_starts_at,
        ends_at = v_ends_at
    where id = p_old_booking_id;

  if p_notify_client then
    insert into notifications (user_id, type, title, body, link)
    values (v_client, 'booking_created', 'Sessão reagendada',
            'A tua sessão foi reagendada para ' || v_when || '.',
            '/app/agenda');
  end if;

  return p_old_booking_id;
end;
$$;

revoke all on function reschedule_booking_admin(uuid, timestamptz, integer, boolean, boolean) from public, anon;
grant execute on function reschedule_booking_admin(uuid, timestamptz, integer, boolean, boolean) to authenticated, service_role;
