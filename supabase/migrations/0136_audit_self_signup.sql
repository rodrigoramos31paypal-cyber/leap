-- ════════════════════════════════════════════════════════════════
-- 0136 · Registo de atividade — conta criada pelo PRÓPRIO cliente
--
-- CONTEXTO: o registo já regista "Conta criada (admin)" (client_create_
-- admin), mas NÃO o auto-registo do cliente (/registar). Isto porque, no
-- momento do signUp, o cliente ainda não está autenticado — a RPC de
-- auditoria (que exige auth.uid()) não pode ser usada aí. O sítio certo
-- para captar o auto-registo é o trigger que cria mesmo a conta:
-- handle_new_user().
--
-- Esta migração acrescenta ao handle_new_user() um registo
-- `account_create_self` em audit_log, com actor = o próprio novo cliente.
--
-- EVITAR DUPLICADOS: as contas criadas por um admin passam pelo MESMO
-- trigger. Para não aparecerem duas vezes (uma como admin, outra como
-- cliente), as ações de admin passam a marcar `created_by_admin: true` no
-- user_metadata; o trigger só regista o auto-registo quando essa marca
-- NÃO está presente.
--
-- SEGURANÇA / ROBUSTEZ: o insert de auditoria está dentro de um bloco
-- BEGIN/EXCEPTION que engole qualquer erro — a criação da conta NUNCA
-- falha por causa da auditoria (best-effort). O insert é direto na tabela
-- (o trigger é SECURITY DEFINER), por isso não passa pelo allowlist da
-- RPC. IP fica NULL (não há contexto de pedido dentro do trigger).
--
-- REVERT: reaplicar a 0046 (handle_new_user sem o bloco de auditoria).
-- ════════════════════════════════════════════════════════════════
create or replace function handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_trainer_id uuid;
begin
  -- Lê e valida o trainer (se vier no metadata). Inválido → NULL.
  begin
    v_trainer_id := (new.raw_user_meta_data->>'trainer_id')::uuid;
  exception when others then
    v_trainer_id := null;
  end;

  if v_trainer_id is not null then
    if not exists (
      select 1 from trainers where id = v_trainer_id and active = true
    ) then
      v_trainer_id := null;
    end if;
  end if;

  insert into profiles (id, email, full_name, phone, role, trainer_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone',
    'client',
    v_trainer_id
  );

  -- Auditoria do AUTO-REGISTO (só quando NÃO foi um admin a criar a conta).
  -- Best-effort: qualquer erro aqui é ignorado para não partir o signup.
  if coalesce(new.raw_user_meta_data->>'created_by_admin', '') <> 'true' then
    begin
      insert into audit_log (actor_id, action, target_table, target_id, payload)
      values (new.id, 'account_create_self', 'profiles', new.id,
              jsonb_build_object('trainer_id', v_trainer_id));
    exception when others then
      -- ignora (auditoria é best-effort; a conta já foi criada)
      null;
    end;
  end if;

  return new;
end;
$$;
