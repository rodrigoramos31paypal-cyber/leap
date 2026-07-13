-- ════════════════════════════════════════════════════════════════
-- 0039_show_cancelled_in_calendar
--
-- Preferência do trainer: mostrar (ou não) sessões canceladas na agenda.
-- Default FALSE → canceladas escondidas (evita o calendário cheio de
-- eventos sobrepostos/riscados).
--
-- REVERT: alter table trainer_settings drop column show_cancelled_in_calendar;
-- ════════════════════════════════════════════════════════════════
alter table trainer_settings
  add column if not exists show_cancelled_in_calendar boolean not null default false;
