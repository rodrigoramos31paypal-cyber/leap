-- ════════════════════════════════════════════════════════════════
-- 0135 · Registo de atividade — filtro exato por cliente
--
-- Acrescenta `p_client_id` a `audit_log_page` (0134). Serve o typeahead
-- de clientes: quando o admin escolhe um cliente da lista, filtramos os
-- registos EXATAMENTE por essa conta (por id), em vez de por texto. Se
-- `p_client_id` vier preenchido, a pesquisa de texto (`p_search`) é
-- ignorada.
--
-- Assinatura nova: (p_action, p_search, p_client_id, p_limit, p_offset).
-- Dropamos a versão de 4 args (0134) para não haver ambiguidade no
-- PostgREST.
--
-- SEGURANÇA inalterada: só admin (is_admin()), fail-closed.
-- REVERT: drop desta função e reaplicar a 0134.
-- ════════════════════════════════════════════════════════════════

drop function if exists audit_log_page(text, text, int, int);

create or replace function audit_log_page(
  p_action text default null,
  p_search text default null,
  p_client_id uuid default null,
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
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not is_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  return query
  -- 1) Resolve o cliente afetado (client_id) de cada linha.
  with base as (
    select
      a.*,
      coalesce(
        case
          when a.target_table = 'profiles'        then a.target_id
          when a.target_table = 'bookings'         then b.client_id
          when a.target_table = 'purchases'        then pu.client_id
          when a.target_table = 'duo_partnerships' then a.target_id
        end,
        case
          when (a.payload ->> 'clientId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (a.payload ->> 'clientId')::uuid
        end
      ) as client_id
    from audit_log a
    left join bookings b  on a.target_table = 'bookings'  and b.id = a.target_id
    left join purchases pu on a.target_table = 'purchases' and pu.id = a.target_id
  ),
  -- 2) Junta o perfil do cliente e aplica os filtros.
  --    Precedência: se p_client_id vier, filtra por id exato e ignora
  --    a pesquisa de texto; caso contrário usa a pesquisa (se houver).
  filtered as (
    select
      base.*,
      cp.full_name as client_name
    from base
    left join profiles cp on cp.id = base.client_id
    where (p_action is null or base.action = p_action)
      and (p_client_id is null or base.client_id = p_client_id)
      and (
        p_client_id is not null
        or v_search is null
        or cp.full_name ilike '%' || v_search || '%'
        or cp.email     ilike '%' || v_search || '%'
        or cp.phone     ilike '%' || v_search || '%'
      )
  ),
  counted as (
    select count(*)::bigint as n from filtered
  ),
  -- 3) Pagina PRIMEIRO (só v_limit linhas) e só depois resolve o autor.
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
    p.client_name,
    p.ip_address,
    p.payload,
    (select n from counted) as total_count
  from page p
  left join profiles actor on actor.id = p.actor_id
  order by p.created_at desc;
end;
$$;

revoke all on function audit_log_page(text, text, uuid, int, int) from public, anon;
grant execute on function audit_log_page(text, text, uuid, int, int) to authenticated, service_role;

comment on function audit_log_page(text, text, uuid, int, int) is
  '0135: como 0134 + filtro exato por cliente (p_client_id). Se p_client_id vier, ignora p_search.';
