-- ════════════════════════════════════════════════════════════════
-- 0079 · Permitir ao trainer/admin cancelar sessões já passadas
--
-- Antes, cancel_booking bloqueava QUALQUER cancelamento de sessões
-- passadas (também para admins). Útil quando a sessão não aconteceu
-- mas o trainer esqueceu-se de a cancelar a tempo. Agora:
--   • Cliente → continua a NÃO poder cancelar uma sessão passada.
--   • Trainer/admin/serviço → PODE (o crédito é devolvido ao cliente).
-- Restante lógica (refund, notificações) mantém-se igual.
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
  v_when text;
  v_trainer_profile uuid;
  v_client_name text;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  v_when := to_char(v_booking.starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');

  -- ── Autorização ───────────────────────────────────────────────
  if auth.uid() is null then
    null; -- service: ok
  elsif v_booking.client_id = auth.uid() then
    null; -- cliente cancela própria marcação: ok
  elsif is_admin() then
    if not _trainer_is_accessible(v_booking.trainer_id) then
      raise exception 'access denied' using errcode = '42501';
    end if;
  else
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_booking.status in ('cancelled', 'no_show') then return; end if;

  -- Quem está a cancelar? (admin/serviço vs cliente). Calculado já aqui
  -- para podermos permitir ao admin cancelar sessões passadas.
  v_by_admin := auth.uid() is null
                or _is_service_or_admin()
                or auth.uid() <> v_booking.client_id;

  -- Sessão passada: o cliente não pode; o trainer/admin pode.
  if v_booking.starts_at <= now() and not v_by_admin then
    raise exception 'Não é possível cancelar uma sessão que já decorreu.';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_booking.trainer_id;

  v_hours_to_session := extract(epoch from (v_booking.starts_at - now())) / 3600.0;

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
    v_notif_body :=
      'A tua sessão de ' || v_when || ' foi cancelada pelo trainer e foi devolvida à tua conta.'
      || case when v_user_reason is not null
              then ' Motivo: ' || v_user_reason
              else '' end;
  else
    v_notif_body := case
      when not v_refund then
        'A tua sessão de ' || v_when || ' foi cancelada com menos de '
        || v_settings.cancellation_window_hours || 'h — 1 sessão foi descontada.'
      else
        'A tua sessão de ' || v_when || ' foi cancelada e foi devolvida à tua conta.'
    end;
  end if;

  insert into notifications (user_id, type, title, body, link)
  values (v_booking.client_id, 'booking_cancelled', 'Marcação cancelada', v_notif_body, '/app/historico');

  -- Quando foi o CLIENTE a cancelar, avisa o trainer/admin.
  if not v_by_admin then
    select profile_id into v_trainer_profile from trainers where id = v_booking.trainer_id;
    select full_name into v_client_name from profiles where id = v_booking.client_id;
    if v_trainer_profile is not null then
      insert into notifications (user_id, type, title, body, link)
      values (v_trainer_profile, 'booking_cancelled_admin',
              'Cliente cancelou',
              coalesce(v_client_name, 'Um cliente') || ' cancelou a sessão de ' || v_when ||
                '. O horário ficou livre.',
              '/admin/agenda');
    end if;
  end if;
end;
$$;
