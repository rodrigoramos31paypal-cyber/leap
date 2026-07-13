-- ════════════════════════════════════════════════════════════════
-- 0066 · Suspender (ban) cliente — bloquear COMPRA de packs
--
-- Pedido: o admin/trainer pode "suspender" um cliente. O cliente
-- continua a aceder à conta normalmente, MAS qualquer tentativa de
-- comprar um pack (seja qual for o método de pagamento) é recusada com
-- um erro claro.
--
-- Implementação (à prova de bypass):
--   1) Coluna `profiles.banned` (default false).
--   2) `create_purchase` passa a recusar quando o PRÓPRIO cliente
--      (auto-compra) está suspenso — cobre todos os métodos, porque
--      gateway e manual entram ambos por esta RPC. Um admin/serviço
--      pode na mesma ATRIBUIR packs manualmente (grant), por isso o
--      bloqueio só se aplica a `not _is_service_or_admin()`.
--   3) `set_client_banned(client, bool)` — RPC só para admin/serviço,
--      usada pelo painel para suspender/reativar.
--
-- REVERT:
--   reaplicar create_purchase de 0057_revolut_manual_method.sql;
--   drop function set_client_banned(uuid, boolean);
--   alter table profiles drop column banned;
-- ════════════════════════════════════════════════════════════════

-- 1) coluna de suspensão ────────────────────────────────────────────
alter table profiles add column if not exists banned boolean not null default false;

-- 2) create_purchase — bloqueia auto-compra de cliente suspenso ──────
--    (base: 0057; só acrescenta o cheque de `banned`).
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

  -- BAN (0066): cliente suspenso não pode comprar packs (qualquer
  -- método). Só bloqueia a auto-compra do próprio cliente — um admin
  -- pode na mesma atribuir packs manualmente.
  if not _is_service_or_admin()
     and exists (select 1 from profiles where id = v_client_id and banned) then
    raise exception 'A tua conta está suspensa. Não é possível comprar packs. Fala com o teu treinador.';
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

-- 3) set_client_banned — só admin/serviço ──────────────────────────
create or replace function set_client_banned(
  p_client_id uuid,
  p_banned boolean
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  -- Só clientes podem ser suspensos (nunca staff).
  if not exists (select 1 from profiles where id = p_client_id and role = 'client') then
    raise exception 'Cliente inválido';
  end if;
  update profiles set banned = p_banned where id = p_client_id;
end;
$$;

revoke all on function set_client_banned(uuid, boolean) from public, anon;
grant execute on function set_client_banned(uuid, boolean) to authenticated, service_role;
