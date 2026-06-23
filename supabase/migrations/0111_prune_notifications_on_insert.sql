-- ════════════════════════════════════════════════════════════════
-- 0111 · P-27 (perf) — manter só as N notificações mais recentes por
--        utilizador via trigger no INSERT, em vez de um DELETE no render.
--
-- CONTEXTO
-- `app/app/notificacoes/page.tsx` corria, EM CADA render (GET), um
-- `DELETE FROM notifications WHERE user_id=… AND id NOT IN (<10 ids>)`
-- para manter a tabela com apenas as 10 mais recentes (assim o `limit 10`
-- da página == total, e apagar uma dá 10→9→8 sem a 11.ª reaparecer).
-- Isso transformava uma leitura idempotente numa escrita por visita
-- (lock de linha + WAL) e impedia qualquer cache da rota.
--
-- FIX
-- Mover a retenção para um trigger AFTER INSERT: sempre que entra uma
-- notificação nova, apaga as que excedem as 10 mais recentes DESSE user.
-- A escrita passa a acontecer no INSERT (que já é uma escrita) e some do
-- caminho de leitura. O steady-state é idêntico (≤10 por user), por isso
-- a UX de apagar (10→9→8, sem reaparecer) mantém-se exactamente.
--
-- NOTA DE COMPORTAMENTO
-- O painel admin (`/admin/notificacoes`) também mostra só "as 10 mais
-- recentes", mas antes NÃO podava — podia acumular >10 na BD. Com este
-- trigger, todos os utilizadores ficam topados em 10 (o badge de não-lidas
-- do sino conta sobre as existentes). Consistente com o que ambas as
-- páginas já apresentam.
--
-- KEEP = 10. Para mudar, alterar o `limit` aqui E o `.limit(10)` das duas
-- páginas em conjunto (a UX de apagar depende de serem iguais).
--
-- REVERT:
--   drop trigger if exists trg_prune_notifications on notifications;
--   drop function if exists prune_notifications_keep_recent();
--   drop index if exists idx_notifications_user_created;
--   (e repor o bloco DELETE em app/app/notificacoes/page.tsx)
-- ════════════════════════════════════════════════════════════════

-- Índice para a subquery "10 mais recentes por user" (order by created_at
-- desc). O idx_notif_user_unread existente tem read_at no meio, por isso
-- não serve bem este order-by; este é dedicado e barato.
create index if not exists idx_notifications_user_created
  on notifications (user_id, created_at desc);

create or replace function prune_notifications_keep_recent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from notifications n
  where n.user_id = new.user_id
    and n.id not in (
      select id
      from notifications
      where user_id = new.user_id
      order by created_at desc, id desc
      limit 10
    );
  return null; -- AFTER trigger: valor de retorno ignorado
end;
$$;

drop trigger if exists trg_prune_notifications on notifications;
create trigger trg_prune_notifications
  after insert on notifications
  for each row execute procedure prune_notifications_keep_recent();

-- ── Backfill one-time ────────────────────────────────────────────
-- O trigger só poda no PRÓXIMO insert de cada user. Quem já tem >10
-- linhas (sobretudo admins, que nunca podavam) ficaria com o bug de
-- "apagar traz a 11.ª de volta" até receber uma notificação nova.
-- Esta limpeza única alinha já toda a tabela com KEEP=10.
delete from notifications n
using (
  select id,
         row_number() over (
           partition by user_id order by created_at desc, id desc
         ) as rn
  from notifications
) ranked
where ranked.id = n.id and ranked.rn > 10;

comment on function prune_notifications_keep_recent() is
  'P-27 (perf, jun/2026): mantém só as 10 notificações mais recentes por '
  'user. Substitui o DELETE que corria no render de /app/notificacoes. '
  'KEEP=10 tem de bater certo com o .limit(10) das páginas.';
