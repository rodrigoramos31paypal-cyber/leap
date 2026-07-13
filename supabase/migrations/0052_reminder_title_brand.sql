-- ════════════════════════════════════════════════════════════════
-- Rebrand do título do lembrete in-app: "Lembrete de sessão" → "Leap Fitness Studio".
-- O corpo da notificação mantém-se igual.
-- ════════════════════════════════════════════════════════════════
create or replace function claim_due_session_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rec record;
  n int := 0;
begin
  if uid is null then
    return 0;
  end if;

  if exists (
    select 1 from notification_preferences p
    where p.user_id = uid and p.kind = 'session_reminder' and p.enabled = false
  ) then
    return 0;
  end if;

  for rec in
    select b.id, b.starts_at
    from bookings b
    where b.client_id = uid
      and b.status in ('booked', 'confirmed')
      and b.starts_at > now()
      and b.starts_at <= now() + interval '24 hours'
      and not exists (
        select 1 from booking_reminders r
        where r.booking_id = b.id
          and r.recipient_id = uid
          and r.channel = 'in_app'
      )
  loop
    insert into booking_reminders (booking_id, recipient_id, channel)
    values (rec.id, uid, 'in_app')
    on conflict (booking_id, recipient_id, channel) do nothing;

    if found then
      insert into notifications (user_id, type, title, body, link)
      values (
        uid,
        'session_reminder',
        'Leap Fitness Studio',
        'Tens uma sessão dia '
          || to_char(rec.starts_at at time zone 'Europe/Lisbon', 'DD/MM')
          || ' às '
          || to_char(rec.starts_at at time zone 'Europe/Lisbon', 'HH24:MI')
          || '.',
        '/app/agenda'
      );
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;
