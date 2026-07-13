-- ════════════════════════════════════════════════════════════════
-- LEAP Fitness Studio · Schema inicial
-- ════════════════════════════════════════════════════════════════

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────────
-- ENUMs
-- ────────────────────────────────────────────────────────────────
create type user_role as enum ('client', 'trainer', 'owner');
create type session_type as enum ('individual', 'dupla');
create type purchase_status as enum (
  'pending_payment',
  'awaiting_confirmation',
  'confirmed',
  'rejected',
  'cancelled'
);
create type payment_method as enum (
  'manual_mbway',
  'manual_cash',
  'manual_transfer',
  'mbway',
  'multibanco',
  'card'
);
create type payment_status as enum ('pending', 'paid', 'failed', 'refunded');
create type payment_gateway as enum ('manual', 'ifthenpay');
create type booking_status as enum ('booked', 'confirmed', 'cancelled', 'no_show');
create type credit_reason as enum (
  'purchase',
  'booking_deduction',
  'late_cancel',
  'no_show',
  'refund',
  'admin_adjust'
);

-- ────────────────────────────────────────────────────────────────
-- profiles · Extends auth.users
-- ────────────────────────────────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'client',
  full_name text not null,
  email text not null,
  phone text,
  trainer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_profiles_role on profiles(role);
create index idx_profiles_trainer on profiles(trainer_id);

-- ────────────────────────────────────────────────────────────────
-- trainers
-- ────────────────────────────────────────────────────────────────
create table trainers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles(id) on delete cascade,
  slug text not null unique,
  bio text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles
  add constraint fk_profiles_trainer
  foreign key (trainer_id) references trainers(id) on delete set null;

-- ────────────────────────────────────────────────────────────────
-- trainer_settings · 1:1 com trainers
-- ────────────────────────────────────────────────────────────────
create table trainer_settings (
  trainer_id uuid primary key references trainers(id) on delete cascade,
  slot_durations_min integer[] not null default '{45, 60, 90}',
  default_slot_duration_min integer not null default 45,
  cancellation_window_hours integer not null default 12,
  default_pack_validity_days integer, -- null = sem validade
  charge_late_cancel boolean not null default true,
  charge_no_show boolean not null default true,
  low_credits_threshold integer not null default 2,
  buffer_between_sessions_min integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────
-- trainer_availability · horário recorrente semanal
-- day_of_week: 0 = domingo, 6 = sábado
-- ────────────────────────────────────────────────────────────────
create table trainer_availability (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_avail_trainer_day on trainer_availability(trainer_id, day_of_week);

-- ────────────────────────────────────────────────────────────────
-- trainer_blocked_times · férias / pausas
-- ────────────────────────────────────────────────────────────────
create table trainer_blocked_times (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  reason text,
  created_at timestamptz not null default now()
);
create index idx_blocked_trainer_time on trainer_blocked_times(trainer_id, starts_at, ends_at);

-- ────────────────────────────────────────────────────────────────
-- packs
-- ────────────────────────────────────────────────────────────────
create table packs (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  name text not null,
  description text,
  session_type session_type not null,
  sessions integer not null check (sessions > 0),
  price_cents integer not null check (price_cents >= 0),
  validity_days integer, -- null = herdar de trainer_settings
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_packs_trainer_active on packs(trainer_id, active);

-- ────────────────────────────────────────────────────────────────
-- purchases · compra de pack por cliente
-- ────────────────────────────────────────────────────────────────
create table purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles(id) on delete restrict,
  trainer_id uuid not null references trainers(id) on delete restrict,
  pack_id uuid references packs(id) on delete set null,
  pack_snapshot jsonb not null, -- {name, sessions, price_cents, session_type}
  session_type session_type not null,
  sessions_total integer not null check (sessions_total > 0),
  sessions_remaining integer not null check (sessions_remaining >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  status purchase_status not null default 'pending_payment',
  payment_method payment_method not null,
  expires_at timestamptz, -- null = sem validade
  confirmed_at timestamptz,
  confirmed_by uuid references profiles(id) on delete set null,
  rejection_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_purchases_client on purchases(client_id, status);
create index idx_purchases_trainer on purchases(trainer_id, status);
create index idx_purchases_status on purchases(status);

-- ────────────────────────────────────────────────────────────────
-- payments · tentativas/registros de pagamento
-- ────────────────────────────────────────────────────────────────
create table payments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  method payment_method not null,
  amount_cents integer not null check (amount_cents >= 0),
  status payment_status not null default 'pending',
  gateway payment_gateway not null,
  gateway_ref text, -- referência multibanco, transactionId, etc.
  gateway_request_id text, -- requestId IfthenPay
  gateway_payload jsonb,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_payments_purchase on payments(purchase_id);
create index idx_payments_status on payments(status);
create index idx_payments_gateway_ref on payments(gateway_ref);

-- ────────────────────────────────────────────────────────────────
-- bookings · marcações
-- ────────────────────────────────────────────────────────────────
create table bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles(id) on delete restrict,
  trainer_id uuid not null references trainers(id) on delete restrict,
  purchase_id uuid not null references purchases(id) on delete restrict,
  session_type session_type not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status booking_status not null default 'booked',
  confirmed_at timestamptz,
  confirmed_by uuid references profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references profiles(id) on delete set null,
  cancellation_reason text,
  credit_charged boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_bookings_client on bookings(client_id, starts_at);
create index idx_bookings_trainer_time on bookings(trainer_id, starts_at, ends_at);
create index idx_bookings_status on bookings(status);
create index idx_bookings_purchase on bookings(purchase_id);

-- Impede sobreposição de marcações ativas para o mesmo trainer
-- (excluindo canceladas)
create unique index idx_bookings_no_overlap
  on bookings(trainer_id, starts_at)
  where status in ('booked', 'confirmed');

-- ────────────────────────────────────────────────────────────────
-- credit_transactions · audit completo
-- ────────────────────────────────────────────────────────────────
create table credit_transactions (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  delta integer not null, -- positivo: créditos somam · negativo: descontam
  reason credit_reason not null,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_credit_tx_purchase on credit_transactions(purchase_id, created_at desc);

-- ────────────────────────────────────────────────────────────────
-- notifications
-- ────────────────────────────────────────────────────────────────
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notif_user_unread on notifications(user_id, read_at, created_at desc);

-- ────────────────────────────────────────────────────────────────
-- audit_log · ações administrativas sensíveis
-- ────────────────────────────────────────────────────────────────
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_actor_time on audit_log(actor_id, created_at desc);

-- ────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ────────────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated before update on profiles
  for each row execute procedure set_updated_at();
create trigger trg_trainers_updated before update on trainers
  for each row execute procedure set_updated_at();
create trigger trg_trainer_settings_updated before update on trainer_settings
  for each row execute procedure set_updated_at();
create trigger trg_packs_updated before update on packs
  for each row execute procedure set_updated_at();
create trigger trg_purchases_updated before update on purchases
  for each row execute procedure set_updated_at();
create trigger trg_payments_updated before update on payments
  for each row execute procedure set_updated_at();
create trigger trg_bookings_updated before update on bookings
  for each row execute procedure set_updated_at();
