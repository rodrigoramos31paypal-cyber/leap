-- ════════════════════════════════════════════════════════════════
-- 0083 · Trainer-scope checks nas RPCs admin/cliente (C-1 audit jun/2026)
--
-- CONTEXTO
-- A maioria das RPCs `SECURITY DEFINER` que mexem em recursos de
-- trainer já valida `_trainer_is_accessible(trainer_id)` (introduzido
-- em 0027). Estas RPCs operam sobre um `p_purchase_id` ou um
-- `p_trainer_id` → fácil resolver para o trainer.
--
-- LACUNA
-- Duas RPCs operam sobre um `p_client_id` (perfil de cliente) sem
-- referência directa a um trainer:
--   • set_client_banned(p_client_id, p_banned)            (0066)
--   • anonymize_client_account(p_client_id)               (0081)
-- Hoje validam só `_is_service_or_admin()` (role-based). Num estúdio
-- com vários trainers, trainer A consegue suspender/anonimizar um
-- cliente de trainer B → fraude financeira (banimento abusivo) e
-- destruição de PII alheia.
--
-- FIX
-- 1) Novo helper `_client_is_accessible(p_client_id)` que devolve
--    TRUE se o caller é service-role, owner, ou se o cliente "cai
--    no scope" de pelo menos um dos trainers do caller (mesma
--    união 3-way que `count_clients_in_scope` em 0081: purchases ∪
--    bookings ∪ profiles.trainer_id).
-- 2) `set_client_banned` e `anonymize_client_account` passam a
--    rejeitar com 42501 quando o cliente está fora do scope do
--    caller (e o caller não é owner / service-role).
--
-- IMPORTANTE
-- Defesa em profundidade no DB. A camada de aplicação (server
-- actions) também restringe estas operações a `requireOwner()` —
-- mas a defesa do DB tem de ficar de pé sozinha caso a UI mude.
--
-- REVERT
-- drop function if exists _client_is_accessible(uuid);
-- reaplicar versões de set_client_banned (0066) e
-- anonymize_client_account (0081).
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- Helper: o cliente alvo está acessível ao caller?
--
-- Regra:
--   • service-role (auth.uid() IS NULL) → sempre TRUE
--   • owner                              → sempre TRUE
--   • trainer                            → TRUE se existe uma ligação
--       (purchases / bookings / profiles.trainer_id) entre o cliente
--       alvo e algum trainer pertencente ao caller.
--   • qualquer outro                     → FALSE
-- ────────────────────────────────────────────────────────────────
create or replace function _client_is_accessible(p_client_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    auth.uid() is null
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
    or exists (
      -- união 3-way: cliente "pertence" a algum trainer do caller
      select 1
      from trainers t
      where t.profile_id = auth.uid()
        and (
          exists (select 1 from purchases pu where pu.client_id = p_client_id and pu.trainer_id = t.id)
          or exists (select 1 from bookings  bk where bk.client_id = p_client_id and bk.trainer_id = t.id)
          or exists (select 1 from profiles  cp where cp.id = p_client_id and cp.trainer_id = t.id)
        )
    ),
    false
  )
$$;

comment on function _client_is_accessible(uuid) is
  'C-1 hardening (jun/2026): TRUE se o cliente alvo está no scope do '
  'trainer/owner autenticado (purchases ∪ bookings ∪ profiles.trainer_id). '
  'Service-role e owner passam sempre. Usar em RPCs admin que recebem '
  'um p_client_id sem trainer_id explícito.';

revoke all on function _client_is_accessible(uuid) from public, anon;
grant execute on function _client_is_accessible(uuid) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────
-- set_client_banned · scope check adicional (body baseado em 0066)
-- ────────────────────────────────────────────────────────────────
create or replace function set_client_banned(
  p_client_id uuid,
  p_banned boolean
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  -- C-1: trainer só pode (des)suspender clientes que estão no seu scope.
  -- Owner e service-role passam sempre.
  if auth.uid() is not null and not _client_is_accessible(p_client_id) then
    raise exception 'access denied (scope)' using errcode = '42501';
  end if;

  -- Só clientes podem ser suspensos (nunca staff).
  if not exists (select 1 from profiles where id = p_client_id and role = 'client') then
    raise exception 'Cliente inválido';
  end if;
  update profiles set banned = p_banned where id = p_client_id;
end;
$$;

revoke all on function set_client_banned(uuid, boolean) from public, anon;
grant execute on function set_client_banned(uuid, boolean) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────
-- anonymize_client_account · scope check adicional (body baseado em 0081)
-- ────────────────────────────────────────────────────────────────
create or replace function anonymize_client_account(
  p_client_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role user_role;
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  -- C-1: trainer só pode anonimizar clientes do seu scope. Owner/service
  -- passam sempre. (Continuamos a bloquear apagar contas de staff.)
  if auth.uid() is not null and not _client_is_accessible(p_client_id) then
    raise exception 'access denied (scope)' using errcode = '42501';
  end if;

  select role into v_target_role from profiles where id = p_client_id;
  if v_target_role is null then
    raise exception 'Cliente não encontrado';
  end if;
  if v_target_role <> 'client' then
    raise exception 'Só contas de cliente podem ser apagadas por aqui';
  end if;

  delete from session_notes where author_id = p_client_id;
  delete from notifications where user_id = p_client_id;
  delete from calendar_integrations where user_id = p_client_id;
  delete from push_subscriptions where user_id = p_client_id;
  delete from notification_preferences where user_id = p_client_id;
  delete from engagement_alerts where user_id = p_client_id;
  delete from booking_reminders where recipient_id = p_client_id;

  update profiles
    set full_name = 'Cliente removido',
        email = 'apagado+' || p_client_id::text || '@removido.invalid',
        phone = null,
        calendar_feed_token = gen_random_uuid()
  where id = p_client_id;
end;
$$;

revoke all on function anonymize_client_account(uuid) from public, anon;
grant execute on function anonymize_client_account(uuid) to authenticated, service_role;
