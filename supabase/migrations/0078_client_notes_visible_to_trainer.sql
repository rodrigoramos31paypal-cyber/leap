-- ════════════════════════════════════════════════════════════════
-- 0078 · Notas de sessão do cliente visíveis ao treinador
--
-- Até agora cada autor só via as suas notas. Agora o treinador da
-- sessão também pode LER as notas que o CLIENTE escreveu nessa sessão
-- (continua a não poder editá-las/apagá-las — só leitura). As notas do
-- treinador permanecem privadas (o cliente não ganha acesso).
--
-- REVERT:
--   drop policy if exists "session_notes: trainer reads client notes" on session_notes;
-- ════════════════════════════════════════════════════════════════
create policy "session_notes: trainer reads client notes" on session_notes
  for select using (
    booking_id is not null
    and exists (
      select 1 from bookings b
      where b.id = session_notes.booking_id
        and b.client_id = session_notes.author_id
        and b.trainer_id in (select id from trainers where profile_id = auth.uid())
    )
  );
