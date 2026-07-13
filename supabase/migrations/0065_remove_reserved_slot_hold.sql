-- ════════════════════════════════════════════════════════════════
-- 0065 · Remover a "reserva" automática do slot da semana seguinte
--
-- Comportamento até agora (0017): ao marcar uma série recorrente, o
-- MESMO dia-da-semana + hora na semana imediatamente a seguir à última
-- ocorrência ficava "reservado" para esse cliente. Qualquer outra
-- marcação que colidisse com esse slot era recusada com
--   'Horário reservado para outro cliente.'
-- A verificação está centralizada em `is_reserved_slot_blocked(...)`,
-- chamada por create_booking, marcação recorrente, reschedule, criação
-- por admin e block-overrides.
--
-- Pedido: remover esta funcionalidade. Em vez de editar todas as RPCs
-- que a consultam, neutralizamos a função num único sítio — passa a
-- devolver sempre `false`, por isso NENHUM slot é considerado reservado
-- e todos os callers deixam de bloquear/recusar por esse motivo.
--
-- A vista `reserved_slots_active` e a coluna `booking_series.last_starts_at`
-- ficam como estão (deixam de ter efeito no bloqueio; sem custo). A
-- classificação da série recorrente deixa de marcar semanas como
-- 'reserved' — essas semanas passam a contar como livres.
--
-- REVERT: reaplicar a definição de `is_reserved_slot_blocked` de
-- 0017_recurring_bookings.sql (a versão que consulta reserved_slots_active).
-- ════════════════════════════════════════════════════════════════

create or replace function is_reserved_slot_blocked(
  p_trainer_id uuid,
  p_client_id  uuid,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz
) returns boolean
language sql immutable
set search_path = public
as $$
  -- Funcionalidade removida (0065): nenhum slot fica reservado.
  select false;
$$;
