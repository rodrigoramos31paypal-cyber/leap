-- ════════════════════════════════════════════════════════════════
-- 0087 · Anonimização completa de conta + same-email reset
--
-- Estende `anonymize_my_account()` e `anonymize_client_account(uuid)`
-- (de 0041 e 0081) para apagar TODAS as tabelas user-bound que ainda
-- ficavam para trás. Mantém propositadamente bookings/purchases/
-- payments/credit_transactions anonimizados para retenção contabilística
-- (~10 anos em PT) — eles ficam agarrados ao UUID antigo e são
-- COMPLETAMENTE invisíveis a um eventual novo registo com o mesmo email
-- (Supabase cria sempre um novo UUID; `profiles.email` não tem unique).
--
-- Tabelas adicionadas ao wipe:
--   • session_ratings           — comment pode ser PII; sem ele a view
--                                  pública `trainer_recent_reviews` deixa
--                                  de mostrar "Cliente removido" como autor.
--   • trusted_devices           — IP + user agent + token hash (PII).
--   • weekly_streak_alerts      — dedup interno do cron.
--   • rating_prompts            — dedup do cron, para bookings deste user.
--   • booking_calendar_events   — órfãos (calendar_integrations já caiu).
--   • booking_series.status     — séries ativas passam a 'cancelled' para
--                                  desaparecerem da view `reserved_slots_active`
--                                  (slots reservados visíveis na agenda).
--
-- Backfill no fim: aplica o mesmo wipe retroactivamente a contas que JÁ
-- estão anonimizadas (`profiles.email like '%@removido.invalid'`) para
-- limpar lixo deixado pelas versões anteriores das RPCs.
--
-- REVERT: reaplicar 0041 e 0081.
-- ════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────
-- 1) anonymize_my_account · self-service (cliente apaga a si próprio)
-- ────────────────────────────────────────────────────────────────
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

  -- Notas e preferências (autor = user).
  delete from session_notes where author_id = uid;
  -- Notas gerais sobre este user (subject = user) — RGPD: o trainer pode
  -- ter escrito notas privadas sobre o cliente; ao apagar a conta o
  -- cliente perde o direito a essas referências ficarem na BD.
  delete from session_notes where subject_id = uid;
  delete from notifications where user_id = uid;
  delete from calendar_integrations where user_id = uid;
  delete from push_subscriptions where user_id = uid;
  delete from notification_preferences where user_id = uid;
  delete from engagement_alerts where user_id = uid;
  delete from booking_reminders where recipient_id = uid;

  -- Novo (0087): mais tabelas user-bound.
  delete from session_ratings where client_id = uid;
  delete from trusted_devices where user_id = uid;
  delete from weekly_streak_alerts where user_id = uid;
  delete from rating_prompts where booking_id in (
    select id from bookings where client_id = uid
  );
  -- Órfãos: a integração de calendário já foi apagada, os events ficam
  -- pendurados sem ninguém a sincronizar. Removidos para evitar lixo.
  delete from booking_calendar_events where booking_id in (
    select id from bookings where client_id = uid
  );

  -- Séries recorrentes activas → cancelled. Sem isto a view
  -- `reserved_slots_active` continuava a sinalizar "Reservado ·
  -- Cliente removido" na agenda do trainer até o slot passar.
  update booking_series
    set status = 'cancelled'
    where client_id = uid
      and status = 'active';

  -- Anonimiza o profile. O auth.users e o profile ficam taggados como
  -- "apagado+{uid}@removido.invalid" — liberta o email original para
  -- ser re-registado por outra pessoa (ou pelo mesmo utilizador como
  -- conta totalmente nova, com UUID diferente).
  update profiles
    set full_name = 'Cliente removido',
        email = 'apagado+' || uid::text || '@removido.invalid',
        phone = null,
        calendar_feed_token = gen_random_uuid()
  where id = uid;
end;
$$;

grant execute on function anonymize_my_account() to authenticated;


-- ────────────────────────────────────────────────────────────────
-- 2) anonymize_client_account · admin apaga cliente (de 0081)
-- ────────────────────────────────────────────────────────────────
create or replace function anonymize_client_account(
  p_client_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role user_role;
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select role into v_target_role from profiles where id = p_client_id;
  if v_target_role is null then
    raise exception 'Cliente não encontrado';
  end if;
  if v_target_role <> 'client' then
    raise exception 'Só contas de cliente podem ser apagadas por aqui';
  end if;

  delete from session_notes where author_id = p_client_id;
  delete from session_notes where subject_id = p_client_id;
  delete from notifications where user_id = p_client_id;
  delete from calendar_integrations where user_id = p_client_id;
  delete from push_subscriptions where user_id = p_client_id;
  delete from notification_preferences where user_id = p_client_id;
  delete from engagement_alerts where user_id = p_client_id;
  delete from booking_reminders where recipient_id = p_client_id;

  -- Novo (0087).
  delete from session_ratings where client_id = p_client_id;
  delete from trusted_devices where user_id = p_client_id;
  delete from weekly_streak_alerts where user_id = p_client_id;
  delete from rating_prompts where booking_id in (
    select id from bookings where client_id = p_client_id
  );
  delete from booking_calendar_events where booking_id in (
    select id from bookings where client_id = p_client_id
  );

  update booking_series
    set status = 'cancelled'
    where client_id = p_client_id
      and status = 'active';

  update profiles
    set full_name = 'Cliente removido',
        email = 'apagado+' || p_client_id::text || '@removido.invalid',
        phone = null,
        calendar_feed_token = gen_random_uuid()
  where id = p_client_id;
end;
$$;

revoke all on function anonymize_client_account(uuid) from public, anon;
grant execute on function anonymize_client_account(uuid) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────
-- 3) Backfill · limpa lixo deixado por versões anteriores das RPCs
--
-- Aplica o mesmo wipe a TODAS as contas já anonimizadas. Idempotente:
-- correr de novo é no-op se as tabelas já estão limpas.
-- ────────────────────────────────────────────────────────────────
do $$
declare
  v_ids uuid[];
begin
  select array_agg(id)
    into v_ids
  from profiles
  where coalesce(email, '') like '%@removido.invalid';

  if v_ids is null or array_length(v_ids, 1) is null then
    return;
  end if;

  -- Repetimos os deletes que faltavam nas versões anteriores. Os que
  -- já corriam (notifications, push_subs, etc.) não precisam — mas
  -- inclui-los seria idempotente, por isso fazemo-lo na mesma para
  -- garantir total consistência caso alguma RPC antiga tenha falhado
  -- parcialmente.
  delete from session_notes where author_id = any(v_ids);
  delete from session_notes where subject_id = any(v_ids);
  delete from notifications where user_id = any(v_ids);
  delete from calendar_integrations where user_id = any(v_ids);
  delete from push_subscriptions where user_id = any(v_ids);
  delete from notification_preferences where user_id = any(v_ids);
  delete from engagement_alerts where user_id = any(v_ids);
  delete from booking_reminders where recipient_id = any(v_ids);

  delete from session_ratings where client_id = any(v_ids);
  delete from trusted_devices where user_id = any(v_ids);
  delete from weekly_streak_alerts where user_id = any(v_ids);
  delete from rating_prompts where booking_id in (
    select id from bookings where client_id = any(v_ids)
  );
  delete from booking_calendar_events where booking_id in (
    select id from bookings where client_id = any(v_ids)
  );

  update booking_series
    set status = 'cancelled'
    where client_id = any(v_ids)
      and status = 'active';
end $$;
