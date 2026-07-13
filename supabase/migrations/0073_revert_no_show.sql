-- ════════════════════════════════════════════════════════════════
-- 0073 · Reverter uma falta (no_show) → confirmada OU cancelada
--
-- As RPCs existentes recusam mexer numa falta:
--   • confirm_booking_attendance só aceita status = 'booked'.
--   • cancel_booking faz no-op (early return) em status = 'no_show'.
-- Esta RPC deixa o trainer corrigir uma falta marcada por engano,
-- escolhendo o estado destino e SE devolve (ou não) o crédito.
--
-- Devolução do crédito (p_refund_credit, default true):
--   • só devolve se a falta ainda detinha o crédito (credit_charged) e
--     tem purchase associada — evita devolver duas vezes quando
--     charge_no_show = false já o tinha devolvido ao marcar a falta.
--   • quando devolve: sessions_remaining += 1 + linha em
--     credit_transactions (reason 'refund') e credit_charged → false.
-- ════════════════════════════════════════════════════════════════

create or replace function revert_no_show(
  p_booking_id uuid,
  p_new_status text,
  p_refund_credit boolean default true
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_when text;
  v_refunded boolean := false;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  v_when := to_char(v_booking.starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');

  -- ── Autorização (C4): só admin/trainer com acesso ao trainer ──
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if auth.uid() is not null and not _trainer_is_accessible(v_booking.trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_booking.status <> 'no_show' then
    raise exception 'Só uma falta pode ser revertida.';
  end if;
  if p_new_status not in ('confirmed', 'cancelled') then
    raise exception 'Estado de destino inválido.';
  end if;

  -- ── Devolução opcional do crédito ────────────────────────────
  if p_refund_credit and v_booking.credit_charged and v_booking.purchase_id is not null then
    update purchases
      set sessions_remaining = sessions_remaining + 1
      where id = v_booking.purchase_id;
    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_booking.purchase_id, p_booking_id, 1, 'refund', auth.uid(),
            'Crédito devolvido ao reverter falta');
    v_refunded := true;
  end if;

  if p_new_status = 'confirmed' then
    update bookings
      set status = 'confirmed',
          confirmed_at = now(),
          confirmed_by = auth.uid(),
          cancelled_at = null,
          cancelled_by = null,
          cancellation_reason = null,
          credit_charged = case when v_refunded then false else credit_charged end
      where id = p_booking_id;

    insert into notifications (user_id, type, title, body, link)
    values (v_booking.client_id, 'booking_confirmed',
            'Sessão atualizada',
            'A tua sessão de ' || v_when || ' foi marcada como presente.'
              || case when v_refunded then ' O crédito foi devolvido à tua conta.' else '' end,
            '/app/historico');
  else
    update bookings
      set status = 'cancelled',
          cancelled_at = now(),
          cancelled_by = auth.uid(),
          cancellation_reason = 'Revertida de falta pelo trainer',
          confirmed_at = null,
          confirmed_by = null,
          credit_charged = case when v_refunded then false else credit_charged end
      where id = p_booking_id;

    insert into notifications (user_id, type, title, body, link)
    values (v_booking.client_id, 'booking_cancelled',
            'Marcação cancelada',
            'A tua sessão de ' || v_when || ' foi cancelada pelo trainer.'
              || case when v_refunded then ' O crédito foi devolvido à tua conta.' else '' end,
            '/app/historico');
  end if;
end;
$$;

revoke all on function revert_no_show(uuid, text, boolean) from public, anon;
grant execute on function revert_no_show(uuid, text, boolean) to authenticated, service_role;
