-- ════════════════════════════════════════════════════════════════
-- 0050 · C1 do audit de segurança — escalada de privilégios via is_admin()
--
-- ROOT CAUSE: is_admin() (0002) devolve `role in ('trainer','owner')`,
-- por isso QUALQUER trainer contava como admin. Consequências:
--   (a) um trainer podia auto-promover-se a owner — o trigger
--       protect_profile_role (0010) só bloqueava `not is_admin()`,
--       que um trainer satisfaz. `PATCH /profiles?id=eq.<self>
--       {role:"owner"}` via PostgREST passava.
--   (b) a policy "profiles: admin update" (= is_admin()) deixava um
--       trainer alterar o perfil de QUALQUER utilizador (PII tamper).
--
-- FIX: introduz is_owner() e passa as operações sensíveis de
-- `profiles` a owner-only. O caminho de SERVICE ROLE mantém-se:
--   • o trigger conserva a isenção `auth.uid() IS NULL` → a gestão de
--     equipa em app/admin/equipa/actions.ts (createAdminClient) continua
--     a promover trainers;
--   • RLS é bypassada por service_role por natureza.
-- Edições self (app/app/perfil/actions.ts) continuam pela policy
-- "profiles: self update" (id = auth.uid()), que NÃO é alterada aqui.
--
-- REVERT: reaplicar a definição de 0010 (protect_profile_role com
-- is_admin) e recriar "profiles: admin update/insert" com is_admin();
-- drop function is_owner().
-- ════════════════════════════════════════════════════════════════

-- ── Helper: o caller é o OWNER? (não apenas staff) ────────────────
create or replace function is_owner()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select role = 'owner' from profiles where id = auth.uid()), false)
$$;

revoke all on function is_owner() from public;
grant execute on function is_owner() to anon, authenticated, service_role;

-- ── (1) Mudança de role: OWNER apenas ─────────────────────────────
-- Mantém a isenção de service role (auth.uid() IS NULL) introduzida
-- em 0010 — caso contrário addTrainerAction deixava de promover.
create or replace function protect_profile_role()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    -- service role (auth.uid() NULL) passa; utilizador autenticado tem
    -- de ser owner. Trainers e clientes são bloqueados.
    if auth.uid() is not null and not is_owner() then
      raise exception 'Apenas o owner pode alterar roles.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- (o trigger trg_protect_profile_role criado em 0003 continua a apontar
--  para esta função — CREATE OR REPLACE não o desliga.)

-- ── (2) Escrita cross-account em profiles: OWNER apenas ────────────
-- Antes: is_admin() → qualquer trainer. Agora: is_owner().
-- Self-edits continuam pela policy "profiles: self update" (inalterada).
drop policy if exists "profiles: admin update" on profiles;
create policy "profiles: owner update" on profiles
  for update using (is_owner()) with check (is_owner());

drop policy if exists "profiles: admin insert" on profiles;
create policy "profiles: owner insert" on profiles
  for insert with check (is_owner());

comment on function is_owner() is
  'TRUE se auth.uid() é um perfil com role = owner. Usar para poderes exclusivos do owner (mudança de roles, escrita cross-account em profiles). NÃO confundir com is_admin() (trainer OU owner).';
