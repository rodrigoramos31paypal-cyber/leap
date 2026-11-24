-- Staff-only first-pack follow-up. No messages, credits or purchases are created here.
create table public.leap_prospect_preferences (
  client_id uuid primary key references public.profiles(id) on delete cascade,
  disposition text not null default 'active' check (disposition in ('active','snoozed','declined')),
  snooze_until timestamptz,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  check ((disposition = 'snoozed') = (snooze_until is not null))
);
alter table public.leap_prospect_preferences enable row level security;
revoke all on public.leap_prospect_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.leap_prospect_preferences to service_role;

create function public.leap_prospect_list(p_actor uuid)
returns table (
  client_id uuid, full_name text, registered_at timestamptz, approval_status text,
  trainer_id uuid, completed_sessions bigint, last_session_at timestamptz,
  next_session_at timestamptz, last_contact_at timestamptz, disposition text,
  snooze_until timestamptz
)
language sql stable security invoker set search_path = '' as $$
  with actor as (
    select p.id, p.role from public.profiles p
    where p.id = p_actor and p.role in ('owner','trainer') and not coalesce(p.access_blocked,false)
  ), single_trainer as (
    select min(t.id::text)::uuid as id from public.trainers t
    where t.active having count(*) = 1
  ), candidates as (
    select p.* from public.profiles p
    join auth.users u on u.id = p.id and u.email_confirmed_at is not null
    cross join actor a
    where p.role = 'client' and p.approval_status in ('approved','pending')
      and not coalesce(p.access_blocked,false) and not coalesce(p.banned,false)
      and coalesce(p.email,'') not ilike '%@removido.invalid'
      and (a.role = 'owner' or exists (
        select 1 from public.trainers t where t.profile_id = a.id and t.active
          and t.id = coalesce(p.trainer_id,(select st.id from single_trainer st))
      ))
      -- Confirmed multi-session paid packs convert a prospect, even when exhausted.
      -- A single paid session can itself be an experiment. Gifts do not count as a sale.
      and not exists (
        select 1 from public.purchases pu where pu.status = 'confirmed'
          and pu.sessions_total > 1 and pu.amount_cents > 0 and pu.payment_method <> 'complimentary'
          and (pu.client_id = p.id or exists (
            select 1 from public.bookings b where
              (b.partner_client_id = p.id and b.partner_purchase_id = pu.id)
              or (b.partner2_client_id = p.id and b.partner2_purchase_id = pu.id)
          ))
      )
      -- Avoid chasing a customer whose purchase is already being processed.
      and not exists (select 1 from public.purchases pu where pu.client_id = p.id
        and pu.status in ('pending_payment','awaiting_confirmation') and pu.sessions_total > 1)
  )
  select p.id, p.full_name, p.created_at, p.approval_status,
    coalesce(p.trainer_id,(select st.id from single_trainer st)),
    sessions.completed, sessions.last_session, sessions.next_session,
    contact.last_contact,
    case when pref.disposition = 'snoozed' and pref.snooze_until <= now() then 'active'
      else coalesce(pref.disposition,'active') end,
    pref.snooze_until
  from candidates p
  cross join lateral (
    select count(*) filter (where b.status = 'confirmed' and b.ends_at <= now()) as completed,
      max(b.starts_at) filter (where b.status = 'confirmed' and b.ends_at <= now()) as last_session,
      min(b.starts_at) filter (where b.status in ('booked','confirmed') and b.ends_at > now()) as next_session
    from public.bookings b where p.id in (b.client_id,b.partner_client_id,b.partner2_client_id)
  ) sessions
  cross join lateral (
    select max(m.created_at) as last_contact from public.leap_chat_messages m
    where m.client_id = p.id and m.sender_id = m.staff_id and m.kind = 'message'
  ) contact
  left join public.leap_prospect_preferences pref on pref.client_id = p.id
  where sessions.completed <= 1
  order by coalesce(sessions.last_session,p.created_at) desc, p.id;
$$;
revoke all on function public.leap_prospect_list(uuid) from public, anon, authenticated;
grant execute on function public.leap_prospect_list(uuid) to service_role;

create function public.leap_prospect_set_preference(p_actor uuid, p_client uuid, p_disposition text)
returns text language plpgsql security invoker set search_path = '' as $$
begin
  if p_disposition not in ('active','snoozed','declined') or p_disposition is null then return 'invalid'; end if;
  if not exists (select 1 from public.leap_prospect_list(p_actor) p where p.client_id = p_client) then return 'unavailable'; end if;
  insert into public.leap_prospect_preferences(client_id,disposition,snooze_until,updated_by)
  values(p_client,p_disposition,case when p_disposition = 'snoozed' then now() + interval '7 days' end,p_actor)
  on conflict(client_id) do update set disposition = excluded.disposition,
    snooze_until = excluded.snooze_until, updated_by = excluded.updated_by, updated_at = now();
  return 'ok';
end;
$$;
revoke all on function public.leap_prospect_set_preference(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.leap_prospect_set_preference(uuid,uuid,text) to service_role;
