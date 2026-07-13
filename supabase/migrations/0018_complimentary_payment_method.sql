-- ════════════════════════════════════════════════════════════════
-- 0018 · "Cortesia" como método de pagamento
--
-- Permite ao trainer atribuir um pack sem registar pagamento — útil
-- para sessões oferecidas, brindes, prendas, ou qualquer cenário em
-- que o cliente não pagou nada por aquelas sessões.
--
-- A compra fica registada normalmente (com o valor do pack) para
-- referência histórica, mas o método "complimentary" deixa claro
-- nos relatórios que não houve receita. Nos relatórios podemos
-- filtrar `payment_method != 'complimentary'` quando quisermos só a
-- receita real.
-- ════════════════════════════════════════════════════════════════

alter type payment_method add value if not exists 'complimentary';

-- Garantir que `complimentary` é tratada como "manual" no fluxo de compras
-- (status inicial = 'awaiting_confirmation' em vez de 'pending_payment').
-- Recria a `create_purchase` igual à de 0015 mudando só a condição do status.
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

  select * into v_settings from trainer_settings where trainer_id = v_pack.trainer_id;

  if not exists (select 1 from profiles where id = v_client_id) then
    raise exception 'Cliente inválido';
  end if;

  v_validity_days := coalesce(v_pack.validity_days, v_settings.default_pack_validity_days);
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
      when p_payment_method in ('manual_mbway', 'manual_cash', 'manual_transfer', 'complimentary') then 'manual'::payment_gateway
      else 'ifthenpay'::payment_gateway
    end
  );

  return v_purchase_id;
end;
$$;
