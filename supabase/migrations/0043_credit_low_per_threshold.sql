-- ════════════════════════════════════════════════════════════════
-- 0043_credit_low_per_threshold
--
-- Permite distinguir avisos de saldo por threshold (2 vs 0) via
-- engagement_alerts.ref_id. O unique index global criado em 0035 ficava
-- no caminho — refazê-lo APENAS para `pack_expiring` (uma vez por
-- compra, como sempre). Para `credit_low`, ref_id é '2' ou '0' e o
-- cooldown é temporal por threshold (verificado no cron).
--
-- REVERT:
--   drop index if exists uq_engagement_alerts_pack_expiring;
--   create unique index uq_engagement_alerts_ref
--     on engagement_alerts (user_id, kind, ref_id)
--     where ref_id is not null;
-- ════════════════════════════════════════════════════════════════

drop index if exists uq_engagement_alerts_ref;

create unique index if not exists uq_engagement_alerts_pack_expiring
  on engagement_alerts (user_id, ref_id)
  where kind = 'pack_expiring' and ref_id is not null;
