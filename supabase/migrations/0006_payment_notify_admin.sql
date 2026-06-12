-- ════════════════════════════════════════════════════════════════
-- Notifica trainer sempre que uma purchase é criada em estado
-- awaiting_confirmation ou pending_payment.
-- ════════════════════════════════════════════════════════════════

create or replace function notify_admin_on_purchase()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_trainer_profile uuid;
  v_client_name text;
  v_pack_name text;
begin
  if new.status not in ('awaiting_confirmation', 'pending_payment') then
    return new;
  end if;

  select profile_id into v_trainer_profile from trainers where id = new.trainer_id;
  if v_trainer_profile is null then
    return new;
  end if;

  select full_name into v_client_name from profiles where id = new.client_id;
  v_pack_name := coalesce(new.pack_snapshot->>'name', 'pack');

  insert into notifications (user_id, type, title, body, link)
  values (
    v_trainer_profile,
    'payment_pending',
    'Pagamento pendente',
    coalesce(v_client_name, 'Cliente') || ' iniciou compra: ' || v_pack_name ||
      case when new.status = 'awaiting_confirmation'
           then ' (a confirmar manualmente).'
           else ' (a aguardar pagamento gateway).' end,
    '/admin/pagamentos'
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_admin_on_purchase on purchases;
create trigger trg_notify_admin_on_purchase
  after insert on purchases
  for each row execute procedure notify_admin_on_purchase();
