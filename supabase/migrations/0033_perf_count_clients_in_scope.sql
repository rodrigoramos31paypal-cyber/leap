-- ════════════════════════════════════════════════════════════════
-- 0033_perf_count_clients_in_scope
--
-- PERF (admin /dashboard · KPI "Total de clientes"): substitui um
-- padrão caro feito em JS por uma agregação no Postgres.
--
--   • ANTES: getClientIdsInScope() trazia TODAS as linhas de
--     `purchases.client_id` + TODAS as de `bookings.client_id` no scope
--     para o Node, juntava num Set e devolvia o array — só para o caller
--     do dashboard ler `.length`. Crescia sem limite (uma linha por cada
--     compra/marcação já feita) e corria em cada carregamento do
--     dashboard.
--
--   • AGORA: COUNT(DISTINCT client_id) sobre a UNION das duas tabelas,
--     calculado no Postgres. Devolve um único inteiro — zero linhas
--     transferidas.
--
-- SEGURANÇA: SECURITY INVOKER (default) — sujeita às MESMAS políticas
-- RLS das queries JS actuais. Sem escalonamento de privilégios. O scope
-- de trainers é passado pelo caller (getAccessibleTrainerIds), tal como
-- hoje.
--
-- REVERT: `drop function if exists count_clients_in_scope(uuid[]);`
-- O código da app tem fallback para getClientIdsInScope().length, por
-- isso remover esta função não parte nada — apenas volta ao caminho
-- lento.
-- ════════════════════════════════════════════════════════════════

-- Nº de clientes distintos com compras OU marcações dentro do scope.
-- `union` (não `union all`) deduplica client_id dentro e entre as duas
-- tabelas; o count(*) externo conta o conjunto já deduplicado.
create or replace function count_clients_in_scope(
  p_trainer_ids uuid[]
)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)
  from (
    select client_id from purchases where trainer_id = any(p_trainer_ids)
    union
    select client_id from bookings  where trainer_id = any(p_trainer_ids)
  ) s;
$$;

grant execute on function count_clients_in_scope(uuid[]) to authenticated;
