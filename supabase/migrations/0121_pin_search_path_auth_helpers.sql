-- ════════════════════════════════════════════════════════════════
-- 0121 · M-1 (audit jun/2026) — pin search_path nas SECURITY DEFINER
--        auth helpers.
--
-- PROBLEMA
-- Quatro funções SECURITY DEFINER usadas na RLS e nas RPCs não fixavam
-- `search_path` e referenciavam `profiles`/`trainers` sem schema:
--   • is_admin()            (0002) — gate de quase toda a RLS
--   • current_role_name()   (0002)
--   • current_trainer_id()  (0002)
--   • _is_service_or_admin()(0015)
-- É o lint `function_search_path_mutable` do Supabase. Numa função
-- SECURITY DEFINER, se o search_path do caller incluísse um schema que
-- o atacante controla ANTES de `public`, um objecto `profiles`/`trainers`
-- aí colocado podia "sombrear" o real e alterar a decisão de
-- autorização. Em Supabase, anon/authenticated não conseguem criar
-- esses objectos por omissão, por isso a explorabilidade prática é
-- baixa — mas is_admin() é crítico (gate de RLS), e o fix é trivial.
--
-- FIX
-- Recriar as quatro funções com `set search_path = public`, mantendo o
-- corpo EXACTAMENTE igual. CREATE OR REPLACE preserva grants/owner, por
-- isso não há grants a refazer. Todas as outras 42 definer functions do
-- projecto já fixam search_path — isto fecha as últimas quatro.
--
-- REVERT: recriar cada função sem a linha `set search_path = public`
-- (ver 0002 / 0015).
-- ════════════════════════════════════════════════════════════════

create or replace function current_role_name()
returns user_role
language sql stable security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('trainer', 'owner') from profiles where id = auth.uid()),
    false
  )
$$;

create or replace function current_trainer_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select t.id from trainers t
    inner join profiles p on p.id = t.profile_id
    where p.id = auth.uid()
$$;

create or replace function _is_service_or_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is null or is_admin();
$$;
