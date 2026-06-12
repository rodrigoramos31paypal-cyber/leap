-- ════════════════════════════════════════════════════════════════
-- Permite a qualquer utilizador autenticado ver os perfis de
-- trainers/owners (nome, bio). Sem isto, o picker mostra strings vazias.
-- ════════════════════════════════════════════════════════════════
drop policy if exists "profiles: read trainers" on profiles;
create policy "profiles: read trainers" on profiles
  for select using (role in ('trainer', 'owner'));

-- (Adicional ao "profiles: self select" existente — combinação é OR.)
