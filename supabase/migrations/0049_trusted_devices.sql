-- ════════════════════════════════════════════════════════════════
-- 0049_trusted_devices
--
-- 2FA · armazena dispositivos onde o utilizador já passou o desafio
-- TOTP e marcou "confiar neste dispositivo 30 dias". Enquanto o
-- token estiver válido, o middleware/layout saltam o desafio 2FA
-- mesmo se a sessão actual estiver em AAL1.
--
-- O cookie envia um token aleatório (32 bytes); a tabela só guarda o
-- HASH (sha256 hex) — se a BD vazar, ninguém consegue impersonar.
--
-- REVERT: drop table if exists trusted_devices;
-- ════════════════════════════════════════════════════════════════
create table if not exists trusted_devices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  token_hash text not null,
  user_agent text,
  ip         text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (token_hash)
);

create index if not exists idx_trusted_devices_user
  on trusted_devices (user_id, expires_at desc);

alter table trusted_devices enable row level security;

-- Cliente autenticado pode VER os seus próprios devices (lista na UI)
-- mas nunca os insere/edita directamente — isso passa pelas server actions
-- com service role.
create policy "trusted_devices: self read" on trusted_devices
  for select using (user_id = auth.uid());
create policy "trusted_devices: self delete" on trusted_devices
  for delete using (user_id = auth.uid());
