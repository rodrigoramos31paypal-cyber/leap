-- ════════════════════════════════════════════════════════════════
-- 0115 · create_booking_admin · repõe relaxações 0107 + 0112
--
-- A migration 0113 (saldo dupla partilhado) redefiniu por completo a
-- `create_booking_admin` para suportar o novo pool partilhado, mas
-- silenciosamente reverteu três comportamentos que tinham sido
-- adicionados nas 0107 e 0112:
--   • 0107: admin podia marcar sessões PASSADAS (registo retroactivo);
--   • 0112: admin podia marcar sessões de 30 min, mesmo que os clientes
--           só pudessem 45/60/90 (slot_durations_min);
--   • 0112: admin podia marcar sessões com SOBREPOSIÇÃO PARCIAL — só
--           ficava bloqueada uma marcação com o MESMO starts_at exacto.
--
-- Esta migration mantém a lógica DUO da 0113 (pool partilhado, sem
-- segundo desconto, partner_purchase_id NULL) e reaplica as três
-- relaxações. Caminho do cliente (`create_booking`) fica inalterado.
--
-- REVERT: reaplicar 0113.
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

  -- 0112: admin/staff/owner pode marcar sessões de 30 min em nome do
  -- cliente, além das durações configuradas em `slot_durations_min`
  -- (que regem o que os clientes podem marcar no fluxo /app).
  if not (p_duration_min = any(v_settings.slot_durations_min) or p_duration_min = 30) then
    raise exception 'Duração % min não permitida.', p_duration_min;
  end if;

  -- 0112: só bloqueia o MESMO horário de início exacto. Sobreposições
  -- parciais (a começar a horas diferentes) são permitidas no admin.
  if exists (
    select 1 from bookings
    where trainer_id = p_trainer_id
      and status in ('booked', 'confirmed')
      and starts_at = p_starts_at
  ) then
    raise exception 'Já existe uma marcação que começa exactamente a esta hora.';
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
    if v_session_type = 'dupla' then
      -- Saldo partilhado: pack do próprio primeiro, senão o do parceiro.
      v_purchase_id := pick_purchase_for_booking(p_client_id, 'dupla', p_trainer_id);
      if v_purchase_id is null then
        v_purchase_id := pick_purchase_for_booking(v_partner, 'dupla', p_trainer_id);
      end if;
      if v_purchase_id is null then
        raise exception 'O par não tem sessões PT Dupla. Marca como sessão grátis ou atribui um pack PT Dupla a uma das contas.'
          using errcode = 'P0001';
      end if;
    else
      v_purchase_id := pick_purchase_for_booking(p_client_id, v_session_type, p_trainer_id);
      if v_purchase_id is null then
        raise exception 'Sem sessões para descontar. Marca como sessão grátis ou atribui um pack ao cliente.'
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
    partner_client_id, partner_purchase_id           -- DUO: partner_purchase_id NULL (saldo partilhado)
  ) values (
    p_client_id, p_trainer_id, v_purchase_id, v_session_type,
    p_starts_at, v_ends_at, v_status, (v_purchase_id is not null),
    case when v_settings.auto_confirm_bookings then now() else null end,
    case when v_settings.auto_confirm_bookings then coalesce(v_actor, p_client_id) else null end,
    v_partner, null                                  -- DUO
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
