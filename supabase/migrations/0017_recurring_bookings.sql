-- ════════════════════════════════════════════════════════════════
-- 0017 · Marcações recorrentes (séries semanais)
--
-- Permite a um cliente (ou ao admin em nome de) marcar várias semanas
-- de uma só vez (ex: 4 semanas de um pack de 4 sessões). Após a última
-- semana criada, o mesmo horário fica "reservado" para esse cliente
-- na semana seguinte: outros clientes não podem marcar esse slot até
-- o tempo passar. O cliente da série pode usar essa semana ao comprar
-- um novo pack ou ignorá-la (passada essa semana, deixa de ser reservada).
-- ════════════════════════════════════════════════════════════════

-- ── booking_series ──────────────────────────────────────────────
create table booking_series (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles(id) on delete restrict,
  trainer_id uuid not null references trainers(id) on delete restrict,
  purchase_id uuid not null references purchases(id) on delete restrict,
  session_type session_type not null,
  duration_min integer not null check (duration_min > 0),
  -- âncora: starts_at da primeira ocorrência criada com esta série
  first_starts_at timestamptz not null,
  -- starts_at da última ocorrência criada com esta série (define o slot reservado da semana seguinte)
  last_starts_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_series_client on booking_series(client_id);
create index idx_series_trainer_last on booking_series(trainer_id, last_starts_at);

-- ── bookings.series_id ──────────────────────────────────────────
alter table bookings
  add column series_id uuid references booking_series(id) on delete set null;
create index idx_bookings_series on bookings(series_id);

-- ── trigger updated_at ──────────────────────────────────────────
create trigger trg_booking_series_updated
  before update on booking_series
  for each row execute procedure set_updated_at();

-- ════════════════════════════════════════════════════════════════
-- View · reserved_slots_active
-- Slots reservados ainda no futuro (último booking da série + 7 dias)
-- ════════════════════════════════════════════════════════════════
create or replace view reserved_slots_active as
select
  s.id            as series_id,
  s.client_id,
  s.trainer_id,
  s.session_type,
  s.duration_min,
  (s.last_starts_at + interval '7 days') as starts_at,
  (s.last_starts_at + interval '7 days' + make_interval(mins => s.duration_min)) as ends_at,
  p.full_name     as client_name
from booking_series s
join profiles p on p.id = s.client_id
where s.status = 'active'
  -- só faz sentido enquanto o slot ainda não passou
  and (s.last_starts_at + interval '7 days' + make_interval(mins => s.duration_min)) > now()
  -- não há já um booking real nesse mesmo slot (caso o cliente já tenha estendido)
  and not exists (
    select 1 from bookings b
    where b.trainer_id = s.trainer_id
      and b.status in ('booked', 'confirmed')
      and b.starts_at = (s.last_starts_at + interval '7 days')
  );

-- ════════════════════════════════════════════════════════════════
-- is_reserved_slot_blocked(...)
-- Retorna true se o intervalo [p_starts_at, p_ends_at) colide com
-- algum slot reservado de outra série/cliente.
-- ════════════════════════════════════════════════════════════════
create or replace function is_reserved_slot_blocked(
  p_trainer_id uuid,
  p_client_id  uuid,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz
) returns boolean
language sql stable
set search_path = public
as $$
  select exists (
    select 1
    from reserved_slots_active r
    where r.trainer_id = p_trainer_id
      and r.client_id <> p_client_id
      and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  );
$$;

-- ════════════════════════════════════════════════════════════════
-- create_booking · atualizado para respeitar slots reservados
-- (mantém toda a lógica original; adiciona check de reserved_slot)
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

  -- NEW: respeita slot reservado de outra série
  if is_reserved_slot_blocked(p_trainer_id, v_client_id, p_starts_at, v_ends_at) then
    raise exception 'Horário reservado para outro cliente.';
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
          'A tua sessão foi marcada. Sessão descontada.', '/app/agenda');

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

-- ════════════════════════════════════════════════════════════════
-- create_recurring_booking · marca N semanas consecutivas em série
-- Retorna jsonb: { ok, series_id, booking_ids[], conflicts[] }
-- Se houver conflitos, NADA é criado (atómico).
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
  v_purchase purchases%rowtype;
  v_purchase_id uuid;
  v_booking_id uuid;
  v_series_id uuid;
  v_occ_starts timestamptz;
  v_occ_ends timestamptz;
  v_conflicts jsonb := '[]'::jsonb;
  v_booking_ids uuid[] := array[]::uuid[];
  v_trainer_profile uuid;
  v_client_name text;
  i integer;
  v_last_starts timestamptz;
begin
  if not _is_service_or_admin() and v_client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if p_sessions_count <= 0 then
    raise exception 'Contagem de sessões tem de ser > 0';
  end if;

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

  -- Escolhe a 1ª compra confirmada com sessões suficientes do tipo certo,
  -- que ainda esteja válida na última semana planeada.
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

  update purchases
    set sessions_remaining = sessions_remaining - p_sessions_count
    where id = v_purchase.id;

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

-- ════════════════════════════════════════════════════════════════
-- Permissões
-- ════════════════════════════════════════════════════════════════
revoke all on function create_recurring_booking(uuid, timestamptz, integer, integer, session_type, uuid) from public, anon;
grant execute on function create_recurring_booking(uuid, timestamptz, integer, integer, session_type, uuid) to authenticated, service_role;

revoke all on function is_reserved_slot_blocked(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function is_reserved_slot_blocked(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;

grant select on reserved_slots_active to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════
-- RLS para booking_series
-- ════════════════════════════════════════════════════════════════
alter table booking_series enable row level security;

create policy series_select_own
  on booking_series for select
  using (
    client_id = auth.uid()
    or exists (
      select 1 from trainers t
      join profiles p on p.id = auth.uid()
      where t.id = booking_series.trainer_id
        and (t.profile_id = auth.uid() or p.role = 'owner')
    )
  );

-- Inserts / updates só via SECURITY DEFINER RPCs (não há policy de write directo).
