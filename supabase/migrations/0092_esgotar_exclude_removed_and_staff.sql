-- ════════════════════════════════════════════════════════════════
-- 0092_esgotar_exclude_removed_and_staff
--
-- BUG: a tab "Esgotar sessões" (admin /clientes) mostrava:
--   • clientes anonimizados/removidos (email `@removido.invalid`);
--   • contas de staff (trainers/owners) que tivessem compras associadas.
--
-- A `clients_low_sessions` (migration 0024) agregava `purchases` por
-- `client_id` sem nunca olhar para o `profiles.role` nem para o marcador
-- de anonimização — ao contrário de `count_clients_in_scope` (0081), que
-- já tinha o guard correcto. Replicamos aqui o MESMO EXISTS:
--   role = 'client' AND email NOT LIKE '%@removido.invalid'
--
-- SEGURANÇA: SECURITY INVOKER (igual ao original) — RLS inalterada.
-- REVERT: reaplicar a definição da migration 0024.
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
    -- exclui staff (trainers/owners) e contas anonimizadas/removidas
    and exists (
      select 1 from profiles pr
      where pr.id = c.client_id
        and pr.role = 'client'
        and coalesce(pr.email, '') not like '%@removido.invalid'
    )
  order by c.total asc, c.client_id asc
  offset greatest(p_offset, 0)
  limit  greatest(p_limit, 0);
$$;

grant execute on function clients_low_sessions(uuid[], int, int) to authenticated;
