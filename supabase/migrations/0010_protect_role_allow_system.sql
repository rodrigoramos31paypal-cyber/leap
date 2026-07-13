-- ════════════════════════════════════════════════════════════════
-- protect_profile_role: permite mudança de role quando o caller
-- não tem sessão (auth.uid() is null) — service role / SQL editor.
-- ════════════════════════════════════════════════════════════════

create or replace function protect_profile_role()
returns trigger language plpgsql security definer as $$
begin
  if new.role is distinct from old.role then
    -- bloqueia apenas quando o utilizador autenticado NÃO é admin
    if auth.uid() is not null and not is_admin() then
      raise exception 'Não tens permissão para alterar o role.';
    end if;
  end if;
  return new;
end;
$$;
