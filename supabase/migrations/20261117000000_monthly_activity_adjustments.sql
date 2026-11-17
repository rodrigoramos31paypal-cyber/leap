create schema if not exists leap_ranking;
revoke all on schema leap_ranking from public, anon, authenticated;

create table leap_ranking.activity_adjustments (
  client_id uuid not null references public.profiles(id) on delete cascade,
  month_start date not null,
  delta integer not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (client_id, month_start),
  check (extract(day from month_start) = 1)
);

create function leap_ranking.month_totals(p_client uuid, p_start date, p_now timestamptz)
returns table(pt_done_month integer, extra_month integer, activities_total integer)
language sql stable set search_path = '' as $$
  select counts.pt, counts.extra, greatest(0, counts.pt + counts.extra + coalesce(adj.delta, 0))
  from (
    select
      (select count(*)::int from public.bookings bk
       where (bk.client_id = p_client or bk.partner_client_id = p_client or bk.partner2_client_id = p_client)
         and bk.status in ('booked', 'confirmed')
         and bk.starts_at >= (p_start::timestamp at time zone 'Europe/Lisbon')
         and bk.starts_at < least(p_now, (p_start + interval '1 month') at time zone 'Europe/Lisbon')) as pt,
      (select count(*)::int from public.activities a
       where a.client_id = p_client and a.status = 'validated'
         and a.activity_date >= p_start and a.activity_date < (p_start + interval '1 month')::date) as extra
  ) counts
  left join leap_ranking.activity_adjustments adj
    on adj.client_id = p_client and adj.month_start = p_start;
$$;

create function public.get_admin_client_month_activities(p_client uuid, p_actor uuid)
returns table(month_start date, total integer, editable boolean)
language sql stable security definer set search_path = '' as $$
  select period.month_start, totals.activities_total, actor.role in ('owner','trainer')
  from public.profiles actor
  join public.profiles client on client.id = p_client and client.role = 'client'
    and coalesce(client.email, '') not like '%@removido.invalid'
  cross join lateral (select date_trunc('month', now() at time zone 'Europe/Lisbon')::date as month_start) period
  cross join lateral leap_ranking.month_totals(client.id, period.month_start, now()) totals
  where actor.id = p_actor and actor.access_blocked is not true
    and (actor.role in ('owner','viewer') or (actor.role = 'trainer' and exists (
      select 1 from public.trainers t where t.id = client.trainer_id and t.profile_id = actor.id
    )));
$$;
revoke all on function public.get_admin_client_month_activities(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_admin_client_month_activities(uuid, uuid) to service_role;

create function public.set_admin_client_month_activities(
  p_client uuid, p_actor uuid, p_month date, p_expected integer, p_total integer
) returns text language plpgsql security definer set search_path = '' as $$
declare
  current_month date := date_trunc('month', now() at time zone 'Europe/Lisbon')::date;
  current_total integer;
  can_edit boolean;
  organic integer;
begin
  if p_month is distinct from current_month then return 'stale'; end if;
  if p_total is null or p_total < 0 or p_total > 100000 then return 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client::text || ':' || current_month::text, 0));
  select s.total, s.editable into current_total, can_edit
  from public.get_admin_client_month_activities(p_client, p_actor) s;
  if can_edit is distinct from true then return 'denied'; end if;
  if current_total is distinct from p_expected then return 'stale'; end if;
  select t.pt_done_month + t.extra_month into organic
  from leap_ranking.month_totals(p_client, current_month, now()) t;
  insert into leap_ranking.activity_adjustments (client_id, month_start, delta, updated_by)
  values (p_client, current_month, p_total - organic, p_actor)
  on conflict (client_id, month_start) do update
     set delta = excluded.delta, updated_by = excluded.updated_by, updated_at = now();
  return 'ok';
end;
$$;
revoke all on function public.set_admin_client_month_activities(uuid, uuid, date, integer, integer) from public, anon, authenticated;
grant execute on function public.set_admin_client_month_activities(uuid, uuid, date, integer, integer) to service_role;

CREATE OR REPLACE FUNCTION public.get_leaderboard_month(p_trainer uuid, p_period text)
 RETURNS TABLE(client_id uuid, full_name text, pack_pct integer, pt_done_month integer, extra_month integer, activities_total integer, current_streak integer, rank integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_m_start date := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_m_end date := (v_m_start + interval '1 month')::date;
  v_m_start_ts timestamptz := (v_m_start::timestamp at time zone 'Europe/Lisbon');
  v_m_end_ts timestamptz := (v_m_end::timestamp at time zone 'Europe/Lisbon');
  v_cutoff timestamptz := least(v_now, v_m_end_ts);
begin
  return query
  with base as (
    select p.id, p.full_name
    from profiles p
    where p.role = 'client'
      and not coalesce(p.leaderboard_opt_out, false)
      and coalesce(p.email, '') not like '%@removido.invalid'
      and exists (
        select 1 from bookings b
        where b.trainer_id = p_trainer
          and (b.client_id = p.id or b.partner_client_id = p.id or b.partner2_client_id = p.id)
      )
  ),
  calc as (
    select
      base.id as client_id,
      base.full_name,
      (select max(t.pct)::int from (
         select least(100, greatest(0, round(
           (select count(*) from bookings bk
              where bk.purchase_id = pu.id
                and bk.status in ('booked', 'confirmed')
                and bk.starts_at < v_cutoff)::numeric
           / pu.sessions_total * 100)))::int as pct
         from purchases pu
         where pu.client_id in (select related_client_ids(base.id))
           and pu.status = 'confirmed'
           and pu.sessions_total > 0
       ) t) as pack_pct,
      totals.pt_done_month,
      totals.extra_month,
      totals.activities_total,
      s.current_streak
    from base
    cross join lateral leap_ranking.month_totals(base.id, v_m_start, v_now) totals
    cross join lateral get_client_streak(base.id) s
  )
  select
    sc.client_id, sc.full_name, sc.pack_pct, sc.pt_done_month, sc.extra_month,
    sc.activities_total, sc.current_streak,
    (row_number() over (
       order by
         (sc.pt_done_month = 0) asc,
         (case when sc.pt_done_month > 0 then sc.pack_pct else null end) desc nulls last,
         sc.activities_total desc,
         sc.current_streak desc,
         lower(coalesce(sc.full_name, '')) asc
     ))::int as rank
  from calc sc
  order by rank;
end;
$function$;
