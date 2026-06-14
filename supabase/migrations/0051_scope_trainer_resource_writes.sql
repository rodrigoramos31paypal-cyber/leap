-- ════════════════════════════════════════════════════════════════
-- 0051 · C2 do audit de segurança — IDOR cross-trainer em escritas
--
-- ROOT CAUSE: as policies de WRITE de packs / trainer_settings /
-- trainer_availability / trainers usavam `is_admin()` puro. Como
-- is_admin() = role in ('trainer','owner'), QUALQUER trainer podia
-- escrever recursos de OUTRO trainer:
--   • packs        → alterar/desactivar/apagar preços de outro trainer
--                    (savePack/updatePack/togglePack/deletePack só
--                     filtram por id; a RLS era o único guard)
--   • trainer_settings → flip auto_confirm / thresholds de outro trainer
--                    (saveSettings confia no trainerId do form)
--   • trainer_availability → reescrever/apagar horários de outro trainer
--   • trainers     → editar bio/slug/active de outro trainer
--
-- A migração 0027 introduziu _trainer_is_accessible() e a 0028 aplicou-o
-- a trainer_blocked_times. Esta migração estende o MESMO padrão às
-- restantes tabelas — owner e service_role mantêm acesso total; cada
-- trainer fica restrito ao seu próprio registo.
--
-- Os SELECT continuam abertos pelas policies de leitura próprias de
-- cada tabela ("clients read", "read active", "availability: read",
-- "anyone authenticated reads active") — só endurecemos a escrita.
--
-- Requisitos: 0027 (_trainer_is_accessible). Padrão idêntico a 0028.
-- REVERT: recriar cada policy com `using (is_admin()) with check (is_admin())`.
-- ════════════════════════════════════════════════════════════════

-- ── packs (coluna trainer_id) ─────────────────────────────────────
drop policy if exists "packs: admin write" on packs;
create policy "packs: admin write" on packs
  for all
  using (is_admin() and _trainer_is_accessible(trainer_id))
  with check (is_admin() and _trainer_is_accessible(trainer_id));

-- ── trainer_settings (coluna trainer_id) ──────────────────────────
drop policy if exists "trainer_settings: admin all" on trainer_settings;
create policy "trainer_settings: admin all" on trainer_settings
  for all
  using (is_admin() and _trainer_is_accessible(trainer_id))
  with check (is_admin() and _trainer_is_accessible(trainer_id));

-- ── trainer_availability (coluna trainer_id) ──────────────────────
drop policy if exists "availability: admin write" on trainer_availability;
create policy "availability: admin write" on trainer_availability
  for all
  using (is_admin() and _trainer_is_accessible(trainer_id))
  with check (is_admin() and _trainer_is_accessible(trainer_id));

-- ── trainers (o id da linha É o trainer id) ───────────────────────
drop policy if exists "trainers: admin writes" on trainers;
create policy "trainers: admin writes" on trainers
  for all
  using (is_admin() and _trainer_is_accessible(id))
  with check (is_admin() and _trainer_is_accessible(id));

comment on policy "packs: admin write" on packs is
  'C2: escrita só para admins COM acesso ao trainer do pack. Owner/service total; trainer só o próprio.';
comment on policy "trainer_settings: admin all" on trainer_settings is
  'C2: escrita scoped por _trainer_is_accessible(trainer_id). Leitura continua aberta pela policy "trainer_settings: clients read".';
comment on policy "availability: admin write" on trainer_availability is
  'C2: escrita scoped por _trainer_is_accessible(trainer_id). Leitura continua aberta pela policy "availability: read".';
comment on policy "trainers: admin writes" on trainers is
  'C2: escrita scoped por _trainer_is_accessible(id). Leitura continua pelas policies de leitura de trainers.';
