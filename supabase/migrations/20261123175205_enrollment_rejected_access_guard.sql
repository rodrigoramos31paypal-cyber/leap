create or replace function public.leap_decline_enrollment(p_client uuid,p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.profiles actor where actor.id=p_actor
   and actor.access_blocked is not true and (actor.role='owner' or (actor.role='trainer' and exists(
     select 1 from public.profiles c join public.trainers t on t.id=c.trainer_id
     where c.id=p_client and t.profile_id=p_actor and t.active)))) then
   raise exception 'Sem permissão.' using errcode='42501';
 end if;
 update public.profiles set approval_status='rejected',access_blocked=true,approval_decided_at=now(),approval_decided_by=p_actor
 where id=p_client and role='client' and approval_status='pending' and access_blocked is not true;
 if not found then raise exception 'Pedido já decidido.'; end if;
end; $$;
