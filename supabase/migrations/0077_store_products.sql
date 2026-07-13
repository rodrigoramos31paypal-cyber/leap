-- ════════════════════════════════════════════════════════════════
-- 0077 · Loja · produtos (ebooks, roupa, suplementos)
--
-- O admin gere produtos em /admin/loja. Os clientes veem os produtos
-- activos nas páginas de categoria da Loja (/app/loja/<categoria>).
-- Imagens carregadas para o bucket público "store" (upload server-side
-- com service role, ver app/admin/loja/actions.ts).
--
-- REVERT:
--   drop policy if exists "store: anon read" on storage.objects;
--   delete from storage.buckets where id = 'store';
--   drop table if exists store_products;
--   drop type if exists store_category;
-- ════════════════════════════════════════════════════════════════

create type store_category as enum ('ebooks', 'roupa', 'suplementos');

create table if not exists store_products (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  category store_category not null,
  name text not null,
  description text,
  price_cents integer check (price_cents is null or price_cents >= 0),
  image_url text,
  link_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_store_products_cat
  on store_products(category, active, sort_order);

alter table store_products enable row level security;

-- Clientes autenticados leem produtos activos.
create policy "store_products read active"
  on store_products for select
  to authenticated
  using (active = true);

-- Admin/trainer gere os produtos do seu scope.
create policy "store_products admin all"
  on store_products for all
  to authenticated
  using (is_admin() and _trainer_is_accessible(trainer_id))
  with check (is_admin() and _trainer_is_accessible(trainer_id));

-- ── Bucket público para imagens de produtos ──────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store',
  'store',
  true,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "store: anon read" on storage.objects;
create policy "store: anon read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'store');
