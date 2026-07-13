-- ════════════════════════════════════════════════════════════════
-- 0064 · Vista `public_busy_times` — horários ocupados (anónimos)
--        para o cálculo de disponibilidade
--
-- Bug: os slots oferecidos ao cliente em /api/slots não excluíam as
-- marcações de OUTROS clientes. A query de disponibilidade
-- (lib/availability.ts) corre sob a RLS do utilizador, e a política de
-- SELECT em `bookings` só deixa cada cliente ver as SUAS marcações
-- (client_id = auth.uid()). Resultado: uma sessão das 09:00–09:45 de
-- outro cliente ficava invisível e o sistema mostrava 08:30 e 09:15
-- como livres — só a RPC (security definer) é que recusava no fim, com
-- o erro reactivo "Já existe uma marcação neste horário".
--
-- Estratégia (igual à de 0016 para `public_blocked_times`):
--   • Vista que expõe APENAS as colunas de tempo das marcações ACTIVAS
--     (booked/confirmed) — sem client_id, sem session_type, sem nada
--     que identifique quem marcou. Só "este trainer está ocupado de X
--     a Y". É o mínimo necessário para calcular slots livres.
--   • `security_invoker = false` → a vista corre como dono e ignora a
--     RLS do base table, por isso qualquer autenticado consegue ler os
--     intervalos ocupados (sem ver as linhas do base table).
--   • GRANT SELECT só a `authenticated`.
--
-- lib/availability.ts passa a ler desta vista em vez de `bookings`.
-- Os fluxos de admin continuam a ler `bookings` directamente.
--
-- REVERT: drop view public_busy_times;  (e reverter lib/availability.ts)
-- ════════════════════════════════════════════════════════════════

drop view if exists public_busy_times;
create view public_busy_times
  with (security_invoker = false)
  as
  select id, trainer_id, starts_at, ends_at
  from bookings
  where status in ('booked', 'confirmed');

revoke all on public_busy_times from public, anon;
grant select on public_busy_times to authenticated;
