-- ════════════════════════════════════════════════════════════════
-- 0081 · Admin pode apagar clientes + scope de clientes mais inclusivo
--
-- 1) anonymize_client_account(p_client_id) — variante de
--    anonymize_my_account exposta ao admin. Apaga dados pessoais sem
--    obrigação de retenção e anonimiza o perfil do CLIENTE alvo
--    (mantém compras/marcações para retenção contabilística). Só
--    callable por owner/trainer (validado dentro da função). O bloqueio
--    de login (auth) continua a depender da service-role key no Node.
--
-- 2) count_clients_in_scope — inclui agora `profiles.trainer_id` no
--    "scope" de um trainer. Sem isto, um cliente que se REGISTOU no
--    trainer mas ainda não comprou nem marcou não contava no KPI e
--    nem aparecia em "Todos clientes". Também passa a EXCLUIR contas
--    anonimizadas (email termina em `@removido.invalid`).
--
-- REVERT: drop function if exists anonymize_client_account(uuid);
--         reaplicar 0033 para o count.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1) anonymize_client_account
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


-- ────────────────────────────────────────────────────────────────
-- 2) count_clients_in_scope · 3-way union + exclui removidos
-- ────────────────────────────────────────────────────────────────
create or replace function count_clients_in_scope(
  p_trainer_ids uuid[]
)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)
  from (
    select client_id as id from purchases where trainer_id = any(p_trainer_ids)
    union
    select client_id as id from bookings  where trainer_id = any(p_trainer_ids)
    union
    select id from profiles
      where role = 'client'
        and trainer_id = any(p_trainer_ids)
  ) s
  where exists (
    select 1 from profiles p
    where p.id = s.id
      and p.role = 'client'
      and coalesce(p.email, '') not like '%@removido.invalid'
  );
$$;

grant execute on function count_clients_in_scope(uuid[]) to authenticated;
