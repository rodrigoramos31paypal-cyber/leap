-- ════════════════════════════════════════════════════════════════
-- 0074 · Remover sessões do saldo de um cliente (admin/trainer)
--
-- Permite ao trainer tirar N sessões do saldo de um cliente a partir
-- do painel "Gerir sessões". Deduz das compras confirmadas, não
-- expiradas e com saldo > 0, consumindo primeiro as que expiram mais
-- cedo (expires_at asc, nulls por último; depois mais antigas). Cada
-- dedução fica registada em credit_transactions (delta negativo) para
-- auditoria. Devolve o nº de sessões efectivamente removidas (pode ser
-- menor do que o pedido se o cliente não tiver saldo suficiente).
-- ════════════════════════════════════════════════════════════════

create or replace function remove_client_sessions(
  p_client_id uuid,
  p_trainer_id uuid,
  p_count integer
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
            'Sessões removidas manualmente pelo trainer');
    v_remaining := v_remaining - v_take;
    v_removed := v_removed + v_take;
  end loop;

  return v_removed;
end;
$$;

revoke all on function remove_client_sessions(uuid, uuid, integer) from public, anon;
grant execute on function remove_client_sessions(uuid, uuid, integer) to authenticated, service_role;
