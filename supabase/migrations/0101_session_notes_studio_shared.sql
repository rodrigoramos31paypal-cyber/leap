-- ════════════════════════════════════════════════════════════════
-- 0101 · Notas de sessão partilhadas entre a EQUIPA do estúdio
--
-- Contexto: o estúdio tem várias contas de gestão (owner) que partilham
-- o mesmo calendário — devem ser tratadas como "a mesma pessoa". Até
-- agora cada autor só lia as suas notas (0013) e o trainer da sessão
-- lia as notas do cliente nessa sessão (0078). Uma conta admin/owner SEM
-- trainer próprio (ex.: leaptreinos) não via NENHUMA das notas escritas
-- pelo owner-trainer (ex.: rodrigoramos), porque não é autor nem é o
-- trainer da marcação.
--
-- Esta migração adiciona uma policy de LEITURA (SELECT) que deixa
-- qualquer membro da equipa (is_admin() = trainer OU owner) LER todas as
-- notas dentro do seu âmbito:
--   • Booking-bound: a marcação pertence a um trainer acessível ao leitor
--     (_trainer_is_accessible — owners vêem tudo; trainers só o próprio).
--   • Geral (subject_id): o cliente-alvo tem relação (purchase/booking)
--     com um trainer acessível ao leitor.
--
-- É ADITIVA: as policies de SELECT são OR. Mantém-se "author reads own"
-- (clientes continuam a ler só as suas) e a 0078. Escrita/edição/apagar
-- continuam restritas ao autor (0013/0029) — partilhamos LEITURA, não a
-- autoria. Cada pessoa edita só a sua nota.
--
-- REVERT:
--   drop policy if exists "session_notes: studio team reads in scope" on session_notes;
-- ════════════════════════════════════════════════════════════════
create policy "session_notes: studio team reads in scope" on session_notes
  for select using (
    is_admin()
    and (
      -- ── Booking-bound: marcação de um trainer acessível ao leitor ──
      (booking_id is not null and exists (
        select 1 from bookings b
        where b.id = session_notes.booking_id
          and _trainer_is_accessible(b.trainer_id)
      ))
      or
      -- ── Geral: nota sobre um cliente com relação a trainer acessível ──
      (booking_id is null
        and subject_id is not null
        and exists (
          select 1 from profiles p
          where p.id = session_notes.subject_id and p.role = 'client'
        )
        and (
          exists (
            select 1 from purchases pu
            where pu.client_id = session_notes.subject_id
              and _trainer_is_accessible(pu.trainer_id)
          )
          or exists (
            select 1 from bookings bk
            where bk.client_id = session_notes.subject_id
              and _trainer_is_accessible(bk.trainer_id)
          )
        )
      )
    )
  );

comment on policy "session_notes: studio team reads in scope" on session_notes is
  'Equipa do estúdio (is_admin) lê todas as notas no seu âmbito (_trainer_is_accessible). Aditiva às policies 0013/0078. Autoria/escrita continua restrita ao autor.';
