-- ════════════════════════════════════════════════════════════════
-- 0119 · delete_purchase força eliminação de compras REJEITADAS/CANCELADAS
--        mesmo com sessões/séries ATIVAS associadas
--
-- Pedido (jun/2026): no separador "Rejeitados", o staff tem de poder
-- ELIMINAR um pagamento independentemente de ter, ou não, sessões/séries
-- ativas associadas. A 0118 só permitia se tudo estivesse cancelado.
--
-- Regra nova:
--   • Se a compra está REJEITADA ('rejected') ou CANCELADA ('cancelled'):
--     elimina à força. As referências desta compra são removidas:
--       – bookings DESTA compra (purchase_id) → apagados, qualquer estado
--         (cascade leva notas/avaliações/lembretes/integrações; e
--         credit_transactions.booking_id fica null por FK).
--       – bookings de PARCEIRO que só a referenciam pelo lado dupla
--         (partner_purchase_id), donos por outra compra → destacados
--         (partner_purchase_id = null), qualquer estado. NÃO se apaga a
--         sessão do parceiro: pertence a outra compra/cliente.
--       – booking_series DESTA compra → apagadas (bookings.series_id fica
--         null por FK).
--     Depois o delete da compra leva payments + credit_transactions por
--     cascade.
--
--   • Se a compra NÃO está rejeitada/cancelada (pending/awaiting/confirmed):
--     mantém-se a proteção da 0118 — recusa se houver sessões ou séries
--     ATIVAS (usar "Cancelar pagamento"). Só limpa referências canceladas.
--
-- REVERT: reaplicar 0118.
-- ════════════════════════════════════════════════════════════════

create or replace function delete_purchase(p_purchase_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_purchase purchases%rowtype;
  v_is_rejected boolean;
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

  v_is_rejected := v_purchase.status in ('rejected', 'cancelled');

  -- Proteção só para compras NÃO rejeitadas/canceladas: continua a recusar
  -- se houver histórico ativo (deve usar-se "Cancelar pagamento"). Para
  -- compras rejeitadas/canceladas, salta a proteção e força a eliminação.
  if not v_is_rejected then
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
  end if;

  -- ── Limpeza das referências ──────────────────────────────────────
  -- Para compras rejeitadas/canceladas isto cobre TUDO (ativo incluído);
  -- para as restantes, neste ponto já só existem referências canceladas.

  -- Destaca bookings do PARCEIRO que só referenciam pelo lado dupla
  -- (donos por outra compra) — não apaga a sessão do parceiro, só corta a FK.
  update bookings
    set partner_purchase_id = null
    where partner_purchase_id = p_purchase_id
      and purchase_id <> p_purchase_id;

  -- Apaga bookings DESTA compra (cascade leva filhos; credit_transactions
  -- e series_id ficam null por FK).
  delete from bookings
    where purchase_id = p_purchase_id;

  -- Apaga séries DESTA compra (bookings.series_id → null por FK).
  delete from booking_series
    where purchase_id = p_purchase_id;

  -- Hard delete da compra. payments + credit_transactions caem por cascade.
  delete from purchases where id = p_purchase_id;
end;
$$;

revoke all on function delete_purchase(uuid) from public, anon;
grant execute on function delete_purchase(uuid) to authenticated, service_role;
