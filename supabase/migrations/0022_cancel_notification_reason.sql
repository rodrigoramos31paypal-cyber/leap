-- ════════════════════════════════════════════════════════════════
-- 0022 · Cancellation: include reason in client notification + allow
--                       users to delete their own notifications.
--
-- Mudanças:
--  1. cancel_booking · quando o cancelamento é feito pelo TRAINER/ADMIN,
--     a notificação enviada ao cliente passa a indicar:
--       "A tua sessão foi cancelada pelo trainer. Motivo: <razão>"
--     Se não houver motivo, mostra apenas "pelo trainer.".
--     Quando cancelado pelo próprio cliente, mantém o comportamento
--     anterior.
--  2. RLS · permitir ao utilizador eliminar as suas próprias notificações
--     (botão "Eliminar" na página de Notificações).
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
  v_by_admin boolean;
  v_user_reason text;
  v_notif_body text;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  -- autorização: cliente da própria marcação OU admin/service
  if not _is_service_or_admin() and v_booking.client_id <> auth.uid() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_booking.status in ('cancelled', 'no_show') then return; end if;

  if v_booking.starts_at <= now() then
    raise exception 'Não é possível cancelar uma sessão que já decorreu.';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_booking.trainer_id;

  v_hours_to_session := extract(epoch from (v_booking.starts_at - now())) / 3600.0;

  -- Identifica cedo quem está a cancelar — usado tanto para a lógica
  -- de reembolso como para o texto da notificação.
  -- Service/admin sem auth.uid() (ex: jobs) também conta como "trainer".
  v_by_admin := auth.uid() is null
                or _is_service_or_admin()
                or auth.uid() <> v_booking.client_id;

  -- Regra de reembolso:
  --   - Trainer/admin a cancelar → SEMPRE devolve a sessão (mesmo tarde).
  --   - Cliente a cancelar → respeita a janela `cancellation_window_hours`
  --     se `charge_late_cancel` estiver activo.
  if not v_by_admin
     and v_settings.charge_late_cancel
     and v_hours_to_session < v_settings.cancellation_window_hours then
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

  if v_refund and v_booking.credit_charged then
    update purchases
      set sessions_remaining = sessions_remaining + 1
      where id = v_booking.purchase_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_booking.purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
            'Devolução de crédito por cancelamento');
  end if;

  -- ──────────────────────────────────────────────────────────────
  -- Notificação ao cliente
  -- ──────────────────────────────────────────────────────────────
  -- O actions.ts envia "Cancelado pelo trainer — <texto>" ou
  -- "Cancelado pelo trainer" — extrai só a parte do texto livre.
  if v_by_admin and p_reason is not null then
    if position('—' in p_reason) > 0 then
      v_user_reason := trim(both ' ' from split_part(p_reason, '—', 2));
    else
      v_user_reason := p_reason;
    end if;
    if v_user_reason = '' then
      v_user_reason := null;
    end if;
  end if;

  if v_by_admin then
    -- Trainer cancela → cliente recebe sempre a sessão de volta.
    v_notif_body :=
      'A tua sessão foi cancelada pelo trainer e foi devolvida à tua conta.'
      || case when v_user_reason is not null
              then ' Motivo: ' || v_user_reason
              else '' end;
  else
    -- Cliente cancela → respeita a janela de cancelamento.
    v_notif_body := case
      when not v_refund then
        'Cancelaste com menos de ' || v_settings.cancellation_window_hours
        || 'h — 1 sessão foi descontada.'
      else
        'A tua sessão foi cancelada e foi devolvida à tua conta.'
    end;
  end if;

  insert into notifications (user_id, type, title, body)
  values (v_booking.client_id, 'booking_cancelled', 'Marcação cancelada', v_notif_body);
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- RLS · permitir ao utilizador eliminar as suas próprias notificações
-- ────────────────────────────────────────────────────────────────
drop policy if exists "notif: delete own" on notifications;
create policy "notif: delete own" on notifications
  for delete using (user_id = auth.uid() or is_admin());
