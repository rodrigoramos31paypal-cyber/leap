-- ════════════════════════════════════════════════════════════════
-- LEAP-FITNESS STUDIO · Row Level Security
-- ════════════════════════════════════════════════════════════════

alter table profiles enable row level security;
alter table trainers enable row level security;
alter table trainer_settings enable row level security;
alter table trainer_availability enable row level security;
alter table trainer_blocked_times enable row level security;
alter table packs enable row level security;
alter table purchases enable row level security;
alter table payments enable row level security;
alter table bookings enable row level security;
alter table credit_transactions enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;

-- ────────────────────────────────────────────────────────────────
-- profiles
-- ────────────────────────────────────────────────────────────────
create policy "profiles: self select" on profiles
  for select using (id = auth.uid() or is_admin());

-- Self update: cliente só pode atualizar a si próprio
-- (role é protegido por trigger BEFORE UPDATE em baixo)
create policy "profiles: self update" on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles: admin update" on profiles
  for update using (is_admin())
  with check (is_admin());

create policy "profiles: admin insert" on profiles
  for insert with check (is_admin());

-- Trigger: impede mudança de role exceto por admin
create or replace function protect_profile_role()
returns trigger language plpgsql security definer as $$
begin
  if new.role is distinct from old.role and not is_admin() then
    raise exception 'Não tens permissão para alterar o role.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_protect_profile_role on profiles;
create trigger trg_protect_profile_role
  before update on profiles
  for each row execute procedure protect_profile_role();

-- ────────────────────────────────────────────────────────────────
-- trainers
-- ────────────────────────────────────────────────────────────────
create policy "trainers: anyone authenticated reads active" on trainers
  for select using (active = true or is_admin());

create policy "trainers: admin writes" on trainers
  for all using (is_admin()) with check (is_admin());

-- ────────────────────────────────────────────────────────────────
-- trainer_settings · só admins leem/editam
-- ────────────────────────────────────────────────────────────────
create policy "trainer_settings: admin all" on trainer_settings
  for all using (is_admin()) with check (is_admin());

create policy "trainer_settings: clients read" on trainer_settings
  for select using (true);

-- ────────────────────────────────────────────────────────────────
-- trainer_availability / blocked_times · leitura pública (autenticados)
-- ────────────────────────────────────────────────────────────────
create policy "availability: read" on trainer_availability for select using (true);
create policy "availability: admin write" on trainer_availability
  for all using (is_admin()) with check (is_admin());

create policy "blocked: read" on trainer_blocked_times for select using (true);
create policy "blocked: admin write" on trainer_blocked_times
  for all using (is_admin()) with check (is_admin());

-- ────────────────────────────────────────────────────────────────
-- packs · clientes veem ativos, admin gere tudo
-- ────────────────────────────────────────────────────────────────
create policy "packs: read active" on packs
  for select using (active = true or is_admin());

create policy "packs: admin write" on packs
  for all using (is_admin()) with check (is_admin());

-- ────────────────────────────────────────────────────────────────
-- purchases
-- ────────────────────────────────────────────────────────────────
create policy "purchases: client read own" on purchases
  for select using (client_id = auth.uid() or is_admin());

create policy "purchases: admin write" on purchases
  for all using (is_admin()) with check (is_admin());

-- Inserts vão pela função create_purchase (SECURITY DEFINER), não diretamente.

-- ────────────────────────────────────────────────────────────────
-- payments
-- ────────────────────────────────────────────────────────────────
create policy "payments: client read own" on payments
  for select using (
    exists (select 1 from purchases p where p.id = payments.purchase_id and p.client_id = auth.uid())
    or is_admin()
  );

create policy "payments: admin write" on payments
  for all using (is_admin()) with check (is_admin());

-- ────────────────────────────────────────────────────────────────
-- bookings
-- ────────────────────────────────────────────────────────────────
create policy "bookings: client read own + admin" on bookings
  for select using (client_id = auth.uid() or is_admin());

create policy "bookings: admin write" on bookings
  for all using (is_admin()) with check (is_admin());

-- Inserts/cancels vão pelas funções (SECURITY DEFINER).

-- ────────────────────────────────────────────────────────────────
-- credit_transactions
-- ────────────────────────────────────────────────────────────────
create policy "credits: client read own" on credit_transactions
  for select using (
    exists (select 1 from purchases p where p.id = credit_transactions.purchase_id and p.client_id = auth.uid())
    or is_admin()
  );

create policy "credits: admin write" on credit_transactions
  for all using (is_admin()) with check (is_admin());

-- ────────────────────────────────────────────────────────────────
-- notifications
-- ────────────────────────────────────────────────────────────────
create policy "notif: read own" on notifications
  for select using (user_id = auth.uid() or is_admin());

create policy "notif: update own (mark read)" on notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "notif: admin all" on notifications
  for all using (is_admin()) with check (is_admin());

-- ────────────────────────────────────────────────────────────────
-- audit_log
-- ────────────────────────────────────────────────────────────────
create policy "audit: admin read" on audit_log
  for select using (is_admin());
