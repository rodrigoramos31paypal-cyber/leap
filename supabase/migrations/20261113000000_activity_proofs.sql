create table public.activity_proofs (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  jpeg text not null check (octet_length(jpeg) between 4 and 700000)
);
alter table public.activity_proofs enable row level security;
revoke all on public.activity_proofs from public, anon, authenticated;
grant select, insert, delete on public.activity_proofs to service_role;

create function public.log_activity_with_proof(p_client uuid, p_type text, p_jpeg text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.profiles where id = p_client and role = 'client'
      and approval_status = 'approved' and access_blocked is not true
  ) then
    raise exception 'Acesso restrito.' using errcode = '42501';
  end if;

  perform set_config('request.jwt.claim.sub', p_client::text, true);
  v_id := public.log_activity(p_type);
  insert into public.activity_proofs (activity_id, jpeg) values (v_id, p_jpeg);
  return v_id;
end;
$$;
revoke all on function public.log_activity_with_proof(uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_activity_with_proof(uuid, text, text) to service_role;

create function public.remove_decided_activity_proof()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.activity_proofs where activity_id = new.id;
  return new;
end;
$$;
revoke all on function public.remove_decided_activity_proof() from public, anon, authenticated;

create trigger remove_decided_activity_proof
after update of status on public.activities
for each row when (new.status in ('validated', 'rejected'))
execute function public.remove_decided_activity_proof();
