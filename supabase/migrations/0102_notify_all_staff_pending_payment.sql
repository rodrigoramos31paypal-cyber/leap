-- ════════════════════════════════════════════════════════════════
-- 0102 · "Pagamento pendente" para TODA a equipa (owner + trainers)
--
-- Até aqui (0006/0091), a notificação de compra a aguardar confirmação
-- ia SÓ para o trainer dono da purchase (purchases.trainer_id →
-- trainers.profile_id). Um "Admin" (role 'owner' sem trainer próprio,
-- ex. leaptreinos@gmail.com) NÃO recebia nada — apesar de ter acesso
-- total e partilhar o calendário do estúdio.
--
-- Agora: insere UMA notificação por cada conta de staff (role 'owner'
-- ou 'trainer'). Cada INSERT dispara o webhook de push → cada admin/
-- trainer recebe o sininho + push. (O email é tratado à parte em
-- lib/email-dispatch.ts → dispatchPurchasePending, também alargado a
-- toda a equipa.)
--
-- Mantém-se o skip de 0091: se quem cria a purchase é staff
-- (_is_service_or_admin() = true), é uma atribuição manual que se
-- confirma logo a seguir — não há nada "pendente" para sinalizar.
--
-- REVERT: reaplicar 0091_no_pending_notif_on_staff_grant.sql.
-- ════════════════════════════════════════════════════════════════

create or replace function notify_admin_on_purchase()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_client_name text;
  v_pack_name text;
  v_body text;
begin
  if new.status not in ('awaiting_confirmation', 'pending_payment') then
    return new;
  end if;

  -- 0091: staff a atribuir o pack ele próprio → confirma logo, sem
  -- "pendente" para avisar.
  if _is_service_or_admin() then
    return new;
  end if;

  select full_name into v_client_name from profiles where id = new.client_id;
  v_pack_name := coalesce(new.pack_snapshot->>'name', 'pack');
  v_body := coalesce(v_client_name, 'Cliente') || ' iniciou compra: ' || v_pack_name ||
    case when new.status = 'awaiting_confirmation'
         then ' (a confirmar manualmente).'
         else ' (a aguardar pagamento gateway).' end;

  -- Fan-out: uma notificação por conta de staff (owner + trainer).
  insert into notifications (user_id, type, title, body, link)
  select p.id, 'payment_pending', 'Pagamento pendente', v_body, '/admin/pagamentos'
  from profiles p
  where p.role in ('owner', 'trainer');

  return new;
end;
$$;

drop trigger if exists trg_notify_admin_on_purchase on purchases;
create trigger trg_notify_admin_on_purchase
  after insert on purchases
  for each row execute procedure notify_admin_on_purchase();
