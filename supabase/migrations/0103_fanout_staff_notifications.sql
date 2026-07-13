-- ════════════════════════════════════════════════════════════════
-- 0103 · Espalha as notificações de STAFF a toda a equipa
--
-- Problema: as notificações trainer/admin (nova marcação, cancelamento,
-- nota de cliente, lembrete do dia) eram inseridas só para o perfil do
-- trainer dono da sessão. Um "Admin" (owner sem trainer próprio, ex.
-- leaptreinos@gmail.com) — que partilha o calendário do estúdio e tem
-- acesso total — não recebia NADA.
--
-- Solução: um trigger genérico em `notifications` que, quando uma
-- notificação de tipo STAFF é inserida para um membro da equipa, cria
-- uma cópia para TODOS os outros membros (owner + trainer). Assim o
-- sininho + push chegam a toda a gente, sem ter de mexer em cada uma
-- das funções/ações/crons que geram estas notificações.
--
-- Tipos cobertos: booking_created_admin, booking_cancelled_admin,
-- client_note, session_reminder (só quando o destinatário é staff — o
-- mesmo tipo serve o lembrete do CLIENTE, esse não é espalhado).
--
-- 'payment_pending' fica DE FORA: já é inserido para toda a equipa pela
-- 0102 (notify_admin_on_purchase). Inseri-lo aqui duplicaria. Além
-- disso, essa notificação nasce DENTRO do trigger de `purchases`
-- (profundidade 2), onde a salvaguarda pg_trigger_depth() abaixo a
-- ignoraria — mais uma razão para a manter na 0102.
--
-- Recursão: as cópias que este trigger insere correm a pg_trigger_depth()
-- = 2 e são ignoradas (só agimos na profundidade 1, o INSERT original).
-- Todos os tipos cobertos nascem fora de triggers (RPCs, server actions,
-- cron), portanto a profundidade 1 apanha-os corretamente.
--
-- REVERT: drop trigger trg_fanout_staff_notifications on notifications;
--         drop function fanout_staff_notifications();
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

  -- Só tipos destinados à equipa.
  if new.type not in (
    'booking_created_admin',
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

drop trigger if exists trg_fanout_staff_notifications on notifications;
create trigger trg_fanout_staff_notifications
  after insert on notifications
  for each row execute procedure fanout_staff_notifications();
