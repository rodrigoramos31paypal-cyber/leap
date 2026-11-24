create function public.leap_annual_discount_eligible(p_client uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=p_client and p.role='client'
  and p.approval_status='approved' and not coalesce(p.access_blocked,false) and not coalesce(p.banned,false)
  and coalesce(p.email,'') not ilike '%@removido.invalid'
  and exists(select 1 from public.purchases pu where pu.status='confirmed' and pu.amount_cents>0
    and pu.payment_method<>'complimentary' and (pu.client_id=p.id or exists(
      select 1 from public.bookings b where (b.partner_client_id=p.id and b.partner_purchase_id=pu.id)
       or (b.partner2_client_id=p.id and b.partner2_purchase_id=pu.id)))));
$$;
revoke all on function public.leap_annual_discount_eligible(uuid) from public,anon,authenticated;
grant execute on function public.leap_annual_discount_eligible(uuid) to service_role;
create table public.leap_annual_discount_tokens (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 client_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours'
);
alter table public.leap_annual_discount_tokens enable row level security;
revoke all on public.leap_annual_discount_tokens from public,anon,authenticated;
grant select,insert,delete on public.leap_annual_discount_tokens to service_role;
create index leap_annual_discount_tokens_expiry on public.leap_annual_discount_tokens(expires_at);
