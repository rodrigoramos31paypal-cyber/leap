-- ════════════════════════════════════════════════════════════════
-- 0072 · "Falta" sem restrições de tempo/estado
--
-- Antes (0027):
--   • mark_no_show só aceitava status = 'booked' → recusava com
--     "Só marcações ativas podem ser marcadas como falta."
--   • Implicava que sessões já confirmadas não podiam ser marcadas
--     como falta (cenário comum: cliente confirma presença mas
--     depois não aparece — o trainer ficava sem forma de marcar
--     falta a partir da agenda).
--   • Sem restrição temporal explícita, mas o gating de estado já
--     filtrava o passado na prática.
--
-- Agora:
--   • Aceita 'booked' E 'confirmed' (passado, presente ou futuro).
--   • 'no_show' → no-op (idempotente).
--   • 'cancelled' → continua recusado (uma sessão cancelada não
--     pode passar a falta — semanticamente são exclusivos).
--   • Mantém a lógica de créditos (charge_no_show controla se
--     desconta ou devolve o crédito).
--
-- REVERT: reaplicar a versão de 0027.
-- ════════════════════════════════════════════════════════════════

create or replace function mark_no_show(p_booking_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_settings trainer_settings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  -- ── Autorização (C4) ──────────────────────────────────────────
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if auth.uid() is not null and not _trainer_is_accessible(v_booking.trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  -- Idempotente: já é falta → no-op.
  if v_booking.status = 'no_show' then return; end if;

  -- Cancelada → não faz sentido sobrescrever como falta.
  if v_booking.status = 'cancelled' then
    raise exception 'Não é possível marcar como falta uma sessão cancelada.';
  end if;

  -- Restantes (booked, confirmed): aceita, sem check de tempo.
  if v_booking.status not in ('booked', 'confirmed') then
    raise exception 'Estado inválido para marcar como falta.';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_booking.trainer_id;

  update bookings
    set status = 'no_show',
        credit_charged = v_settings.charge_no_show,
        -- Limpa marcas de confirmação para o estado ficar coerente
        -- (não estava "presente" — não chegou).
        confirmed_at = null,
        confirmed_by = null
    where id = p_booking_id;

  -- Se NÃO se cobra falta e a sessão já tinha sido descontada do
  -- pack, devolve o crédito (e regista no histórico).
  if not v_settings.charge_no_show and v_booking.credit_charged and v_booking.purchase_id is not null then
    update purchases
      set sessions_remaining = sessions_remaining + 1
      where id = v_booking.purchase_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_booking.purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
            'No-show sem cobrança');
  end if;
end;
$$;

revoke all on function mark_no_show(uuid) from public, anon;
grant execute on function mark_no_show(uuid) to authenticated, service_role;
