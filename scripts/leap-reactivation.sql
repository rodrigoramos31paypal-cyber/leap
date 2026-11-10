create extension if not exists pg_cron with schema pg_catalog;

create table public.leap_reactivation_preferences (
  client_id uuid primary key references public.profiles(id) on delete cascade,
  disabled boolean not null default false,
  snooze_until timestamptz
);
create table public.leap_reactivation_weeks (
  week_at timestamptz primary key
);
create table public.leap_reactivation_seen (
  staff_id uuid references public.profiles(id) on delete cascade,
  week_at timestamptz references public.leap_reactivation_weeks(week_at) on delete cascade,
  primary key (staff_id, week_at)
);
create table public.leap_reactivation_alerts (
  id uuid primary key default gen_random_uuid(),
  week_at timestamptz not null references public.leap_reactivation_weeks(week_at),
  client_id uuid not null references public.profiles(id) on delete cascade,
  trainer_id uuid references public.trainers(id) on delete set null,
  reasons text[] not null,
  days integer,
  last_session timestamptz,
  remaining integer not null,
  unique (week_at, client_id)
);
create table public.leap_reactivation_messages (
  message_id uuid primary key references public.leap_chat_messages(id) on delete cascade,
  alert_id uuid not null references public.leap_reactivation_alerts(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  sent_at timestamptz not null default now(),
  booked_at timestamptz,
  renewed_at timestamptz
);
create index leap_reactivation_message_client_time on public.leap_reactivation_messages(client_id,sent_at desc);

do $$
declare name text;
begin
  foreach name in array array['preferences','weeks','seen','alerts','messages'] loop
    execute format('alter table public.leap_reactivation_%I enable row level security', name);
    execute format('revoke all on public.leap_reactivation_%I from public, anon, authenticated', name);
    execute format('grant select,insert,update on public.leap_reactivation_%I to service_role', name);
  end loop;
end $$;

create function public.leap_reactivation_scan() returns void
language plpgsql set search_path = '' as $$
declare
  local_now timestamp := now() at time zone 'Europe/Lisbon';
  sunday timestamp := date_trunc('week',local_now) + interval '6 days 18 hours';
  cutoff timestamptz;
begin
  update public.leap_reactivation_messages m
  set booked_at = coalesce(m.booked_at, (
    select min(b.created_at) from public.bookings b
    where m.client_id in (b.client_id,b.partner_client_id,b.partner2_client_id)
      and b.status in ('booked','confirmed') and b.created_at > m.sent_at
      and b.created_at <= m.sent_at + interval '14 days'
  )), renewed_at = coalesce(m.renewed_at, (
    select min(pay.paid_at) from public.payments pay join public.purchases p on p.id=pay.purchase_id
    where p.client_id=m.client_id and p.status='confirmed' and pay.status='paid'
      and pay.paid_at > m.sent_at and pay.paid_at <= m.sent_at + interval '14 days'
  ))
  where m.sent_at >= now() - interval '15 days' and (m.booked_at is null or m.renewed_at is null);

  if sunday > local_now then sunday := sunday - interval '7 days'; end if;
  cutoff := sunday at time zone 'Europe/Lisbon';
  insert into public.leap_reactivation_weeks values (cutoff) on conflict do nothing;
  if not found then return; end if;

  insert into public.leap_reactivation_alerts (week_at,client_id,trainer_id,reasons,days,last_session,remaining)
  with clients as (
    select p.id, coalesce(p.trainer_id, (select id from public.trainers where active order by id limit 1)) as trainer_id
    from public.profiles p left join public.leap_reactivation_preferences f on f.client_id=p.id
    where p.role='client' and p.approval_status='approved' and p.access_blocked is not true
      and p.email not ilike '%@removido.invalid' and f.disabled is not true
      and (f.snooze_until is null or f.snooze_until <= cutoff)
  ), stats as (
    select c.*, b.last_session, (sunday::date - (b.last_session at time zone 'Europe/Lisbon')::date) as days,
      p.remaining, p.last_pack, b.misses
    from clients c
    cross join lateral (
      select max(ends_at) filter (where status='confirmed' and ends_at <= cutoff) as last_session,
        count(*) filter (where (status='no_show' and starts_at between cutoff-interval '30 days' and cutoff)
          or (status='cancelled' and cancelled_by=c.id and late_cancel_review is not null
              and cancelled_at between cutoff-interval '30 days' and cutoff)) as misses
      from public.bookings
      where c.id in (client_id,partner_client_id,partner2_client_id)
    ) b
    cross join lateral (
      select coalesce(sum(greatest(sessions_remaining,0)) filter (where expires_at is null or expires_at >= cutoff),0)::integer as remaining,
        max(coalesce(confirmed_at,created_at)) as last_pack
      from public.purchases p
      where p.status='confirmed' and coalesce(p.confirmed_at,p.created_at) <= cutoff and (
        p.client_id=c.id
        or (p.session_type='dupla' and exists (
          select 1 from public.duo_partnerships d where d.active and c.id in (d.client_a,d.client_b)
            and p.client_id in (d.client_a,d.client_b)
        ))
        or (p.session_type='tripla' and exists (
          select 1 from public.trio_partnerships t where t.active and c.id in (t.client_a,t.client_b,t.client_c)
            and p.client_id in (t.client_a,t.client_b,t.client_c)
        ))
      )
    ) p
  ), flagged as (
    select *, array_remove(array[
      case when days >= 30 then 'level3' when days >= 14 then 'level2' when days >= 10 then 'level1' end,
      case when remaining=0 and last_pack <= cutoff - interval '3 days' then 'empty'
           when remaining between 1 and 2 then 'low' end,
      case when misses >= 2 then 'misses' end
    ],null) as reasons from stats
  )
  select cutoff,id,trainer_id,reasons,days,last_session,remaining from flagged where cardinality(reasons)>0;
end $$;

create function public.leap_reactivation_send(p_alert uuid,p_client uuid,p_staff uuid,p_id uuid,p_body text)
returns text language plpgsql set search_path = '' as $$
declare recent timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('leap-reactivation:' || p_client,0));
  if exists (select 1 from public.leap_reactivation_messages where message_id=p_id and alert_id=p_alert and client_id=p_client) then
    return null;
  end if;
  if not exists (
    select 1 from public.leap_reactivation_alerts a left join public.leap_reactivation_preferences f on f.client_id=a.client_id
    where a.id=p_alert and a.client_id=p_client and a.week_at=(select max(week_at) from public.leap_reactivation_weeks)
      and f.disabled is not true and (f.snooze_until is null or f.snooze_until<=now())
  ) then return 'Este alerta já não está disponível.'; end if;
  select max(sent_at) into recent from public.leap_reactivation_messages where client_id=p_client;
  if recent > now()-interval '7 days' then
    return 'Já foi enviada uma mensagem de reativação a este cliente nos últimos 7 dias.';
  end if;
  perform public.leap_send_chat_message(p_id,p_client,p_staff,p_staff,p_body,null,null);
  insert into public.leap_reactivation_messages(message_id,alert_id,client_id) values(p_id,p_alert,p_client);
  return null;
end $$;

create function public.leap_reactivation_summary(p_trainers uuid[]) returns jsonb
language sql stable set search_path = '' as $$
  with bounds as (
    select date_trunc('month',now() at time zone 'Europe/Lisbon') at time zone 'Europe/Lisbon' as month_start
  ), scoped as (
    select m.* from public.leap_reactivation_messages m join public.leap_reactivation_alerts a on a.id=m.alert_id
    where p_trainers is null or a.trainer_id=any(p_trainers)
  ), paid as (
    select pay.amount_cents,p.client_id,pay.paid_at
    from public.payments pay join public.purchases p on p.id=pay.purchase_id cross join bounds
    where p.status='confirmed' and pay.status='paid' and pay.paid_at>=month_start
      and exists(select 1 from scoped m where m.client_id=p.client_id and pay.paid_at>m.sent_at and pay.paid_at<=m.sent_at+interval '14 days')
  ), recovered as (
    select client_id from scoped cross join bounds where booked_at>=month_start or renewed_at>=month_start
    union select client_id from paid
  )
  select jsonb_build_object(
    'sent',(select count(*) from scoped cross join bounds where sent_at>=month_start),
    'recovered',(select count(*) from recovered),
    'revenue',(select coalesce(sum(amount_cents),0) from paid)
  )
$$;

revoke execute on function public.leap_reactivation_scan(),public.leap_reactivation_send(uuid,uuid,uuid,uuid,text),public.leap_reactivation_summary(uuid[]) from public,anon,authenticated;
grant execute on function public.leap_reactivation_send(uuid,uuid,uuid,uuid,text),public.leap_reactivation_summary(uuid[]) to service_role;
select cron.schedule('leap-reactivation','0 * * * *','select public.leap_reactivation_scan()');
select public.leap_reactivation_scan();
