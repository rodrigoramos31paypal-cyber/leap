-- ════════════════════════════════════════════════════════════════
-- 0101 · Preferências de notificação POR CANAL (push / email)
--
-- Antes: notification_preferences era 1 boolean (`enabled`) por `kind`.
-- Agora cada linha (user_id, kind=CATEGORIA) tem dois canais separados:
-- email_enabled e push_enabled. O in-app (sininho) é sempre ON.
--
-- Categorias:
--   Cliente:  sessions · packs · ratings
--   Treinador: bookings · payments · notes · reminders
--
-- "Sem linha" para uma categoria = tudo ON (default). Só gravamos quando
-- o utilizador desliga algo.
-- ════════════════════════════════════════════════════════════════

alter table notification_preferences
  add column if not exists email_enabled boolean not null default true;
alter table notification_preferences
  add column if not exists push_enabled boolean not null default true;

-- Migra os opt-outs legados (kind 'session_reminder' / 'credit_alert')
-- para as novas categorias, preservando a escolha do utilizador.
insert into notification_preferences (user_id, kind, enabled, email_enabled, push_enabled)
select user_id, 'sessions', enabled, enabled, enabled
from notification_preferences
where kind = 'session_reminder'
on conflict (user_id, kind) do nothing;

insert into notification_preferences (user_id, kind, enabled, email_enabled, push_enabled)
select user_id, 'packs', enabled, enabled, enabled
from notification_preferences
where kind = 'credit_alert'
on conflict (user_id, kind) do nothing;
