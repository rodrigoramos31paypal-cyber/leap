begin;
create temp table profiles as select * from public.profiles where false;
create temp table trainers as select * from public.trainers where false;
create temp table purchases as select * from public.purchases where false;
create temp table bookings as select * from public.bookings where false;
create temp table notifications as select * from public.notifications where false;
create temp table notification_preferences as select * from public.notification_preferences where false;
create temp table leap_chat_messages (like public.leap_chat_messages including defaults including indexes);
create temp table leap_prospect_preferences (like public.leap_prospect_preferences including defaults including indexes);
create temp table leap_prospect_emails (like public.leap_prospect_emails including defaults including indexes);
do $$ declare signature text; begin
 foreach signature in array array['public.leap_prospect_list(uuid)','public.leap_send_chat_message(uuid,uuid,uuid,uuid,text,uuid,timestamptz)','public.leap_prospect_send(uuid,uuid,uuid,uuid,text)','public.leap_prospect_prepare_deletion(uuid,uuid,uuid)','public.leap_prospect_claim_emails(uuid,integer)','public.leap_prospect_finish_email(uuid,uuid,boolean)'] loop
  execute replace(pg_get_functiondef(signature::regprocedure),'public.','pg_temp.');
 end loop;
end $$;
insert into pg_temp.profiles(id,role,full_name,email,approval_status,created_at,trainer_id) values
 ('20000000-0000-4000-8000-000000000001','owner','Owner','owner@example.invalid','approved',now(),null),
 ('20000000-0000-4000-8000-000000000002','trainer','Trainer','trainer@example.invalid','approved',now(),null),
 ('20000000-0000-4000-8000-000000000003','client','Fixture','fixture@example.invalid','pending',now(),'20000000-0000-4000-8000-000000000010');
insert into pg_temp.trainers(id,profile_id,active) values ('20000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000002',true);
do $$ declare
 owner_id uuid := '20000000-0000-4000-8000-000000000001';
 trainer_id uuid := '20000000-0000-4000-8000-000000000002';
 client_id uuid := '20000000-0000-4000-8000-000000000003';
 message_id uuid := '20000000-0000-4000-8000-000000000020';
 deletion_id uuid := '20000000-0000-4000-8000-000000000030';
 token uuid; item record;
begin
 assert (select count(*) from pg_temp.leap_prospect_list(owner_id))=1,'abandoned unverified registration absent';
 assert pg_temp.leap_prospect_send(client_id,client_id,client_id,message_id,'Hello')='unavailable','client forged invitation';
 assert pg_temp.leap_prospect_send(owner_id,client_id,trainer_id,message_id,'Hello')='unavailable','forged sender';
 assert pg_temp.leap_prospect_send(owner_id,client_id,owner_id,message_id,'Hello')='ok','invitation failed';
 assert (select count(*) from pg_temp.leap_chat_messages)=1,'message missing';
 assert (select count(*) from pg_temp.leap_prospect_emails)=1,'email missing';
 assert pg_temp.leap_prospect_send(owner_id,client_id,owner_id,message_id,'Hello')='ok','same request retry failed';
 assert (select count(*) from pg_temp.leap_chat_messages)=1,'duplicate message';
 assert (select count(*) from pg_temp.leap_prospect_emails)=1,'duplicate email';
 select * into item from pg_temp.leap_prospect_claim_emails(message_id,1); token:=item.lease_token;
 assert token is not null,'missing delivery lease';
 assert (select count(*) from pg_temp.leap_prospect_claim_emails(message_id,1))=0,'concurrent delivery';
 perform pg_temp.leap_prospect_finish_email(message_id,gen_random_uuid(),true);
 assert (select status from pg_temp.leap_prospect_emails where id=message_id)='sending','forged lease accepted';
 perform pg_temp.leap_prospect_finish_email(message_id,token,false);
 assert (select status from pg_temp.leap_prospect_emails where id=message_id)='pending','failure not retried';
 update pg_temp.leap_prospect_emails set next_attempt_at=now() where id=message_id;
 select * into item from pg_temp.leap_prospect_claim_emails(message_id,1);
 perform pg_temp.leap_prospect_finish_email(message_id,item.lease_token,true);
 assert (select status from pg_temp.leap_prospect_emails where id=message_id)='sent','success missing';
 assert (select recipient is null and body is null and href is null from pg_temp.leap_prospect_emails where id=message_id),'PII retained after delivery';
 insert into pg_temp.notification_preferences(user_id,kind,email_enabled) values(client_id,'sessions',false);
 assert pg_temp.leap_prospect_send(owner_id,client_id,owner_id,'20000000-0000-4000-8000-000000000021','Second')='email_disabled','email opt-out ignored';
 assert (select count(*) from pg_temp.leap_chat_messages)=2,'opt-out blocked chat';
 assert (select count(*) from pg_temp.leap_prospect_emails)=1,'opt-out queued email';
 assert pg_temp.leap_prospect_prepare_deletion(trainer_id,client_id,deletion_id) is null,'trainer deleted account';
 insert into pg_temp.bookings(id,client_id,status,starts_at,ends_at) values('20000000-0000-4000-8000-000000000040',client_id,'confirmed',now()+interval '1 day',now()+interval '2 days');
 assert pg_temp.leap_prospect_prepare_deletion(owner_id,client_id,deletion_id) is null,'scheduled session lost';
 delete from pg_temp.bookings;
 assert pg_temp.leap_prospect_prepare_deletion(owner_id,client_id,deletion_id)=deletion_id,'owner deletion preparation failed';
 assert (select count(*) from pg_temp.leap_prospect_claim_emails(deletion_id,1))=0,'notice sent before actual deletion';
 update pg_temp.profiles set email='deleted@removido.invalid',access_blocked=true where id=client_id;
 select * into item from pg_temp.leap_prospect_claim_emails(deletion_id,1);
 assert item.kind='account_removed' and item.recipient='fixture@example.invalid','deletion recipient lost after anonymization';
 perform pg_temp.leap_prospect_finish_email(deletion_id,item.lease_token,true);
 assert (select recipient is null from pg_temp.leap_prospect_emails where id=deletion_id),'deletion email retained';
 -- Expiry clears private payloads without sending, including abandoned held requests.
 insert into pg_temp.leap_prospect_emails(id,client_id,actor_id,kind,status,recipient,body,retry_until)
 values('20000000-0000-4000-8000-000000000050',client_id,owner_id,'invitation','pending','private@example.invalid','Private',now()-interval '1 hour');
 perform pg_temp.leap_prospect_claim_emails(null,0);
 assert (select recipient is null and body is null from pg_temp.leap_prospect_emails where id='20000000-0000-4000-8000-000000000050'),'expired payload retained';
end $$;
select 'all queue, idempotency, permissions, preferences and deletion ordering assertions passed' as result;
rollback;
