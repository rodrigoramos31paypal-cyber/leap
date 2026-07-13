-- ════════════════════════════════════════════════════════════════
-- 0095_active_clients_confirmed_only
--
-- "Clientes ativos no mês" passa a contar APENAS clientes com pelo menos
-- uma sessão CONFIRMADA (status = 'confirmed') no mês seleccionado —
-- contados de forma distinta (1 cliente conta 1×, tenha ele 1 ou 500
-- sessões). Antes (0088) contava qualquer status <> 'cancelled', o que
-- incluía 'booked' (pendente, ainda sem desfecho) e 'no_show' (falta).
--
-- Decisão de produto: "ativo no mês" = cliente que efectivamente teve uma
-- sessão confirmada nesse mês, independentemente de ser no dia 1 ou no
-- último dia. Mantém-se o guard de role/anonimização (só clientes reais).
--
-- "Sessões marcadas no mês" mantém-se como espelho da agenda (qualquer
-- status excepto cancelled) — só o contador de CLIENTES muda.
--
-- SEGURANÇA: SECURITY INVOKER, igual à 0088. REVERT: reaplicar 0088.
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
        -- espelho da agenda: tudo o que não é cancelled.
        count(*) filter (where bk.status <> 'cancelled')                            as sessions_booked,
        count(*) filter (where bk.status = 'confirmed')                             as sessions_confirmed,
        count(*) filter (where bk.status = 'no_show')                               as sessions_no_show,
        -- clientes ativos no mês: distinto, só sessões CONFIRMADAS, e só
        -- clientes reais (exclui staff e contas anonimizadas).
        count(distinct bk.client_id) filter (
          where bk.status = 'confirmed'
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
  '0095: active_clients = distinct clientes com sessão confirmed no mês '
  '(exclui staff/anonimizados); sessions_booked espelha a agenda. SECURITY INVOKER.';
