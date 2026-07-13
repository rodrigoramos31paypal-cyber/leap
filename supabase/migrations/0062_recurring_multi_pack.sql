-- ════════════════════════════════════════════════════════════════
-- 0062 · Marcação recorrente — alocar entre VÁRIOS packs
--
-- Bug (0061): a selecção de crédito exigia UM ÚNICO pack com saldo
-- suficiente para TODAS as semanas livres
--   (`sessions_remaining >= v_booked_count` numa só compra).
-- Se o cliente tinha as sessões repartidas por mais do que um pack
-- (ex.: pack de 10 + 1 sessão avulsa = 11), nenhuma compra sozinha
-- cobria as 11 semanas → a RPC lançava
--   'Sem sessões suficientes ou pack expira antes da última semana.'
-- e a UI mostrava o erro genérico "Não foi possível marcar a série".
--
-- Correcção: aloca cada semana livre a partir das compras disponíveis,
-- pela MESMA ordem que uma marcação simples (pick_purchase_for_booking):
-- expiração mais próxima primeiro, depois mais antiga. Esgota uma compra
-- e passa à seguinte. Cada booking/credit_transaction fica ligado à
-- compra concreta de onde saiu a sessão. A série regista a primeira
-- compra usada (coluna purchase_id é NOT NULL — informativa).
--
-- Mantém tudo o resto de 0061: classificação parcial (semanas livres vs
-- conflito), advisory lock por trainer, notificações, retorno jsonb.
--
-- REVERT: reaplicar a definição de 0061_recurring_partial_booking.sql.
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
begin
  -- ── Autorização ───────────────────────────────────────────────
  if not _is_service_or_admin() and v_client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if p_sessions_count <= 0 then
    raise exception 'Contagem de sessões tem de ser > 0';
  end if;

  -- ── SEC: serializa por trainer ────────────────────────────────
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

  -- ── Fase 1 — classifica cada semana: LIVRE ou CONFLITO ────────
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

  -- ── Nenhuma semana livre → não cria nada ──────────────────────
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
  v_last_free := p_starts_at + (v_free_weeks[array_upper(v_free_weeks, 1)] || ' weeks')::interval;

  -- ── Saldo total entre TODOS os packs elegíveis ────────────────
  -- (antes exigia um único pack com saldo >= nº de semanas; agora
  -- somamos as compras utilizáveis a partir da 1ª semana livre.)
  select coalesce(sum(sessions_remaining), 0) into v_total_available
  from purchases
  where client_id = v_client_id
    and trainer_id = p_trainer_id
    and status = 'confirmed'
    and session_type = p_session_type
    and sessions_remaining > 0
    and (expires_at is null or expires_at > v_first_free);

  if v_total_available < v_booked_count then
    raise exception 'Sem sessões suficientes: % disponível(eis) para % semana(s) livre(s).',
      v_total_available, v_booked_count
      using errcode = '23514';
  end if;

  -- Primeira compra a usar (vai para o registo da série, NOT NULL).
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

  -- ── Fase 2 — cria série + bookings só nas semanas LIVRES ──────
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

    -- Aloca 1 sessão da melhor compra disponível PARA ESTA semana
    -- (mesma ordem do pick_purchase_for_booking) e desconta-a já.
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
      -- Defesa: o pré-cheque garante saldo total, mas um pack pode
      -- expirar antes de uma semana específica. Aborta a série inteira
      -- (transacção faz rollback) com mensagem clara.
      raise exception 'Sem sessões válidas para a semana % (pack pode expirar antes dessa data).',
        i + 1
        using errcode = '23514';
    end if;

    insert into bookings (
      client_id, trainer_id, purchase_id, series_id, session_type,
      starts_at, ends_at, status, credit_charged
    ) values (
      v_client_id, p_trainer_id, v_week_purchase, v_series_id, p_session_type,
      v_occ_starts, v_occ_ends, 'booked', true
    ) returning id into v_booking_id;

    v_booking_ids := v_booking_ids || v_booking_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_week_purchase, v_booking_id, -1, 'booking_deduction', v_client_id, 'Recorrente · sem ' || (i + 1));
  end loop;

  -- ── Notificações ──────────────────────────────────────────────
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
