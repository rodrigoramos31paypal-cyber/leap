-- ════════════════════════════════════════════════════════════════
-- 0140_trusted_device_ua_hash  (audit jul/2026 · M3)
--
-- Liga cada trusted-device ao browser que o criou. Guardamos o hash
-- (sha256 hex) do User-Agent no momento em que o device é confiado; a
-- validação em `isDeviceTrusted` passa a exigir que o UA do request
-- actual corresponda. Assim, um cookie `lf_td` exfiltrado deixa de ser
-- reutilizável num cliente com UA diferente.
--
-- Registos antigos (ua_hash NULL) continuam a validar por
-- compatibilidade — expiram naturalmente aos 30 dias.
--
-- REVERT: alter table trusted_devices drop column if exists ua_hash;
-- ════════════════════════════════════════════════════════════════
alter table trusted_devices
  add column if not exists ua_hash text;
