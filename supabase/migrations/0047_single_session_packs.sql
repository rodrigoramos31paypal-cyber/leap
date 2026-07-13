-- ════════════════════════════════════════════════════════════════
-- 0047_single_session_packs
--
-- Adiciona um flag `is_single_session` aos packs. Permite marcar UM
-- pack por trainer como "Sessão avulsa" — usado pela UI para destacar
-- a opção "compra uma sessão sem compromisso de pack" no topo da
-- página /app/comprar.
--
-- O índice parcial unique impede ter mais que um pack avulsa activo
-- por trainer (evita ambiguidade na UI pública). Packs avulsa podem
-- ter qualquer nº de sessões (tipicamente 1), mas o nome diz tudo.
--
-- REVERT:
--   drop index if exists uq_packs_single_session_active;
--   alter table packs drop column if exists is_single_session;
-- ════════════════════════════════════════════════════════════════

alter table packs
  add column if not exists is_single_session boolean not null default false;

create unique index if not exists uq_packs_single_session_active
  on packs (trainer_id)
  where is_single_session = true and active = true;
