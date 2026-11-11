create table public.leap_weigh_ins (
  id uuid primary key,
  client_id uuid not null references public.profiles(id) on delete cascade,
  recorded_by uuid references public.profiles(id) on delete set null,
  measured_on date not null,
  weight numeric check (weight > 0 and weight <= 500),
  muscle numeric check (muscle > 0 and muscle <= 250),
  fat_mass numeric check (fat_mass >= 0 and fat_mass <= 400),
  fat_percent numeric check (fat_percent >= 0 and fat_percent <= 100),
  total_muscle numeric check (total_muscle > 0 and total_muscle <= 300),
  water numeric check (water > 0 and water <= 300),
  visceral_fat numeric check (visceral_fat >= 0 and visceral_fat <= 100),
  note text check (char_length(note) <= 500),
  source text not null check (source in ('manual','starfit')),
  created_at timestamptz not null default now(),
  check (num_nonnulls(weight,muscle,fat_mass,fat_percent)>0)
);
create index leap_weigh_ins_history on public.leap_weigh_ins(client_id,measured_on desc,created_at desc);
alter table public.leap_weigh_ins enable row level security;
revoke all on public.leap_weigh_ins from public,anon,authenticated;
grant select,insert on public.leap_weigh_ins to service_role;
