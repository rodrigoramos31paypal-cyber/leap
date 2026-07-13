-- ════════════════════════════════════════════════════════════════
-- 0104 · Corrige notificações DUPLICADAS de "Nova marcação"
--
-- Bug introduzido pela 0103: o trigger fanout_staff_notifications
-- espalhava também o tipo 'booking_created_admin' a toda a equipa. Mas
-- a função create_booking (e create_recurring_booking) JÁ tinha, desde
-- a 0025, um bloco próprio que notifica todos os owners ("Também
-- notifica todos os owners…"). Resultado: cada nova marcação gerava
-- DUAS notificações por conta de staff (a original + a cópia do
-- trigger) → o owner via a marcação duplicada (e, com mais do que uma
-- subscrição de push no mesmo device, ainda mais).
--
-- Fix: tira 'booking_created_admin' da lista do trigger. Esse tipo já é
-- espalhado pela própria create_booking — o trigger não deve duplicá-lo.
-- Os restantes tipos MANTÊM-SE no trigger porque NÃO são espalhados na
-- origem (só notificam o trainer da sessão):
--   • booking_cancelled_admin (cancel_booking → só o trainer)
--   • client_note            (server actions → só o trainer)
--   • session_reminder       (cron → só o trainer)
-- ('payment_pending' continua de fora — é espalhado pela 0102.)
--
-- REVERT: reaplicar 0103_fanout_staff_notifications.sql.
-- ════════════════════════════════════════════════════════════════

create or replace function fanout_staff_notifications()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- Só o INSERT original. As cópias abaixo voltam a disparar este
  -- trigger a profundidade 2 → saímos para não entrar em recursão.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  -- Só tipos destinados à equipa que NÃO são já espalhados na origem.
  -- NB: 'booking_created_admin' foi removido — create_booking já o
  -- espalha a todos os owners (ver 0104).
  if new.type not in (
    'booking_cancelled_admin',
    'client_note',
    'session_reminder'
  ) then
    return new;
  end if;

  -- Só se o destinatário original é staff. Protege o session_reminder,
  -- que também é enviado ao CLIENTE (esse não deve ser espalhado).
  if not exists (
    select 1 from profiles
    where id = new.user_id and role in ('owner', 'trainer')
  ) then
    return new;
  end if;

  -- Cópia para todos os OUTROS membros da equipa (owner + trainer).
  insert into notifications (user_id, type, title, body, link)
  select p.id, new.type, new.title, new.body, new.link
  from profiles p
  where p.role in ('owner', 'trainer')
    and p.id <> new.user_id;

  return new;
end;
$$;

-- O trigger em si não muda (continua a apontar para esta função), mas
-- recriamo-lo de forma idempotente para garantir o estado correcto.
drop trigger if exists trg_fanout_staff_notifications on notifications;
create trigger trg_fanout_staff_notifications
  after insert on notifications
  for each row execute procedure fanout_staff_notifications();
