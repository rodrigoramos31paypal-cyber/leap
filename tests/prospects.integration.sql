begin;
create temp table profiles as select * from public.profiles where false;
create temp table trainers as select * from public.trainers where false;
create temp table purchases as select * from public.purchases where false;
create temp table bookings as select * from public.bookings where false;
create temp table leap_chat_messages as select * from public.leap_chat_messages where false;
create temp table leap_prospect_preferences (like public.leap_prospect_preferences including indexes including defaults);
create temp table users(id uuid,email_confirmed_at timestamptz);
do $$ begin
 execute replace(replace(pg_get_functiondef('public.leap_prospect_list(uuid)'::regprocedure),'public.','pg_temp.'),'auth.users','pg_temp.users');
 execute replace(pg_get_functiondef('public.leap_prospect_set_preference(uuid,uuid,text)'::regprocedure),'public.','pg_temp.');
end $$;
insert into pg_temp.profiles(id,role,full_name,approval_status,created_at,trainer_id) values
 ('20000000-0000-4000-8000-000000000001','owner','Owner','approved',now(),null),
 ('20000000-0000-4000-8000-000000000002','trainer','Assigned','approved',now(),null),
 ('20000000-0000-4000-8000-000000000003','trainer','Other','approved',now(),null),
 ('20000000-0000-4000-8000-000000000004','client','Fixture','approved',now(),'20000000-0000-4000-8000-000000000010');
insert into pg_temp.trainers(id,profile_id,active) values
 ('20000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000002',true),
 ('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000003',true);
insert into pg_temp.users values ('20000000-0000-4000-8000-000000000004',now());
do $$ declare
 owner_id uuid := '20000000-0000-4000-8000-000000000001';
 trainer_id uuid := '20000000-0000-4000-8000-000000000002';
 other_id uuid := '20000000-0000-4000-8000-000000000003';
 client_id uuid := '20000000-0000-4000-8000-000000000004';
 n integer;
begin
 select count(*) into n from pg_temp.leap_prospect_list(owner_id); assert n=1,'new registrant missing';
 select count(*) into n from pg_temp.leap_prospect_list(trainer_id); assert n=1,'assigned trainer missing';
 select count(*) into n from pg_temp.leap_prospect_list(other_id); assert n=0,'cross-trainer access';
 select count(*) into n from pg_temp.leap_prospect_list(client_id); assert n=0,'client access';
 assert pg_temp.leap_prospect_set_preference(other_id,client_id,'declined')='unavailable','cross-trainer write';
 assert pg_temp.leap_prospect_set_preference(owner_id,client_id,'snoozed')='ok','snooze failed';
 assert (select disposition from pg_temp.leap_prospect_list(owner_id))='snoozed','snooze visibility';
 update pg_temp.leap_prospect_preferences set snooze_until=now()-interval '1 minute';
 assert (select disposition from pg_temp.leap_prospect_list(owner_id))='active','snooze expiry';
 assert pg_temp.leap_prospect_set_preference(owner_id,client_id,'declined')='ok','decline failed';
 assert (select disposition from pg_temp.leap_prospect_list(owner_id))='declined','decline visibility';
 assert pg_temp.leap_prospect_set_preference(owner_id,client_id,'active')='ok','restore failed';
 insert into pg_temp.bookings(id,client_id,status,starts_at,ends_at) values
 ('20000000-0000-4000-8000-000000000020',client_id,'confirmed',now()-interval '2 hours',now()-interval '1 hour');
 assert (select completed_sessions from pg_temp.leap_prospect_list(owner_id))=1,'experiment not counted';
 insert into pg_temp.purchases(id,client_id,status,payment_method,sessions_total,amount_cents) values
 ('20000000-0000-4000-8000-000000000030',client_id,'confirmed','manual_cash',1,2000);
 assert (select count(*) from pg_temp.leap_prospect_list(owner_id))=1,'single trial treated as pack';
 update pg_temp.purchases set sessions_total=8;
 assert (select count(*) from pg_temp.leap_prospect_list(owner_id))=0,'paid pack still prospect';
 update pg_temp.purchases set payment_method='complimentary';
 assert (select count(*) from pg_temp.leap_prospect_list(owner_id))=1,'gift counted as purchase';
 update pg_temp.purchases set status='pending_payment',payment_method='manual_cash';
 assert (select count(*) from pg_temp.leap_prospect_list(owner_id))=0,'pending payment chased';
 update pg_temp.purchases set status='rejected';
 insert into pg_temp.bookings(id,client_id,status,starts_at,ends_at) values
 ('20000000-0000-4000-8000-000000000021',client_id,'cancelled',now()-interval '4 hours',now()-interval '3 hours');
 assert (select completed_sessions from pg_temp.leap_prospect_list(owner_id))=1,'cancelled trial counted';
 update pg_temp.bookings set status='confirmed' where id='20000000-0000-4000-8000-000000000021';
 assert (select count(*) from pg_temp.leap_prospect_list(owner_id))=0,'returning client treated as new';
 delete from pg_temp.bookings where id='20000000-0000-4000-8000-000000000021';
 update pg_temp.profiles set approval_status='rejected' where id=client_id;
 assert (select count(*) from pg_temp.leap_prospect_list(owner_id))=0,'rejected account visible';
 update pg_temp.profiles set approval_status='approved',access_blocked=true where id=client_id;
 assert (select count(*) from pg_temp.leap_prospect_list(owner_id))=0,'blocked account visible';
 update pg_temp.profiles set access_blocked=false where id=client_id;
 update pg_temp.profiles set approval_status='pending',approval_notified_at=null where id=client_id;
 assert (select count(*) from pg_temp.leap_prospect_list(owner_id))=0,'unverified pending account visible';
 update pg_temp.profiles set approval_notified_at=now() where id=client_id;
 assert (select count(*) from pg_temp.leap_prospect_list(owner_id))=1,'verified pending account missing';
end $$;
select 'all synthetic eligibility, scope and preference assertions passed' as result;
rollback;
