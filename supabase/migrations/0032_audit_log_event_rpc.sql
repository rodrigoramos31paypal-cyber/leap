-- ════════════════════════════════════════════════════════════════
-- 0032 · RPC log_audit_event (H7 do audit de segurança)
--
-- A tabela audit_log já existia (0001) com RLS "admin read", mas NÃO
-- tinha policy de INSERT — ou seja, com RLS ligada, ninguém conseguia
-- escrever pelo client autenticado. Resultado: nada era auditado.
--
-- Esta RPC SECURITY DEFINER permite registar eventos de auditoria a
-- partir de código chamado por um utilizador autenticado (ex. o
-- endpoint /api/relatorios/export, que exporta PII e precisa de
-- rasto RGPD), SEM recorrer a service_role nesse caminho (regra H5).
--
-- Pontos de segurança:
--   • actor_id é SEMPRE auth.uid() — o caller não o pode falsificar.
--   • Só utilizadores autenticados podem registar (auth.uid() não-nulo).
--   • A leitura continua restrita a admins pela policy "audit: admin read".
-- ════════════════════════════════════════════════════════════════

create or replace function log_audit_event(
  p_action text,
  p_target_table text default null,
  p_target_id uuid default null,
  p_payload jsonb default null
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  -- Só autenticados. actor_id forçado ao caller (não falsificável).
  if auth.uid() is null then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if p_action is null or length(p_action) = 0 then
    raise exception 'action required' using errcode = '22023';
  end if;

  insert into audit_log (actor_id, action, target_table, target_id, payload)
  values (auth.uid(), p_action, p_target_table, p_target_id, p_payload);
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- Permissões — autenticado (o actor é sempre o próprio) + service_role.
-- anon não tem grant.
-- ────────────────────────────────────────────────────────────────
revoke all on function log_audit_event(text, text, uuid, jsonb) from public, anon;
grant execute on function log_audit_event(text, text, uuid, jsonb) to authenticated, service_role;

comment on function log_audit_event(text, text, uuid, jsonb) is
  'Regista um evento em audit_log com actor_id = auth.uid() (não falsificável). Usado para rasto RGPD de ações sensíveis como exportação de PII (H7). Leitura continua restrita a admins.';
