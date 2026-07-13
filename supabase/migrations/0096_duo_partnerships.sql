-- ════════════════════════════════════════════════════════════════
-- 0096 · Pares "Duo" (perfis ligados)
--
-- Permite ao admin LIGAR DOIS perfis de cliente. A partir daí, sempre
-- que qualquer um deles marca uma sessão, ela passa a ser uma sessão
-- DUPLA partilhada:
--   • UMA única marcação (respeita o EXCLUDE de não-sobreposição do
--     trainer — não se criam dois registos no mesmo horário);
--   • ligada às DUAS contas (`client_id` + `partner_client_id`);
--   • desconta 1 sessão a CADA um (de um pack `dupla` de cada cliente);
--   • aparece no calendário de AMBOS.
-- Cancelar (dentro da janela) devolve 1 sessão a cada conta.
--
-- A ligação é gerida só pelo admin (RPCs SECURITY DEFINER `link_duo` /
-- `unlink_duo`). Cada cliente só pode estar num par activo de cada vez.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1. Tabela de pares
-- ────────────────────────────────────────────────────────────────
create table if not exists duo_partnerships (
  id uuid primary key default gen_random_uuid(),
  -- Normalizamos sempre client_a < client_b (ver `link_duo`) para o par
  -- ser único independentemente da ordem em que é criado.
  client_a uuid not null references profiles(id) on delete cascade,
  client_b uuid not null references profiles(id) on delete cascade,
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint duo_distinct check (client_a <> client_b),
  constraint duo_ordered check (client_a < client_b)
);

-- O mesmo par (a,b) só pode existir uma vez ACTIVO.
create unique index if not exists idx_duo_pair_active
  on duo_partnerships(client_a, client_b) where active;
-- Defesa extra: um cliente não pode aparecer duas vezes no MESMO papel.
-- (A garantia "no máximo um par activo por cliente em qualquer papel" é
--  reforçada no corpo de `link_duo`, único escritor da tabela.)
create unique index if not exists idx_duo_a_active on duo_partnerships(client_a) where active;
create unique index if not exists idx_duo_b_active on duo_partnerships(client_b) where active;

-- ────────────────────────────────────────────────────────────────
-- 2. Colunas de par na tabela bookings
--    Uma marcação duo é UM registo com o segundo cliente em
--    `partner_client_id` e o pack desse cliente em `partner_purchase_id`
--    (null quando a sessão duo é grátis / sem desconto ao par).
-- ────────────────────────────────────────────────────────────────
alter table bookings
  add column if not exists partner_client_id uuid references profiles(id) on delete restrict;
alter table bookings
  add column if not exists partner_purchase_id uuid references purchases(id) on delete restrict;
create index if not exists idx_bookings_partner on bookings(partner_client_id, starts_at);

-- ────────────────────────────────────────────────────────────────
-- 3. Helper: par activo de um cliente (ou null)
-- ────────────────────────────────────────────────────────────────
create or replace function duo_partner_of(p_client uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select case when client_a = p_client then client_b else client_a end
  from duo_partnerships
  where active and (client_a = p_client or client_b = p_client)
  limit 1
$$;

-- Não exposta a clientes (evita enumeração de pares); as RPCs internas
-- (SECURITY DEFINER) chamam-na na mesma com os privilégios do owner.
revoke all on function duo_partner_of(uuid) from public, anon;
grant execute on function duo_partner_of(uuid) to service_role;

-- ────────────────────────────────────────────────────────────────
-- 4. RLS
-- ────────────────────────────────────────────────────────────────
alter table duo_partnerships enable row level security;

drop policy if exists "duo: admin all" on duo_partnerships;
create policy "duo: admin all" on duo_partnerships
  for all using (is_admin()) with check (is_admin());

drop policy if exists "duo: read own" on duo_partnerships;
create policy "duo: read own" on duo_partnerships
  for select using (client_a = auth.uid() or client_b = auth.uid() or is_admin());

-- O parceiro tem de conseguir LER a marcação partilhada para esta
-- aparecer no calendário dele. Alargamos a policy de SELECT de bookings.
drop policy if exists "bookings: client read own + admin" on bookings;
create policy "bookings: client read own + admin" on bookings
  for select using (
    client_id = auth.uid()
    or partner_client_id = auth.uid()
    or is_admin()
  );

-- ────────────────────────────────────────────────────────────────
-- 5. RPCs de gestão da ligação (admin)
-- ────────────────────────────────────────────────────────────────
create or replace function link_duo(p_client_a uuid, p_client_b uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
  v_id uuid;
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if p_client_a is null or p_client_b is null then
    raise exception 'Faltam clientes para ligar.';
  end if;
  if p_client_a = p_client_b then
    raise exception 'Não é possível ligar um cliente a si próprio.';
  end if;

  -- Normaliza ordem (client_a < client_b).
  if p_client_a < p_client_b then
    v_a := p_client_a; v_b := p_client_b;
  else
    v_a := p_client_b; v_b := p_client_a;
  end if;

  if not exists (select 1 from profiles where id = v_a)
     or not exists (select 1 from profiles where id = v_b) then
    raise exception 'Cliente não encontrado.';
  end if;

  -- Nenhum dos dois pode já estar num par activo (em qualquer papel).
  if duo_partner_of(v_a) is not null then
    raise exception 'Este cliente já está ligado a outra conta. Desliga primeiro.';
  end if;
  if duo_partner_of(v_b) is not null then
    raise exception 'O segundo cliente já está ligado a outra conta. Desliga primeiro.';
  end if;

  insert into duo_partnerships (client_a, client_b, created_by)
  values (v_a, v_b, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function unlink_duo(p_client uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  update duo_partnerships
    set active = false
    where active and (client_a = p_client or client_b = p_client);
end;
$$;

revoke all on function link_duo(uuid, uuid) from public, anon;
grant execute on function link_duo(uuid, uuid) to authenticated, service_role;
revoke all on function unlink_duo(uuid) from public, anon;
grant execute on function unlink_duo(uuid) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════
-- 6. create_booking — agora com lógica de par duo
--    (base: 0086. Alterações marcadas com «-- DUO».)
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

  -- DUO: se este cliente tem par activo, a sessão é SEMPRE dupla e
  -- desconta a ambos. Forçamos o tipo para 'dupla'.
  v_partner := duo_partner_of(v_client_id);
  if v_partner is not null then
    v_session_type := 'dupla';
  end if;

  v_purchase_id := pick_purchase_for_booking(v_client_id, v_session_type, p_trainer_id);
  if v_purchase_id is null then
    if v_partner is not null then
      raise exception 'Sem sessões duplas para este treinador. Compra um pack duo deste treinador para marcar.';
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

-- ════════════════════════════════════════════════════════════════
-- 7. create_booking_admin — mesma lógica de par duo
--    (base: 0086. p_deduct=false ⇒ sessão grátis: marca o par mas NÃO
--     desconta a ninguém.)
-- ════════════════════════════════════════════════════════════════
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

  -- DUO: par activo ⇒ sessão dupla partilhada.
  v_partner := duo_partner_of(p_client_id);
  if v_partner is not null then
    v_session_type := 'dupla';
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

-- ════════════════════════════════════════════════════════════════
-- 8. cancel_booking — devolve a sessão a AMBAS as contas e avisa o par
--    (base: 0079. Alterações marcadas com «-- DUO».)
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
  v_when text;
  v_trainer_profile uuid;
  v_client_name text;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  v_when := to_char(v_booking.starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');

  -- ── Autorização ───────────────────────────────────────────────
  if auth.uid() is null then
    null; -- service: ok
  elsif v_booking.client_id = auth.uid()
        or v_booking.partner_client_id = auth.uid() then   -- DUO: o par também pode cancelar
    null;
  elsif is_admin() then
    if not _trainer_is_accessible(v_booking.trainer_id) then
      raise exception 'access denied' using errcode = '42501';
    end if;
  else
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_booking.status in ('cancelled', 'no_show') then return; end if;

  -- Quem está a cancelar? (admin/serviço vs um dos clientes do par).
  -- DUO: o par (partner_client_id) conta como CLIENTE, não como admin.
  v_by_admin := auth.uid() is null
                or _is_service_or_admin()
                or (auth.uid() <> v_booking.client_id
                    and auth.uid() <> coalesce(v_booking.partner_client_id, v_booking.client_id));

  -- Sessão passada: o cliente não pode; o trainer/admin pode.
  if v_booking.starts_at <= now() and not v_by_admin then
    raise exception 'Não é possível cancelar uma sessão que já decorreu.';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_booking.trainer_id;

  v_hours_to_session := extract(epoch from (v_booking.starts_at - now())) / 3600.0;

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

    -- DUO: devolve também ao par.
    if v_booking.partner_purchase_id is not null then
      update purchases
        set sessions_remaining = sessions_remaining + 1
        where id = v_booking.partner_purchase_id;

      insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
      values (v_booking.partner_purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
              'Devolução de crédito por cancelamento (par duo)');
    end if;
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

  -- DUO: avisa também o par de que a sessão partilhada foi cancelada.
  if v_booking.partner_client_id is not null then
    insert into notifications (user_id, type, title, body, link)
    values (v_booking.partner_client_id, 'booking_cancelled', 'Marcação duo cancelada',
            'A tua sessão duo de ' || v_when || ' foi cancelada'
            || case when v_refund then ' e foi devolvida à tua conta.' else '.' end,
            '/app/historico');
  end if;

  -- Quando foi o CLIENTE a cancelar, avisa o trainer/admin.
  if not v_by_admin then
    select profile_id into v_trainer_profile from trainers where id = v_booking.trainer_id;
    select full_name into v_client_name from profiles where id = v_booking.client_id;
    if v_trainer_profile is not null then
      insert into notifications (user_id, type, title, body, link)
      values (v_trainer_profile, 'booking_cancelled_admin',
              'Cliente cancelou',
              coalesce(v_client_name, 'Um cliente') || ' cancelou a sessão de ' || v_when ||
                '. O horário ficou livre.',
              '/admin/agenda');
    end if;
  end if;
end;
$$;
