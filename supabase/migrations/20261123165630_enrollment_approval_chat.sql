-- Prepared for review. Apply only with the approved release.
create table public.leap_enrollment_requests (
 client_id uuid primary key references public.profiles(id) on delete cascade,
 interest text not null check (interest in ('Treino individual','Treino em dupla','Ainda estou a explorar')),
 goal text not null check (goal in ('Ganhar músculo','Perder gordura','Melhorar a condição física','Outro')),
 availability text not null check (char_length(btrim(availability)) between 3 and 300),
 submitted_at timestamptz not null default now()
);
alter table public.leap_enrollment_requests enable row level security;
revoke all on public.leap_enrollment_requests from public, anon, authenticated;
grant select, insert, update on public.leap_enrollment_requests to service_role;

create function public.leap_save_enrollment(p_client uuid,p_interest text,p_goal text,p_availability text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.profiles where id=p_client and role='client'
   and approval_status='pending' and access_blocked is not true for update;
 if not found then raise exception 'Pedido indisponível.' using errcode='42501'; end if;
 insert into public.leap_enrollment_requests(client_id,interest,goal,availability)
 values(p_client,p_interest,p_goal,btrim(p_availability))
 on conflict(client_id) do update set interest=excluded.interest,goal=excluded.goal,
 availability=excluded.availability,submitted_at=now();
end; $$;
revoke all on function public.leap_save_enrollment(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.leap_save_enrollment(uuid,text,text,text) to service_role;

create function public.leap_decline_enrollment(p_client uuid,p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.profiles actor where actor.id=p_actor
   and actor.access_blocked is not true and (actor.role='owner' or (actor.role='trainer' and exists(
     select 1 from public.profiles c join public.trainers t on t.id=c.trainer_id
     where c.id=p_client and t.profile_id=p_actor and t.active)))) then
   raise exception 'Sem permissão.' using errcode='42501';
 end if;
 update public.profiles set approval_status='rejected',approval_decided_at=now(),approval_decided_by=p_actor
 where id=p_client and role='client' and approval_status='pending' and access_blocked is not true;
 if not found then raise exception 'Pedido já decidido.'; end if;
end; $$;
revoke all on function public.leap_decline_enrollment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.leap_decline_enrollment(uuid,uuid) to service_role;
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
      case when p_sender = p_client then '/admin/mensagens?cliente=' || p_client::text else case when exists(select 1 from public.profiles where id=p_client and approval_status='pending') then '/aprovacao-pendente?chat=1' else '/app/mensagens?equipa=' || p_staff::text end end
    );
  elsif not exists (
    select 1 from public.leap_chat_messages m
    where m.id = p_id and m.client_id = p_client and m.staff_id = p_staff
      and m.sender_id = p_sender and m.body = p_body and m.booking_id is not distinct from p_booking
  ) then
    raise exception 'Invalid message identifier';
  end if;
end;
$function$;
