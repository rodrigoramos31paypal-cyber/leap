-- ════════════════════════════════════════════════════════════════
-- 0085 · Desactivar marcações recorrentes / limpar slots reservados
--
-- O estúdio deixou de oferecer marcações recorrentes (séries semanais).
-- A opção foi removida do fluxo de marcação (booking-flow.tsx), mas as
-- séries antigas continuam 'active' e a view `reserved_slots_active`
-- continua a gerar os blocos "Reservado" na agenda (last_starts_at + 7d).
--
-- Esta migração marca TODAS as séries activas como 'cancelled'. Efeito:
--   • `reserved_slots_active` filtra `where status = 'active'` → deixa de
--     devolver linhas → os blocos "Reservado" desaparecem da agenda.
--   • `is_reserved_slot_blocked(...)` deixa de bloquear esses horários,
--     pelo que outros clientes podem voltar a marcá-los.
--
-- NÃO apaga nenhuma marcação real: as `bookings` (passadas ou futuras)
-- ficam intactas; só o estado das `booking_series` muda. `bookings.series_id`
-- é `on delete set null`, mas aqui nem sequer apagamos séries — só mudamos
-- o status, por isso o histórico fica preservado e a operação é auditável.
-- ════════════════════════════════════════════════════════════════

update booking_series
set status = 'cancelled',
    updated_at = now()
where status = 'active';
