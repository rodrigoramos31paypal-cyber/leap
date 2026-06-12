-- ════════════════════════════════════════════════════════════════
-- 0029 · Scope check em session_notes (C5 do audit de segurança)
--
-- Estado actual:
--   • Booking-bound (booking_id IS NOT NULL) — já está protegida:
--     o autor tem de ser o cliente do booking OU o trainer do booking.
--     0013/0014 garantem isto.
--   • Geral (booking_id IS NULL, subject_id IS NOT NULL) — ABERTA:
--     a policy 0014 só exige que subject_id seja um profile válido
--     com role ∈ (client, trainer, owner). Qualquer cliente pode
--     anotar a qualquer trainer/cliente, e qualquer trainer pode
--     anotar a qualquer cliente (incluindo de outros trainers).
--
-- Esta migração endurece o ramo "geral" para reflectir o uso real:
--   • Cliente (author) → tem de apontar para um trainer profile ACTIVO
--     (existe linha em `trainers` com profile_id = subject_id e
--     active = true).
--   • Trainer/owner (author) → tem de apontar para um CLIENTE que
--     tem alguma relação (booking ou purchase) com um trainer
--     acessível ao autor (via `_trainer_is_accessible` de 0027).
--
-- O ramo booking-bound mantém-se inalterado.
--
-- Requisitos: 0027 (helper `_trainer_is_accessible`) tem de estar
-- aplicado antes desta migração.
-- ════════════════════════════════════════════════════════════════

drop policy if exists "session_notes: author inserts own" on session_notes;

create policy "session_notes: author inserts own" on session_notes
  for insert with check (
    author_id = auth.uid()
    and (
      -- ── Booking-bound: autor é cliente ou trainer do booking ────
      (booking_id is not null and exists (
        select 1 from bookings b
        where b.id = booking_id
          and (
            b.client_id = auth.uid()
            or b.trainer_id in (select id from trainers where profile_id = auth.uid())
          )
      ))
      or
      -- ── Nota geral: autor cliente sobre um trainer activo ───────
      (booking_id is null
        and subject_id is not null
        and not is_admin()
        and exists (
          select 1 from trainers t
          where t.profile_id = subject_id
            and t.active = true
        )
      )
      or
      -- ── Nota geral: autor admin sobre um cliente em scope ───────
      -- O cliente alvo tem de ter ao menos uma purchase ou booking
      -- com um trainer acessível ao autor. Isto impede que trainer A
      -- anote clientes que só pertencem ao trainer B.
      (booking_id is null
        and subject_id is not null
        and is_admin()
        and exists (
          select 1 from profiles p
          where p.id = subject_id and p.role = 'client'
        )
        and (
          exists (
            select 1 from purchases pu
            where pu.client_id = subject_id
              and _trainer_is_accessible(pu.trainer_id)
          )
          or exists (
            select 1 from bookings bk
            where bk.client_id = subject_id
              and _trainer_is_accessible(bk.trainer_id)
          )
        )
      )
    )
  );

comment on policy "session_notes: author inserts own" on session_notes is
  'C5 hardening: booking-bound mantém scope original; notas gerais agora exigem relação real autor↔subject (cliente→trainer activo; admin→cliente com purchase/booking num trainer acessível).';

-- ════════════════════════════════════════════════════════════════
-- NOTA: notas pré-existentes que não satisfaçam o novo check NÃO
-- são removidas (a policy só afecta novos INSERTs e UPDATEs que
-- mexam em subject_id). Para auditar registos órfãos:
--
--   select n.id, n.author_id, n.subject_id, p.role as author_role
--   from session_notes n
--   left join profiles p on p.id = n.author_id
--   where n.booking_id is null;
--
-- Se quiseres limpar notas geradas antes do hardening, decide
-- caso a caso — algumas podem ser legítimas (notas do João sobre
-- clientes seus criadas antes desta migração).
-- ════════════════════════════════════════════════════════════════
