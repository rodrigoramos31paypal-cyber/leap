-- ════════════════════════════════════════════════════════════════
-- 0045_public_trainer_profile
--
-- Acesso público (anon) à página do trainer indexável (/t/<slug>):
--   • trainers (activos) — slug, bio.
--   • profiles dos trainers — full_name.
--   • trainer_rating_stats e trainer_recent_reviews (já estavam
--     granted em 0044 — aqui só reforçamos por segurança).
--
-- As policies existentes não tinham clause `to` por isso já aplicavam
-- a `anon`, mas os GRANTs nas tabelas podiam não estar. Esta migração
-- garante ambas as coisas e cria policies dedicadas a `anon` com a
-- mínima superfície (só rows necessárias e só colunas seguras a partir
-- de queries que o cliente faz na página pública).
--
-- REVERT:
--   drop policy if exists "trainers: anon reads active" on trainers;
--   drop policy if exists "profiles: anon reads trainers" on profiles;
--   revoke select on trainers from anon;
--   revoke select on profiles from anon;
-- ════════════════════════════════════════════════════════════════

-- ── Trainers: anon pode ler trainers ACTIVOS ─────────────────────
drop policy if exists "trainers: anon reads active" on trainers;
create policy "trainers: anon reads active" on trainers
  for select to anon using (active = true);

grant select on trainers to anon;

-- ── Profiles: anon pode ler perfis cujo role é trainer/owner ─────
-- A view pública só usa full_name; bio fica em trainers.bio.
drop policy if exists "profiles: anon reads trainers" on profiles;
create policy "profiles: anon reads trainers" on profiles
  for select to anon using (role in ('trainer', 'owner'));

grant select on profiles to anon;

-- ── Views de ratings: re-grant (idempotente, garante consistência)
grant select on trainer_rating_stats   to anon;
grant select on trainer_recent_reviews to anon;
