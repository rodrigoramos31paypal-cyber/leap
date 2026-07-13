-- ════════════════════════════════════════════════════════════════
-- 0128 · L-1 do audit (jul/2026) — endurecer log_audit_event
--
-- ROOT CAUSE: a RPC log_audit_event (0032) força actor_id = auth.uid()
-- (bom, não falsificável), mas p_action e p_payload eram livres e a
-- função tem grant a `authenticated`. Qualquer cliente autenticado podia
-- chamá-la em loop com ações arbitrárias e payloads grandes, poluindo /
-- inchando a trilha de auditoria RGPD (audit_log).
--
-- FIX: validar p_action contra um allowlist dos eventos que a app
-- realmente emite (lib/audit.ts + rotas de export), limitar o tamanho de
-- p_action e o tamanho de p_payload. Tudo o resto é rejeitado com 22023.
-- O wrapper logAudit() é best-effort (apanha o erro e continua), por isso
-- um evento novo esquecido no allowlist NÃO parte fluxos de admin — só
-- deixa de ser registado e loga um erro server-side (sinal para adicionar
-- ao allowlist). As exportações de PII (export_pii / export_pii_self) já
-- estão incluídas, logo o caminho fail-closed do RGPD não é afetado.
--
-- Mantém assinatura, grants e comportamento de actor_id iguais a 0032.
-- REVERT: reaplicar 0032 (versão sem allowlist).
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

  -- L-1: allowlist dos eventos emitidos pela app. Bloqueia poluição do
  -- audit log com ações arbitrárias. Manter em sync com lib/audit.ts e
  -- as rotas de export ao adicionar novos eventos.
  if p_action not in (
    'export_pii',
    'export_pii_self',
    'client_create_admin',
    'client_delete_admin',
    'client_ban',
    'client_unban',
    'booking_create_admin',
    'booking_cancel_admin',
    'booking_reschedule_admin',
    'pack_grant',
    'credits_adjust',
    'purchase_confirm',
    'purchase_reject',
    'purchase_cancel_confirmed',
    'purchase_delete',
    'duo_link',
    'duo_unlink'
  ) then
    raise exception 'unknown audit action: %', p_action using errcode = '22023';
  end if;

  -- L-1: teto de tamanho do payload (defesa contra inchaço da tabela).
  if p_payload is not null and pg_column_size(p_payload) > 8192 then
    raise exception 'audit payload too large' using errcode = '22023';
  end if;

  insert into audit_log (actor_id, action, target_table, target_id, payload)
  values (auth.uid(), p_action, p_target_table, p_target_id, p_payload);
end;
$$;

-- Grants inalterados (idempotente — igual a 0032).
revoke all on function log_audit_event(text, text, uuid, jsonb) from public, anon;
grant execute on function log_audit_event(text, text, uuid, jsonb) to authenticated, service_role;

comment on function log_audit_event(text, text, uuid, jsonb) is
  'L-1: como 0032 (actor_id = auth.uid(), não falsificável) + allowlist de p_action e teto de 8KB no payload — bloqueia poluição do audit log por qualquer autenticado.';
