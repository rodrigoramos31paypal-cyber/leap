-- ════════════════════════════════════════════════════════════════
-- 0086 · Deep-link das notificações de SESSÃO para a sessão exacta
--
-- Até aqui, as notificações de sessão para o cliente apontavam para
-- páginas genéricas (/app/agenda, /app/historico). Agora apontam para
-- a página da própria sessão (/app/sessao/<id>), para que o clique
-- (in-app E push) abra exactamente o assunto.
--
-- Só muda o LITERAL do `link` na notificação do CLIENTE em cada função;
-- toda a restante lógica é cópia fiel da última definição de cada função
-- (0060/0042/0037). As notificações do ADMIN mantêm /admin/agenda (não
-- existe página por-sessão no admin) e os cancelamentos/no-show mantêm
-- /app/historico (a sessão deixa de estar activa).
--
-- Aplica-se a notificações NOVAS; as antigas mantêm o link já gravado
-- (e continuam clicáveis para a página genérica).
-- ════════════════════════════════════════════════════════════════

-- ─── create_booking_admin · cliente abre a sessão marcada ───
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

  -- NOTA: o conflito-com-bloqueio (trainer_blocked_times / recorrentes)
  -- é DELIBERADAMENTE ignorado aqui — o trainer pode sobrepor uma sessão
  -- a tempo marcado como ocupado. A sobreposição com OUTRA sessão activa
  -- continua a ser recusada.
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

  v_status := case when v_settings.auto_confirm_bookings then 'confirmed'::booking_status
                   else 'booked'::booking_status end;

  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status, credit_charged,
    confirmed_at, confirmed_by
  ) values (
    p_client_id, p_trainer_id, v_purchase_id, p_session_type,
    p_starts_at, v_ends_at, v_status, (v_purchase_id is not null),
    case when v_settings.auto_confirm_bookings then now() else null end,
    case when v_settings.auto_confirm_bookings then coalesce(v_actor, p_client_id) else null end
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
          '/app/sessao/' || v_booking_id);

  return v_booking_id;
end;
$$;

revoke all on function create_booking_admin(uuid, timestamptz, integer, session_type, uuid, boolean) from public, anon;
grant execute on function create_booking_admin(uuid, timestamptz, integer, session_type, uuid, boolean) to authenticated, service_role;

-- ─── reschedule_booking_admin · cliente abre a nova sessão ───
create or replace function reschedule_booking_admin(
  p_old_booking_id uuid,
  p_starts_at timestamptz,
  p_duration_min integer,
  p_notify_client boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old bookings%rowtype;
  v_client uuid;
  v_trainer uuid;
  v_type session_type;
  v_settings trainer_settings%rowtype;
  v_ends_at timestamptz := p_starts_at + (p_duration_min || ' minutes')::interval;
  v_purchase_id uuid;
  v_remaining integer;
  v_new_id uuid;
  v_status booking_status;
  v_was_confirmed boolean;
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

  v_client := v_old.client_id;
  v_trainer := v_old.trainer_id;
  v_type := v_old.session_type;
  v_was_confirmed := v_old.status = 'confirmed';

  perform pg_advisory_xact_lock(hashtextextended(v_trainer::text, 0));

  select * into v_settings from trainer_settings where trainer_id = v_trainer;
  if not found then raise exception 'Trainer não encontrado'; end if;

  if p_starts_at <= now() then
    raise exception 'A marcação tem de ser no futuro.';
  end if;
  if not (p_duration_min = any(v_settings.slot_durations_min)) then
    raise exception 'Duração % min não permitida.', p_duration_min;
  end if;

  -- NOTA: conflito-com-bloqueio ignorado (override do trainer). Mantém-se
  -- a recusa de sobreposição com outra sessão activa e com slots reservados.
  if exists (
    select 1 from bookings
    where trainer_id = v_trainer
      and id <> p_old_booking_id
      and status in ('booked', 'confirmed')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Já existe uma marcação neste horário.';
  end if;
  if is_reserved_slot_blocked(v_trainer, v_client, p_starts_at, v_ends_at) then
    raise exception 'Horário reservado para outro cliente.';
  end if;

  if v_old.credit_charged and v_old.purchase_id is not null then
    update purchases set sessions_remaining = sessions_remaining + 1 where id = v_old.purchase_id;
    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_old.purchase_id, p_old_booking_id, 1, 'cancel_refund', v_actor, 'Reagendamento (admin) — devolução');
  end if;

  update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = v_actor,
        cancellation_reason = 'Reagendada pelo treinador',
        confirmed_at = null,
        confirmed_by = null,
        credit_charged = false
  where id = p_old_booking_id;

  v_purchase_id := pick_purchase_for_booking(v_client, v_type, v_trainer);
  if v_purchase_id is null then
    raise exception 'Sem sessões para reagendar.';
  end if;

  v_status := case when v_was_confirmed then 'confirmed'::booking_status
                   else 'booked'::booking_status end;

  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status, credit_charged, confirmed_at, confirmed_by
  ) values (
    v_client, v_trainer, v_purchase_id, v_type,
    p_starts_at, v_ends_at, v_status, true,
    case when v_was_confirmed then now() else null end,
    case when v_was_confirmed then coalesce(v_actor, v_client) else null end
  )
  returning id into v_new_id;

  update purchases
    set sessions_remaining = sessions_remaining - 1
    where id = v_purchase_id and sessions_remaining > 0
    returning sessions_remaining into v_remaining;
  if v_remaining is null then
    raise exception 'Sem sessões disponíveis para descontar.' using errcode = '23514';
  end if;

  insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by)
  values (v_purchase_id, v_new_id, -1, 'booking_deduction', coalesce(v_actor, v_client));

  if p_notify_client then
    insert into notifications (user_id, type, title, body, link)
    values (v_client, 'booking_created', 'Sessão reagendada',
            'A tua sessão foi reagendada para ' || v_when || '.',
            '/app/sessao/' || v_new_id);
  end if;

  return v_new_id;
end;
$$;

revoke all on function reschedule_booking_admin(uuid, timestamptz, integer, boolean) from public, anon;
grant execute on function reschedule_booking_admin(uuid, timestamptz, integer, boolean) to authenticated, service_role;

-- ─── create_booking · cliente abre a sessão marcada ───
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

  -- Bloqueios RECORRENTES (semanais), excepto se houver "skip" para a
  -- data concreta. Compara em hora-de-parede Europe/Lisbon.
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
          '/app/sessao/' || v_booking_id);

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

-- ─── reschedule_booking · cliente abre a nova sessão ───
create or replace function reschedule_booking(
  p_old_booking_id uuid,
  p_starts_at timestamptz,
  p_duration_min integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old bookings%rowtype;
  v_client uuid;
  v_trainer uuid;
  v_type session_type;
  v_settings trainer_settings%rowtype;
  v_ends_at timestamptz := p_starts_at + (p_duration_min || ' minutes')::interval;
  v_purchase_id uuid;
  v_remaining integer;
  v_new_id uuid;
  v_status booking_status;
  v_trainer_profile uuid;
  v_client_name text;
  v_when text := to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');
begin
  select * into v_old from bookings where id = p_old_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  -- Autorização: dono, admin com acesso ao trainer, ou service role.
  if auth.uid() is null then
    null;
  elsif v_old.client_id = auth.uid() then
    null;
  elsif is_admin() and _trainer_is_accessible(v_old.trainer_id) then
    null;
  else
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_old.status not in ('booked', 'confirmed') then
    raise exception 'Só sessões ativas podem ser reagendadas.';
  end if;
  if v_old.starts_at <= now() then
    raise exception 'Não é possível reagendar uma sessão que já decorreu.';
  end if;

  v_client := v_old.client_id;
  v_trainer := v_old.trainer_id;
  v_type := v_old.session_type;

  -- Serializa marcações por trainer (igual a create_booking).
  perform pg_advisory_xact_lock(hashtextextended(v_trainer::text, 0));

  select * into v_settings from trainer_settings where trainer_id = v_trainer;
  if not found then raise exception 'Trainer não encontrado'; end if;

  -- Validar o novo slot.
  if p_starts_at <= now() then
    raise exception 'A marcação tem de ser no futuro.';
  end if;
  if not (p_duration_min = any(v_settings.slot_durations_min)) then
    raise exception 'Duração % min não permitida.', p_duration_min;
  end if;
  if exists (
    select 1 from trainer_blocked_times
    where trainer_id = v_trainer
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Horário não disponível (bloqueado).';
  end if;
  -- Sobreposição com OUTRAS marcações (exclui a própria que vai ser cancelada).
  if exists (
    select 1 from bookings
    where trainer_id = v_trainer
      and id <> p_old_booking_id
      and status in ('booked', 'confirmed')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Já existe uma marcação neste horário.';
  end if;
  if is_reserved_slot_blocked(v_trainer, v_client, p_starts_at, v_ends_at) then
    raise exception 'Horário reservado para outro cliente.';
  end if;

  -- Devolve o crédito da sessão antiga ANTES de marcar a nova, para que
  -- pick_purchase_for_booking encontre o crédito disponível (neutro).
  if v_old.credit_charged and v_old.purchase_id is not null then
    update purchases set sessions_remaining = sessions_remaining + 1 where id = v_old.purchase_id;
    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_old.purchase_id, p_old_booking_id, 1, 'cancel_refund', auth.uid(), 'Reagendamento — devolução');
  end if;

  -- Cancela a antiga.
  update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancellation_reason = 'Reagendada pelo cliente',
        confirmed_at = null,
        confirmed_by = null,
        credit_charged = false
  where id = p_old_booking_id;

  -- Marca a nova (mesma lógica de create_booking).
  v_purchase_id := pick_purchase_for_booking(v_client, v_type, v_trainer);
  if v_purchase_id is null then
    raise exception 'Sem sessões para reagendar.';
  end if;

  v_status := case when v_settings.auto_confirm_bookings then 'confirmed'::booking_status
                   else 'booked'::booking_status end;

  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status, credit_charged, confirmed_at, confirmed_by
  ) values (
    v_client, v_trainer, v_purchase_id, v_type,
    p_starts_at, v_ends_at, v_status, true,
    case when v_settings.auto_confirm_bookings then now() else null end,
    case when v_settings.auto_confirm_bookings then v_client else null end
  )
  returning id into v_new_id;

  update purchases
    set sessions_remaining = sessions_remaining - 1
    where id = v_purchase_id and sessions_remaining > 0
    returning sessions_remaining into v_remaining;
  if v_remaining is null then
    raise exception 'Sem sessões disponíveis para descontar.' using errcode = '23514';
  end if;

  insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by)
  values (v_purchase_id, v_new_id, -1, 'booking_deduction', v_client);

  -- Notifica o cliente só se ficar pendente (auto-confirm = redundante).
  if not v_settings.auto_confirm_bookings then
    insert into notifications (user_id, type, title, body, link)
    values (v_client, 'booking_created', 'Sessão reagendada',
            'A tua sessão foi reagendada para ' || v_when || ' (a aguardar aceitação).',
            '/app/sessao/' || v_new_id);
  end if;

  -- Notifica o trainer.
  select profile_id into v_trainer_profile from trainers where id = v_trainer;
  select full_name into v_client_name from profiles where id = v_client;
  if v_trainer_profile is not null then
    insert into notifications (user_id, type, title, body, link)
    values (v_trainer_profile, 'booking_created_admin', 'Sessão reagendada',
            split_part(coalesce(v_client_name, 'Cliente'), ' ', 1) || ' reagendou para ' || v_when || '.',
            '/admin/agenda');
  end if;

  return v_new_id;
end;
$$;

revoke all on function reschedule_booking(uuid, timestamptz, integer) from public, anon;
grant execute on function reschedule_booking(uuid, timestamptz, integer) to authenticated, service_role;

-- ─── confirm_booking_attendance · cliente abre a sessão ───
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
          '/app/sessao/' || p_booking_id);
end;
$$;
