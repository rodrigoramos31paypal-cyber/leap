CREATE OR REPLACE FUNCTION public.leap_send_chat_message(p_id uuid, p_client uuid, p_staff uuid, p_sender uuid, p_body text, p_booking uuid, p_booking_starts timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_staff = 'a444e83b-e56a-4d5f-95d0-ea0976f01a89'::uuid then
    p_staff := 'c4a7bb71-540e-4d41-ad53-c49f7085602b'::uuid;
    if p_sender = 'a444e83b-e56a-4d5f-95d0-ea0976f01a89'::uuid then
      p_sender := p_staff;
    end if;
  end if;

  insert into public.leap_chat_messages (id, client_id, staff_id, sender_id, body, booking_id, booking_starts_at)
  values (p_id, p_client, p_staff, p_sender, p_body, p_booking, p_booking_starts)
  on conflict (id) do nothing;
  if found then
    insert into public.notifications (id, user_id, type, title, body, link)
    values (
      p_id,
      case when p_sender = p_client then p_staff else p_client end,
      'chat_message',
      coalesce((select case when p_sender <> p_client and lower(btrim(full_name)) = 'admin'
        then 'PT - João Pedro' else nullif(btrim(full_name), '') end
        from public.profiles where id = p_sender), 'Nova mensagem LEAP'),
      'Tens uma nova mensagem na app.',
      case when p_sender = p_client then '/admin/mensagens?cliente=' || p_client::text else '/app/mensagens?equipa=' || p_staff::text end
    );
  elsif not exists (
    select 1 from public.leap_chat_messages m
    where m.id = p_id and m.client_id = p_client and m.staff_id = p_staff
      and m.sender_id = p_sender and m.body = p_body and m.booking_id is not distinct from p_booking
  ) then
    raise exception 'Invalid message identifier';
  end if;
end;
$function$
;

with moved as (
  update public.leap_chat_messages
  set staff_id = 'c4a7bb71-540e-4d41-ad53-c49f7085602b',
      sender_id = case when sender_id = 'a444e83b-e56a-4d5f-95d0-ea0976f01a89' then 'c4a7bb71-540e-4d41-ad53-c49f7085602b'::uuid else sender_id end
  where staff_id = 'a444e83b-e56a-4d5f-95d0-ea0976f01a89'
  returning id
)
update public.notifications n
set user_id = case when n.user_id = 'a444e83b-e56a-4d5f-95d0-ea0976f01a89' then 'c4a7bb71-540e-4d41-ad53-c49f7085602b'::uuid else n.user_id end,
    link = replace(n.link, 'a444e83b-e56a-4d5f-95d0-ea0976f01a89', 'c4a7bb71-540e-4d41-ad53-c49f7085602b')
from moved where n.id = moved.id and n.type = 'chat_message';
