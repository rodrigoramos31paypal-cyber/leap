-- Synthetic eligibility tests: pg_temp only; no real profiles or purchases are altered.
begin;
create temp table profiles as select * from public.profiles where false;
create temp table purchases as select * from public.purchases where false;
create temp table bookings as select * from public.bookings where false;
do $$ begin execute replace(pg_get_functiondef('public.leap_annual_discount_eligible(uuid)'::regprocedure),'public.','pg_temp.'); end $$;
insert into pg_temp.profiles(id,role,approval_status,email) values
 ('20000000-0000-4000-8000-000000000001','client','approved','test@example.invalid'),
 ('20000000-0000-4000-8000-000000000002','owner','approved','owner@example.invalid');
do $$ declare client uuid:='20000000-0000-4000-8000-000000000001'; begin
 assert not pg_temp.leap_annual_discount_eligible(client),'registration alone qualified';
 insert into pg_temp.purchases(id,client_id,status,amount_cents,payment_method) values('20000000-0000-4000-8000-000000000010',client,'confirmed',0,'complimentary');
 assert not pg_temp.leap_annual_discount_eligible(client),'gift qualified';
 update pg_temp.purchases set amount_cents=5900,payment_method='manual_cash',status='pending_payment';
 assert not pg_temp.leap_annual_discount_eligible(client),'pending purchase qualified';
 update pg_temp.purchases set status='confirmed';
 assert pg_temp.leap_annual_discount_eligible(client),'paid customer missing';
 update pg_temp.profiles set access_blocked=true where id=client;
 assert not pg_temp.leap_annual_discount_eligible(client),'blocked customer qualified';
 update pg_temp.profiles set access_blocked=false,approval_status='pending' where id=client;
 assert not pg_temp.leap_annual_discount_eligible(client),'unapproved customer qualified';
 assert not pg_temp.leap_annual_discount_eligible('20000000-0000-4000-8000-000000000002'),'staff qualified';
end $$;
select 'eligibility assertions passed' as result;
rollback;
