-- ════════════════════════════════════════════════════════════════
-- Permite notas "gerais" não ligadas a sessão.
-- - booking_id passa a opcional
-- - novo subject_id: a "outra parte" da nota
--   (cliente alvo se autor=trainer; trainer alvo se autor=cliente)
-- - check: pelo menos um anchor (booking ou subject) está definido
-- - unique parcial: só 1 nota por (booking, author) quando há booking;
--   notas gerais podem ser várias por par autor↔subject
-- ════════════════════════════════════════════════════════════════

alter table session_notes
  alter column booking_id drop not null;

alter table session_notes
  add column if not exists subject_id uuid references profiles(id) on delete cascade;

-- substitui a unique antiga por unique parcial só quando booking_id está definido
alter table session_notes drop constraint if exists session_notes_booking_id_author_id_key;

create unique index if not exists session_notes_booking_author_uniq
  on session_notes(booking_id, author_id)
  where booking_id is not null;

create index if not exists idx_session_notes_subject
  on session_notes(subject_id, created_at desc);

-- ancora obrigatória
alter table session_notes drop constraint if exists session_notes_anchor_check;
alter table session_notes add constraint session_notes_anchor_check
  check (booking_id is not null or subject_id is not null);

-- ────────────────────────────────────────────────────────────────
-- RLS · insert policy expandida para suportar notas gerais
-- ────────────────────────────────────────────────────────────────
drop policy if exists "session_notes: author inserts own" on session_notes;
create policy "session_notes: author inserts own" on session_notes
  for insert with check (
    author_id = auth.uid()
    and (
      -- nota ligada a sessão: autor é cliente OU trainer do booking
      (booking_id is not null and exists (
        select 1 from bookings b
        where b.id = booking_id
          and (
            b.client_id = auth.uid()
            or b.trainer_id in (select id from trainers where profile_id = auth.uid())
          )
      ))
      or
      -- nota geral: subject existe como user válido (cliente, trainer ou owner)
      (booking_id is null and subject_id is not null and exists (
        select 1 from profiles p
        where p.id = subject_id
          and p.role in ('client', 'trainer', 'owner')
      ))
    )
  );
