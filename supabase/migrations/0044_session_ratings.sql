-- ════════════════════════════════════════════════════════════════
-- 0044_session_ratings
--
-- Avaliação opcional 1-5⭐ + comentário privado pós-sessão. Cliente
-- avalia uma sessão que JÁ realizou (status='confirmed' e ends_at no
-- passado). Uma só avaliação por sessão; pode ser actualizada.
--
-- Tabelas:
--   • session_ratings          — avaliações em si.
--   • rating_prompts           — dedup do prompt enviado pelo cron.
--
-- Views públicas (anon + authenticated podem ler):
--   • trainer_rating_stats     — média e contagem por trainer.
--   • trainer_recent_reviews   — reviews anonimizadas (primeiro nome +
--                                 inicial do apelido) para o pop-up.
--
-- REVERT:
--   drop view if exists trainer_recent_reviews;
--   drop view if exists trainer_rating_stats;
--   drop table if exists rating_prompts;
--   drop table if exists session_ratings;
-- ════════════════════════════════════════════════════════════════

create table if not exists session_ratings (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings(id) on delete cascade,
  client_id   uuid not null references profiles(id) on delete cascade,
  trainer_id  uuid not null references trainers(id) on delete cascade,
  stars       integer not null check (stars between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (booking_id)
);

create index if not exists idx_session_ratings_trainer
  on session_ratings (trainer_id, created_at desc);

-- ── Dedup do prompt do cron ──────────────────────────────────────
create table if not exists rating_prompts (
  booking_id uuid primary key references bookings(id) on delete cascade,
  sent_at    timestamptz not null default now()
);

-- ── RLS ──────────────────────────────────────────────────────────
alter table session_ratings enable row level security;
alter table rating_prompts  enable row level security;

-- Cliente: pode ler/criar/actualizar as próprias avaliações.
create policy "ratings: client read own" on session_ratings
  for select using (client_id = auth.uid());
create policy "ratings: client insert own" on session_ratings
  for insert with check (
    client_id = auth.uid()
    and exists (
      select 1 from bookings b
      where b.id = session_ratings.booking_id
        and b.client_id = auth.uid()
        and b.status = 'confirmed'
        and b.ends_at < now()
    )
  );
create policy "ratings: client update own" on session_ratings
  for update using (client_id = auth.uid()) with check (client_id = auth.uid());

-- Trainer: pode ler as avaliações que recebeu.
create policy "ratings: trainer read own" on session_ratings
  for select using (
    exists (
      select 1 from trainers t
      where t.id = session_ratings.trainer_id
        and t.profile_id = auth.uid()
    )
  );

-- rating_prompts é puramente interno (cron + service role).

-- ── Views públicas ───────────────────────────────────────────────
-- security_invoker = OFF (default) → a view corre com privilégios do
-- criador (postgres), por isso bypassa o RLS de session_ratings.
-- Os campos expostos são seguros: agregados ou anonimizados.

create or replace view trainer_rating_stats as
select
  trainer_id,
  round(avg(stars)::numeric, 1) as avg_stars,
  count(*)::int                  as review_count
from session_ratings
group by trainer_id;

grant select on trainer_rating_stats to anon, authenticated;

create or replace view trainer_recent_reviews as
select
  r.trainer_id,
  r.stars,
  r.comment,
  r.created_at,
  -- "João S." (primeiro nome + inicial do apelido). NULL-safe.
  case
    when p.full_name is null or length(trim(p.full_name)) = 0 then 'Anónimo'
    else
      split_part(trim(p.full_name), ' ', 1)
      || case
           when split_part(trim(p.full_name), ' ', 2) <> ''
             then ' ' || upper(left(split_part(trim(p.full_name), ' ', 2), 1)) || '.'
           else ''
         end
  end as reviewer_name
from session_ratings r
join profiles p on p.id = r.client_id
order by r.created_at desc;

grant select on trainer_recent_reviews to anon, authenticated;

-- ── Trigger: manter updated_at ───────────────────────────────────
create or replace function bump_session_ratings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_session_ratings_bump_updated on session_ratings;
create trigger trg_session_ratings_bump_updated
  before update on session_ratings
  for each row execute function bump_session_ratings_updated_at();
