-- Reuse the trusted signup verification marker without granting access to auth.users.
create or replace function public.leap_prospect_list(p_actor uuid)
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
    cross join actor a
    where p.role = 'client' and p.approval_status in ('approved','pending')
      -- Existing verification trigger sets approval_notified_at; approved accounts are already accepted.
      and (p.approval_status = 'approved' or p.approval_notified_at is not null)
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
