-- ════════════════════════════════════════════════════════════════
-- 0122 · L-2 (audit jun/2026) — índice em profiles.calendar_feed_token
--
-- A rota /api/calendar/feed/[token] faz
--   select ... from profiles where calendar_feed_token = <token>
-- a cada refresh de um cliente de calendário (iOS/Google, ~1×/hora por
-- subscritor). Sem índice, é um sequential scan de `profiles` por fetch.
-- Negligível hoje, cresce linearmente com o nº de utilizadores.
--
-- Índice parcial (só linhas com token não-nulo) — menor e suficiente,
-- já que o lookup é sempre por um token concreto.
--
-- REVERT: drop index if exists idx_profiles_calendar_feed_token;
-- ════════════════════════════════════════════════════════════════
create index if not exists idx_profiles_calendar_feed_token
  on profiles (calendar_feed_token)
  where calendar_feed_token is not null;
