-- ════════════════════════════════════════════════════════════════
-- 0026 · Webhook IfthenPay endurecido (C2 do audit de segurança)
--
-- Move a lógica do callback IfthenPay para dentro de uma RPC atómica
-- com `SELECT ... FOR UPDATE`. Resolve quatro problemas do handler
-- antigo (lib/ifthenpay.ts → handleIfthenpayCallback):
--
--   1. Validação de montante  — antes não comparava o `amount` recebido
--      com `payments.amount_cents`. Um callback forjado podia confirmar
--      a compra com qualquer valor.
--   2. Anti-replay forte      — antes confiava só em `status = pending`
--      sem lock; duas chamadas em paralelo podiam dar race. Agora o
--      `FOR UPDATE` serializa.
--   3. Idempotência explícita — chamadas repetidas ao mesmo payment
--      já pago devolvem `ok = true` (status 200 para o IfthenPay, sem
--      executar `confirm_purchase` outra vez).
--   4. Leak da anti-phishing key — esta RPC recebe `p_payload` já
--      sanitizado pelo lib/ifthenpay.ts (sem `key`). A persistência
--      fica blindada do lado da BD: se alguém esquecer de filtrar lá,
--      esta função NÃO toca em `key` (mas confia na sanitização). A
--      segunda camada está documentada no handler TS.
--
-- Apenas o service_role pode chamar esta RPC. authenticated/anon não
-- têm grant — mesmo que alguém descubra o nome, PostgREST recusa.
-- ════════════════════════════════════════════════════════════════

create or replace function confirm_ifthenpay_callback(
  p_order_id text,
  p_amount_cents integer,
  p_payload jsonb
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_payment payments%rowtype;
begin
  -- ── SEC: webhook = service_role only ──────────────────────────
  -- O JWT de service_role não tem `sub` → auth.uid() devolve NULL.
  -- Qualquer chamada com utilizador autenticado é rejeitada.
  if auth.uid() is not null then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if p_order_id is null or length(p_order_id) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'order_id_missing');
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'amount_invalid');
  end if;

  -- ── Lock no payment correspondente ────────────────────────────
  -- Filtra por gateway = 'ifthenpay' para não colidir com `manual`.
  -- ORDER BY created_at DESC + LIMIT 1 garante que se houver
  -- históricos (re-tentativas), pegamos o mais recente.
  select * into v_payment
  from payments
  where gateway_ref = p_order_id
    and gateway = 'ifthenpay'
  order by created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  -- ── Idempotência ──────────────────────────────────────────────
  -- IfthenPay re-envia callbacks. Se já marcámos como pago, NÃO
  -- corremos `confirm_purchase` outra vez (evita inflar crédito).
  -- Devolvemos `ok = true` para o webhook responder 200 OK.
  if v_payment.status = 'paid' then
    return jsonb_build_object(
      'ok', true,
      'reason', 'already_paid',
      'payment_id', v_payment.id,
      'purchase_id', v_payment.purchase_id
    );
  end if;

  if v_payment.status <> 'pending' then
    -- failed / refunded — não confirmar sem intervenção humana
    return jsonb_build_object(
      'ok', false,
      'reason', 'bad_status',
      'status', v_payment.status::text
    );
  end if;

  -- ── Validação CRÍTICA de montante ─────────────────────────────
  -- Sem isto, um callback com `amount=0.01` confirmava a compra.
  -- IfthenPay devolve o valor recebido em euros; o handler TS
  -- converte para cêntimos antes de chamar.
  if v_payment.amount_cents <> p_amount_cents then
    return jsonb_build_object(
      'ok', false,
      'reason', 'amount_mismatch',
      'expected_cents', v_payment.amount_cents,
      'received_cents', p_amount_cents
    );
  end if;

  -- ── Marca como pago + confirma compra ─────────────────────────
  update payments
    set status = 'paid',
        paid_at = now(),
        gateway_payload = p_payload
    where id = v_payment.id;

  -- confirm_purchase (definida em 0015 com `_is_service_or_admin()`)
  -- aceita-nos porque auth.uid() é NULL (service role).
  perform confirm_purchase(v_payment.purchase_id);

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment.id,
    'purchase_id', v_payment.purchase_id
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- Permissões — só service_role
-- ────────────────────────────────────────────────────────────────
revoke all on function confirm_ifthenpay_callback(text, integer, jsonb) from public, anon, authenticated;
grant execute on function confirm_ifthenpay_callback(text, integer, jsonb) to service_role;

comment on function confirm_ifthenpay_callback(text, integer, jsonb) is
  'Confirma um pagamento IfthenPay vindo do webhook. Atómica (FOR UPDATE), valida amount_cents, idempotente para callbacks repetidos. Service role apenas — qualquer chamada com auth.uid() não-nulo é recusada.';
