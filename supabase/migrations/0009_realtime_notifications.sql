-- ════════════════════════════════════════════════════════════════
-- Activa Supabase Realtime na tabela notifications para que o
-- sino atualize sem refresh.
-- ════════════════════════════════════════════════════════════════
alter publication supabase_realtime add table notifications;
