create table public.leap_chat_messages (
  id uuid primary key,
  client_id uuid not null references public.profiles(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  booking_id uuid references public.bookings(id) on delete set null,
  booking_starts_at timestamptz,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (client_id <> staff_id and sender_id in (client_id, staff_id))
);
create index leap_chat_thread_idx on public.leap_chat_messages (client_id, staff_id, created_at desc, id desc);
create index leap_chat_staff_idx on public.leap_chat_messages (staff_id, client_id);
create index leap_chat_booking_idx on public.leap_chat_messages (booking_id) where booking_id is not null;
alter table public.leap_chat_messages enable row level security;
revoke all on public.leap_chat_messages from public, anon, authenticated;
grant select, insert, update, delete on public.leap_chat_messages to service_role;

create function public.leap_send_chat_message(p_id uuid, p_client uuid, p_staff uuid, p_sender uuid, p_body text, p_booking uuid, p_booking_starts timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.leap_chat_messages (id, client_id, staff_id, sender_id, body, booking_id, booking_starts_at)
  values (p_id, p_client, p_staff, p_sender, p_body, p_booking, p_booking_starts)
  on conflict (id) do nothing;
  if found then
    insert into public.notifications (id, user_id, type, title, body, link)
    values (
      p_id,
      case when p_sender = p_client then p_staff else p_client end,
      'chat_message',
      'Nova mensagem LEAP',
      'Tens uma nova mensagem na app.',
      case when p_sender = p_client then '/admin/mensagens?cliente=' || p_client::text else '/app/mensagens' end
    );
  elsif not exists (
    select 1 from public.leap_chat_messages m
    where m.id = p_id and m.client_id = p_client and m.staff_id = p_staff
      and m.sender_id = p_sender and m.body = p_body and m.booking_id is not distinct from p_booking
  ) then
    raise exception 'Invalid message identifier';
  end if;
end;
$$;

create function public.leap_chat_inbox(p_staff uuid)
returns table (client_id uuid, full_name text, unread bigint, last_message timestamptz)
language sql stable security invoker set search_path = '' as $$
  select m.client_id, p.full_name, count(*) filter (where m.sender_id = m.client_id and m.read_at is null), max(m.created_at)
  from public.leap_chat_messages m
  join public.profiles p on p.id = m.client_id
  where m.staff_id = p_staff
  group by m.client_id, p.full_name
  order by max(m.created_at) desc;
$$;

revoke all on function public.leap_send_chat_message(uuid,uuid,uuid,uuid,text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.leap_chat_inbox(uuid) from public, anon, authenticated;
grant execute on function public.leap_send_chat_message(uuid,uuid,uuid,uuid,text,uuid,timestamptz) to service_role;
grant execute on function public.leap_chat_inbox(uuid) to service_role;
