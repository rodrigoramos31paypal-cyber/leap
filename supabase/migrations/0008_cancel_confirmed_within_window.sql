-- ════════════════════════════════════════════════════════════════
-- Permite cancelar/reagendar mesmo depois do admin confirmar,
-- desde que a sessão ainda esteja no futuro.
-- A regra de cancelamento tardio (cancellation_window_hours) continua
-- a aplicar-se ao reembolso de crédito.
-- ════════════════════════════════════════════════════════════════

create or replace function cancel_booking(
  p_booking_id uuid,
  p_reason text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_settings trainer_settings%rowtype;
  v_hours_to_session numeric;
  v_refund boolean := true;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;
  if v_booking.status in ('cancelled', 'no_show') then return; end if;

  -- só bloqueia se a sessão já passou
  if v_booking.starts_at <= now() then
    raise exception 'Não é possível cancelar uma sessão que já decorreu.';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_booking.trainer_id;

  v_hours_to_session := extract(epoch from (v_booking.starts_at - now())) / 3600.0;

  -- cancelamento tardio? então NÃO devolve crédito
  if v_settings.charge_late_cancel and v_hours_to_session < v_settings.cancellation_window_hours then
    v_refund := false;
  end if;

  update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancellation_reason = p_reason,
        confirmed_at = null,
        confirmed_by = null,
        credit_charged = not v_refund
    where id = p_booking_id;

  -- devolve crédito se aplicável e ainda estava marcado como debitado
  if v_refund and v_booking.credit_charged then
    update purchases
      set sessions_remaining = sessions_remaining + 1
      where id = v_booking.purchase_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_booking.purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
            'Devolução de crédito por cancelamento');
  end if;

  insert into notifications (user_id, type, title, body)
  values (v_booking.client_id, 'booking_cancelled', 'Marcação cancelada',
          case when not v_refund
               then 'Cancelaste com menos de ' || v_settings.cancellation_window_hours || 'h — 1 sessão foi descontada.'
               else 'A tua sessão foi cancelada e o crédito devolvido.' end);
end;
$$;
