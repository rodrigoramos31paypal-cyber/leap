-- ════════════════════════════════════════════════════════════════
-- 0075 · Banners promocionais (ex: ebooks) no dashboard do cliente
--
-- O trainer/owner gere banners em /admin/promocoes. Os clientes veem
-- os banners activos num carrossel no dashboard. O botão "Comprar
-- agora" abre o link configurado (link_url) — checkout externo, etc.
-- Imagem via URL (sem upload/storage) para simplicidade.
-- ════════════════════════════════════════════════════════════════

create table if not exists promo_banners (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  title text not null,
  subtitle text,
  image_url text,
  button_label text,
  link_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_promo_banners_active
  on promo_banners(active, sort_order);

alter table promo_banners enable row level security;

-- Qualquer cliente autenticado lê os banners activos.
create policy "promo_banners read active"
  on promo_banners for select
  to authenticated
  using (active = true);

-- Admin/trainer gere (CRUD + vê inactivos) os banners do seu scope.
create policy "promo_banners admin all"
  on promo_banners for all
  to authenticated
  using (is_admin() and _trainer_is_accessible(trainer_id))
  with check (is_admin() and _trainer_is_accessible(trainer_id));
