-- ════════════════════════════════════════════════════════════════
-- 0091 · "Pagamento pendente" só para compras iniciadas pelo CLIENTE
--
-- Fluxo problemático:
--   • Trainer abre o perfil de um cliente → "Gerir sessões" →
--     escolhe método (manual_cash/manual_mbway/manual_revolut/complimentary)
--     → confirma. A server action `grantPackAction` cria a purchase com
--     status `awaiting_confirmation` e logo a seguir chama
--     `confirm_purchase`, deixando a compra confirmada na mesma
--     transação. NÃO há nada para confirmar à parte.
--
--   • Mas a trigger `notify_admin_on_purchase` (0006) corre no INSERT
--     da purchase com status `awaiting_confirmation` e dispara uma
--     notificação "Pagamento pendente" para o trainer — mesmo no caso
--     acima, em que é o PRÓPRIO trainer a criar a compra. Spam.
--
-- Fix:
--   Salta a notificação quando `_is_service_or_admin()` é true no
--   momento do INSERT. Isso significa que foi o trainer/owner (não o
--   cliente em auto-compra) a criar a purchase — o fluxo dele já
--   confirma logo a seguir, por isso não há "pendente" para sinalizar.
--
-- O caso normal (cliente compra um pack via /app/comprar e escolhe
-- pagamento manual, que requer confirmação do trainer) mantém-se
-- inalterado: nesse caso `_is_service_or_admin()` devolve false e a
-- notificação é enviada como antes.
--
-- REVERT: reaplicar 0006_payment_notify_admin.sql.
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

  -- 0091: o trainer/owner está a atribuir o pack ele próprio — a
  -- server action `grantPackAction` confirma a compra logo a seguir,
  -- por isso não há nada "pendente" para o trainer ser avisado.
  if _is_service_or_admin() then
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
