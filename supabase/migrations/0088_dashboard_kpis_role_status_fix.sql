-- ════════════════════════════════════════════════════════════════
-- 0088 · Dashboard KPIs · filtro de role + mirror da agenda
--
-- Dois ajustes em `get_dashboard_kpis` (criada em 0084):
--
-- (1) "Clientes ativos no mês"
--     ANTES: count(distinct client_id) onde status ∈ ('booked','confirmed').
--     PROBLEMA: nada impede que `client_id` aponte para um profile com
--     role 'trainer' ou 'owner' (sessão de teste do staff, etc.) — esses
--     casos inflavam o contador. O KPI "Total de clientes" já exclui staff
--     porque a RPC `count_clients_in_scope` (0081) filtra por role='client'.
--     Aqui passa a haver paridade: só conta `client_id` cujo profile é
--     mesmo cliente, e que não esteja anonimizado.
--
-- (2) "Sessões marcadas no mês" · mirror da agenda
--     ANTES: count(*) onde status ∈ ('booked','confirmed').
--     AGORA: count(*) onde status <> 'cancelled' — mesma regra de exibição
--     da agenda no modo default (`show_cancelled_in_calendar = false`).
--     Inclui no_show (faltas) que ocupam slot e aparecem na agenda. O
--     auto-confirm está ligado por defeito, por isso na prática a maioria
--     são 'confirmed' e algumas 'no_show'; quem desactiva auto-confirm vê
--     também 'booked'.
--
-- "Taxa de presenças" mantém-se: confirmed / (confirmed + no_show) — é a
-- única taxa de presença significativa (booked = pendente, não tem
-- desfecho ainda; cancelled = sem sessão).
--
-- SEGURANÇA: SECURITY INVOKER, igual à 0084. Sem escalonamento.
--
-- REVERT: reaplicar 0084.
-- ════════════════════════════════════════════════════════════════

create or replace function get_dashboard_kpis(
  p_trainer_ids uuid[],
  p_month_start timestamptz,
  p_month_end   timestamptz
)
returns table (
  revenue_cents      bigint,
  packs_sold         bigint,
  pending_payments   bigint,
  sessions_booked    bigint,
  sessions_confirmed bigint,
  sessions_no_show   bigint,
  active_clients     bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.revenue_cents,
    p.packs_sold,
    pend.pending_payments,
    b.sessions_booked,
    b.sessions_confirmed,
    b.sessions_no_show,
    b.active_clients
  from
    (
      select
        -- (2) mirror da agenda: tudo o que não é cancelled.
        count(*) filter (where bk.status <> 'cancelled')                            as sessions_booked,
        count(*) filter (where bk.status = 'confirmed')                             as sessions_confirmed,
        count(*) filter (where bk.status = 'no_show')                               as sessions_no_show,
        -- (1) só clientes reais (exclui staff e contas anonimizadas).
        count(distinct bk.client_id) filter (
          where bk.status <> 'cancelled'
            and exists (
              select 1 from profiles p
              where p.id = bk.client_id
                and p.role = 'client'
                and coalesce(p.email, '') not like '%@removido.invalid'
            )
        )                                                                            as active_clients
      from bookings bk
      where bk.trainer_id = any(p_trainer_ids)
        and bk.starts_at >= p_month_start
        and bk.starts_at <  p_month_end
    ) b
    cross join (
      select
        coalesce(sum(amount_cents), 0)::bigint as revenue_cents,
        count(*)                               as packs_sold
      from purchases
      where trainer_id = any(p_trainer_ids)
        and status = 'confirmed'
        and payment_method <> 'complimentary'
        and confirmed_at >= p_month_start
        and confirmed_at <  p_month_end
    ) p
    cross join (
      select count(*) as pending_payments
      from purchases
      where trainer_id = any(p_trainer_ids)
        and status in ('awaiting_confirmation','pending_payment')
    ) pend;
$$;

grant execute on function get_dashboard_kpis(uuid[], timestamptz, timestamptz) to authenticated;

comment on function get_dashboard_kpis(uuid[], timestamptz, timestamptz) is
  '0088: active_clients exclui staff/anonimizados; sessions_booked espelha a '
  'agenda (qualquer status excepto cancelled). SECURITY INVOKER.';
