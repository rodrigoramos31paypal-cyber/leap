-- ════════════════════════════════════════════════════════════════
-- 0107 · create_booking_admin · restaurar "permite passado"
--
-- Regressão histórica: a 0055 removeu a guarda "A marcação tem de ser
-- no futuro." do create_booking_admin (com a regra "passado → status
-- confirmed"). As redefinições posteriores (0080, 0086, 0096, 0098,
-- 0100) — feitas por outros motivos (deep-links, DUO, requires_link) —
-- não preservaram esse comportamento e a guarda voltou silenciosamente.
-- Resultado: o trainer/admin que clica num slot passado para registar
-- uma sessão que já decorreu recebe "A marcação tem de ser no futuro.".
--
-- Este patch:
--   • Remove a guarda `p_starts_at <= now()` apenas do caminho ADMIN.
--   • Restaura o status condicional: passado → 'confirmed' (já ocorreu);
--     futuro → respeita auto_confirm_bookings (igual a 0100).
--   • Notificação ao cliente: "registou" vs "marcou-te" conforme passado
--     ou futuro (consistente com 0055).
--   • DUO: a notificação do par segue o mesmo idioma (registou/marcou).
--   • Mantém a versão DUO de 0100 (partner_client_id/purchase, partner
--     deduction, partner notification) intacta.
--
-- Cliente (`create_booking`) NÃO é tocado — clientes continuam a só
-- marcar no futuro. `reschedule_booking_admin` já permite passado desde
-- a 0089. `create_recurring_booking` mantém a regra "futuro" (recorrência
-- só faz sentido daqui em diante).
--
-- REVERT: reaplicar 0100.
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

  -- 0107: SEM check de "tem de ser no futuro" — admin pode registar
  -- sessões passadas (e marcar como livre/realizada à posteriori).

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

  -- 0107: passado → confirmed (a sessão já ocorreu).
  -- Futuro → respeita auto_confirm_bookings.
  v_status := case
    when v_is_past then 'confirmed'::booking_status
    when v_settings.auto_confirm_bookings then 'confirmed'::booking_status
    else 'booked'::booking_status
  end;

  insert into bookings (
    client_id, trainer_id, purchase_id, session_type,
    starts_at, ends_at, status, credit_charged,
    confirmed_at, confirmed_by,
    partner_client_id, partner_purchase_id           -- DUO
  ) values (
    p_client_id, p_trainer_id, v_purchase_id, v_session_type,
    p_starts_at, v_ends_at, v_status, (v_purchase_id is not null),
    case when v_status = 'confirmed' then now() else null end,
    case when v_status = 'confirmed' then coalesce(v_actor, p_client_id) else null end,
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

  -- Notificação ao cliente: distinguir registo de sessão passada
  -- ("registou") de marcação futura ("marcou-te"), igual à 0055.
  insert into notifications (user_id, type, title, body, link)
  values (p_client_id, 'booking_created',
          case when v_is_past then 'Sessão registada pelo treinador'
               else 'Sessão marcada pelo treinador' end,
          'O teu treinador ' ||
            case when v_is_past then 'registou' else 'marcou-te' end ||
            ' uma sessão para ' || v_when || '.',
          '/app/sessao/' || v_booking_id);

  -- DUO: notifica o par com o mesmo idioma.
  if v_partner is not null then
    insert into notifications (user_id, type, title, body, link)
    values (v_partner, 'booking_created',
            case when v_is_past then 'Sessão duo registada pelo treinador'
                 else 'Sessão duo marcada pelo treinador' end,
            'O teu treinador ' ||
              case when v_is_past then 'registou' else 'marcou' end ||
              ' uma sessão duo para ' || v_when || ' — também conta para ti.',
            '/app/sessao/' || v_booking_id);
  end if;

  return v_booking_id;
end;
$$;

revoke all on function create_booking_admin(uuid, timestamptz, integer, session_type, uuid, boolean) from public, anon;
grant execute on function create_booking_admin(uuid, timestamptz, integer, session_type, uuid, boolean) to authenticated, service_role;
