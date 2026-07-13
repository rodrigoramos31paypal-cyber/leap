-- ════════════════════════════════════════════════════════════════
-- 0108 · calendar_feed_last_fetched_at
--
-- Não temos forma de saber, do lado do servidor, se o utilizador
-- carregou em "Subscrever" — isso acontece no dispositivo. MAS o
-- dispositivo, quando subscrito, vai buscar o feed iCal
-- (/api/calendar/feed/<token>.ics) periodicamente. Registar o
-- instante do último fetch dá-nos um sinal fiável de que a
-- subscrição está ativa e a sincronizar, para podermos mostrar
-- esse estado ao cliente no perfil.
-- ════════════════════════════════════════════════════════════════

alter table profiles
  add column if not exists calendar_feed_last_fetched_at timestamptz;

comment on column profiles.calendar_feed_last_fetched_at is
  'Último instante em que um cliente de calendário foi buscar o feed iCal deste utilizador. Sinal de subscrição ativa (best-effort).';
