-- ════════════════════════════════════════════════════════════════
-- 0114 · Remover sessões com filtro opcional por tipo (individual/dupla)
--
-- A versão da migration 0074 remove sessões de QUALQUER pack do cliente
-- (consome o que expira mais cedo, independentemente do tipo). Agora o
-- admin pode escolher remover só de packs PT Individual ou só PT Dupla
-- — útil em pares duo, onde o saldo dupla é partilhado e o admin quer
-- ajustar especificamente um dos pools sem tocar no outro.
--
-- Append-only: dropa a versão 3-arg (0074) e recria com 4 args, sendo o
-- último opcional (default null = qualquer tipo). Evita ambiguidade de
-- overload no PostgreSQL: as duas assinaturas coexistir-em-iam e uma
-- chamada com 3 args seria ambígua.
-- ════════════════════════════════════════════════════════════════

drop function if exists remove_client_sessions(uuid, uuid, integer);

create or replace function remove_client_sessions(
  p_client_id uuid,
  p_trainer_id uuid,
  p_count integer,
  p_session_type session_type default null
)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_purchase record;
  v_remaining integer := p_count;
  v_take integer;
  v_removed integer := 0;
begin
  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if auth.uid() is not null and not _trainer_is_accessible(p_trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if p_count is null or p_count <= 0 then
    raise exception 'Número de sessões inválido.';
  end if;

  for v_purchase in
    select id, sessions_remaining
    from purchases
    where client_id = p_client_id
      and trainer_id = p_trainer_id
      and status = 'confirmed'
      and sessions_remaining > 0
      and (expires_at is null or expires_at >= now())
      and (p_session_type is null or session_type = p_session_type)
    order by expires_at asc nulls last, created_at asc
    for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_purchase.sessions_remaining, v_remaining);
    update purchases
      set sessions_remaining = sessions_remaining - v_take
      where id = v_purchase.id;
    insert into credit_transactions (purchase_id, delta, reason, created_by, notes)
    values (v_purchase.id, -v_take, 'admin_adjust', auth.uid(),
            case
              when p_session_type is null then 'Sessões removidas manualmente pelo trainer'
              else 'Sessões removidas manualmente pelo trainer (' || p_session_type::text || ')'
            end);
    v_remaining := v_remaining - v_take;
    v_removed := v_removed + v_take;
  end loop;

  return v_removed;
end;
$$;

revoke all on function remove_client_sessions(uuid, uuid, integer, session_type) from public, anon;
grant execute on function remove_client_sessions(uuid, uuid, integer, session_type) to authenticated, service_role;
