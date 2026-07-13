-- ════════════════════════════════════════════════════════════════
-- 0109 · Sinal global de "forçar atualização" da PWA (kill-switch)
--
-- A PWA fica muitas vezes presa numa versão antiga até o utilizador
-- fechar/reabrir (sobretudo iOS standalone). Esta tabela é um sinal
-- global: quando o staff carrega em "Forçar atualização" (admin →
-- Definições → Segurança), `force_reload_at` avança e TODAS as apps
-- abertas (clientes + staff), que ouvem via realtime/poll (componente
-- AppUpdater), recarregam para a versão mais recente.
--
-- Singleton: uma única linha (id = true). Leitura aberta a qualquer
-- utilizador autenticado (todos precisam de ouvir o sinal). Escrita
-- NÃO tem policy → só service_role (server action requireStaff) escreve.
-- ════════════════════════════════════════════════════════════════

create table if not exists app_config (
  id boolean primary key default true,
  force_reload_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint app_config_singleton check (id = true)
);

-- Linha única inicial.
insert into app_config (id) values (true) on conflict (id) do nothing;

alter table app_config enable row level security;

-- Qualquer utilizador autenticado LÊ o sinal (cliente e staff).
drop policy if exists "app_config read" on app_config;
create policy "app_config read"
  on app_config for select
  to authenticated
  using (true);

-- Sem policy de INSERT/UPDATE/DELETE: a escrita é feita server-side com
-- service role (server action protegida por requireStaff). RLS bloqueia
-- qualquer escrita vinda do cliente.

-- Realtime: permite que o AppUpdater receba o UPDATE quase instantâneo.
-- Defensivo: só adiciona se a publicação existir e ainda não tiver a tabela.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table app_config;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;
