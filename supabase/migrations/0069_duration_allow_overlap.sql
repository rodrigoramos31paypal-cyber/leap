-- ════════════════════════════════════════════════════════════════
-- 0069 · Ajuste de duração — permitir SOBREPOSIÇÃO (com confirmação)
--
-- Mudança vs 0068: a sobreposição com OUTRA sessão deixa de ser uma
-- barreira dura. Agora a RPC apenas AVISA — devolve
--   { ok:false, conflict:true, count:N }
-- sem alterar nada. A UI mostra "vai sobrepor N sessão(ões), tens a
-- certeza?"; se o trainer confirmar, chama de novo com p_force=true e
-- a sessão é gravada mesmo sobreposta (2 eventos ao mesmo tempo — ok).
--
-- Bloqueios (trainer_blocked_times) CONTINUAM a ser barreira dura.
--
-- A função passa a devolver jsonb (antes era void) e ganha p_force.
-- Removemos a versão antiga (uuid,integer) para não ficar overload.
--
-- REVERT: drop function update_booking_duration(uuid,integer,boolean);
--         e reaplicar 0068.
-- ════════════════════════════════════════════════════════════════

drop function if exists update_booking_duration(uuid, integer);

create or replace function update_booking_duration(
  p_booking_id uuid,
  p_duration_min integer,
  p_force boolean default false
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_ends_at timestamptz;
  v_conflicts integer;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  -- Autorização: só admin com acesso ao trainer (ou service role).
  if auth.uid() is not null
     and not (is_admin() and _trainer_is_accessible(v_booking.trainer_id)) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_booking.status not in ('booked', 'confirmed') then
    raise exception 'Só sessões ativas podem ser ajustadas.';
  end if;

  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 600 then
    raise exception 'A duração tem de estar entre 5 e 600 minutos.';
  end if;

  v_ends_at := v_booking.starts_at + (p_duration_min || ' minutes')::interval;

  perform pg_advisory_xact_lock(hashtextextended(v_booking.trainer_id::text, 0));

  -- Bloqueios continuam a ser uma barreira dura.
  if exists (
    select 1 from trainer_blocked_times
    where trainer_id = v_booking.trainer_id
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_booking.starts_at, v_ends_at, '[)')
  ) then
    raise exception 'A nova duração sobrepõe um horário bloqueado.';
  end if;

  -- Sobreposição com OUTRAS sessões activas → AVISO (não barreira).
  select count(*) into v_conflicts
  from bookings
  where trainer_id = v_booking.trainer_id
    and id <> p_booking_id
    and status in ('booked', 'confirmed')
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_booking.starts_at, v_ends_at, '[)');

  if v_conflicts > 0 and not coalesce(p_force, false) then
    -- Não grava — devolve o aviso para a UI confirmar.
    return jsonb_build_object('ok', false, 'conflict', true, 'count', v_conflicts);
  end if;

  update bookings set ends_at = v_ends_at where id = p_booking_id;
  return jsonb_build_object('ok', true, 'conflict', v_conflicts > 0, 'count', v_conflicts);
end;
$$;

revoke all on function update_booking_duration(uuid, integer, boolean) from public, anon;
grant execute on function update_booking_duration(uuid, integer, boolean) to authenticated, service_role;
