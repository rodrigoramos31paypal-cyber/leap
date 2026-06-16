-- 0082_remove_ifthenpay.sql
-- ════════════════════════════════════════════════════════════════
-- Remove a integração IfthenPay (gateway de pagamento automático).
--
-- O fluxo de compra do cliente passou a ser 100% MANUAL (MB WAY /
-- Revolut com confirmação do admin). O código da app que falava com a
-- IfthenPay (lib/ifthenpay.ts, o webhook /api/webhooks/ifthenpay e a
-- página /app/compras/[id]/gateway) foi eliminado, por isso as RPC do
-- callback automático deixam de ter quem as chame.
--
-- NOTA sobre o enum: os valores legacy de payment_method
-- ('mbway', 'multibanco', 'card') e payment_gateway ('ifthenpay') NÃO
-- são removidos — registos históricos de compras podem usá-los e o
-- Postgres não permite apagar valores de enum em uso sem recriar o
-- tipo (operação arriscada). Ficam apenas como legacy; nenhum código
-- novo os escreve.
-- ════════════════════════════════════════════════════════════════

-- Remove TODAS as overloads das funções do fluxo IfthenPay,
-- independentemente da assinatura, de forma idempotente.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT 'DROP FUNCTION IF EXISTS public.'
           || p.proname || '('
           || pg_get_function_identity_arguments(p.oid) || ') CASCADE' AS stmt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('confirm_ifthenpay_callback', 'set_payment_gateway_info')
  LOOP
    EXECUTE r.stmt;
  END LOOP;
END $$;
