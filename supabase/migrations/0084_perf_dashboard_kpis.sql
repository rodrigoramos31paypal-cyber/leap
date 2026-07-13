-- ════════════════════════════════════════════════════════════════
-- 0084_perf_dashboard_kpis
--
-- PERF (P-05 audit jun/2026): substitui o padrão caro do admin
-- /dashboard (KPIs) por uma agregação no Postgres.
--
--   • ANTES: o componente Kpis() trazia para o Node TODAS as linhas
--     de `bookings` do mês no scope (status, client_id) + TODAS as
--     `purchases` confirmadas do mês (amount_cents, …) e agregava em
--     JS (somatório de receita, Set de client_id distintos, contagens
--     por status). Cresce sem limite com o volume do estúdio e corre
--     em cada carregamento do dashboard.
--
--   • AGORA: uma única função devolve todos os números já calculados.
--     `bookings` é varrido UMA vez com count(*) FILTER (...) e
--     count(distinct client_id) FILTER (...); `purchases` duas vezes
--     (receita+packs do mês, e pendentes). Zero linhas transferidas.
--
-- PARIDADE EXACTA com o JS substituído:
--   revenue_cents      = Σ amount_cents  | status='confirmed'
--                        ∧ payment_method <> 'complimentary'
--                        ∧ confirmed_at ∈ [start, end)
--   packs_sold         = COUNT(*) do mesmo conjunto
--   pending_payments   = COUNT(*) purchases status ∈
--                        ('awaiting_confirmation','pending_payment')
--   sessions_booked    = COUNT bookings status ∈ ('booked','confirmed')
--   sessions_confirmed = COUNT bookings status = 'confirmed'
--   sessions_no_show   = COUNT bookings status = 'no_show'
--   active_clients     = COUNT(DISTINCT client_id) bookings status ∈
--                        ('booked','confirmed')
--   (todos os filtros de bookings com starts_at ∈ [start, end) e
--    trainer_id ∈ scope; avgRevenuePerClient continua a ser calculado
--    na app por Math.round(revenue/active_clients) para igualar a
--    semântica de arredondamento.)
--
-- SEGURANÇA: SECURITY INVOKER (default) — sujeita às MESMAS políticas
-- RLS das queries JS actuais. Sem escalonamento. O scope de trainers é
-- passado pelo caller (getAccessibleTrainerIds), tal como hoje. Scope
-- vazio (array '{}') ⇒ nenhuma linha casa ⇒ todos os contadores a 0.
--
-- REVERT: drop function if exists
--   get_dashboard_kpis(uuid[], timestamptz, timestamptz);
-- O código da app tem fallback para o caminho antigo (fetch+JS), por
-- isso remover esta função não parte nada — só volta ao caminho lento.
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
        count(*) filter (where status in ('booked','confirmed'))                       as sessions_booked,
        count(*) filter (where status = 'confirmed')                                   as sessions_confirmed,
        count(*) filter (where status = 'no_show')                                     as sessions_no_show,
        count(distinct client_id) filter (where status in ('booked','confirmed'))      as active_clients
      from bookings
      where trainer_id = any(p_trainer_ids)
        and starts_at >= p_month_start
        and starts_at <  p_month_end
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
  'P-05 perf (jun/2026): KPIs do admin dashboard agregados no Postgres '
  '(receita, packs, pendentes, sessoes por status, clientes activos '
  'distintos) num so round-trip. SECURITY INVOKER (RLS). Caller passa o '
  'scope de trainers; scope vazio devolve zeros.';
