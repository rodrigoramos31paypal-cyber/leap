-- ════════════════════════════════════════════════════════════════
-- 0016 · Esconder `trainer_blocked_times.reason` aos clientes
--
-- Antes: a política RLS permitia SELECT a qualquer utilizador
-- autenticado. Isso expunha o campo `reason` (potencialmente PII —
-- "consulta médica", "funeral", …) a todos os clientes do estúdio.
--
-- Estratégia:
--   1. Restringir o SELECT do base table a admins.
--   2. Criar uma vista `public_blocked_times` que expõe apenas
--      colunas de tempo (sem `reason`), com `security_invoker=false`
--      para que ignore o RLS do base table (corre como dono).
--   3. lib/availability.ts e qualquer client-side passa a usar a
--      vista. O admin continua a ler o base table directamente.
-- ════════════════════════════════════════════════════════════════

-- 1) substitui a política de SELECT
drop policy if exists "blocked: read" on trainer_blocked_times;

create policy "blocked: admin select" on trainer_blocked_times
  for select using (is_admin());

-- 2) vista pública sem o campo `reason`
drop view if exists public_blocked_times;
create view public_blocked_times
  with (security_invoker = false)
  as
  select id, trainer_id, starts_at, ends_at
  from trainer_blocked_times;

-- 3) permissões na vista
revoke all on public_blocked_times from public;
grant select on public_blocked_times to authenticated;

-- Nota: NÃO fazemos column-level REVOKE em `reason`, porque os admins
-- usam createClient() (role authenticated) e precisam de SELECT (reason).
-- A protecção vem do RLS: clientes não vêem rows do base table de todo
-- (a política agora exige is_admin()), por isso `reason` fica
-- inalcançável a partir do client.
