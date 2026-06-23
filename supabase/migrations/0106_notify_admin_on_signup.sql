-- ════════════════════════════════════════════════════════════════
-- 0106 · Notificação a toda a equipa (owner + trainer) quando um
-- cliente novo se regista.
--
-- Antes: ninguém na equipa era avisado de um signup — havia que ir
-- ao admin/clientes ver. Agora, sempre que `handle_new_user()` cria
-- uma linha em `profiles` com role='client' (= novo registo via
-- /registar ou via /t/<slug>), inserimos UMA notificação por cada
-- conta de staff (owner + trainer). Cada INSERT dispara o webhook
-- de push → todos recebem o sininho + push.
--
-- Email: NÃO é enviado. O canal é só in-app/push, por escolha de
-- produto. (Quem mexer aqui, ver lib/email-dispatch.ts; basta NÃO
-- chamar emailStudioStaff para esta categoria.)
--
-- Gating: respeita a preferência `signups` por utilizador. A linha
-- em `notifications` é sempre criada (sininho), mas o push é
-- filtrado em /api/push/dispatch via categoryForType('new_signup_
-- admin') → 'signups' → getChannelPref(user).
--
-- Sem skip por "service_role": tanto self-signup como criação manual
-- via /admin/agenda passam pelo handle_new_user com auth.uid() = NULL.
-- Não conseguimos distinguir no trigger, por isso optamos por avisar
-- toda a equipa sempre — quando é a própria equipa a criar, vê a
-- notificação como confirmação. Não há canal de email (in-app + push).
--
-- REVERT:
--   drop trigger trg_notify_admin_on_new_client on profiles;
--   drop function notify_admin_on_new_client();
-- ════════════════════════════════════════════════════════════════

create or replace function notify_admin_on_new_client()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_body text;
  v_link text;
begin
  -- Só nos interessa o registo de CLIENTES. Owner/trainer são criados
  -- pela equipa via fluxos admin e não devem disparar este aviso.
  if new.role is distinct from 'client' then
    return new;
  end if;

  v_body := coalesce(new.full_name, 'Um cliente novo') || ' criou uma conta.';
  v_link := '/admin/clientes/' || new.id::text;

  -- Fan-out: uma notificação por conta de staff (owner + trainer).
  -- Não usamos o trigger 0103 (fanout_staff_notifications) porque o
  -- INSERT manual aqui é mais directo e evita acoplar este caso à
  -- lista de tipos "espalháveis" desse trigger.
  insert into notifications (user_id, type, title, body, link)
  select p.id, 'new_signup_admin', 'Novo registo', v_body, v_link
  from profiles p
  where p.role in ('owner', 'trainer');

  return new;
end;
$$;

drop trigger if exists trg_notify_admin_on_new_client on profiles;
create trigger trg_notify_admin_on_new_client
  after insert on profiles
  for each row execute procedure notify_admin_on_new_client();
