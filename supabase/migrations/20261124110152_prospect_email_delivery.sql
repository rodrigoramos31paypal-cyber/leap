-- Server-only delivery queue. No email is queued until staff explicitly sends a prospect message
-- or explicitly confirms account deletion. PII is cleared after delivery/cancellation/expiry.
create table public.leap_prospect_emails (
 id uuid primary key,
 client_id uuid not null references public.profiles(id),
 actor_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('invitation','continuation','account_removed')),
 recipient text,
 body text,
 href text,
 status text not null check(status in ('held','pending','sending','sent','failed','cancelled')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 retry_until timestamptz not null default now() + interval '23 hours',
 locked_until timestamptz,
 lease_token uuid,
 created_at timestamptz not null default now(),
 sent_at timestamptz
);
create unique index leap_prospect_deletion_email_once on public.leap_prospect_emails(client_id) where kind='account_removed';
create index leap_prospect_email_pending on public.leap_prospect_emails(next_attempt_at) where status in ('pending','sending','held');
alter table public.leap_prospect_emails enable row level security;
revoke all on public.leap_prospect_emails from public,anon,authenticated;
grant select,insert,update,delete on public.leap_prospect_emails to service_role;

create function public.leap_prospect_send(p_actor uuid,p_client uuid,p_staff uuid,p_id uuid,p_body text)
returns text language plpgsql security invoker set search_path='' as $$
declare lead record; destination text; message_link text; category text;
begin
 if p_body is null or length(btrim(p_body)) not between 1 and 2000 then return 'invalid'; end if;
 if not exists(select 1 from public.profiles a where a.id=p_actor and a.role in ('owner','trainer') and not coalesce(a.access_blocked,false)) then return 'unavailable'; end if;
 if p_staff is distinct from (case when p_actor='a444e83b-e56a-4d5f-95d0-ea0976f01a89'::uuid then 'c4a7bb71-540e-4d41-ad53-c49f7085602b'::uuid else p_actor end) then return 'unavailable'; end if;
 -- Serialize with deletion and concurrent invitations for this account.
 select p.email into destination from public.profiles p where p.id=p_client for update;
 select * into lead from public.leap_prospect_list(p_actor) p where p.client_id=p_client and p.disposition='active';
 if not found then return 'unavailable'; end if;
 if destination is null or destination !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return 'invalid_email'; end if;
 perform public.leap_send_chat_message(p_id,p_client,p_staff,p_staff,btrim(p_body),null,null);
 category := case when lead.completed_sessions > 0 then 'packs' else 'sessions' end;
 if exists(select 1 from public.notification_preferences n where n.user_id=p_client and n.kind=category and n.email_enabled=false) then return 'email_disabled'; end if;
 message_link := case when lead.approval_status='pending' then '/aprovacao-pendente?chat=1' else '/app/mensagens?equipa=' || p_staff::text end;
 insert into public.leap_prospect_emails(id,client_id,actor_id,kind,recipient,body,href,status)
 values(p_id,p_client,p_actor,case when lead.completed_sessions > 0 then 'continuation' else 'invitation' end,destination,btrim(p_body),message_link,'pending')
 on conflict(id) do nothing;
 if not exists(select 1 from public.leap_prospect_emails e where e.id=p_id and e.client_id=p_client and e.actor_id=p_actor and e.kind in ('invitation','continuation')) then raise exception 'Invalid email identifier'; end if;
 return 'ok';
end; $$;

create function public.leap_prospect_prepare_deletion(p_actor uuid,p_client uuid,p_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare lead record; recipient_email text; event_id uuid;
begin
 if not exists(select 1 from public.profiles a where a.id=p_actor and a.role='owner' and not coalesce(a.access_blocked,false)) then return null; end if;
 select p.email into recipient_email from public.profiles p where p.id=p_client for update;
 select * into lead from public.leap_prospect_list(p_actor) p where p.client_id=p_client;
 if not found or lead.next_session_at is not null then return null; end if;
 if recipient_email is null or recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return null; end if;
 insert into public.leap_prospect_emails(id,client_id,actor_id,kind,recipient,status)
 values(p_id,p_client,p_actor,'account_removed',recipient_email,'held')
 on conflict(client_id) where kind='account_removed' do nothing;
 select e.id into event_id from public.leap_prospect_emails e where e.client_id=p_client and e.kind='account_removed';
 return event_id;
end; $$;

create function public.leap_prospect_claim_emails(p_id uuid default null,p_limit integer default 3)
returns setof public.leap_prospect_emails language plpgsql security invoker set search_path='' as $$
begin
 -- A deletion notice becomes sendable only after anonymization actually completed.
 update public.leap_prospect_emails e set status='pending'
 where e.kind='account_removed' and e.status='held' and exists(select 1 from public.profiles p where p.id=e.client_id and p.access_blocked and p.email like '%@removido.invalid');
 -- Remove undelivered invitations if the client has since been removed or blocked.
 update public.leap_prospect_emails e set status='cancelled',recipient=null,body=null,href=null
 where e.kind<>'account_removed' and e.status in ('pending','sending')
 and exists(select 1 from public.profiles p where p.id=e.client_id and (p.access_blocked or p.email like '%@removido.invalid'));
 update public.leap_prospect_emails set status='failed',recipient=null,body=null,href=null,lease_token=null,locked_until=null
 where status in ('pending','sending','held') and retry_until <= now();
 if p_limit <= 0 then return; end if;
 return query
 with due as (
   select e.id from public.leap_prospect_emails e
   where (p_id is null or e.id=p_id) and e.retry_until>now() and e.next_attempt_at <= now()
     and (e.status='pending' or (e.status='sending' and e.locked_until<now()))
   order by e.created_at limit greatest(1,least(p_limit,5)) for update skip locked
 )
 update public.leap_prospect_emails e set status='sending',attempts=e.attempts+1,locked_until=now()+interval '2 minutes',lease_token=gen_random_uuid()
 from due where e.id=due.id returning e.*;
end; $$;

create function public.leap_prospect_finish_email(p_id uuid,p_lease uuid,p_sent boolean)
returns void language sql security invoker set search_path='' as $$
 update public.leap_prospect_emails e set
   status=case when p_sent then 'sent' else 'pending' end,
   sent_at=case when p_sent then now() else null end,
   recipient=case when p_sent then null else e.recipient end,
   body=case when p_sent then null else e.body end,
   href=case when p_sent then null else e.href end,
   next_attempt_at=now()+interval '5 minutes',locked_until=null,lease_token=null
 where e.id=p_id and e.lease_token=p_lease and e.status='sending';
$$;
revoke all on function public.leap_prospect_send(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.leap_prospect_prepare_deletion(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.leap_prospect_claim_emails(uuid,integer) from public,anon,authenticated;
revoke all on function public.leap_prospect_finish_email(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.leap_prospect_send(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.leap_prospect_prepare_deletion(uuid,uuid,uuid) to service_role;
grant execute on function public.leap_prospect_claim_emails(uuid,integer) to service_role;
grant execute on function public.leap_prospect_finish_email(uuid,uuid,boolean) to service_role;

-- Include abandoned registrations, including those without email verification.
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
