-- ════════════════════════════════════════════════════════════════
-- 0031 · RPC set_payment_gateway_info (H5 do audit de segurança)
--
-- Remove o último uso de service_role no caminho de compra iniciado
-- por um utilizador autenticado (lib/ifthenpay.ts → createIfthenpayPayment,
-- chamado a partir da server action startPurchaseAction).
--
-- Antes, esse código usava createAdminClient() (service_role, bypassa
-- RLS) para:
--   1. SELECT na purchase   → agora feito com o client autenticado + RLS
--      (policy "purchases: client read own" já permite o dono ler).
--   2. UPDATE em payments    → RLS de payments é admin-write only, por
--      isso não dá para o client autenticado escrever directamente.
--      Esta RPC SECURITY DEFINER faz o UPDATE de forma controlada,
--      validando que quem chama é o DONO da compra (ou admin/service).
--
-- Regra de ouro aplicada: service_role só em webhooks/cron, nunca em
-- código chamado a partir de server actions com utilizador autenticado.
--
-- A RPC anexa a informação devolvida pelo gateway (request id, ref,
-- payload) ao payment `pending` da compra. NÃO altera status nem
-- confirma nada — a confirmação continua a vir só do webhook
-- (confirm_ifthenpay_callback, migration 0026).
-- ════════════════════════════════════════════════════════════════

create or replace function set_payment_gateway_info(
  p_purchase_id uuid,
  p_gateway_request_id text,
  p_gateway_ref text,
  p_gateway_payload jsonb
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  -- ── Ownership check ───────────────────────────────────────────
  -- SECURITY DEFINER bypassa RLS, por isso validamos manualmente que
  -- quem chama é o dono da compra. _is_service_or_admin() (migration
  -- 0015) cobre webhooks/jobs (auth.uid() NULL) e admins.
  select client_id into v_client_id
  from purchases
  where id = p_purchase_id;

  if not found then
    raise exception 'purchase not found' using errcode = 'P0002';
  end if;

  if not (v_client_id = auth.uid() or _is_service_or_admin()) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  -- ── Anexa info do gateway ao payment pending ──────────────────
  -- Escopado ao gateway 'ifthenpay' para não tocar em payments
  -- manuais. Mesmo critério do UPDATE original (purchase + pending).
  update payments
    set gateway_request_id = p_gateway_request_id,
        gateway_ref = coalesce(p_gateway_ref, gateway_ref),
        gateway_payload = p_gateway_payload
    where purchase_id = p_purchase_id
      and status = 'pending'
      and gateway = 'ifthenpay';
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- Permissões — dono autenticado + service_role (a verificação fina
-- de ownership é feita dentro da função). anon não tem grant.
-- ────────────────────────────────────────────────────────────────
revoke all on function set_payment_gateway_info(uuid, text, text, jsonb) from public, anon;
grant execute on function set_payment_gateway_info(uuid, text, text, jsonb) to authenticated, service_role;

comment on function set_payment_gateway_info(uuid, text, text, jsonb) is
  'Anexa info do gateway (request id, ref, payload) ao payment pending ifthenpay de uma compra. Valida que o caller é o dono da compra (ou admin/service). Não altera status — confirmação vem só do webhook. Substitui o UPDATE com service_role em lib/ifthenpay.ts (H5).';
