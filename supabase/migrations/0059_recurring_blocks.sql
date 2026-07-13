-- ════════════════════════════════════════════════════════════════
-- 0059 · Bloqueios RECORRENTES (semanais) + excepções por dia
--
-- Até aqui o trainer só podia bloquear horários pontuais
-- (trainer_blocked_times: instantes concretos). Este passo adiciona
-- bloqueios que se repetem TODAS as semanas no mesmo dia-da-semana e
-- intervalo de horas, indefinidamente até serem removidos — p.ex.
-- "ocupado 11:00–17:00 de 2ª a domingo".
--
--   • trainer_recurring_blocks · regra semanal (day_of_week + horas).
--   • trainer_recurring_block_skips · "neste dia concreto ignora a
--     recorrência" — permite ao trainer ajustar/limpar a recorrência
--     num dia específico sem mexer na regra.
--
-- day_of_week segue a convenção de trainer_availability: 0 = domingo,
-- 6 = sábado (= extract(dow ...) do Postgres).
--
-- Segurança: espelha o padrão de trainer_blocked_times —
--   - SELECT no base table só para admins (reason pode ser PII);
--   - WRITE só admins COM scope ao trainer (_trainer_is_accessible);
--   - vistas públicas sem `reason` para o cálculo de disponibilidade
--     do lado do cliente (lib/availability.ts).
--
-- REVERT:
--   drop view if exists public_recurring_block_skips;
--   drop view if exists public_recurring_blocks;
--   drop table if exists trainer_recurring_block_skips;
--   drop table if exists trainer_recurring_blocks;
-- ════════════════════════════════════════════════════════════════

-- ── 1) Tabelas ──────────────────────────────────────────────────
create table if not exists trainer_recurring_blocks (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  reason text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_recurring_block_trainer_day
  on trainer_recurring_blocks(trainer_id, day_of_week);

create table if not exists trainer_recurring_block_skips (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  skip_date date not null,
  created_at timestamptz not null default now(),
  unique (trainer_id, skip_date)
);
create index if not exists idx_recurring_skip_trainer_date
  on trainer_recurring_block_skips(trainer_id, skip_date);

-- ── 2) RLS ──────────────────────────────────────────────────────
alter table trainer_recurring_blocks enable row level security;
alter table trainer_recurring_block_skips enable row level security;

drop policy if exists "recurring_blocks: admin select" on trainer_recurring_blocks;
create policy "recurring_blocks: admin select" on trainer_recurring_blocks
  for select using (is_admin());

drop policy if exists "recurring_blocks: admin write" on trainer_recurring_blocks;
create policy "recurring_blocks: admin write" on trainer_recurring_blocks
  for all
  using (is_admin() and _trainer_is_accessible(trainer_id))
  with check (is_admin() and _trainer_is_accessible(trainer_id));

drop policy if exists "recurring_skips: admin select" on trainer_recurring_block_skips;
create policy "recurring_skips: admin select" on trainer_recurring_block_skips
  for select using (is_admin());

drop policy if exists "recurring_skips: admin write" on trainer_recurring_block_skips;
create policy "recurring_skips: admin write" on trainer_recurring_block_skips
  for all
  using (is_admin() and _trainer_is_accessible(trainer_id))
  with check (is_admin() and _trainer_is_accessible(trainer_id));

-- ── 3) Vistas públicas (sem `reason`) p/ disponibilidade do cliente ─
drop view if exists public_recurring_blocks;
create view public_recurring_blocks
  with (security_invoker = false)
  as
  select id, trainer_id, day_of_week, start_time, end_time
  from trainer_recurring_blocks
  where active;

revoke all on public_recurring_blocks from public;
grant select on public_recurring_blocks to authenticated;

drop view if exists public_recurring_block_skips;
create view public_recurring_block_skips
  with (security_invoker = false)
  as
  select trainer_id, skip_date
  from trainer_recurring_block_skips;

revoke all on public_recurring_block_skips from public;
grant select on public_recurring_block_skips to authenticated;
