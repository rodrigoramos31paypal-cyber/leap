-- ════════════════════════════════════════════════════════════════
-- 0021 · create_custom_purchase
--
-- Permite ao admin/trainer atribuir manualmente N sessões a um cliente
-- sem ter de criar um pack predefinido. Útil para casos como "vou dar
-- 1 sessão grátis" ou "5 sessões a 60€ que combinámos por fora".
-- ════════════════════════════════════════════════════════════════

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
  -- Só admin/service pode usar isto
  if not _is_service_or_admin() then
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

  if p_payment_method in ('manual_mbway', 'manual_cash', 'manual_transfer', 'complimentary') then
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
    null,                       -- sem pack referenciado
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

revoke all on function create_custom_purchase(uuid, uuid, integer, integer, session_type, payment_method, text, integer) from public, anon;
grant execute on function create_custom_purchase(uuid, uuid, integer, integer, session_type, payment_method, text, integer) to authenticated, service_role;
