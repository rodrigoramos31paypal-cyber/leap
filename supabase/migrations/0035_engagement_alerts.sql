-- ════════════════════════════════════════════════════════════════
-- 0035_engagement_alerts
--
-- Re-engagement: avisos de saldo baixo / sem sessões / pack a expirar.
-- Reutiliza notification_preferences (kind = 'credit_alert' como opt-out).
--
--   • engagement_alerts — dedup/cooldown dos avisos enviados.
--       - 'credit_low'    → ref_id null; cooldown por tempo (ver route).
--       - 'pack_expiring' → ref_id = purchase_id; uma vez por compra.
--
-- RLS ligado SEM políticas: só service role (cron) lhe toca.
--
-- REVERT: drop table if exists engagement_alerts;
-- ════════════════════════════════════════════════════════════════

create table if not exists engagement_alerts (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references profiles(id) on delete cascade,
  kind     text not null,          -- 'credit_low' | 'pack_expiring'
  ref_id   text,                   -- purchase_id p/ 'pack_expiring'; null p/ 'credit_low'
  sent_at  timestamptz not null default now()
);

create index if not exists idx_engagement_alerts_user_kind
  on engagement_alerts (user_id, kind, sent_at desc);

-- Dedup forte por compra quando há ref_id (uma só vez por pack a expirar).
create unique index if not exists uq_engagement_alerts_ref
  on engagement_alerts (user_id, kind, ref_id)
  where ref_id is not null;

alter table engagement_alerts enable row level security;
