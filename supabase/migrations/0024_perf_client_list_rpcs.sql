-- ════════════════════════════════════════════════════════════════
-- 0024_perf_client_list_rpcs
--
-- PERF (admin /clientes): substitui dois padrões caros feitos em JS por
-- agregação no Postgres:
--
--   • upcoming/past: antes trazíamos até 1000 linhas de bookings para
--     deduplicar client_id e paginar em memória (não escalava > 1000).
--   • esgotar: antes fazíamos dois full-scans de `purchases` e somávamos
--     sessões por cliente em memória, a cada page load.
--
-- Estas funções devolvem APENAS os client_id já deduplicados, ordenados
-- e paginados, mais o total da janela (COUNT(*) OVER()). O resto da UI
-- (perfis + chip de sessões) continua exactamente igual no caller.
--
-- SEGURANÇA: SECURITY INVOKER (default) — as queries continuam sujeitas
-- às MESMAS políticas RLS que as queries JS actuais. Sem escalonamento
-- de privilégios. O scope de trainers é passado pelo caller
-- (getAccessibleTrainerIds), tal como hoje.
--
-- REVERT: `drop function if exists clients_by_booking(uuid[],boolean,int,int);`
--         `drop function if exists clients_low_sessions(uuid[],int,int);`
-- O código da app tem fallback para a lógica antiga, por isso remover
-- estas funções não parte nada — apenas volta ao caminho lento.
-- ════════════════════════════════════════════════════════════════

-- Clientes com sessões próximas (p_upcoming=true) ou passadas (false),
-- deduplicados e ordenados pela sessão mais próxima / mais recente.
create or replace function clients_by_booking(
  p_trainer_ids uuid[],
  p_upcoming boolean,
  p_offset int,
  p_limit int
)
returns table (client_id uuid, total_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with distinct_clients as (
    select
      b.client_id,
      case when p_upcoming then min(b.starts_at) else max(b.starts_at) end as sort_key
    from bookings b
    where b.trainer_id = any(p_trainer_ids)
      and b.status in ('booked', 'confirmed')
      and (
        case when p_upcoming
             then b.starts_at >= now()
             else b.starts_at <  now()
        end
      )
    group by b.client_id
  )
  select
    dc.client_id,
    count(*) over () as total_count
  from distinct_clients dc
  order by
    (case when p_upcoming then dc.sort_key end) asc nulls last,
    (case when not p_upcoming then dc.sort_key end) desc nulls last
  offset greatest(p_offset, 0)
  limit  greatest(p_limit, 0);
$$;

-- Clientes "a esgotar": <= 2 sessões activas (não expiradas) no scope,
-- incluindo quem tem compras no scope mas 0 sessões restantes.
create or replace function clients_low_sessions(
  p_trainer_ids uuid[],
  p_offset int,
  p_limit int
)
returns table (client_id uuid, total_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with any_clients as (
    select distinct p.client_id
    from purchases p
    where p.trainer_id = any(p_trainer_ids)
  ),
  sums as (
    select p.client_id, coalesce(sum(p.sessions_remaining), 0) as total
    from purchases p
    where p.trainer_id = any(p_trainer_ids)
      and p.status = 'confirmed'
      and (p.expires_at is null or p.expires_at >= now())
    group by p.client_id
  ),
  combined as (
    select ac.client_id, coalesce(s.total, 0) as total
    from any_clients ac
    left join sums s on s.client_id = ac.client_id
  )
  select
    c.client_id,
    count(*) over () as total_count
  from combined c
  where c.total <= 2
  order by c.total asc, c.client_id asc
  offset greatest(p_offset, 0)
  limit  greatest(p_limit, 0);
$$;

grant execute on function clients_by_booking(uuid[], boolean, int, int) to authenticated;
grant execute on function clients_low_sessions(uuid[], int, int) to authenticated;
