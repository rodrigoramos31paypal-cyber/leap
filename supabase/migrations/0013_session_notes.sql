-- ════════════════════════════════════════════════════════════════
-- session_notes · diário privado por autor (cliente OU treinador).
-- Cada autor só vê e edita as suas. Cliente e treinador NUNCA
-- vêem as notas um do outro.
-- ════════════════════════════════════════════════════════════════
create table if not exists session_notes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, author_id)
);
create index if not exists idx_session_notes_author on session_notes(author_id, created_at desc);
create index if not exists idx_session_notes_booking on session_notes(booking_id);

create trigger trg_session_notes_updated before update on session_notes
  for each row execute procedure set_updated_at();

alter table session_notes enable row level security;

-- Cada user só lê / escreve / apaga as próprias notas
create policy "session_notes: author reads own" on session_notes
  for select using (author_id = auth.uid());

create policy "session_notes: author inserts own" on session_notes
  for insert with check (
    author_id = auth.uid()
    -- e o autor tem de ter a ver com o booking (é o cliente OU o trainer)
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and (
          b.client_id = auth.uid()
          or b.trainer_id in (select id from trainers where profile_id = auth.uid())
        )
    )
  );

create policy "session_notes: author updates own" on session_notes
  for update using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "session_notes: author deletes own" on session_notes
  for delete using (author_id = auth.uid());
