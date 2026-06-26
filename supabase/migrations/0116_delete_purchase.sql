-- ════════════════════════════════════════════════════════════════
-- 0116 · Eliminar (hard delete) uma compra/pagamento — admin/staff
--
-- Dá ao staff a opção de APAGAR definitivamente um registo de
-- pagamento (ícone de caixote do lixo na página de Pagamentos), em vez
-- de o deixar para sempre em "Confirmados", "Rejeitados" ou
-- "Pendentes". Útil para limpar registos de teste, duplicados ou
-- criados por engano.
--
-- DIFERENÇA vs. cancel_confirmed_purchase: cancelar MANTÉM o registo
-- (passa a 'cancelled', aparece em "Rejeitados"). Eliminar REMOVE-o de
-- vez — não fica em lado nenhum.
--
-- INTEGRIDADE: bookings.purchase_id, bookings.partner_purchase_id e
-- booking_series.purchase_id são FK `on delete restrict`. Se a compra
-- já pagou sessões marcadas, apagá-la deixaria essas sessões órfãs — a
-- RPC recusa com mensagem clara e o admin deve usar "Cancelar
-- pagamento" nesse caso. payments e credit_transactions são
-- `on delete cascade`, por isso desaparecem com a compra.
--
-- REVERT: drop function delete_purchase(uuid);
-- ════════════════════════════════════════════════════════════════

create or replace function delete_purchase(p_purchase_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_purchase purchases%rowtype;
  v_bookings integer;
  v_series integer;
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_purchase from purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'Compra não encontrada';
  end if;

  if auth.uid() is not null and not _trainer_is_accessible(v_purchase.trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  -- Recusa se há sessões marcadas que dependem desta compra (FK restrict).
  -- Conta tanto a compra "dona" da sessão como o lado dupla (partner).
  select count(*) into v_bookings
    from bookings
    where purchase_id = p_purchase_id
       or partner_purchase_id = p_purchase_id;
  if v_bookings > 0 then
    raise exception
      'Esta compra tem % sessão(ões) marcada(s) associada(s). Usa "Cancelar pagamento" em vez de eliminar.',
      v_bookings
      using errcode = 'P0001';
  end if;

  select count(*) into v_series
    from booking_series
    where purchase_id = p_purchase_id;
  if v_series > 0 then
    raise exception
      'Esta compra tem séries de marcações associadas. Usa "Cancelar pagamento" em vez de eliminar.'
      using errcode = 'P0001';
  end if;

  -- Hard delete. payments + credit_transactions caem por cascade.
  delete from purchases where id = p_purchase_id;
end;
$$;

revoke all on function delete_purchase(uuid) from public, anon;
grant execute on function delete_purchase(uuid) to authenticated, service_role;
