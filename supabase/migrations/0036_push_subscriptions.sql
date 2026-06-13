-- ════════════════════════════════════════════════════════════════
-- 0036_push_subscriptions
--
-- Web Push (PWA): guarda as subscrições de push por utilizador.
-- O envio é feito server-side (web-push + VAPID) a partir de
-- /api/push/dispatch, accionado por um Database Webhook em INSERT
-- na tabela notifications.
--
-- REVERT: drop table if exists push_subscriptions;
-- ════════════════════════════════════════════════════════════════

create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subs_user on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

-- Cada utilizador gere apenas as SUAS subscrições. O dispatch lê-as via
-- service role (bypass RLS).
create policy push_subs_select on push_subscriptions
  for select using (user_id = auth.uid());
create policy push_subs_insert on push_subscriptions
  for insert with check (user_id = auth.uid());
create policy push_subs_update on push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subs_delete on push_subscriptions
  for delete using (user_id = auth.uid());
