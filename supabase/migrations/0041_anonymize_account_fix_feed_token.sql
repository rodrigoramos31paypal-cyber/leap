-- ════════════════════════════════════════════════════════════════
-- 0041_anonymize_account_fix_feed_token
--
-- Fix: anonymize_my_account() punha calendar_feed_token = null, mas a
-- coluna é NOT NULL (0030) → a RPC rebentava com violação de constraint
-- e a conta não era apagada. Em vez de null, ROTAMOS o token para um novo
-- UUID — invalida o feed iCal antigo (objetivo de privacidade) e respeita
-- o NOT NULL + unique.
--
-- REVERT: reaplicar 0040.
-- ════════════════════════════════════════════════════════════════
create or replace function anonymize_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from session_notes where author_id = uid;
  delete from notifications where user_id = uid;
  delete from calendar_integrations where user_id = uid;
  delete from push_subscriptions where user_id = uid;
  delete from notification_preferences where user_id = uid;
  delete from engagement_alerts where user_id = uid;
  delete from booking_reminders where recipient_id = uid;

  update profiles
    set full_name = 'Cliente removido',
        email = 'apagado+' || uid::text || '@removido.invalid',
        phone = null,
        calendar_feed_token = gen_random_uuid()
  where id = uid;
end;
$$;

grant execute on function anonymize_my_account() to authenticated;
