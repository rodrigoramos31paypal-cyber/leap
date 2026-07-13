-- ════════════════════════════════════════════════════════════════
-- 0105 · Antecedência mínima de marcação (cliente)
--
-- Os clientes só podem marcar sessões com pelo menos N horas de
-- antecedência (default 12h). Ex.: às 03:00, a primeira hora marcável
-- é 15:00. Configurável por trainer em Definições → Regras.
--
-- Enforcement:
--   • UI/slots: getAvailableSlots (lib/availability.ts) corta os slots
--     a menos de N horas do agora.
--   • Server: as server actions do cliente (app/app/agenda/actions.ts)
--     revalidam antes de chamar a RPC.
-- Admins NÃO são afectados (marcam por outro caminho — app/admin/agenda).
--
-- REVERT:
--   alter table trainer_settings drop column if exists min_booking_notice_hours;
-- ════════════════════════════════════════════════════════════════
alter table trainer_settings
  add column if not exists min_booking_notice_hours integer not null default 12;

comment on column trainer_settings.min_booking_notice_hours is
  'Antecedência mínima (horas) com que um CLIENTE pode marcar uma sessão. 0 = sem mínimo. Default 12. Admins não são afectados.';
