-- ════════════════════════════════════════════════════════════════
-- 0030 · calendar_feed_token
--
-- Token único por utilizador para subscrição iCal (webcal://) do
-- calendário pessoal do telemóvel (iOS Settings → Calendar → Add
-- Subscribed Calendar, ou Google Calendar no Android).
--
-- Não requer OAuth: o endpoint /api/calendar/feed/<token>.ics serve
-- o feed sem sessão, autenticado apenas pelo token (segredo na URL).
-- Se for comprometido, o user pode rodar o token (UPDATE manual ou
-- futura action). O token NÃO dá acesso à app, só leitura do feed.
-- ════════════════════════════════════════════════════════════════

alter table profiles
  add column if not exists calendar_feed_token uuid not null default gen_random_uuid();

-- Garantir unicidade para lookup por token (acelera o GET do feed).
create unique index if not exists idx_profiles_calendar_feed_token
  on profiles(calendar_feed_token);
