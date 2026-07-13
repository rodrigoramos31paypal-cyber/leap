-- ════════════════════════════════════════════════════════════════
-- 0019 · Fix: cancel_refund missing from credit_reason enum
--
-- A função `cancel_booking` (migration 0008/0015) tenta inserir
-- 'cancel_refund' em credit_transactions.reason, mas o enum
-- `credit_reason` (migration 0001) não tem esse valor. Resultado:
-- ao cancelar uma sessão, Postgres devolve erro 22P02
-- (invalid_text_representation) e o cancelamento falha.
--
-- Solução: adicionar 'cancel_refund' ao enum.
-- ════════════════════════════════════════════════════════════════

alter type credit_reason add value if not exists 'cancel_refund';
