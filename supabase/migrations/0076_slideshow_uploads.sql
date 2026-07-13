-- ════════════════════════════════════════════════════════════════
-- 0076 · Slideshow · upload de imagens dos slides
--
-- O admin gere o slideshow em /admin/promocoes (tab "Slideshow") e
-- carrega imagens directamente do telemóvel/galeria. As imagens vão
-- para o bucket público "slideshow". O upload é feito server-side com
-- service role (ver app/admin/promocoes/actions.ts), por isso só
-- precisamos de uma policy de SELECT para anon/authenticated — o
-- service role bypassa RLS nos writes.
--
-- REVERT:
--   drop policy if exists "slideshow: anon read" on storage.objects;
--   delete from storage.buckets where id = 'slideshow';
-- ════════════════════════════════════════════════════════════════

-- ── Bucket público para imagens do slideshow ─────────────────────
-- file_size_limit: 5 MB. allowed_mime_types: imagens.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'slideshow',
  'slideshow',
  true,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── Policy: anon/authenticated podem ler do bucket slideshow ─────
-- (writes ficam restritos ao service role usado pela server action)
drop policy if exists "slideshow: anon read" on storage.objects;
create policy "slideshow: anon read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'slideshow');
