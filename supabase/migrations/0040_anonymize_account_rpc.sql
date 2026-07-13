-- ════════════════════════════════════════════════════════════════
-- 0040_anonymize_account_rpc
--
-- RGPD · apagar conta de forma FIÁVEL. Corre como SECURITY DEFINER
-- (bypassa RLS) e está limitada a auth.uid(), por isso não depende da
-- service-role key estar disponível no runtime serverless — que era a
-- causa do delete "silencioso" (escritas a falhar sem erro visível).
--
-- Apaga dados pessoais sem obrigação de retenção e anonimiza o perfil.
-- Marcações/compras ficam anonimizadas ("Cliente removido") para cumprir
-- a retenção contabilística. O bloqueio de login (auth) é feito na server
-- action via admin API (a única parte que exige service role).
--
-- REVERT: drop function if exists anonymize_my_account();
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
        calendar_feed_token = null
  where id = uid;
end;
$$;

grant execute on function anonymize_my_account() to authenticated;
