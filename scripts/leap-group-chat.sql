-- A conversation belongs to the exact set of athletes and the booking trainer.
-- Membership changes create a different conversation instead of sharing history.
create table public.leap_group_chats (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  members uuid[] not null check (cardinality(members) in (2,3)),
  unique (trainer_id,members)
);
create index leap_group_chats_members on public.leap_group_chats using gin(members);
create index leap_group_chats_staff on public.leap_group_chats(staff_id);

create table public.leap_group_chat_messages (
  id uuid primary key,
  group_id uuid not null references public.leap_group_chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  booking_id uuid references public.bookings(id) on delete set null,
  booking_starts_at timestamptz,
  rescheduled_from timestamptz,
  kind text not null default 'message' check (kind in ('message','cancellation')),
  created_at timestamptz not null default now()
);
create index leap_group_chat_messages_latest on public.leap_group_chat_messages(group_id,created_at desc,id desc);

create table public.leap_group_chat_reads (
  message_id uuid references public.leap_group_chat_messages(id) on delete cascade,
  reader_id uuid references public.profiles(id) on delete cascade,
  primary key(message_id,reader_id)
);

alter table public.leap_group_chats enable row level security;
alter table public.leap_group_chat_messages enable row level security;
alter table public.leap_group_chat_reads enable row level security;
revoke all on public.leap_group_chats,public.leap_group_chat_messages,public.leap_group_chat_reads from public,anon,authenticated;
grant select,insert,update on public.leap_group_chats,public.leap_group_chat_messages,public.leap_group_chat_reads to service_role;

create function public.leap_group_for_booking(p_booking uuid)
returns uuid language plpgsql set search_path = '' as $$
declare
  b public.bookings%rowtype;
  v_members uuid[];
  v_staff uuid;
  v_group uuid;
begin
  select * into b from public.bookings where id=p_booking;
  if not found or b.session_type not in ('dupla','tripla') then return null; end if;
  select array_agg(id order by id) into v_members
    from (select distinct unnest(array[b.client_id,b.partner_client_id,b.partner2_client_id]) as id) members
    where id is not null;
  if cardinality(v_members) is distinct from (case when b.session_type='dupla' then 2 else 3 end) then return null; end if;

  select profile_id into v_staff from public.trainers where id=b.trainer_id;
  if v_staff is null then return null; end if;
  -- Use the same João Pedro identity as the private inbox.
  if v_staff='a444e83b-e56a-4d5f-95d0-ea0976f01a89'::uuid then
    v_staff := 'c4a7bb71-540e-4d41-ad53-c49f7085602b'::uuid;
  end if;

  insert into public.leap_group_chats(trainer_id,staff_id,members) values(b.trainer_id,v_staff,v_members)
    on conflict (trainer_id,members) do update set staff_id=excluded.staff_id
    returning id into v_group;
  return v_group;
end $$;

create function public.leap_send_group_message(p_group uuid,p_sender uuid,p_id uuid,p_body text)
returns void language plpgsql set search_path = '' as $$
declare
  g public.leap_group_chats%rowtype;
begin
  select * into strict g from public.leap_group_chats where id=p_group;
  if p_sender is distinct from g.staff_id and not (p_sender=any(g.members)) then
    raise exception 'Acesso restrito.' using errcode='42501';
  end if;
  insert into public.leap_group_chat_messages(id,group_id,sender_id,body)
    values(p_id,p_group,p_sender,p_body) on conflict(id) do nothing;
end $$;

revoke execute on function public.leap_group_for_booking(uuid),public.leap_send_group_message(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.leap_group_for_booking(uuid),public.leap_send_group_message(uuid,uuid,uuid,text) to service_role;

create function public.leap_notify_group_chat() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.notifications(user_id,type,title,body,link)
  select recipient,'chat_message',case when cardinality(g.members)=2 then 'Conversa Duo LEAP' else 'Conversa Trio LEAP' end,
    'Tens uma nova mensagem no grupo.',
    case when recipient=g.staff_id then '/admin/mensagens' else '/app/mensagens' end || '?grupo=' || g.id
  from public.leap_group_chats g
  cross join lateral unnest(g.members || array[g.staff_id]) recipients(recipient)
  join public.profiles p on p.id=recipient
  where g.id=new.group_id and recipient<>new.sender_id and p.access_blocked is not true
    and (recipient=g.staff_id or p.approval_status='approved');
  return new;
end $$;
create trigger leap_notify_group_chat after insert on public.leap_group_chat_messages
for each row execute function public.leap_notify_group_chat();

create function public.leap_group_booking_event() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_group uuid;
begin
  if new.booking_id is null or (new.rescheduled_from is null and new.kind<>'cancellation') then return new; end if;
  if old.rescheduled_from is not distinct from new.rescheduled_from and old.kind=new.kind then return new; end if;
  v_group := public.leap_group_for_booking(new.booking_id);
  if v_group is null then return new; end if;

  insert into public.leap_group_chat_messages(id,group_id,sender_id,body,booking_id,booking_starts_at,rescheduled_from,kind)
  select gen_random_uuid(),g.id,case when new.sender_id=any(g.members) then new.sender_id else g.staff_id end,
    case when new.kind='cancellation' then 'A sessão de grupo foi cancelada.' else 'Sessão reagendada' end,
    new.booking_id,new.booking_starts_at,new.rescheduled_from,new.kind
  from public.leap_group_chats g where g.id=v_group;
  return new;
end $$;
create trigger leap_group_booking_event after update of rescheduled_from,kind on public.leap_chat_messages
for each row execute function public.leap_group_booking_event();

revoke execute on function public.leap_notify_group_chat(),public.leap_group_booking_event() from public,anon,authenticated;

create function public.leap_group_inbox(p_account uuid,p_staff boolean)
returns table(id uuid,full_name text,unread bigint,last_message timestamptz,preview text,mine boolean)
language sql stable set search_path = '' as $$
  select g.id,
    (case when cardinality(g.members)=2 then 'Duo · ' else 'Trio · ' end) ||
      coalesce((select string_agg(split_part(p.full_name,' ',1),' e ' order by p.full_name)
        from public.profiles p where p.id=any(g.members)),'LEAP'),
    (select count(*) from public.leap_group_chat_messages m
      where m.group_id=g.id and m.sender_id<>p_account and not exists (
        select 1 from public.leap_group_chat_reads r where r.message_id=m.id and r.reader_id=p_account
      )),
    latest.created_at,
    case when latest.rescheduled_from is not null then 'Sessão reagendada'
         when latest.kind='cancellation' then 'Cancelamento de treino' else left(latest.body,160) end,
    coalesce(latest.sender_id=p_account,false)
  from public.leap_group_chats g
  left join lateral (
    select * from public.leap_group_chat_messages m where m.group_id=g.id order by m.created_at desc,m.id desc limit 1
  ) latest on true
  where (p_staff and g.staff_id=p_account) or (not p_staff and p_account=any(g.members))
  order by latest.created_at desc nulls last,g.id
$$;
revoke execute on function public.leap_group_inbox(uuid,boolean) from public,anon,authenticated;
grant execute on function public.leap_group_inbox(uuid,boolean) to service_role;
