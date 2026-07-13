-- ════════════════════════════════════════════════════════════════
-- 0055_admin_booking_allow_past
--
-- O trainer/owner pode agora REGISTAR sessões no PASSADO a partir da
-- Agenda (ex: lançar uma sessão que já aconteceu). Mudanças face a 0054:
--
--   1. Remove a validação "A marcação tem de ser no futuro." — só para
--      a RPC de admin. A marcação do CLIENTE (create_booking) continua
--      a exigir futuro.
--   2. Uma sessão no passado já ocorreu → fica sempre 'confirmed'
--      (independentemente da definição auto_confirm_bookings). O trainer
--      pode depois marcá-la como falta, se necessário.
--
-- Tudo o resto (autorização admin-only, conflitos, desconto opcional,
-- purchase_id NULL para sessões grátis) mantém-se igual a 0054.
--
-- REVERT: reaplicar 0054.
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
  v_is_past boolean := p_starts_at <= now();
  v_actor uuid := auth.uid();
  v_when text := to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');
begin
  -- ── Autorização: só trainer/owner (ou service role) ───────────
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'Cliente em falta.';
  end if;

  -- ── SEC: serializa marcações por trainer ──────────────────────
  perform pg_advisory_xact_lock(hashtextextended(p_trainer_id::text, 0));

  select * into v_settings from trainer_settings where trainer_id = p_trainer_id;
  if not found then
    raise exception 'Trainer não encontrado';
  end if;

  -- NOTA: sem validação de "tem de ser no futuro" — admin pode registar
  -- sessões passadas. (A marcação do cliente continua a exigir futuro.)

  if not (p_duration_min = any(v_settings.slot_durations_min)) then
    raise exception 'Duração % min não permitida.', p_duration_min;
  end if;

  -- ── Conflitos ─────────────────────────────────────────────────
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

  if is_reserved_slot_blocked(p_trainer_id, p_client_id, p_starts_at, v_ends_at) then
    raise exception 'Horário reservado para outro cliente.';
  end if;

  -- ── Desconto opcional ─────────────────────────────────────────
  if p_deduct then
    v_purchase_id := pick_purchase_for_booking(p_client_id, p_session_type, p_trainer_id);
    if v_purchase_id is null then
      raise exception 'Sem sessões para descontar. Marca como sessão grátis ou atribui um pack ao cliente.'
        using errcode = 'P0001';
    end if;
  end if;

  -- Passado → já ocorreu, fica confirmada. Futuro → respeita auto-confirm.
  v_status := case
    when v_is_past then 'confirmed'::booking_status
    when v_settings.auto_confirm_bookings then 'confirmed'::booking_status
    else 'booked'::booking_status
  end;

  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status, credit_charged,
    confirmed_at, confirmed_by
  ) values (
    p_client_id, p_trainer_id, v_purchase_id, p_session_type,
    p_starts_at, v_ends_at, v_status, (v_purchase_id is not null),
    case when v_status = 'confirmed' then now() else null end,
    case when v_status = 'confirmed' then coalesce(v_actor, p_client_id) else null end
  )
  returning id into v_booking_id;

  -- ── Desconto defensivo (só quando há pack) ────────────────────
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

  -- ── Notifica o cliente (in-app) ───────────────────────────────
  insert into notifications (user_id, type, title, body, link)
  values (p_client_id, 'booking_created',
          case when v_is_past then 'Sessão registada pelo treinador'
               else 'Sessão marcada pelo treinador' end,
          'O teu treinador ' ||
            case when v_is_past then 'registou' else 'marcou-te' end ||
            ' uma sessão para ' || v_when || '.',
          '/app/agenda');

  return v_booking_id;
end;
$$;

revoke all on function create_booking_admin(uuid, timestamptz, integer, session_type, uuid, boolean) from public, anon;
grant execute on function create_booking_admin(uuid, timestamptz, integer, session_type, uuid, boolean) to authenticated, service_role;
