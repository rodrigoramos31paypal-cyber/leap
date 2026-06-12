-- ════════════════════════════════════════════════════════════════
-- 0025 · Fecho da race condition em marcações (C1 do audit de segurança)
--
-- Antes: `create_booking` e `create_recurring_booking` faziam
--   `IF EXISTS (... && ...) THEN raise; END IF; INSERT ...`
-- sem nenhum lock entre o check e o INSERT. Dois pedidos concorrentes
-- para o mesmo slot passavam ambos no check e gravavam ambos. Também
-- o desconto de sessões (`update purchases set sessions_remaining =
-- sessions_remaining - 1`) podia ir abaixo de zero.
--
-- Esta migração aplica defesa em três camadas:
--   1. EXCLUDE constraint em `bookings` — a BD impede SEMPRE overlaps,
--      mesmo que código futuro venha a falhar.
--   2. CHECK constraint em `purchases.sessions_remaining >= 0` — créditos
--      nunca podem ficar negativos.
--   3. `pg_advisory_xact_lock(trainer_id)` no topo de `create_booking`
--      e `create_recurring_booking` — serializa por trainer, dá mensagens
--      de erro humanas (em vez de constraint violations crus).
--   4. UPDATE defensivo: `where sessions_remaining > 0` + `returning`,
--      e raise se nada foi actualizado.
--
-- Aplicar contra dados existentes:
--   - O EXCLUDE constraint NÃO suporta NOT VALID. Se existirem overlaps
--     na BD (provavelmente já causados por exploração da race), a
--     migração FALHA. Antes de correr, executa as queries no bloco
--     "PRE-FLIGHT CHECKS" mais abaixo e limpa overlaps manualmente.
--   - O CHECK em purchases usa NOT VALID para não falhar em linhas
--     antigas potencialmente negativas; valida depois quando souberes
--     que está tudo a 0+.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- PRE-FLIGHT CHECKS (correr manualmente antes do resto da migração)
-- ────────────────────────────────────────────────────────────────
-- 1) Bookings sobrepostos no mesmo trainer (devem dar 0 linhas):
--
--    select a.id as a_id, b.id as b_id, a.trainer_id, a.starts_at, b.starts_at
--    from bookings a
--    join bookings b
--      on a.trainer_id = b.trainer_id
--     and a.id < b.id
--     and a.status in ('booked','confirmed')
--     and b.status in ('booked','confirmed')
--     and tstzrange(a.starts_at, a.ends_at, '[)')
--      && tstzrange(b.starts_at, b.ends_at, '[)');
--
-- 2) Purchases com créditos negativos (devem dar 0 linhas):
--
--    select id, client_id, sessions_remaining
--    from purchases where sessions_remaining < 0;
--
-- Se alguma destas devolver linhas, resolve-as ANTES de continuar
-- (cancelar o booking mais recente / corrigir sessions_remaining).
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1. Extension + EXCLUDE constraint em bookings
-- ────────────────────────────────────────────────────────────────
create extension if not exists btree_gist;

-- Evita erro se já existir (re-run da migração)
alter table bookings drop constraint if exists bookings_no_overlap;

alter table bookings
  add constraint bookings_no_overlap
  exclude using gist (
    trainer_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('booked', 'confirmed'));

comment on constraint bookings_no_overlap on bookings is
  'C1 hardening: impede dois bookings activos (booked|confirmed) do mesmo trainer com tempos sobrepostos. Defesa final contra race conditions em create_booking / create_recurring_booking.';

-- ────────────────────────────────────────────────────────────────
-- 2. CHECK constraint em purchases.sessions_remaining
-- ────────────────────────────────────────────────────────────────
alter table purchases drop constraint if exists purchases_sessions_nonneg;

alter table purchases
  add constraint purchases_sessions_nonneg
  check (sessions_remaining >= 0)
  not valid;

comment on constraint purchases_sessions_nonneg on purchases is
  'C1 hardening: sessions_remaining nunca pode ser negativo. NOT VALID para não bloquear migração; correr "ALTER TABLE purchases VALIDATE CONSTRAINT purchases_sessions_nonneg" assim que existing data estiver limpa.';

-- ────────────────────────────────────────────────────────────────
-- 3. create_booking — advisory lock + decremento defensivo
--
-- Body baseado em 0020_auto_confirm_bookings.sql. Apenas alterações:
--   • pg_advisory_xact_lock(hashtextextended(p_trainer_id::text, 0))
--     logo a seguir ao auth check.
--   • UPDATE de purchases passa a ter WHERE sessions_remaining > 0
--     e raise se nada foi actualizado.
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
  v_status booking_status;
begin
  -- ── Autorização ───────────────────────────────────────────────
  if not _is_service_or_admin() and v_client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  -- ── SEC: serializa marcações por trainer ──────────────────────
  -- Dois pedidos concorrentes para o mesmo trainer ficam em fila;
  -- entre trainers diferentes, há paralelismo total. O lock dura
  -- até ao fim da transacção. Combinado com o EXCLUDE constraint,
  -- garante que NUNCA há dois bookings activos sobrepostos.
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
  -- WHERE sessions_remaining > 0 garante que mesmo num cenário em
  -- que duas transacções escolhessem a mesma purchase (não deve
  -- acontecer com o advisory lock acima, mas defesa em camadas),
  -- a segunda transacção apanha v_remaining = null e aborta.
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

-- ────────────────────────────────────────────────────────────────
-- 4. create_recurring_booking — mesmo tratamento
--
-- Body baseado em 0017_recurring_bookings.sql. Alterações:
--   • pg_advisory_xact_lock no topo.
--   • UPDATE final em purchases passa a ter WHERE sessions_remaining
--     >= p_sessions_count + raise se nada foi actualizado.
--   • A fase 1 (detecção de conflitos) já é correcta porque o lock
--     impede inserts concorrentes; agora "fotografia" do estado dá
--     resultado consistente até ao final da transacção.
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
  v_purchase purchases%rowtype;
  v_booking_id uuid;
  v_series_id uuid;
  v_occ_starts timestamptz;
  v_occ_ends timestamptz;
  v_conflicts jsonb := '[]'::jsonb;
  v_booking_ids uuid[] := array[]::uuid[];
  v_trainer_profile uuid;
  v_client_name text;
  v_updated_count integer;
  i integer;
  v_last_starts timestamptz;
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

  v_last_starts := p_starts_at + ((p_sessions_count - 1) || ' weeks')::interval;
  select * into v_purchase
  from purchases
  where client_id = v_client_id
    and trainer_id = p_trainer_id
    and status = 'confirmed'
    and session_type = p_session_type
    and sessions_remaining >= p_sessions_count
    and (expires_at is null or expires_at > v_last_starts)
  order by expires_at nulls last, created_at
  limit 1;

  if not found then
    raise exception 'Sem sessões suficientes ou pack expira antes da última semana.';
  end if;

  -- Fase 1 — Detectar TODOS os conflitos antes de criar qualquer coisa
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
        'week', i + 1,
        'starts_at', v_occ_starts,
        'reason', 'booking'
      );
    elsif exists (
      select 1 from trainer_blocked_times
      where trainer_id = p_trainer_id
        and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_occ_starts, v_occ_ends, '[)')
    ) then
      v_conflicts := v_conflicts || jsonb_build_object(
        'week', i + 1,
        'starts_at', v_occ_starts,
        'reason', 'blocked'
      );
    elsif is_reserved_slot_blocked(p_trainer_id, v_client_id, v_occ_starts, v_occ_ends) then
      v_conflicts := v_conflicts || jsonb_build_object(
        'week', i + 1,
        'starts_at', v_occ_starts,
        'reason', 'reserved'
      );
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object(
      'ok', false,
      'series_id', null,
      'booking_ids', '[]'::jsonb,
      'conflicts', v_conflicts
    );
  end if;

  -- Fase 2 — Criar série + bookings + descontar sessões
  insert into booking_series (
    client_id, trainer_id, purchase_id, session_type,
    duration_min, first_starts_at, last_starts_at, status
  ) values (
    v_client_id, p_trainer_id, v_purchase.id, p_session_type,
    p_duration_min, p_starts_at, v_last_starts, 'active'
  ) returning id into v_series_id;

  for i in 0 .. (p_sessions_count - 1) loop
    v_occ_starts := p_starts_at + (i || ' weeks')::interval;
    v_occ_ends := v_occ_starts + (p_duration_min || ' minutes')::interval;

    insert into bookings (
      client_id, trainer_id, purchase_id, series_id, session_type,
      starts_at, ends_at, status, credit_charged
    ) values (
      v_client_id, p_trainer_id, v_purchase.id, v_series_id, p_session_type,
      v_occ_starts, v_occ_ends, 'booked', true
    ) returning id into v_booking_id;

    v_booking_ids := v_booking_ids || v_booking_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_purchase.id, v_booking_id, -1, 'booking_deduction', v_client_id, 'Recorrente · sem ' || (i+1));
  end loop;

  -- ── SEC: desconto defensivo da série inteira ──────────────────
  update purchases
    set sessions_remaining = sessions_remaining - p_sessions_count
    where id = v_purchase.id
      and sessions_remaining >= p_sessions_count;

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'Sem sessões suficientes para descontar a série.' using errcode = '23514';
  end if;

  -- Notificações
  insert into notifications (user_id, type, title, body, link)
  values (v_client_id, 'booking_created',
          'Marcações recorrentes criadas',
          'Foram marcadas ' || p_sessions_count || ' sessões semanais. Vê o teu histórico.',
          '/app/agenda');

  select profile_id into v_trainer_profile from trainers where id = p_trainer_id;
  select full_name into v_client_name from profiles where id = v_client_id;
  if v_trainer_profile is not null then
    insert into notifications (user_id, type, title, body, link)
    values (v_trainer_profile, 'booking_created_admin',
            'Nova série recorrente',
            coalesce(v_client_name, 'Cliente') || ' marcou ' || p_sessions_count ||
              ' sessões semanais a começar ' ||
              to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM HH24:MI') || '.',
            '/admin/agenda');
  end if;

  return jsonb_build_object(
    'ok', true,
    'series_id', v_series_id,
    'booking_ids', to_jsonb(v_booking_ids),
    'conflicts', '[]'::jsonb
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- Permissões — manter idênticas às migrações anteriores
-- ────────────────────────────────────────────────────────────────
revoke all on function create_booking(uuid, timestamptz, integer, session_type, uuid) from public, anon;
grant execute on function create_booking(uuid, timestamptz, integer, session_type, uuid) to authenticated, service_role;

revoke all on function create_recurring_booking(uuid, timestamptz, integer, integer, session_type, uuid) from public, anon;
grant execute on function create_recurring_booking(uuid, timestamptz, integer, integer, session_type, uuid) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════
-- Pós-migração (correr manualmente quando dados antigos estiverem
-- limpos):
--
--   alter table purchases validate constraint purchases_sessions_nonneg;
-- ════════════════════════════════════════════════════════════════
