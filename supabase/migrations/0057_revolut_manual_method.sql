-- ════════════════════════════════════════════════════════════════
-- 0057_revolut_manual_method
--
-- 'manual_revolut' (adicionado em 0056) é um método de pagamento
-- MANUAL, como manual_mbway/cash/transfer. As RPCs create_purchase e
-- create_custom_purchase tinham listas explícitas destes métodos para
-- decidir (a) o estado inicial da compra ('awaiting_confirmation' vs
-- 'pending_payment') e (b) o gateway ('manual' vs 'ifthenpay'). Sem
-- 'manual_revolut' nessas listas, uma compra paga por Revolut caía no
-- ramo "online" (gateway ifthenpay), o que é incorrecto.
--
-- Esta migração re-publica as duas funções (corpo idêntico a 0027) com
-- 'manual_revolut' acrescentado às listas de métodos manuais. Corre numa
-- transacção SEPARADA de 0056 — o valor de enum já está commitado, por
-- isso pode ser usado nos corpos das funções.
--
-- REVERT: reaplicar 0027.
-- ════════════════════════════════════════════════════════════════

-- ── create_purchase (base: 0027) ──────────────────────────────────
create or replace function create_purchase(
  p_pack_id uuid,
  p_payment_method payment_method,
  p_client_id uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_client_id uuid := coalesce(p_client_id, auth.uid());
  v_pack packs%rowtype;
  v_settings trainer_settings%rowtype;
  v_purchase_id uuid;
  v_validity_days integer;
  v_expires_at timestamptz;
  v_status purchase_status;
begin
  if not _is_service_or_admin() and v_client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_pack from packs where id = p_pack_id and active = true;
  if not found then
    raise exception 'Pack não encontrado ou inativo';
  end if;

  if auth.uid() is not null
     and v_client_id <> auth.uid()
     and not _trainer_is_accessible(v_pack.trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_pack.trainer_id;

  if not exists (select 1 from profiles where id = v_client_id) then
    raise exception 'Cliente inválido';
  end if;

  v_validity_days := coalesce(v_pack.validity_days, v_settings.default_pack_validity_days);
  if v_validity_days is not null then
    v_expires_at := now() + (v_validity_days || ' days')::interval;
  end if;

  if p_payment_method in ('manual_mbway', 'manual_cash', 'manual_transfer', 'manual_revolut') then
    v_status := 'awaiting_confirmation';
  else
    v_status := 'pending_payment';
  end if;

  insert into purchases (
    client_id, trainer_id, pack_id, pack_snapshot, session_type,
    sessions_total, sessions_remaining, amount_cents, status,
    payment_method, expires_at
  ) values (
    v_client_id,
    v_pack.trainer_id,
    v_pack.id,
    jsonb_build_object(
      'name', v_pack.name,
      'sessions', v_pack.sessions,
      'price_cents', v_pack.price_cents,
      'session_type', v_pack.session_type
    ),
    v_pack.session_type,
    v_pack.sessions,
    v_pack.sessions,
    v_pack.price_cents,
    v_status,
    p_payment_method,
    v_expires_at
  )
  returning id into v_purchase_id;

  insert into payments (purchase_id, method, amount_cents, status, gateway)
  values (
    v_purchase_id,
    p_payment_method,
    v_pack.price_cents,
    'pending',
    case
      when p_payment_method in ('manual_mbway', 'manual_cash', 'manual_transfer', 'manual_revolut') then 'manual'::payment_gateway
      else 'ifthenpay'::payment_gateway
    end
  );

  return v_purchase_id;
end;
$$;

-- ── create_custom_purchase (base: 0027) ───────────────────────────
create or replace function create_custom_purchase(
  p_client_id uuid,
  p_trainer_id uuid,
  p_sessions integer,
  p_price_cents integer,
  p_session_type session_type,
  p_payment_method payment_method,
  p_name text default null,
  p_validity_days integer default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_settings trainer_settings%rowtype;
  v_purchase_id uuid;
  v_validity_days integer;
  v_expires_at timestamptz;
  v_status purchase_status;
  v_name text := coalesce(nullif(trim(p_name), ''),
                          'Avulso · ' || p_sessions || ' ' ||
                          case when p_sessions = 1 then 'sessão' else 'sessões' end);
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if auth.uid() is not null and not _trainer_is_accessible(p_trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if p_sessions <= 0 then
    raise exception 'Número de sessões tem de ser > 0';
  end if;
  if p_price_cents < 0 then
    raise exception 'Preço não pode ser negativo';
  end if;

  if not exists (select 1 from profiles where id = p_client_id) then
    raise exception 'Cliente inválido';
  end if;
  if not exists (select 1 from trainers where id = p_trainer_id) then
    raise exception 'Trainer inválido';
  end if;

  select * into v_settings from trainer_settings where trainer_id = p_trainer_id;
  v_validity_days := coalesce(p_validity_days, v_settings.default_pack_validity_days);
  if v_validity_days is not null then
    v_expires_at := now() + (v_validity_days || ' days')::interval;
  end if;

  if p_payment_method in ('manual_mbway', 'manual_cash', 'manual_transfer', 'manual_revolut', 'complimentary') then
    v_status := 'awaiting_confirmation';
  else
    v_status := 'pending_payment';
  end if;

  insert into purchases (
    client_id, trainer_id, pack_id, pack_snapshot, session_type,
    sessions_total, sessions_remaining, amount_cents, status,
    payment_method, expires_at
  ) values (
    p_client_id,
    p_trainer_id,
    null,
    jsonb_build_object(
      'name', v_name,
      'sessions', p_sessions,
      'price_cents', p_price_cents,
      'session_type', p_session_type,
      'custom', true
    ),
    p_session_type,
    p_sessions,
    p_sessions,
    p_price_cents,
    v_status,
    p_payment_method,
    v_expires_at
  )
  returning id into v_purchase_id;

  insert into payments (purchase_id, method, amount_cents, status, gateway)
  values (
    v_purchase_id,
    p_payment_method,
    p_price_cents,
    'pending',
    'manual'::payment_gateway
  );

  return v_purchase_id;
end;
$$;
