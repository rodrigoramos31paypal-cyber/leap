-- ════════════════════════════════════════════════════════════════
-- 0028 · RLS scope em trainer_blocked_times (defesa em camadas C4)
--
-- Em 0027 o `deleteBlockAction` passou a verificar
-- `_trainer_is_accessible(trainer_id)` antes do DELETE. Mas se um
-- bug futuro fizer um DELETE/UPDATE/INSERT directo (server action
-- nova, script de manutenção, query manual com role authenticated),
-- a RLS antiga (`is_admin()` puro) aceitava porque qualquer trainer
-- conta como admin.
--
-- Esta migração endurece a policy de WRITE para exigir também scope.
-- A policy de SELECT mantém-se como `is_admin()` (admin precisa de
-- ler todos os bloqueios para o conflict-check em create_booking,
-- que corre como SECURITY DEFINER e portanto bypassa RLS — mas a
-- camada de UI faz queries directas filtradas por
-- `getAccessibleTrainerIds()`, portanto não precisamos de filtrar
-- também na RLS).
--
-- Requisitos: migration 0027 (que cria `_trainer_is_accessible`)
-- tem de estar aplicada antes desta.
-- ════════════════════════════════════════════════════════════════

drop policy if exists "blocked: admin write" on trainer_blocked_times;

create policy "blocked: admin write" on trainer_blocked_times
  for all
  using (is_admin() and _trainer_is_accessible(trainer_id))
  with check (is_admin() and _trainer_is_accessible(trainer_id));

comment on policy "blocked: admin write" on trainer_blocked_times is
  'C4 hardening: admins só podem inserir/alterar/apagar bloqueios dos trainers a que têm acesso. Owner vê todos; trainer só o seu próprio. Service role bypassa RLS naturalmente.';
