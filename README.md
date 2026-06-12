# LEAP-FITNESS STUDIO · Portal

Portal próprio da LEAP-FITNESS STUDIO — agenda, packs, créditos automáticos, pagamentos.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind · Supabase (Postgres + Auth) · IfthenPay (MB Way, Multibanco, Cartão)

---

## Setup local

### 1. Pré-requisitos
- Node.js 20+
- Conta no Supabase (gratuita) → https://supabase.com
- (Opcional, fase 2) Conta no IfthenPay → https://ifthenpay.com

### 2. Instalar dependências
```bash
npm install
```

### 3. Criar projeto Supabase
1. Vai a https://app.supabase.com → **New project**.
2. Define password forte, escolhe região **West EU (Ireland)** ou **Frankfurt**.
3. Quando estiver pronto: **Project Settings → API**. Copia:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (mantém secreto)

### 4. Correr as migrations
No painel Supabase → **SQL Editor** → cola e corre por esta ordem:
1. `supabase/migrations/0001_initial_schema.sql`
2. `supabase/migrations/0002_functions.sql`
3. `supabase/migrations/0003_rls_policies.sql`
4. `supabase/migrations/0004_seed_defaults.sql`

### 5. Criar o utilizador "João" (PT)
1. **Authentication → Users → Add user**.
2. Email: `joao@leap-fitness.pt` (ou outro), password forte, **confirma email automaticamente**.
3. Vai ao **SQL Editor** e corre:
```sql
select bootstrap_trainer('joao@leap-fitness.pt', 'João', 'joao');
```
Isto cria o trainer, settings, horários default (seg–sex 7h–21h, sáb 8h–13h) e os 8 packs do PDF.

### 6. Variáveis de ambiente
```bash
cp .env.example .env.local
```
Preenche `.env.local` com os valores acima. Por agora deixa **IFTHENPAY_ENABLED=false**.

### 7. Correr
```bash
npm run dev
```
Abre http://localhost:3000.

---

## Como funciona o sistema de créditos

1. Cliente compra pack → cria `purchase` em `awaiting_confirmation` (manual) ou `pending_payment` (gateway).
2. Admin confirma o pagamento (ou webhook IfthenPay confirma automaticamente) → função `confirm_purchase()` regista crédito inicial.
3. Cliente marca sessão → `create_booking()` valida créditos, disponibilidade, sobreposição, janela de cancelamento.
4. Admin confirma presença → `confirm_booking_attendance()` desconta 1 crédito e regista em `credit_transactions`.
5. Quando atinge limite baixo (default 2) → notificação automática.
6. Quando chega a 0 → cliente fica bloqueado para novas marcações.

Tudo o que afeta créditos passa por funções `SECURITY DEFINER` em Postgres com audit em `credit_transactions` e `audit_log`.

---

## Ativar IfthenPay (quando aprovado)

1. No backoffice IfthenPay copia:
   - Chave MB Way
   - Chave Multibanco
   - Chave Cartão
   - **Anti-Phishing Key** (gera em Definições → Chaves)
2. Edita `.env.local`:
```env
IFTHENPAY_ENABLED=true
IFTHENPAY_MBWAY_KEY=...
IFTHENPAY_MULTIBANCO_KEY=...
IFTHENPAY_CCARD_KEY=...
IFTHENPAY_ANTI_PHISHING_KEY=...
IFTHENPAY_CALLBACK_URL=https://teu-dominio.com/api/webhooks/ifthenpay
```
3. No backoffice IfthenPay configura o **callback URL** apontado para `https://teu-dominio.com/api/webhooks/ifthenpay`, incluindo a anti-phishing key como parâmetro `key`.
4. Faz redeploy. Os clientes passam a ver os 3 métodos automáticos em `Comprar pack`.

Não precisas mudar código nenhum.

---

## Deploy (Vercel)

1. `git init && git remote add origin <repo>`
2. https://vercel.com/new → importa o repo.
3. **Environment Variables** → copia tudo do `.env.local`.
4. Deploy.

Adiciona o domínio (`portal.leap-fitness.pt`) em Vercel → **Domains**.

---

## Áreas

### Cliente (`/app/*`)
- `/app/dashboard` — créditos, avisos, próximas sessões
- `/app/agenda` — marcação (dia → duração → tipo → slot)
- `/app/comprar` — packs + escolha de método de pagamento
- `/app/historico` — sessões + compras
- `/app/perfil` — dados pessoais
- `/app/notificacoes` — caixa de notificações

### Admin (`/admin/*`)
- `/admin/dashboard` — KPIs (receita mês, clientes, sessões hoje, alertas)
- `/admin/agenda` — vista semanal, confirmar presença, falta, cancelar
- `/admin/clientes` — listagem com pesquisa, ficha do cliente, ajuste manual de créditos
- `/admin/pagamentos` — confirmar/rejeitar compras pendentes
- `/admin/packs` — CRUD de packs e preços
- `/admin/relatorios` — KPIs por período, exportar CSV
- `/admin/definicoes` — slots, durações, validades, horários, bloqueios

---

## Fase 2 (próximos passos)

- Notificações email/SMS (Resend + integrar SMS provider — vimeSMS / Twilio / IfthenPay SMS)
- Push notifications via web push
- Onboarding de clientes existentes (importar lista da Fresha)
- Branding final (logo definitivo, tipografia, ícones definitivos)
- Reagendamento direto pelo cliente
- Multi-trainer (já suportado no schema, falta admin UI completa para gerir equipa)
- **Workflow de cancelamento pelo trainer** — quando o trainer cancela uma marcação,
  deve abrir um diálogo a pedir o motivo (texto livre). O cliente recebe email + push
  com o motivo + um CTA "Reagendar". Hoje, depois do fix 0019, o cancelamento funciona
  mas o cliente não é informado proactivamente do motivo nem orientado para reagendar.
- **Regerar `types/database.ts` a partir do Supabase** — actualmente os tipos
  estão escritos à mão e ficaram desalinhados com versões recentes do
  `@supabase/postgrest-js` (v2.108 exige `Relationships: []` por tabela e
  mudou o shape do schema). Corrida única no terminal:
  `npx supabase gen types typescript --project-id <id> > types/database.ts`.
  Depois remover `typescript.ignoreBuildErrors` em `next.config.mjs`.

---

## Estrutura do projeto

```
app/
  (público) page.tsx, login, registar, recuperar, auth/
  app/      área cliente (dashboard, agenda, comprar, historico, perfil, notificacoes)
  admin/    área admin (dashboard, agenda, clientes, pagamentos, packs, relatorios, definicoes)
  api/      webhooks/ifthenpay, relatorios/export
components/  bottom-nav, top-bar
lib/         supabase clients, credits, availability, ifthenpay, utils
supabase/migrations/  0001 schema · 0002 funções · 0003 RLS · 0004 seed
types/database.ts  tipos TS
public/      manifest.json, sw.js, icons/
```
