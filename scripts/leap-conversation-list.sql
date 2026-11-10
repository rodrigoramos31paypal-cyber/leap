create function public.leap_conversation_list(p_account uuid,p_is_staff boolean)
returns table (id uuid, full_name text, unread bigint, last_message timestamptz, preview text, mine boolean)
language sql stable set search_path = '' as $$
  with messages as (
    select m.*, case when p_is_staff then m.client_id else m.staff_id end as contact
    from public.leap_chat_messages m
    where (p_is_staff and m.staff_id=p_account) or (not p_is_staff and m.client_id=p_account)
  ), ranked as (
    select m.*, count(*) filter (where sender_id<>p_account and read_at is null) over(partition by contact) as unread_count,
      row_number() over(partition by contact order by created_at desc,id desc) as position
    from messages m
  )
  select r.contact,p.full_name,r.unread_count,r.created_at,
    case when r.rescheduled_from is not null then 'Sessão reagendada'
         when r.kind='cancellation' then 'Cancelamento de treino'
         else left(r.body,160) end,
    r.sender_id=p_account
  from ranked r join public.profiles p on p.id=r.contact
  where r.position=1 and (p_is_staff or (p.role in ('owner','trainer') and p.access_blocked is not true))
  order by r.created_at desc,r.id desc
$$;
revoke execute on function public.leap_conversation_list(uuid,boolean) from public,anon,authenticated;
grant execute on function public.leap_conversation_list(uuid,boolean) to service_role;
