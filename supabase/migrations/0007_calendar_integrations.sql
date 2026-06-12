-- ════════════════════════════════════════════════════════════════
-- Calendar integrations · armazena tokens OAuth de Google/Microsoft
-- e mapeia bookings → event IDs externos.
-- ════════════════════════════════════════════════════════════════

create table if not exists calendar_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  calendar_id text default 'primary',
  account_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create index if not exists idx_cal_integ_user on calendar_integrations(user_id);

create trigger trg_cal_integ_updated before update on calendar_integrations
  for each row execute procedure set_updated_at();

-- Mapping booking → external event
create table if not exists booking_calendar_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  integration_id uuid not null references calendar_integrations(id) on delete cascade,
  external_event_id text not null,
  created_at timestamptz not null default now(),
  unique (booking_id, integration_id)
);
create index if not exists idx_bce_booking on booking_calendar_events(booking_id);

-- RLS: só o próprio user pode ver os seus tokens
alter table calendar_integrations enable row level security;
alter table booking_calendar_events enable row level security;

create policy "cal_integ: owner reads" on calendar_integrations
  for select using (user_id = auth.uid());
create policy "cal_integ: owner writes" on calendar_integrations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "bce: owner reads" on booking_calendar_events
  for select using (
    integration_id in (select id from calendar_integrations where user_id = auth.uid())
  );
