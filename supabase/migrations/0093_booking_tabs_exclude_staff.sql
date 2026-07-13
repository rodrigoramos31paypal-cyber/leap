-- ════════════════════════════════════════════════════════════════
-- 0093_booking_tabs_exclude_staff
--
-- BUG: as tabs "Próximas sessões" e "Sessões passadas" (admin /clientes)
-- mostravam contas de staff (owners/trainers/admins) e contas
-- anonimizadas/removidas sempre que o profile aparecesse como `client_id`
-- de um booking no scope (ex.: o owner marcou sessões a si próprio em
-- testes). A `clients_by_booking` (migration 0024) agregava `bookings`
-- por `client_id` sem olhar para `profiles.role` nem para o marcador de
-- anonimização — mesma lacuna que já corrigimos em `clients_low_sessions`
-- (0092) e que `count_clients_in_scope` (0081) nunca teve.
--
-- Fix: mesmo EXISTS guard —
--   role = 'client' AND email NOT LIKE '%@removido.invalid'
--
-- SEGURANÇA: SECURITY INVOKER (igual ao original) — RLS inalterada.
-- REVERT: reaplicar a definição da migration 0024.
-- ════════════════════════════════════════════════════════════════

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
      -- exclui staff (trainers/owners/admins) e contas anonimizadas
      and exists (
        select 1 from profiles pr
        where pr.id = b.client_id
          and pr.role = 'client'
          and coalesce(pr.email, '') not like '%@removido.invalid'
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

grant execute on function clients_by_booking(uuid[], boolean, int, int) to authenticated;
