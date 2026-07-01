-- ════════════════════════════════════════════════════════════════
-- 0130_scope_anon_profiles_columns
--
-- [HIGH H-1] PII de staff (email, phone) legível por anónimos.
--
-- A 0045 fez `grant select on profiles to anon` (tabela inteira, sem lista
-- de colunas) + policy que deixa anon ler qualquer linha trainer/owner.
-- A página pública /t/<slug> só precisa de `full_name`, mas anon conseguia
-- ler `email`, `phone`, etc. de todo o staff via REST → phishing/spam.
--
-- Correcção: substituir o grant table-wide por um grant restrito a colunas
-- (só id + full_name). A policy de row-level de 0045 mantém-se; as colunas
-- usadas na cláusula USING (`role`) não precisam de grant para serem
-- avaliadas pela RLS.
--
-- A query da página pública (lib/public-trainer.ts) faz o embed
-- `profiles:profile_id(full_name)` e resolve a relação por `id` — ambas as
-- colunas ficam cobertas por este grant, por isso não é preciso mexer no código.
--
-- VERIFICAR (Supabase SQL editor) — anon só deve ter privilégio em id/full_name:
--   select table_name, column_name, privilege_type
--   from information_schema.column_privileges
--   where grantee = 'anon' and table_name = 'profiles'
--   order by column_name;
--   -- e confirmar que NÃO há grant table-wide:
--   select has_table_privilege('anon','profiles','select');  -- deve continuar
--   -- false a nível de tabela inteira; o acesso é só por coluna.
--
-- REVERT:
--   revoke select (id, full_name) on profiles from anon;
--   grant select on profiles to anon;
-- ════════════════════════════════════════════════════════════════

-- Remover o acesso table-wide (expõe email/phone/…).
revoke select on profiles from anon;

-- Conceder apenas as colunas que a página pública precisa.
-- (id → resolução do embed por FK trainers.profile_id; full_name → nome público.)
grant select (id, full_name) on profiles to anon;
