-- ════════════════════════════════════════════════════════════════
-- 0053_trainer_avatar
--
-- Avatar (foto de perfil) do trainer. Mostrado em:
--   • página pública /t/<slug>
--   • dashboard cliente · cartões "Sessões por treinador"
--   • qualquer outro sítio onde o trainer apareça
--
-- Storage: bucket público "avatars". O upload em si é feito server-side
-- com service role na server action (ver app/admin/definicoes/actions.ts),
-- portanto NÃO precisamos de policies de INSERT para `authenticated` no
-- storage.objects — só de uma policy de SELECT para `anon` para o browser
-- poder pedir o ficheiro directamente. O service role bypassa RLS.
--
-- REVERT:
--   drop policy if exists "avatars: anon read" on storage.objects;
--   delete from storage.buckets where id = 'avatars';
--   alter table trainers drop column if exists avatar_url;
-- ════════════════════════════════════════════════════════════════

-- ── Coluna na tabela trainers ────────────────────────────────────
alter table trainers
  add column if not exists avatar_url text;

-- ── Bucket público para avatares ─────────────────────────────────
-- file_size_limit: 2 MB. allowed_mime_types: imagens.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── Policy: anon pode ler ficheiros do bucket avatars ────────────
-- (writes ficam restritos ao service role usado pela server action)
drop policy if exists "avatars: anon read" on storage.objects;
create policy "avatars: anon read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');
