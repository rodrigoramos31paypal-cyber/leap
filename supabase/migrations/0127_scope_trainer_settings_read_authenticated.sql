-- ════════════════════════════════════════════════════════════════
-- 0127 · M-4 do audit (jul/2026) — trainer_settings legível por anon
--
-- ROOT CAUSE: a policy de leitura criada em 0003
--   create policy "trainer_settings: clients read" on trainer_settings
--     for select using (true);
-- não declara `to`, por isso aplica-se ao role `anon` (sem login). Um
-- visitante não-autenticado podia ler config de negócio via PostgREST
-- direto com a chave anon pública:
--   GET /rest/v1/trainer_settings
-- expondo janelas de cancelamento, thresholds, flags auto_confirm /
-- charge_no_show, buffers, etc. Não é PII, mas é configuração interna
-- que não precisa de ser pública (princípio do menor privilégio).
--
-- PORQUE É SEGURO RESTRINGIR: nenhum caminho da app lê trainer_settings
-- sem sessão. /api/slots exige sessão no middleware (getClaims) e
-- getAvailableSlots corre sob RLS autenticada; os restantes leitores
-- estão todos em /admin (staff) e /app (autenticado). service_role
-- ignora RLS, por isso jobs/servidor não são afetados.
--
-- Mudamos APENAS os roles a que a policy se aplica (de `public` →
-- `authenticated`), sem tocar na expressão USING.
--
-- NOTA relacionada (fora do âmbito desta migração): as policies
-- "availability: read" e "blocked: read" (0003) também usam
-- `using (true)` sem `to`. Existe já uma família de vistas `public_*`
-- (public_busy_times / public_blocked_times / public_recurring_blocks)
-- pensada como projeção anon-safe — vale a pena rever depois se as
-- tabelas-base ainda precisam de leitura anon direta.
--
-- REVERT:
--   alter policy "trainer_settings: clients read" on trainer_settings to public;
-- ════════════════════════════════════════════════════════════════

alter policy "trainer_settings: clients read" on trainer_settings
  to authenticated;

comment on policy "trainer_settings: clients read" on trainer_settings is
  'M-4: leitura restrita a autenticados (era public → incluía anon). Config de negócio não é exposta pela chave anon. Escrita continua scoped por "trainer_settings: admin all" (0051).';
