-- ════════════════════════════════════════════════════════════════
-- 0048_weekly_streak_alerts
--
-- Dedup do envio semanal de parabéns por streak. PK composta por
-- (user_id, week_start) garante 1 envio por utilizador por semana.
-- O cron (segunda-feira) reclama a linha antes de notificar; se já
-- existir, salta — idempotente a qualquer cadência.
--
-- week_start convenção: SEGUNDA-FEIRA da semana de referência (a
-- semana que ACABOU no domingo anterior à corrida do cron).
--
-- REVERT: drop table if exists weekly_streak_alerts;
-- ════════════════════════════════════════════════════════════════
create table if not exists weekly_streak_alerts (
  user_id      uuid not null references profiles(id) on delete cascade,
  week_start   date not null,
  streak_weeks integer not null,
  sent_at      timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table weekly_streak_alerts enable row level security;
-- Sem políticas: tabela puramente interna do cron (service role).
