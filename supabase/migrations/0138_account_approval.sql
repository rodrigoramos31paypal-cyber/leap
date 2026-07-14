-- ════════════════════════════════════════════════════════════════
-- 0138 · Aprovação de contas pelo admin
--
-- Um cliente que se auto-regista fica PENDENTE até um admin/trainer o
-- aprovar. Só depois pode usar a app. Contas criadas por admin (onboarding
-- privado) ficam logo aprovadas. Contas já existentes ficam aprovadas
-- (default da coluna). Rejeitar = anonimizar/bloquear a conta (irreversível),
-- ficando registada no histórico como rejeitada.
--
-- Peças:
--   1. Colunas de aprovação em `profiles` (+ índice).
--   2. handle_new_user: define pending/approved conforme quem cria.
--   3. protect_profile_role: bloqueia self-write de `approval_status`
--      (um cliente pendente NÃO se pode auto-aprovar via PostgREST).
--   4. approve_account(uuid): RPC staff-only para aprovar.
--   5. notify_pending_approval(): RPC (self) chamada após verificação de
--      email → notifica a equipa (uma vez).
--   6. notify_admin_on_new_client: já não avisa no INSERT das contas
--      PENDENTES (essas avisam na verificação); mantém para as aprovadas.
--   7. allowlist de auditoria: account_approve / account_reject.
--
-- REVERT: remover colunas + reaplicar 0136 (handle_new_user), 0120
-- (protect_profile_role), 0106 (notify_admin_on_new_client); drop das RPCs.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Colunas ────────────────────────────────────────────────────
alter table profiles
  add column if not exists approval_status text not null default 'approved'
    check (approval_status in ('pending', 'approved', 'rejected')),
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approval_decided_at timestamptz,
  add column if not exists approval_decided_by uuid references profiles(id) on delete set null,
  add column if not exists approval_notified_at timestamptz;

comment on column profiles.approval_status is
  '0138: pending (auto-registo à espera de aprovação) | approved | rejected. '
  'Contas antigas e criadas por admin ficam approved. Só staff/service alteram.';

-- Índice para as listagens da aba "Contas pendentes".
create index if not exists idx_profiles_approval
  on profiles (approval_status, approval_requested_at);
create index if not exists idx_profiles_approval_decided
  on profiles (approval_status, approval_decided_at desc);

-- ── 2. handle_new_user: pending para auto-registo, approved p/ admin ──
create or replace function handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_trainer_id uuid;
  v_by_admin boolean := coalesce(new.raw_user_meta_data->>'created_by_admin', '') = 'true';
  v_status text;
begin
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

  -- Admin cria → já aprovado. Auto-registo → pendente de aprovação.
  v_status := case when v_by_admin then 'approved' else 'pending' end;

  insert into profiles (
    id, email, full_name, phone, role, trainer_id,
    approval_status, approval_requested_at
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone',
    'client',
    v_trainer_id,
    v_status,
    case when v_by_admin then null else now() end
  );

  -- Auditoria do AUTO-REGISTO (só quando NÃO foi um admin a criar).
  if not v_by_admin then
    begin
      insert into audit_log (actor_id, action, target_table, target_id, payload)
      values (new.id, 'account_create_self', 'profiles', new.id,
              jsonb_build_object('trainer_id', v_trainer_id));
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$$;

-- ── 3. protect_profile_role: + guard de approval_status ──────────────
create or replace function protect_profile_role()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role and not is_owner() then
    raise exception 'Apenas o owner pode alterar roles.' using errcode = '42501';
  end if;

  if new.banned is distinct from old.banned and not is_admin() then
    raise exception 'Apenas staff pode alterar o estado de suspensão da conta.' using errcode = '42501';
  end if;

  if new.access_blocked is distinct from old.access_blocked and not is_admin() then
    raise exception 'Apenas staff pode alterar o bloqueio de acesso da conta.' using errcode = '42501';
  end if;

  if new.trainer_id is distinct from old.trainer_id and not is_admin() then
    raise exception 'Apenas staff pode alterar o trainer associado à conta.' using errcode = '42501';
  end if;

  -- 0138: aprovação — nunca pelo próprio cliente (senão auto-aprovava-se).
  if new.approval_status is distinct from old.approval_status and not is_admin() then
    raise exception 'Apenas staff pode alterar o estado de aprovação da conta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ── 4. approve_account · staff aprova uma conta pendente ─────────────
create or replace function approve_account(p_client_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  update profiles
    set approval_status = 'approved',
        approval_decided_at = now(),
        approval_decided_by = auth.uid()
    where id = p_client_id
      and role = 'client'
      and approval_status = 'pending';

  if not found then
    raise exception 'Conta não encontrada ou já decidida.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function approve_account(uuid) from public, anon;
grant execute on function approve_account(uuid) to authenticated, service_role;

-- ── 5. notify_pending_approval · avisa a equipa após verificação ─────
-- Chamada pelo próprio cliente (auth.uid()) a partir de /auth/callback,
-- logo após verificar o email. Só avisa se estiver pendente e ainda não
-- avisado (idempotente). SECURITY DEFINER para inserir nas notificações
-- da equipa (bypass RLS).
create or replace function notify_pending_approval()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_status text;
  v_notified timestamptz;
begin
  if v_uid is null then
    return;
  end if;

  select full_name, approval_status, approval_notified_at
    into v_name, v_status, v_notified
    from profiles where id = v_uid;

  if v_status is distinct from 'pending' or v_notified is not null then
    return;
  end if;

  -- type 'new_signup_admin' → mapeia para a categoria de push "signups".
  insert into notifications (user_id, type, title, body, link)
  select p.id, 'new_signup_admin', 'Conta pendente de aprovação',
         coalesce(v_name, 'Um cliente') || ' verificou o email e aguarda aprovação.',
         '/admin/clientes?tab=pendentes'
  from profiles p
  where p.role in ('owner', 'trainer');

  update profiles set approval_notified_at = now() where id = v_uid;
end;
$$;

revoke all on function notify_pending_approval() from public, anon;
grant execute on function notify_pending_approval() to authenticated, service_role;

-- ── 6. notify_admin_on_new_client: não avisar no INSERT dos pendentes ─
-- Contas pendentes (auto-registo) passam a avisar SÓ na verificação de
-- email (notify_pending_approval). Contas aprovadas no insert (criadas por
-- admin) mantêm o aviso de confirmação.
create or replace function notify_admin_on_new_client()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_body text;
  v_link text;
begin
  if new.role is distinct from 'client' then
    return new;
  end if;

  -- 0138: contas por aprovar avisam na verificação, não aqui.
  if new.approval_status = 'pending' then
    return new;
  end if;

  v_body := coalesce(new.full_name, 'Um cliente novo') || ' criou uma conta.';
  v_link := '/admin/clientes/' || new.id::text;

  insert into notifications (user_id, type, title, body, link)
  select p.id, 'new_signup_admin', 'Novo registo', v_body, v_link
  from profiles p
  where p.role in ('owner', 'trainer');

  return new;
end;
$$;

-- ── 7. Allowlist de auditoria: aprovar / rejeitar conta ──────────────
create or replace function log_audit_event(
  p_action text,
  p_target_table text default null,
  p_target_id uuid default null,
  p_payload jsonb default null,
  p_ip text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if p_action is null or length(p_action) = 0 then
    raise exception 'action required' using errcode = '22023';
  end if;

  if p_action not in (
    'export_pii', 'export_pii_self',
    'client_create_admin', 'client_delete_admin', 'client_ban', 'client_unban',
    'booking_create_admin', 'booking_cancel_admin', 'booking_reschedule_admin',
    'pack_grant', 'credits_adjust',
    'purchase_confirm', 'purchase_reject', 'purchase_cancel_confirmed', 'purchase_delete',
    'duo_link', 'duo_unlink',
    'booking_create_client', 'booking_reschedule_client', 'booking_cancel_client',
    'purchase_create_client', 'profile_update_self', 'password_change_self',
    'account_delete_self',
    -- 0138:
    'account_approve', 'account_reject'
  ) then
    raise exception 'unknown audit action: %', p_action using errcode = '22023';
  end if;

  if p_payload is not null and pg_column_size(p_payload) > 8192 then
    raise exception 'audit payload too large' using errcode = '22023';
  end if;

  insert into audit_log (actor_id, action, target_table, target_id, payload, ip_address)
  values (auth.uid(), p_action, p_target_table, p_target_id, p_payload, left(p_ip, 100));
end;
$$;

revoke all on function log_audit_event(text, text, uuid, jsonb, text) from public, anon;
grant execute on function log_audit_event(text, text, uuid, jsonb, text) to authenticated, service_role;
