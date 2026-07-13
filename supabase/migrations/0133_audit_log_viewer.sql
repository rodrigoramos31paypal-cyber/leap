-- ════════════════════════════════════════════════════════════════
-- 0133 · Registo de atividade (audit log) — coluna IP, eventos novos
--        e RPC de leitura paginada para o painel de admin.
--
-- CONTEXTO: sessões de clientes apareceram alteradas/canceladas sem
-- que nenhum admin tivesse agido. A tabela `audit_log` (0001) + a RPC
-- `log_audit_event` (0032 → 0128) já registavam VÁRIAS ações de admin,
-- mas faltava: (a) o IP de quem agiu, (b) cobertura das ações feitas
-- pelo próprio CLIENTE (marcar, cancelar, reagendar, comprar, editar
-- perfil, apagar conta), e (c) um ecrã para consultar tudo isto.
--
-- Esta migração trata das partes de base de dados:
--   1. Adiciona `audit_log.ip_address` (text — guarda tal como o proxy
--      o reporta, incluindo o sentinela "no-trusted-ip" do rate-limit,
--      que não é um inet válido; por isso text e não inet).
--   2. Recria `log_audit_event` com um parâmetro `p_ip` (opcional, para
--      retro-compat) e alarga o allowlist de ações aos eventos do lado
--      do cliente. actor_id continua = auth.uid() (não falsificável).
--   3. Cria `audit_log_page(...)` — RPC SECURITY DEFINER, só para admin
--      (is_admin()), que devolve uma PÁGINA do registo já com o nome do
--      autor e o nome do cliente afetado resolvidos, filtrável por ação
--      e com a contagem total para a paginação (10 por página na UI).
--
-- SEGURANÇA: leitura continua restrita a staff (is_admin() = trainer ou
-- owner). A escrita continua a passar SÓ pela RPC (o cliente não escreve
-- diretamente em audit_log — RLS sem policy de INSERT).
--
-- REVERT: `alter table audit_log drop column ip_address;` e reaplicar a
-- 0128 (versão da RPC sem p_ip); `drop function audit_log_page(...)`.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1) Coluna IP (idempotente).
-- ────────────────────────────────────────────────────────────────
alter table audit_log add column if not exists ip_address text;

-- Índice para o filtro por ação + ordenação cronológica da UI.
create index if not exists idx_audit_action_time
  on audit_log (action, created_at desc);

-- ────────────────────────────────────────────────────────────────
-- 2) RPC de escrita — agora com IP e allowlist alargado.
--
-- Dropamos a assinatura antiga (4 args) e criamos uma única função com
-- `p_ip` opcional no fim. Chamadas antigas (4 args nomeados) continuam a
-- resolver para esta função (p_ip fica null); a chamada nova passa p_ip.
-- ────────────────────────────────────────────────────────────────
drop function if exists log_audit_event(text, text, uuid, jsonb);

create or replace function log_audit_event(
  p_action text,
  p_target_table text default null,
  p_target_id uuid default null,
  p_payload jsonb default null,
  p_ip text default null
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

  -- Allowlist dos eventos emitidos pela app. Manter em sync com
  -- lib/audit.ts e as rotas de export ao adicionar novos eventos.
  if p_action not in (
    -- Exportação de PII (RGPD)
    'export_pii',
    'export_pii_self',
    -- Ações de admin sobre contas de cliente
    'client_create_admin',
    'client_delete_admin',
    'client_ban',
    'client_unban',
    -- Ações de admin sobre marcações
    'booking_create_admin',
    'booking_cancel_admin',
    'booking_reschedule_admin',
    -- Créditos / packs / pagamentos (admin)
    'pack_grant',
    'credits_adjust',
    'purchase_confirm',
    'purchase_reject',
    'purchase_cancel_confirmed',
    'purchase_delete',
    -- Pares duo (admin)
    'duo_link',
    'duo_unlink',
    -- ── NOVO (0133): ações feitas pelo próprio CLIENTE ──────────────
    'booking_create_client',
    'booking_reschedule_client',
    'booking_cancel_client',
    'purchase_create_client',
    'profile_update_self',
    'password_change_self',
    'account_delete_self'
  ) then
    raise exception 'unknown audit action: %', p_action using errcode = '22023';
  end if;

  -- Teto de tamanho do payload (defesa contra inchaço da tabela).
  if p_payload is not null and pg_column_size(p_payload) > 8192 then
    raise exception 'audit payload too large' using errcode = '22023';
  end if;

  -- Limita o tamanho do IP (defesa; um header forjado não deve inchar a linha).
  insert into audit_log (actor_id, action, target_table, target_id, payload, ip_address)
  values (auth.uid(), p_action, p_target_table, p_target_id, p_payload, left(p_ip, 100));
end;
$$;

revoke all on function log_audit_event(text, text, uuid, jsonb, text) from public, anon;
grant execute on function log_audit_event(text, text, uuid, jsonb, text) to authenticated, service_role;

comment on function log_audit_event(text, text, uuid, jsonb, text) is
  '0133: como 0128 (actor_id = auth.uid(), allowlist, teto de payload) + coluna IP e eventos do lado do cliente. Escrita de auditoria para staff e clientes autenticados; leitura via audit_log_page (admin).';

-- ────────────────────────────────────────────────────────────────
-- 3) RPC de leitura paginada para o painel de admin.
--
-- Devolve uma página do registo (mais recentes primeiro), já com:
--   • actor_name  → nome de quem fez a ação (profiles.full_name)
--   • client_name → nome do cliente AFETADO, resolvido a partir do
--                   target (bookings/purchases/profiles/duo) ou, em
--                   último caso, do payload.clientId
--   • total_count → total de linhas que passam o filtro (para paginação)
--
-- Só admin (is_admin() = trainer|owner). Fail-closed.
-- ────────────────────────────────────────────────────────────────
create or replace function audit_log_page(
  p_action text default null,
  p_limit int default 10,
  p_offset int default 0
) returns table (
  id uuid,
  created_at timestamptz,
  action text,
  actor_id uuid,
  actor_name text,
  target_table text,
  target_id uuid,
  client_name text,
  ip_address text,
  payload jsonb,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 10), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if not is_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  return query
  with filtered as (
    select a.*
    from audit_log a
    where p_action is null or a.action = p_action
  ),
  counted as (
    select count(*)::bigint as n from filtered
  ),
  -- Pagina PRIMEIRO (só 10 linhas) e só depois resolve os nomes por join.
  -- Assim os joins não correm sobre a tabela inteira.
  page as (
    select f.*
    from filtered f
    order by f.created_at desc
    offset v_offset
    limit v_limit
  )
  select
    p.id,
    p.created_at,
    p.action,
    p.actor_id,
    actor.full_name as actor_name,
    p.target_table,
    p.target_id,
    coalesce(
      case
        when p.target_table = 'profiles'  then tp.full_name
        when p.target_table = 'bookings'  then bp.full_name
        when p.target_table = 'purchases' then pp.full_name
        when p.target_table = 'duo_partnerships' then dp.full_name
      end,
      cp.full_name
    ) as client_name,
    p.ip_address,
    p.payload,
    (select n from counted) as total_count
  from page p
  left join profiles actor on actor.id = p.actor_id
  -- target = profiles (ex: client_create_admin, client_ban, ...)
  left join profiles tp on p.target_table = 'profiles' and tp.id = p.target_id
  -- target = bookings → cliente da marcação
  left join bookings b on p.target_table = 'bookings' and b.id = p.target_id
  left join profiles bp on bp.id = b.client_id
  -- target = purchases → cliente da compra
  left join purchases pu on p.target_table = 'purchases' and pu.id = p.target_id
  left join profiles pp on pp.id = pu.client_id
  -- target = duo_partnerships → o target_id é o profile do cliente
  left join profiles dp on p.target_table = 'duo_partnerships' and dp.id = p.target_id
  -- fallback: payload.clientId (quando existe e é um uuid válido). O cast
  -- ::uuid fica DENTRO do CASE — só corre quando o regex confirma o
  -- formato, para nunca rebentar com "invalid input syntax for type uuid".
  left join profiles cp
    on cp.id = case
      when (p.payload ->> 'clientId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (p.payload ->> 'clientId')::uuid
    end
  order by p.created_at desc;
end;
$$;

revoke all on function audit_log_page(text, int, int) from public, anon;
grant execute on function audit_log_page(text, int, int) to authenticated, service_role;

comment on function audit_log_page(text, int, int) is
  '0133: página do registo de atividade para admin (is_admin()). Resolve nome do autor e do cliente afetado e devolve total_count para paginação. Filtro opcional por ação.';
