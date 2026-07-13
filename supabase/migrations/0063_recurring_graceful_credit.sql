-- ════════════════════════════════════════════════════════════════
-- 0063 · Marcação recorrente — degradar com elegância quando faltam
--        créditos (em vez de abortar a SÉRIE INTEIRA)
--
-- Bug (0062): havia DUAS situações em que a RPC fazia `raise` e a
-- transacção inteira sofria rollback → o cliente via o erro genérico
-- "Não foi possível marcar a série. Tenta novamente.":
--
--   1) Pré-cheque de saldo:
--        if v_total_available < v_booked_count then raise '23514' ...
--      Bastava o nº de créditos ELEGÍVEIS (mesmo trainer + tipo de
--      sessão + não expirados até cada semana) ser menor do que as
--      semanas livres pedidas — mesmo que houvesse créditos para
--      ALGUMAS semanas — e NADA era marcado.
--
--   2) Defesa por semana no loop:
--        if v_week_purchase is null then raise '23514' ...
--      Um pack que expira A MEIO da série abortava tudo o resto.
--
-- O nº de "restantes" mostrado na UI conta os créditos do cliente de
-- forma mais lata do que a RPC (que filtra por trainer/tipo/expiração
-- por semana), por isso era fácil pedir 10 e a RPC só conseguir N<10.
--
-- Correcção: tratar a FALTA DE CRÉDITO exactamente como já se trata um
-- horário ocupado — marcação PARCIAL. Marca as semanas que dá, e
-- devolve as restantes em `conflicts` com `reason = 'no_credit'`. A UI
-- já sabe mostrar "Marcadas X de Y" e listar as que ficaram por marcar.
--
--   • Pré-cheque: em vez de `raise`, corta as ÚLTIMAS semanas que não
--     há crédito para cobrir (as mais propensas a expiração) e marca-as
--     como `no_credit`.
--   • Loop: se uma semana específica não tiver pack válido, salta-a
--     (regista `no_credit`) em vez de abortar.
--   • Se no fim não se marcou nada, apaga a série vazia e devolve
--     booked_count = 0 (com os conflitos para a UI sugerir/explicar).
--
-- Mantém tudo o resto de 0062 (alocação multi-pack, advisory lock,
-- classificação livre/conflito, notificações, retorno jsonb).
--
-- REVERT: reaplicar a definição de 0062_recurring_multi_pack.sql.
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

  -- ── Nenhuma semana livre (só conflitos de horário) → nada ─────
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

  -- ── Saldo total entre TODOS os packs elegíveis ────────────────
  -- (soma das compras utilizáveis a partir da 1ª semana livre.)
  select coalesce(sum(sessions_remaining), 0) into v_total_available
  from purchases
  where client_id = v_client_id
    and trainer_id = p_trainer_id
    and status = 'confirmed'
    and session_type = p_session_type
    and sessions_remaining > 0
    and (expires_at is null or expires_at > v_first_free);

  -- ── GRACEFUL: faltam créditos para todas as semanas livres? ───
  -- Em vez de abortar a série, corta as ÚLTIMAS semanas que não há
  -- crédito para cobrir (as mais propensas a cair fora da validade
  -- de um pack) e marca-as como `no_credit`. Marca o resto.
  if v_total_available < v_booked_count then
    for v_idx in (v_total_available + 1) .. v_booked_count loop
      v_wk := v_free_weeks[v_idx];
      v_conflicts := v_conflicts || jsonb_build_object(
        'week', v_wk + 1,
        'starts_at', p_starts_at + (v_wk || ' weeks')::interval,
        'reason', 'no_credit');
    end loop;
    -- Mantém só as primeiras `v_total_available` semanas livres
    -- (slice [1:0] devolve array vazio quando não há crédito nenhum).
    v_free_weeks := v_free_weeks[1 : greatest(v_total_available, 0)];
    v_booked_count := coalesce(array_length(v_free_weeks, 1), 0);
  end if;

  -- ── Sem crédito para nenhuma semana → nada marcado ────────────
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
      -- Esta semana específica não tem pack válido (ex.: todos os
      -- packs com saldo expiram antes desta data). NÃO aborta a série:
      -- regista `no_credit` e segue para a próxima semana.
      v_conflicts := v_conflicts || jsonb_build_object(
        'week', i + 1,
        'starts_at', v_occ_starts,
        'reason', 'no_credit');
      continue;
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

  -- Recalcula o que REALMENTE ficou marcado (o loop pode ter saltado
  -- semanas sem pack válido).
  v_booked_count := coalesce(array_length(v_booking_ids, 1), 0);

  -- ── Nada marcado no fim → apaga a série vazia e devolve 0 ─────
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

  -- Acerta a última data da série ao que ficou efectivamente marcado.
  update booking_series
    set last_starts_at = (
      select max(starts_at) from bookings where series_id = v_series_id
    )
    where id = v_series_id;

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
