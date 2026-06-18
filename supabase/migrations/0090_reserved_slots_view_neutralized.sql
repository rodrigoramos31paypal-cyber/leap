-- ════════════════════════════════════════════════════════════════
-- 0090 · Reactivar marcações recorrentes SEM os blocos "Reservado"
--
-- Histórico: 0017 introduziu séries recorrentes + um slot "reservado"
-- automático na semana seguinte (last_starts_at + 7d), visível na
-- agenda como bloco cinzento "Reservado · Cliente X". A 0065
-- neutralizou o *bloqueio funcional* (a função is_reserved_slot_blocked
-- passou a devolver sempre false) e a 0085 *cancelou todas as séries
-- activas* para esvaziar a view e tirar os blocos do calendário.
--
-- O cliente quer recuperar as marcações recorrentes mas SEM esses
-- blocos. Esta migração:
--
--   (a) Neutraliza a view `reserved_slots_active`: passa a devolver
--       sempre vazio. Mantém-se o nome/colunas para compatibilidade
--       com queries existentes (a agenda admin selecciona-a) — apenas
--       não retorna linhas. Sem alterações no schema dos consumidores.
--
--   (b) Mantém `is_reserved_slot_blocked` inalterada (já é no-op
--       desde 0065).
--
-- Resultado: a UI de marcação recorrente volta a funcionar (UI
-- restaurada + RPC `create_recurring_booking` intacta), o `booking_series`
-- continua a ser criado para agrupar as sessões (útil em históricos), mas
-- nenhum bloco "Reservado" aparece na agenda no modo default.
--
-- REVERT: reaplicar a definição original da view de 0017.
-- ════════════════════════════════════════════════════════════════

create or replace view reserved_slots_active as
select
  s.id            as series_id,
  s.client_id,
  s.trainer_id,
  s.session_type,
  s.duration_min,
  (s.last_starts_at + interval '7 days') as starts_at,
  (s.last_starts_at + interval '7 days' + make_interval(mins => s.duration_min)) as ends_at,
  null::text      as client_name
from booking_series s
where false; -- 0090: view neutralizada (sem linhas).

grant select on reserved_slots_active to authenticated;
