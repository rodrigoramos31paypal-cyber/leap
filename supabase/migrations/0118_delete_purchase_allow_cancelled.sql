-- ════════════════════════════════════════════════════════════════
-- 0118 · delete_purchase tolera sessões/séries CANCELADAS
--
-- Problema (reportado jun/2026): um pagamento cancelado cujas sessões
-- foram todas canceladas continuava a não poder ser eliminado. As
-- marcações canceladas mantêm a FK para a compra (on delete restrict),
-- por isso o pré-check da 0116 — que recusava se existisse QUALQUER
-- booking — bloqueava mesmo quando já não havia nada de real associado.
--
-- Agora: o delete só é recusado se houver sessões ou séries ATIVAS
-- (status <> 'cancelled') — isso é histórico real e não deve ser
-- apagado por aqui (usar "Cancelar pagamento"). Se as referências
-- forem todas canceladas, são limpas e a compra é eliminada:
--   • bookings cancelados que apontam para esta compra (purchase_id) →
--     apagados;
--   • bookings cancelados que só a referenciam pelo lado dupla
--     (partner_purchase_id) → destacados (partner_purchase_id = null),
--     sem apagar a linha do parceiro;
--   • booking_series canceladas desta compra → apagadas (bookings.series_id
--     fica null por FK on delete set null).
-- Depois o delete da compra leva payments + credit_transactions por
-- cascade.
--
-- REVERT: reaplicar 0116.
-- ════════════════════════════════════════════════════════════════

create or replace function delete_purchase(p_purchase_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_purchase purchases%rowtype;
  v_active_bookings integer;
  v_active_series integer;
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

  -- Sessões ATIVAS (não-canceladas) associadas — conta tanto o lado dono
  -- (purchase_id) como o lado dupla (partner_purchase_id). Se houver,
  -- recusa: é histórico real, deve usar-se "Cancelar pagamento".
  select count(*) into v_active_bookings
    from bookings
    where (purchase_id = p_purchase_id or partner_purchase_id = p_purchase_id)
      and status <> 'cancelled';
  if v_active_bookings > 0 then
    raise exception
      'Esta compra tem % sessão(ões) ativa(s) associada(s). Usa "Cancelar pagamento" em vez de eliminar.',
      v_active_bookings
      using errcode = 'P0001';
  end if;

  select count(*) into v_active_series
    from booking_series
    where purchase_id = p_purchase_id
      and status <> 'cancelled';
  if v_active_series > 0 then
    raise exception
      'Esta compra tem séries de marcações ativas associadas. Usa "Cancelar pagamento" em vez de eliminar.'
      using errcode = 'P0001';
  end if;

  -- ── Limpeza das referências CANCELADAS (todas, por definição acima) ──
  -- Destaca bookings cancelados do parceiro que só referenciam pelo lado
  -- dupla (não apaga a linha do parceiro, só corta a FK).
  update bookings
    set partner_purchase_id = null
    where partner_purchase_id = p_purchase_id
      and purchase_id <> p_purchase_id
      and status = 'cancelled';

  -- Apaga bookings cancelados desta compra (series_id fica null por FK;
  -- credit_transactions.booking_id fica null por FK).
  delete from bookings
    where purchase_id = p_purchase_id
      and status = 'cancelled';

  -- Apaga séries canceladas desta compra (bookings.series_id → null).
  delete from booking_series
    where purchase_id = p_purchase_id
      and status = 'cancelled';

  -- Hard delete da compra. payments + credit_transactions caem por cascade.
  delete from purchases where id = p_purchase_id;
end;
$$;

revoke all on function delete_purchase(uuid) from public, anon;
grant execute on function delete_purchase(uuid) to authenticated, service_role;
