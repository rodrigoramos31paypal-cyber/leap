# Ranking LEAP — Update "Treinos fora das sessões PT" + Ranking por Consistência

> Documento de governança. Plano detalhado por fases. Nenhuma linha de código é
> escrita sem a fase correspondente estar aprovada aqui.
>
> Última atualização: 2026-09-29 · Estado: **✅ FASE 1 e FASE 2 CONCLUÍDAS · Fase 3 opcional**

---

## 0. Resumo para o cliente (linguagem simples)

> Secção pensada para mostrar ao dono do estúdio. Descreve o que vai mudar na
> prática, sem termos técnicos. Se algo aqui não fizer sentido, é só dizer antes
> de começarmos.

### O que estamos a resolver

Hoje o Ranking premeia sobretudo quem faz mais sessões PT — o que acaba por
favorecer quem compra packs maiores. Queremos que o Ranking passe a premiar a
**consistência e a atividade física**, para que um cliente com um pack de 4 ou 8
possa competir com um de 12 se cumprir o seu pack e continuar ativo (treino
sozinho, cardio, férias, etc.).

### O que o cliente passa a ver na app

- Na página inicial aparece uma zona pequena, no mesmo estilo do resto da app,
  com dois botões: **"Treinei hoje"** e **"Fiz cardio hoje"**.
- Ao carregar num deles, fica registada uma atividade do dia com a mensagem
  **"✓ Registado · Pendente de validação"** e o aviso **"Envia o comprovativo
  por WhatsApp para validação."**
- Pode registar atividades **só referentes ao próprio dia**, e pode registar
  **mais do que uma no mesmo dia** (ex.: treino + cardio).
- No **histórico** e no **perfil**, as atividades aparecem separadas por tipo —
  **Sessão PT**, **Treino autónomo**, **Cardio** — com o estado (Validado /
  Pendente / Rejeitado).
- No **perfil** passa a haver um resumo: consistência do pack (%), total de
  atividades (e a repartição), Sequência LEAP (semanas) e nível
  (Bronze/Silver/Gold/Elite).

### O que muda para o admin (tu)

- Ganhas uma lista das atividades que os clientes submeteram, com **[ Validar ]**
  e **[ Rejeitar ]**.
- **Só depois de validares** é que a atividade conta para o Ranking. Enquanto
  estiver pendente (ou se for rejeitada) **não conta**.
- Podes consultar o histórico das atividades (validadas e rejeitadas).
- O comprovativo continua a ser enviado por **WhatsApp** — nesta fase não há
  upload de fotos na app.

### Como o Ranking passa a funcionar

O Ranking passa a olhar para **duas coisas**:

1. **% do pack cumprido** — quanto do pack atual já foi usado (ex.: 6 de 8 = 75%).
   Isto coloca packs diferentes no mesmo pé (8/8 e 12/12 são ambos 100%).
2. **Nº de atividades validadas no mês** — sessões PT realizadas + treinos
   autónomos validados + cardios validados.

**Ordem de classificação:** primeiro quem tem maior % do pack; em caso de empate,
quem tem mais atividades no mês; depois maior Sequência LEAP; e por fim um
critério neutro (nome).

**Exemplo real (o objetivo do update):**

| Cliente | Pack | % do pack | Atividades no mês | Fica… |
|---------|------|-----------|-------------------|-------|
| A | 8 | 100% (8/8) | 13 (8 PT + 3 treinos + 2 cardios) | **à frente** |
| B | 12 | 100% (12/12) | 12 (12 PT + 0 extra) | atrás |

Ambos cumpriram 100% do pack, mas o Cliente A, por ter continuado ativo fora das
sessões PT, fica à frente do Cliente B, que tem um pack maior. É exatamente este
o comportamento que queremos.

### O que NÃO muda (garantias importantes)

- **Os packs e o saldo do cliente ficam intactos.** Registar um treino ou cardio
  **não tira nem acrescenta** sessões, **não** substitui uma sessão PT e **não**
  altera a percentagem de utilização do pack. São atividades adicionais.
- O pack **continua a não expirar** aos 31 dias — o mês é só o período de
  referência de consistência. As sessões restantes ficam sempre disponíveis.
- **A estética mantém-se exatamente igual**: dark mode, dourado, cards,
  tipografia e navegação atuais. Não há redesenho.
- **Não há perfis públicos.** No Ranking vê-se posição, nome próprio + inicial do
  apelido, % e atividades; não se clica noutros clientes nem se vê informação
  privada de terceiros. A linha do próprio cliente fica destacada.

### Em que ordem vamos fazer

- **Fase 1 (primeiro):** os dois botões na página inicial, o registo de
  atividades, a validação no admin, o novo Ranking (% + atividades) e o
  histórico/perfil já a distinguir os tipos.
- **Fase 2 (depois):** os ecrãs dedicados "O meu progresso" e "As tuas
  atividades" com mais detalhe visual (como nos screenshots de referência).

### Pontos a confirmar com o cliente

- Uma atividade só conta depois de **tu** validares (com base no comprovativo do
  WhatsApp). De acordo?
- Um cliente pode registar **várias atividades no mesmo dia**, e uma rejeitada
  não o impede de voltar a registar. De acordo?
- Um cliente em férias, que num mês só fez cardio mas ainda tem pack a meio,
  mantém a sua percentagem do pack (não "cai" no ranking por não ter feito PT
  esse mês). De acordo? *(ver P1 na secção 12)*

---

## 1. Objetivo

Transformar o **Ranking LEAP** numa competição de **consistência e atividade
física**, e não de "quem compra o maior pack". Um cliente com pack de 4/8 deve
poder competir com um de 12 se cumprir o seu pack e continuar ativo através de
treino autónomo/cardio validados.

Para isso introduzimos o registo de **atividade física feita fora das sessões
PT** (treino autónomo e cardio), sujeita a **validação do admin**, e passamos o
ranking a considerar **duas dimensões**: cumprimento do pack (%) e atividade
total validada.

### Restrições invioláveis (guard-rails)

1. **Não redesenhar a app.** Manter a estética atual: dark mode, dourado, cards,
   tipografia e navegação existentes.
2. **Reutilizar componentes existentes** sempre que possível.
3. **Não alterar a lógica de compra/saldo dos packs.** As atividades extra
   NUNCA tocam em `purchases`, `bookings` ou `credit_transactions`.
4. **Não criar perfis públicos de clientes.** No ranking não se clica noutros
   clientes; sem histórico/dados privados de terceiros.
5. **Alterar o mínimo possível da UI existente.**

---

## 2. Decisões fechadas (decision log)

| # | Tema | Decisão | Origem |
|---|------|---------|--------|
| D1 | Período das **atividades** | **Mês de calendário** (Europe/Lisbon), reinicia dia 1 | brainstorm |
| D2 | Cálculo da **% do pack** | **Cumulativa** do pack atual (`realizadas ÷ total`); não zera em férias | brainstorm |
| D3 | Contagem de atividades | **Bruta** (sem normalizar): PT realizadas + autónomos validados + cardios validados | brainstorm |
| D4 | Faseamento | **Fase 1 primeiro**; ecrãs dedicados na Fase 2 | brainstorm |
| D5 | Limite por dia | **Sem limite.** Cliente pode registar 2+ atividades no mesmo dia; rejeitada não bloqueia novo registo | brainstorm |
| D6 | Só o próprio dia | Só se pode registar atividade referente a **hoje** (fuso Europe/Lisbon) | spec |
| D7 | Comprovativo | Enviado **por WhatsApp** ao admin. **Sem upload de fotos** nesta fase | spec |
| D8 | Impacto no pack | Atividades extra **não** retiram/aumentam sessões, **não** alteram a % de utilização, **não** substituem PT | spec |
| D9 | Ordenação do ranking | (1) % do pack ↓ · (2) nº de atividades do mês ↓ · (3) Sequência LEAP ↓ · (4) desempate neutro (nome) | spec + brainstorm |
| D10 | Exceção "férias" | Cliente **sem pack ativo** (sem % para mostrar) é ordenado pelas atividades do mês, a seguir a quem tem % | brainstorm |
| D11 | PT "realizada" | Sessão com estado **`confirmed`** (presença), no passado. Canceladas/faltas não contam | assunção (a confirmar) |
| D12 | Sequência LEAP | Mantém-se **só-PT** (presença/faltas). Atividades extra **não** alteram a Sequência | assunção (a confirmar) |

### Decisão pendente (P1) — regra "0 PT com pack a meio"

Falta o teu veredicto: um cliente **com pack a meio (ex.: 75%)** que num mês só
fez cardio (0 PT nesse mês) —

- **(A) Recomendação adotada por defeito:** mantém-se ordenado pelos **75%** (a
  % é cumulativa, não zerou). A exceção de férias (D10) aplica-se **só** a quem
  não tem pack ativo.
- (B) Alternativa: sempre que há 0 PT no mês, o cliente "cai" para o grupo
  ordenado por atividades, mesmo com pack a meio.

Este documento assume **(A)**. Mudar para (B) só altera a query de ordenação
(1 `CASE`), não a estrutura.

---

## 3. Modelo de dados

### 3.1 Tabela nova: `activities`

```
activities
  id            uuid pk default gen_random_uuid()
  client_id     uuid not null  -> profiles(id) on delete cascade
  trainer_id    uuid not null  -> trainers(id)         -- scope do admin
  type          text not null  check (type in ('autonomous','cardio'))
  activity_date date not null                          -- dia a que se refere (= hoje no registo)
  status        text not null default 'pending' check (status in ('pending','validated','rejected'))
  created_at    timestamptz not null default now()
  decided_at    timestamptz                            -- quando foi validada/rejeitada
  decided_by    uuid          -> profiles(id)          -- admin que decidiu
```

Índices:
- `(trainer_id, status, activity_date desc)` — lista de validação do admin.
- `(client_id, activity_date desc)` — histórico e contagem mensal do cliente.
- `(trainer_id, status, activity_date)` — agregação para o leaderboard.

Notas:
- **Sem** FK/relação a `purchases`/`bookings`. Isolamento financeiro total (D8).
- `activity_date` guarda o dia; a contagem mensal usa `date_trunc('month', activity_date)`.
- Sem constraint de unicidade por dia (D5 — múltiplas por dia permitidas).

### 3.2 RLS

- **SELECT**: cliente vê as suas (`client_id = auth.uid()`); staff vê as do seu
  scope (`trainer_id` acessível via helper existente `getAccessibleTrainerIds`
  / `is_admin()`).
- **INSERT**: cliente insere só para si (`client_id = auth.uid()`), `status`
  forçado a `pending`, `activity_date` forçado a "hoje" no fuso do estúdio
  (validado no RPC, não confiar no cliente), `trainer_id` = trainer do cliente.
- **UPDATE (validar/rejeitar)**: só staff, via RPC `SECURITY DEFINER`.
- **DELETE**: nenhum pela app nesta fase (histórico preservado).

### 3.3 Migrações (aplicadas manualmente no SQL Editor — pasta gitignored)

- `0158_activities.sql` — tabela + índices + RLS + grants.
- `0159_activity_rpcs.sql` — `log_activity`, `decide_activity`, `get_client_activity_summary`.
- `0160_leaderboard_v2.sql` — reescrita de `get_leaderboard` (nova ordenação).

---

## 4. Modelo do Ranking (especificação de cálculo)

Para cada cliente (opt-in, do trainer), no mês de calendário corrente:

- `pack_pct` = `sessions_used / sessions_total` do **pack atual**
  (cumulativo, D2). Sem pack ativo → `null`.
  - `sessions_used`/`sessions_total`: usar a mesma noção de "pack atual" já
    existente no resumo do cliente (o que alimenta "Pack atual · 4/8" no
    dashboard). **Reutilizar**, não reinventar.
- `pt_done_month` = nº de `bookings` `confirmed` do cliente com `starts_at` no
  mês corrente (D11).
- `extra_validated_month` = nº de `activities` `validated` com `activity_date`
  no mês corrente.
- `activities_total` = `pt_done_month + extra_validated_month` (D3).
- `streak` = `get_client_streak` (existente).

**Ordenação** (D9 + D10, variante A de P1):

```
ORDER BY
  (pack_pct IS NULL) ASC,          -- quem tem pack ativo primeiro
  pack_pct DESC NULLS LAST,        -- 1) % do pack
  activities_total DESC,           -- 2) atividades do mês
  streak DESC,                     -- 3) Sequência LEAP
  full_name ASC                    -- 4) desempate neutro
```

Clientes sem pack ativo (`pack_pct IS NULL`) caem para o fim e ficam ordenados
entre si por `activities_total` (D10).

**Colunas do leaderboard (UI):** posição · nome próprio + inicial do apelido ·
`% do pack` · `nº atividades`. (Igual ao screenshot; substitui a coluna de
streak que existe hoje.) A Sequência LEAP continua a existir como dimensão e
critério de desempate, e é mostrada no perfil.

---

## 5. FASE 1 — Registo, validação e novo ranking

> **✅ CONCLUÍDA E EM PRODUÇÃO** (set/2026). Migrações aplicadas: 0158
> (tabela activities + RLS), 0159 (log_activity / decide_activity), 0160
> (get_leaderboard v2 + get_client_activity_summary). Todas as tarefas
> abaixo entregues e a compilar (`tsc` limpo). Decisões finais: P1 =
> variante B (0 PT no mês → ordenado por atividades); P2 = sessão PT
> realizada = marcada e já passada, exceto falta; P4 = validação como aba
> "Atividades" dentro do Ranking do admin.
>
> Entregue: botões Treinei/Cardio na Home + toast; validação Validar/Rejeitar
> no admin (aba Atividades, com contador de pendentes); ranking cliente+admin
> com colunas % Pack + Atividades; resumo de consistência no Perfil; aba
> Atividades no Histórico (com estado); "Como funciona" reescrito; card
> Ranking do dashboard com a posição.

**Meta:** cliente regista treino autónomo/cardio; admin valida; ranking passa a
usar % + atividades; histórico e perfil distinguem tipos. Sem ecrãs novos
dedicados.

### 5.1 Base de dados
- [ ] `0158_activities.sql`: tabela, índices, RLS, grants.
- [ ] `0159_activity_rpcs.sql`:
  - `log_activity(p_type text) returns uuid` — valida tipo, força `client_id`,
    `activity_date = hoje (Lisboa)`, `status = pending`, resolve `trainer_id`.
  - `decide_activity(p_id uuid, p_status text)` — só staff; `pending → validated|rejected`;
    grava `decided_at/by`.
  - `get_client_activity_summary(p_client uuid)` — devolve, para o mês corrente:
    `pt_done`, `autonomous_validated`, `cardio_validated`, `total`, e listas
    para histórico (com estado).
- [ ] `0160_leaderboard_v2.sql`: reescrita de `get_leaderboard` conforme §4,
  devolvendo `client_id, full_name, pack_pct, pt_done_month, extra_month,
  activities_total, streak, rank`. Mantém `SECURITY DEFINER`, mantém filtro
  opt-out (`leaderboard_opt_out`).

### 5.2 Cliente — Home (`app/app/dashboard/page.tsx`)
- [ ] Zona "A tua atividade extra" **integrada** (card no estilo atual), com dois
  botões: **[ Treinei hoje ]** e **[ Fiz cardio hoje ]**. Pequena, não invasiva.
- [ ] Componente cliente `components/activity-buttons.tsx` (ou em
  `app/app/dashboard/`): chama server action, mostra toast (padrão `leap_flash`)
  **"✓ Treino registado · Pendente de validação"** / **"✓ Cardio registado · …"**
  + linha fixa **"Envia o comprovativo por WhatsApp para validação."**
- [ ] Server action `logActivityAction(type)` → RPC `log_activity` +
  `revalidatePath`. Reutiliza o toaster existente.

### 5.3 Admin — validação (`app/admin/...`)
- [ ] Nova subpágina/aba de **atividades** (reutilizar layout de listas do admin,
  ex.: estilo das "Contas pendentes"): cada linha = nome + tipo + data + estado,
  botões **[ Validar ] [ Rejeitar ]**.
- [ ] Filtros mínimos: **Pendentes** (default) e **Histórico** (validadas/rejeitadas).
- [ ] Server actions `decideActivityAction(id, 'validated'|'rejected')` → RPC.
- [ ] Ponto de entrada no menu do admin (barra/"Mais") — reutilizar padrão de
  `bottom-nav`/`admin-layout` (como se fez com "Ranking").
- [ ] (Opcional, barato) contador de pendentes no destaque, à semelhança de
  "pagamento pendente" / "novos registos".

### 5.4 Ranking (existente, reescrever ordenação)
- [ ] `app/app/leaderboard/page.tsx`: passar a mostrar colunas **% do pack** e
  **atividades** (em vez de streak). Destaque da linha do próprio (já existe).
  Sem clique noutros clientes (já é o caso). Manter paginação 10/pág.
- [ ] `app/admin/leaderboard/page.tsx`: mesmas colunas; linhas continuam a ligar
  ao perfil do cliente (é admin, não é perfil público).
- [ ] Dashboard: card "Ranking" mantém-se; subtítulo passa a refletir
  "% do pack + atividades" e a posição.
- [ ] `app/app/leaderboard/como-funciona/page.tsx`: atualizar o texto para
  explicar % do pack + atividades + ordem (screenshot #5).

### 5.5 Histórico e perfil do cliente
- [ ] Histórico (`app/app/historico/…`): intercalar `bookings` com `activities`
  do cliente, distinguindo **Sessão PT / Treino autónomo / Cardio** e mostrando
  o **estado** quando aplicável (Validado / Pendente / Rejeitado). Ordenar por
  data desc.
- [ ] Resumo no Perfil (`app/app/perfil/…`): bloco com
  **Consistência do pack (%)**, **Atividade (total + repartição PT/autónomo/cardio)**,
  **Sequência LEAP (semanas)** e **Nível** — reutilizar `lib/streak.ts`.

### 5.6 Helpers TS
- [ ] `lib/activities.ts`: tipos + labels (LABEL/ícone por tipo e por estado),
  para reutilizar em histórico, perfil e admin.

### 5.7 Critérios de aceitação (Fase 1)
- Registar "Treinei hoje" cria 1 `activity` pendente; toast + nota WhatsApp.
- É possível registar 2+ atividades no mesmo dia; rejeitar não bloqueia novo registo (D5).
- Não é possível registar atividade com data ≠ hoje (validado no RPC) (D6).
- Validar torna a atividade contável no ranking; pendente/rejeitada **não** contam.
- Ranking ordena por % do pack → atividades → streak → nome (§4); linha do
  próprio destacada; sem clique em terceiros.
- Saldo/sessões do pack **inalterados** por qualquer registo/validação (teste de regressão).
- `npx tsc --noEmit` limpo.

---

## 6. FASE 2 — Ecrãs dedicados de progresso e atividades

> **✅ CONCLUÍDA** (set/2026). Migração 0161 (get_client_month_consistency).
> Ecrãs: `/app/progresso` ("O meu progresso" — pack atual, anel Consistência
> no mês, atividade validada PT/autónomo/cardio, Sequência + nível) e
> `/app/atividades` ("As tuas atividades" — lista combinada sessões+extras com
> filtros Mês/Todas/Pendentes e estados). Navegação: o card "Ranking" do
> dashboard abre "O meu progresso"; daí chega-se ao ranking e às atividades;
> a aba Atividades do Histórico tem link para a linha do tempo.
>
> **Consistência no mês (definição final):** por semana do mês — CONTA se houve
> PT realizada OU treino/cardio validado e SEM falta; falta faz a semana não
> ser cumprida; semanas sem nada previsto não entram. % = cumpridas ÷ relevantes.

**Meta:** os ecrãs do mockup que não são essenciais à mecânica.

### 6.1 "O meu progresso" (screenshot #3)
- [ ] Abas **Resumo · Sessões · Histórico**.
- [ ] "Pack atual" (visual claro, sem alterar lógica de saldo).
- [ ] Anel **"Consistência no mês"** (X/ N semanas do mês com PT sem falta) —
  **métrica nova de apresentação** derivada de `bookings` (a definir fórmula
  exata na Fase 2; não confundir com a Sequência LEAP de longo prazo).
- [ ] Blocos "Atividade validada" (PT / treinos / cardios) e "Sequência LEAP + nível".

### 6.2 "As tuas atividades" (screenshot #4)
- [ ] Lista de todas as sessões + atividades extra.
- [ ] Filtros **Mês atual · Todas · Pendentes**.
- [ ] Estados: **Realizada / Validado / Pendente / Falta** com as cores atuais.
- [ ] Nota informativa: "As atividades extra contam para o ranking, mas não
  gastam sessões do pack."

### 6.3 Critérios de aceitação (Fase 2)
- Navegação e estética idênticas ao resto da app; sem novas dependências.
- Nenhuma métrica nova altera a % do pack nem o saldo.

---

## 7. FASE 3 — Futuro / opcional (fora de âmbito imediato)

- Cap/anti-spam configurável de atividades por período (se o volume começar a
  distorcer o ranking apesar da validação manual).
- Notificação ao cliente quando a atividade é validada/rejeitada (reutilizar
  `notifications`).
- Upload de comprovativo na app (substituir WhatsApp) — só se pedido.

---

## 8. Regras de negócio (resumo normativo)

1. Registo só do próprio dia (Lisboa). (D6)
2. Sem limite de atividades por dia; rejeitada não bloqueia. (D5)
3. Pendente e rejeitada **não** contam para o ranking; só **validada** conta. (spec)
4. Atividades extra não alteram saldo, nº de sessões, % de utilização, nem
   substituem PT. (D8)
5. Ranking: % do pack (cumulativa) → atividades do mês (bruto) → Sequência →
   desempate neutro. (D9/D2/D3)
6. Sem pack ativo → ordenado por atividades, a seguir a quem tem %. (D10)
7. Sequência LEAP inalterada (só-PT). (D12)

---

## 9. Casos extremos

- **Sem pack ativo** (acabou, sem novo): `pack_pct = null` → §4/D10.
- **Pack novo com 0 usadas**: `pack_pct = 0%`. (Com D2 cumulativa, é o estado
  real; sobe à medida que usa.)
- **Múltiplos packs simultâneos**: usar a definição de "pack atual" já existente
  no resumo do cliente (fonte única de verdade).
- **Cliente opt-out do ranking**: não aparece no leaderboard (flag existente),
  mas continua a poder registar atividades e a vê-las no seu histórico/perfil.
- **Fuso horário**: "hoje", "mês" e "semana" sempre em Europe/Lisbon (como já
  fazem `get_client_streak`/agenda).
- **Atividade validada num mês seguinte ao `activity_date`**: conta no mês do
  `activity_date` (a atividade "pertence" ao dia em que foi feita). (D... §4)

---

## 10. Verificação e testes

- [ ] `npx tsc --noEmit` limpo em cada fase.
- [ ] Teste de regressão de saldo: registar+validar N atividades e confirmar por
  SQL que `purchases.sessions_remaining` e `bookings` ficam **inalterados**.
- [ ] Teste de ordenação com o exemplo do brief:
  - Cliente A: pack 8, 8/8 (100%), +3 autónomos +2 cardios → total 13.
  - Cliente B: pack 12, 12/12 (100%), +0 → total 12.
  - Esperado: **A à frente de B** (empate a 100%, 13 > 12). ✅
- [ ] Teste de férias: cliente sem PT no mês mas com pack a 75% → mantém 75%
  (variante A). Cliente sem pack ativo com 6 cardios → ordenado por atividades.
- [ ] RLS: cliente não vê atividades de terceiros; não consegue inserir com data
  ≠ hoje nem `status` ≠ pending; não consegue validar.

---

## 11. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Gaming por volume (sem cap por dia) | Validação manual do admin é o travão; Fase 3 pode acrescentar cap |
| Tocar sem querer no saldo do pack | Isolamento total: `activities` sem FK a purchases/bookings; teste de regressão |
| Redesenhar demasiado a Home | Zona pequena com 2 botões, componentes/estilos atuais |
| Ordenação confundir utilizadores | Ecrã "Como funciona?" atualizado (screenshot #5) |
| Migrações gitignored aplicadas fora de ordem | Numeração sequencial 0158→0160 + nota de "correr por ordem" |

---

## 12. Perguntas em aberto (para fechar antes do GO da Fase 1)

- **P1** (§2): regra "0 PT com pack a meio" — confirmar variante **A** (recomendada) ou **B**.
- **P2** (D11): "PT realizada" = estado `confirmed`. Confirmar.
- **P3** (D12): Sequência mantém-se só-PT (cardio de férias **não** salva a semana). Confirmar.
- **P4**: ponto de entrada da validação no admin — subpágina própria (ex.:
  `/admin/atividades`) ou aba dentro de uma página existente? (recomendo página própria)

---

## 13. Ficheiros previstos (mapa de impacto — Fase 1)

**Novos**
- `supabase/migrations/0158_activities.sql`
- `supabase/migrations/0159_activity_rpcs.sql`
- `supabase/migrations/0160_leaderboard_v2.sql`
- `lib/activities.ts`
- `components/activity-buttons.tsx` (cliente)
- `app/admin/atividades/page.tsx` (+ `actions.ts`)

**Alterados**
- `app/app/dashboard/page.tsx` (zona de atividade extra)
- `app/app/leaderboard/page.tsx` (colunas % + atividades)
- `app/app/leaderboard/como-funciona/page.tsx` (texto)
- `app/admin/leaderboard/page.tsx` (colunas)
- `app/app/historico/…` (intercalar atividades + estados)
- `app/app/perfil/…` (resumo de atividade)
- `components/bottom-nav.tsx` / `app/admin/layout.tsx` (entrada "Atividades")
- `lib/streak.ts` só se for preciso um label/nível novo (evitar tocar na lógica)

> **Governança:** cada fase só arranca após aprovação explícita neste documento.
> Ao concluir uma fase, marcar as checkboxes e registar o commit correspondente.
