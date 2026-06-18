-- ════════════════════════════════════════════════════════════════
-- 0094_esgotar_include_zero_session_clients
--
-- BUG: a tab "Esgotar sessões" não mostrava clientes que NUNCA compraram
-- um pack (0 sessões). A `clients_low_sessions` (0024/0092) construía o
-- conjunto candidato APENAS a partir de `purchases` (any_clients = quem
-- tem ao menos uma compra no scope). Um cliente registado sem nenhuma
-- compra não tinha linha em `purchases` → ficava de fora, apesar de ter
-- 0 sessões (devia ser o caso MAIS óbvio de "a esgotar").
--
-- FIX: o conjunto candidato passa a ser o MESMO universo de clientes do
-- scope usado por `count_clients_in_scope` (0081) — união de:
--   • client_id em purchases no scope
--   • client_id em bookings  no scope
--   • profiles.trainer_id no scope (registados com o trainer)
-- com o mesmo guard de role/anonimização. Quem não tem sessões activas
-- entra com total 0 (LEFT JOIN aos sums) e é apanhado pelo filtro <= 2.
--
-- NOTA: contas "órfãs" (trainer_id NULL, sem compras/bookings) continuam
-- fora deste universo scoped — o owner trata-as no caminho app-level
-- (page.tsx), que enumera TODOS os profiles role='client'.
--
-- SEGURANÇA: SECURITY INVOKER (igual ao original). REVERT: reaplicar 0092.
-- ════════════════════════════════════════════════════════════════

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
  with scoped_clients as (
    select client_id as id from purchases where trainer_id = any(p_trainer_ids)
    union
    select client_id as id from bookings  where trainer_id = any(p_trainer_ids)
    union
    select id from profiles
      where role = 'client'
        and trainer_id = any(p_trainer_ids)
  ),
  eligible as (
    select distinct sc.id as client_id
    from scoped_clients sc
    where sc.id is not null
      and exists (
        select 1 from profiles pr
        where pr.id = sc.id
          and pr.role = 'client'
          and coalesce(pr.email, '') not like '%@removido.invalid'
      )
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
    select e.client_id, coalesce(s.total, 0) as total
    from eligible e
    left join sums s on s.client_id = e.client_id
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

grant execute on function clients_low_sessions(uuid[], int, int) to authenticated;
