create function public.reschedule_booking_admin(
  p_old_booking_id uuid, p_starts_at timestamptz, p_duration_min integer,
  p_notify_client boolean, p_force boolean, p_message text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_client uuid;
  v_old_start timestamptz;
  v_old_end timestamptz;
  v_actor uuid := auth.uid();
  v_message text := case when p_notify_client then nullif(btrim(p_message), '') end;
begin
  if not public.is_admin() or not exists (
    select 1 from public.profiles where id = v_actor and role in ('owner', 'trainer')
      and access_blocked is not true
  ) then
    raise exception 'Acesso restrito.' using errcode = '42501';
  end if;
  if char_length(v_message) > 1000 then
    raise exception 'A mensagem pode ter até 1000 caracteres.';
  end if;

  select starts_at, ends_at into v_old_start, v_old_end
    from public.bookings where id = p_old_booking_id for update;

  v_id := public.reschedule_booking_admin(
    p_old_booking_id, p_starts_at, p_duration_min, p_notify_client and v_message is null, p_force
  );

  if v_message is not null and (
    v_old_start is distinct from p_starts_at
    or v_old_end is distinct from p_starts_at + make_interval(mins => p_duration_min)
  ) then
    select client_id into strict v_client from public.bookings where id = v_id;
    perform public.leap_send_chat_message(
      gen_random_uuid(), v_client, v_actor, v_actor,
      'Sessão reagendada' || E'\n\n' || v_message, v_id, p_starts_at
    );
  end if;
  return v_id;
end;
$$;

revoke all on function public.reschedule_booking_admin(uuid,timestamptz,integer,boolean,boolean,text)
  from public, anon;
grant execute on function public.reschedule_booking_admin(uuid,timestamptz,integer,boolean,boolean,text)
  to authenticated;
