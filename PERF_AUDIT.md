# LEAP — Performance Audit (stable baseline)

**Date:** 2026-06-17 (last update)
**Method:** Full read of routing, data layer, middleware, client components, build
config. Baseline `next build` + Lighthouse not captured this run — see "Baseline
limitation" below.
**Scope:** Speed / rendering / resource use only. No feature work.

> ## How to use this file
> This is a **living inventory**, not a one-shot highlight reel. The reason earlier audits
> kept surfacing a *different* "critical bottleneck" each run is that the prompt asked for
> *the biggest* problems and a short list — so each pass ranked and reported only the top
> few, and which few rose to the top varied run to run (fresh exploration each time, no
> memory between runs, normal model non-determinism).
>
> To stop that: keep **every** finding here with a fixed ID, a severity, and a status. On
> future audits, *update this file* (flip `Status`, add new rows) rather than regenerating.

**Severity:** 🟥 Critical · 🟧 High · 🟨 Medium · 🟦 Low / quick win
**Status:** `OPEN` · `IN PROGRESS` · `FIXED` · `ACCEPTED` (known trade-off) · `CANCELLED` (investigated, not worth doing) · `SKIPPED` (low value / small risk, left alone)

---

## Baseline limitation — this run

`next build` and `tsc --noEmit` could not be executed in the audit sandbox because
`node_modules/next/*.d.ts` contained NUL-padded byte ranges (corrupted partial copy from
the Windows host). The TS errors at `node_modules/next/index.d.ts:20` are not real source
errors — running `npm install` on the host clears them. **All findings below are grounded
in source reads with file/line refs, not build output.** Re-run `next build` locally and
record the bundle/route table here to make future deltas measurable.

---

## Progress log — 2026-06-17

- **P-04 — committed and shipped.** Commit `7aa3bcf` ("perf(auth): validate JWT locally via
  getClaims() in getCurrentProfile (P-04)").
- **P-05 — committed and shipped.** Commits `b8bbc53` + `fc1c56a` ("perf(dashboard): aggregate
  admin KPIs in Postgres via get_dashboard_kpis RPC (P-05)"). Migration `0084` is in tree.
  Fallback path retained so an out-of-order deploy can't break the dashboard.
- **New findings — appended (P-13 through P-26).** They are mostly the same class of fix
  as the previously closed items (DB-side aggregation, parallelize independent reads,
  trim `select("*")` payloads, hot-path GoTrue round-trips) — applied to pages that the
  earlier sweeps didn't reach.
- **Editor hazard from the 2026-06-16 run is still present** — keep avoiding `eslint --fix`
  and editor format-on-save in this folder until that's understood.

---

## Progress log — 2026-06-16

Actions taken this session, and *why* the plan changed after deeper checks:

- **P-02 — FIXED & shipped.** Moved the empty-banners guard below all hooks in
  `components/promo-carousel.tsx`. Verified: type-check clean, lint no longer reports the
  rules-of-hooks error. Committed and pushed to `main`.
- **P-04 — done in code, awaiting commit.** Investigation found the project is **already on
  ES256 asymmetric JWTs** (the JWKS endpoint publishes an EC P-256 signing key), so the
  middleware's `getClaims()` already validates locally — no round-trip there. The real
  remaining cost was `getCurrentProfile()` calling `getUser()` (a GoTrue round-trip) on
  **every authenticated page load**, via both layouts. Switched it to local `getClaims()`
  validation (same pattern the middleware uses). Type-check clean; MFA flow keeps strict
  `getAuthUser()`. *The "migrate to RS256" idea in the original P-04 was unnecessary — you
  were already on asymmetric keys.*
- **P-05 — done in code, needs migration + commit.** Added migration
  `0084_perf_dashboard_kpis.sql` (a `SECURITY INVOKER` RPC that aggregates
  revenue / packs / pending / per-status session counts / distinct active
  clients in one round-trip) and switched `app/admin/dashboard/page.tsx`
  `Kpis()` to call it, **with a fallback to the old fetch+JS path** so a
  mis-ordered deploy can't break the dashboard. Type-check clean; math
  verified identical to the old code. *Apply the migration first, then push.*
- **P-01 — CANCELLED after investigation.** It is **not** a small/clean fix. All-route
  dynamic rendering is driven by the **nonce-based CSP** itself (a fresh per-request nonce
  must be read for scripts to run), not just the one `headers()` line. Making routes static
  would require dropping the nonce for a weaker CSP — a real security regression. The repo's
  own comment in `lib/public-trainer.ts` already reached this conclusion. Declined.
- **P-03 — DEFERRED.** Re-enabling ESLint in the build requires a clean `lint` first, but
  `eslint --fix` in this repo has a bug that **truncates files** and flips line endings
  (it corrupted `promo-carousel.tsx` mid-session; recovered from git). Until that tooling
  bug is understood, do **not** run `lint --fix` here. Left `eslint.ignoreDuringBuilds` as-is.
- **P-08 / P-09 / P-10 — SKIPPED.** Cosmetic / marginal value with a small risk of
  unintended visual change (e.g. dropping "Inter" changes rendering for users who have the
  font locally). Left untouched in keeping with "don't change what already works."

> ⚠️ **Environment hazard noted:** the editor's format/lint-on-save on this folder rewrites
> files on every save and has truncated files twice. Recommend disabling format/lint-on-save
> for this project until fixed. Edits this session were applied via shell to avoid it.

---

## Findings index

| ID    | Sev | Area               | Title                                                                                | Status                                     |
|-------|-----|--------------------|--------------------------------------------------------------------------------------|--------------------------------------------|
| P-01  | 🟥  | Rendering          | Root layout `headers()` / nonce-CSP forces whole app into dynamic SSR                | CANCELLED                                  |
| P-02  | 🟥  | Correctness/Render | `promo-carousel.tsx` Rules-of-Hooks violation                                        | FIXED                                      |
| P-03  | 🟧  | Build hygiene      | `eslint.ignoreDuringBuilds: true` ships bugs / hides regressions                     | DEFERRED                                   |
| P-04  | 🟧  | Edge/Auth          | `getCurrentProfile()` did a GoTrue round-trip (`getUser`) on every page              | FIXED                                      |
| P-05  | 🟧  | Data               | Admin dashboard KPIs over-fetch rows and aggregate in JS                             | FIXED                                      |
| P-06  | 🟨  | Data               | Client dashboard "BelowFold" fetches full rows to compute counts                     | OPEN                                       |
| P-07  | 🟨  | UX/CLS             | Promo banner computes `aspect-ratio` from `onLoad` → layout shift                    | OPEN                                       |
| P-08  | 🟨  | Assets             | `font-family: Inter` declared but no font is loaded (dead intent)                    | SKIPPED                                    |
| P-09  | 🟦  | Images             | Above-the-fold images lack `priority` / explicit `sizes` audit                       | SKIPPED                                    |
| P-10  | 🟦  | Edge               | API routes could declare `runtime`/`revalidate` explicitly                           | SKIPPED                                    |
| P-11  | 🟦  | Realtime           | `NotificationBell` realtime + poll + immediate refresh redundancy                    | ACCEPTED                                   |
| P-12  | 🟦  | Data               | `listMyNotes` `IN (bookingIds)` can grow unbounded                                   | OPEN                                       |
| P-13  | 🟧  | Edge/Auth          | `/app/notificacoes` and `/admin/notificacoes` still call `supabase.auth.getUser()`   | OPEN                                       |
| P-14  | 🟨  | Data               | Duplicate "mark notifications read" — layout + page both run the UPDATE              | OPEN                                       |
| P-15  | 🟨  | Data               | `/admin/relatorios` aggregates in JS and is **not scoped to the trainer**            | OPEN                                       |
| P-16  | 🟨  | Data               | `/app/comprar` serial `await getActiveTrainersPublic()` then `getTrainerForClient()` | OPEN                                       |
| P-17  | 🟨  | Data               | `/admin/notas` index fetches up to 500 notes and group-bys in JS                     | OPEN                                       |
| P-18  | 🟨  | Data               | `/admin/clientes/[id]` uses `select("*")` on purchases + bookings                    | OPEN                                       |
| P-19  | 🟨  | Data               | `/admin/clientes/[id]` waterfalls 3 round-trips that can run as 1 parallel batch     | OPEN                                       |
| P-20  | 🟧  | Edge/Data          | Engagement cron pulls ALL confirmed purchases + N×2 serial per-client awaits         | OPEN                                       |
| P-21  | 🟨  | Edge/Data          | Reminders cron is a serial per-booking loop with 4 awaits each                       | OPEN                                       |
| P-22  | 🟦  | Data               | `getAvailableSlots` has 3 sequential `Promise.all` batches; last two can merge       | OPEN                                       |
| P-23  | 🟦  | Bundle             | `InstallPrompt` in root layout — client JS ships on landing + auth + `/t/<slug>`     | OPEN                                       |
| P-24  | 🟦  | Build hygiene      | `experimental.serverComponentsExternalPackages` renamed in Next 15+                  | OPEN                                       |
| P-25  | 🟦  | Assets             | `/images/logo.png` 28 KB rendered at 44×44 in every TopBar                           | OPEN                                       |
| P-26  | 🟦  | Images             | `/admin/loja` product `<Image>` 64×64 lacks `sizes` → wider srcset than needed       | OPEN                                       |

---

## 🟥 Critical

### P-01 — Nonce-based CSP forces app-wide dynamic rendering — CANCELLED
**Files:** `app/layout.tsx`, `lib/security-headers.ts`, `middleware.ts`
**What:** `script-src` uses `'nonce-<per-request>' 'strict-dynamic'`. A fresh nonce must be
generated and read on every request for scripts to be allowed to execute, which is
fundamentally incompatible with static rendering / Full Route Cache / ISR. The `headers()`
call in the root layout is a symptom, not the sole cause — removing it alone would break the
service-worker script while everything stayed dynamic.
**Why cancelled:** the only way to make routes static is to drop the nonce and adopt a weaker
CSP (`'unsafe-inline'` or a brittle hash setup) — a genuine security regression. The codebase
already documents this trade-off (`lib/public-trainer.ts`). Not worth weakening security, and
a CSP change can't be safely verified without a browser on a preview deploy anyway.
**Better lever instead:** since rendering stays dynamic, make each dynamic render cheap →
that's what P-04 does (removes the per-request auth round-trip) and P-05/P-06 (cheaper queries).

### P-02 — Rules-of-Hooks violation in the promo carousel — FIXED
**File:** `components/promo-carousel.tsx`
The early `if (!banners.length) return null;` sat *between* `useRef` and `useEffect`, so an
empty `banners` rendered fewer hooks than a populated one. Moved the guard below all hooks.
This was also the lone real error forcing `eslint.ignoreDuringBuilds` (see P-03).
**Verified:** type-check clean; lint no longer flags it. **Committed & pushed.**

---

## 🟧 High

### P-03 — ESLint disabled during builds — DEFERRED (tooling hazard)
`next.config.mjs` keeps `eslint: { ignoreDuringBuilds: true }`. The remaining lint errors are
~20 cosmetic `react/no-unescaped-entities` (PT quotes). Re-enabling requires a clean lint
first, but **`eslint --fix` truncates files in this repo** — a real tooling bug that must be
resolved before touching lint here. Fix the quote escapes *by hand* (not `--fix`) later, then
remove the flag. Left as-is for safety.

### P-04 — Per-request auth round-trip on every authenticated page — FIXED
**File:** `lib/supabase/server.ts`
`getCurrentProfile()` (run in both `app/app/layout.tsx` and `app/admin/layout.tsx`, i.e. every
authenticated navigation) called `getAuthUser()` → `supabase.auth.getUser()`, a network
round-trip to GoTrue. The project is on **ES256 asymmetric keys**, so the JWT can be verified
**in-process** with `getClaims()` (no network) — the same approach the middleware already uses.
Added a `getClaimsUser()` helper and switched `getCurrentProfile()` to it.
**Trade-off (accepted):** `getClaims()` trusts a cryptographically-valid token until it expires,
so server-side revocation (sign-out elsewhere / ban) can lag up to the access-token TTL. Mitigated
by (1) `role` re-read from `profiles` each request → admin demotion caught live; (2) MFA/security
flows keep strict `getAuthUser()`. **Committed:** `7aa3bcf`.
**Note:** the original "migrate to RS256" framing was moot — the project was already asymmetric.

### P-05 — Admin dashboard KPIs aggregate in JS over full row sets — FIXED
**File:** `app/admin/dashboard/page.tsx → Kpis()` ; **Migration:** `supabase/migrations/0084_perf_dashboard_kpis.sql`
`monthBookings` used to select `status, client_id` for every booking in the month across all
in-scope trainers, then loop in JS (status counts + active-clients `Set`). Same for revenue
reduce. Replaced with `get_dashboard_kpis(p_trainer_ids, p_month_start, p_month_end)` RPC —
one round-trip, zero rows transferred. **Fallback retained** so a misordered deploy can't break
the dashboard. **Committed:** `b8bbc53` + `fc1c56a`.

### P-13 — `/app/notificacoes` and `/admin/notificacoes` still call `supabase.auth.getUser()` — OPEN
**Files:** `app/app/notificacoes/page.tsx:8`, `app/admin/notificacoes/page.tsx:7`
Both pages start with `const { data: { user } } = await supabase.auth.getUser();`. That is a
**network round-trip to the Supabase auth server** on every notification-page render — the
exact thing P-04 took out of the layouts. The fix is one-line: replace with `await
getSessionUser()` (or `await getClaimsUser()` if you want claim-level data) from
`@/lib/supabase/server`.
**Impact:** one extra GoTrue RTT (≈30–80 ms cold path) per visit to the notifications page,
on top of the middleware's already-cached claims. The notifications page is also the target
of every notification CTA, so it's hit more often than its name suggests.
**Verify:** flame chart shows the GoTrue call disappear; the page's HTML still streams under
the layout's existing `getCurrentProfile()` ≤ 1 ms cache hit.

### P-20 — Engagement cron does a full table scan + per-client serial work — OPEN
**File:** `app/api/cron/engagement/route.ts:60–154`
Two perf problems compounding:
1. `supabase.from("purchases").select("client_id, sessions_remaining, expires_at").eq("status",
   "confirmed")` — **no other filter**. Returns every confirmed purchase in the entire system
   to compute per-client totals in JS. Grows linearly with revenue history; will eventually
   blow the function's memory and is already wasted bandwidth.
2. Then a `for (const c of lowClients)` loop that, **per client**, runs two SERIAL awaits:
   `last booking (credit_charged=true)` and `engagement_alerts cooldown`. For N low-credit
   clients that's 2N round-trips serialized. With `maxDuration: 60`, this is the function's
   ceiling.
**Fix:**
- Replace the totals scan with an RPC `get_low_credit_clients(threshold, since_charged_at)`
  that returns `(client_id, total_remaining, last_charged_at, last_alert_at_threshold)` in
  one round-trip, doing the totals, the last-charged join and the cooldown check in SQL.
- The remaining per-client work (insert engagement_alerts + notification) can run with
  `Promise.allSettled` capped to e.g. 8 concurrent — push throughput is gated by Resend
  rate-limits, not by Supabase.
**Verify:** before/after, count `pg_stat_statements` calls during one cron run; payload size
of the purchases scan should drop to 0.

---

## 🟨 Medium

### P-06 — Client dashboard counts via full-row fetches — OPEN
`app/app/dashboard/page.tsx` → `BelowFold()` fetches `status` / `ends_at` rows to count in JS.
Convert to DB-side counts. Lower priority (single client's pack, small row sets). Pairs with P-05.

### P-07 — Promo banner causes layout shift (CLS) — OPEN
`components/promo-carousel.tsx → PromoCard` derives desktop height from the image ratio read in
`onLoad`, so the slide resizes after load. Reserve the box with a fixed `aspect-[3/1]` (or known
dimensions from the DB record).

### P-08 — Declared font never loaded — SKIPPED
`app/globals.css` names `Inter` first but no font is loaded (silent fallback to system-ui).
Perf-wise harmless. Left alone: dropping it would change rendering for users who have Inter
installed locally — not worth the cosmetic churn.

### P-14 — Duplicate "mark notifications read" UPDATE — OPEN
**Files:** `app/app/layout.tsx:24–30` + `app/app/notificacoes/page.tsx:34–39` (same shape in
the admin variants).
The layout already runs `UPDATE notifications SET read_at = now() WHERE user_id=... AND read_at
IS NULL` when `headers().get("x-pathname")` starts with the notifications path. The page then
runs **the same UPDATE again** before rendering. Even on the second call (no rows to update),
Postgres still acquires the lock and writes a tombstone in the index of the partial index.
**Fix:** delete the second UPDATE from both pages. The layout call is the canonical place;
keeping it means the badge resets before the page even streams.

### P-15 — `/admin/relatorios` aggregates in JS and is **not scoped to the trainer** — OPEN
**File:** `app/admin/relatorios/page.tsx:75–96 (ReportStats)`
- Pulls every confirmed purchase + every booking in the date range with no `.in("trainer_id",
  scope)` filter. Layout already requires staff role, but a `trainer` (non-owner) sees the
  **whole studio's numbers** here — that's both a correctness/data-leak issue (similar to the
  pagamentos search S-issue) and a perf issue (full system payload).
- Aggregates in JS — same pattern as P-05 before the fix.
**Fix:** add a `get_report_stats(p_trainer_ids, p_from, p_to)` RPC that returns
`(revenue_cents, packs_sold, credits_bought, sessions_confirmed, no_shows, cancellations)` in
one row. Pass `getAccessibleTrainerIds()`. Pair the SQL change with the SECURITY_AUDIT fix.

### P-16 — `/app/comprar` serial waterfall on trainer resolution — OPEN
**File:** `app/app/comprar/page.tsx:15–17`
```ts
const actives = await getActiveTrainersPublic();
const preselected = searchParams.trainer ?? (await getTrainerForClient(user.id));
```
`getTrainerForClient` is awaited **after** `getActiveTrainersPublic` even though it doesn't
depend on it. `/app/agenda` already parallelizes this exact pair (see lines 55-58). Copy the
same `Promise.all` pattern. Saves one round-trip on the common path (no `?trainer=` query).

### P-17 — `/admin/notas` index over-fetches and groups in JS — OPEN
**File:** `app/admin/notas/page.tsx:110–129`
`listMyNotes({ limit: 500, include: "meta" })` is used solely to compute a count + last-seen
per client and render at most **10** cards. With volume the 500-cap drops clients from the
index; with low volume it still ships hundreds of rows for ≤10 cards.
**Fix:** add an RPC `notes_clients_index(p_trainer_id, p_q, p_limit)` returning
`(client_id, full_name, email, phone, count, last_at)` ordered by `last_at DESC`, supports the
`q` search server-side. Drops payload by an order of magnitude and fixes the silent 500-cap.

### P-18 — `/admin/clientes/[id]` `select("*")` on purchases and bookings — OPEN
**File:** `app/admin/clientes/[id]/page.tsx:33–42`
`purchases.*` includes `pack_snapshot` (JSON, can be a few KB each) plus columns the page
never reads (`stripe_*`, `confirmed_by/at`, `rejected_reason`, `cancelled_*`, …). `bookings.*`
ditto (`cancellation_reason`, `series_id`, `credit_charged`, etc.).
**Fix:** restrict the columns to those actually consumed:
```ts
.select("id, status, amount_cents, sessions_remaining, sessions_total, pack_snapshot, created_at")
.select("id, starts_at, ends_at, session_type, status")
```
Mirrors the same trim already done in `/app/historico` (CB-5).

### P-19 — `/admin/clientes/[id]` has a 3-step waterfall that can be 1 batch — OPEN
**File:** `app/admin/clientes/[id]/page.tsx:27–58`
The page resolves data in **3 sequential rounds**:
1. trainerIds + credits + purchases + bookings (parallel)
2. await first → `getClientNotesMapForBookings(...)` (serial, alone)
3. then `packs + notesMap` (parallel)
Steps 2 and 3 both depend only on `bookings.map(b => b.id)` (and `packs` depends on `trainerIds`,
which resolves earlier). Restructure as:
1. trainerIds + credits + purchases + bookings + packs (all parallel — packs doesn't need
   bookings)
2. once bookings resolves, run `Promise.all([getMyNotesMapForBookings, getClientNotesMapForBookings])`.
Saves 1 RTT on every client detail page.

### P-21 — Reminders cron serializes 4 awaits per booking — OPEN
**File:** `app/api/cron/reminders/route.ts:128–167`
Each booking does (sequentially): claim+email client → claim+inApp client → claim+email
trainer → claim+inApp trainer. With N bookings in the 24h window that's 4N serial round-trips,
each ≥1 RTT to Supabase plus Resend latency. `maxDuration: 60` puts a hard cap at maybe ~200
bookings/run on a good day.
**Fix:** run the per-booking work as `Promise.allSettled` with a bounded `pLimit` (8). Even
better, replace the 4 individual claim INSERTs with one RPC `claim_reminders(booking_ids[],
recipient_channel_pairs)` that does all the dedup in SQL and returns the set that was
actually claimed — then `notifications` and `sendEmail` only fan out for those.

### P-22 — `getAvailableSlots` has an unnecessary serial batch boundary — OPEN
**File:** `lib/availability.ts:70–137`
Three sequential `Promise.all` batches: (avail + settings) → early-return on empty avail →
(bookings + blocks) → (recurring + skips). Batches 2 and 3 don't depend on each other; merge
into a single `Promise.all` after the short-circuit. Saves one RTT per `/api/slots` call —
this endpoint is called every time a client switches day in the booking flow.

### Currently fixed/skipped Medium-severity items
P-08 stays SKIPPED. No new Mediums beyond P-13..P-19, P-22 added.

---

## 🟦 Low / quick wins

### P-09 — Image priority hints — SKIPPED (marginal)
Above-the-fold images could set `priority` and audited `sizes`. Low value; left alone.

### P-10 — Explicit runtime/revalidate on API routes — SKIPPED (marginal)
`force-dynamic` cron/push/feed routes are correct; declaring `runtime`/`revalidate` explicitly is
nice-to-have, not impactful.

### P-11 — NotificationBell redundancy — ACCEPTED
Realtime + 120s background-paused poll + mount refresh is deliberate belt-and-suspenders; cheap. Leave.

### P-12 — `listMyNotes` `IN (bookingIds)` can grow large — OPEN
`lib/notes.ts:51–80`: unbounded `IN (...)` for clients with many bookings. Cap it, or filter server-side
via join/RPC. Low urgency.

### P-23 — `InstallPrompt` rendered from root layout — OPEN
**File:** `app/layout.tsx:78`
The component is a client component that only does anything in authenticated PWA contexts,
but it's rendered from the **root** layout. The chunk + its hydration work loads on every
public page: landing `/`, `/login`, `/registar`, `/recuperar`, `/t/<slug>`, `/offline`,
`/auth/*`. Move into `app/app/layout.tsx` and `app/admin/layout.tsx`. Saves a small client
chunk on the unauthenticated entry points (where the install prompt is least useful anyway).

### P-24 — `serverComponentsExternalPackages` is the old name — OPEN
**File:** `next.config.mjs:52`
Next 15 promoted `experimental.serverComponentsExternalPackages` to top-level
`serverExternalPackages`. The repo is on `next: ^16.2.9`. The old key still works but emits a
deprecation warning on every build and is on track to be removed. One-line rename:
```ts
// before
experimental: { serverComponentsExternalPackages: ["exceljs", "web-push", "@supabase/supabase-js"] }
// after
serverExternalPackages: ["exceljs", "web-push", "@supabase/supabase-js"],
```

### P-25 — Logo PNG is 28 KB for a 44×44 render — OPEN
**Files:** `public/images/logo.png` (28 060 bytes), `components/top-bar.tsx:42` and
`app/page.tsx:17`.
The PNG is rendered at 44×44 (mobile/desktop TopBar) and 36–40 px on the landing. A 64-square
PNG-with-WebP fallback would be ≈3–5 KB; an inline SVG of the wordmark would be ~1 KB and
benefit from `currentColor` (kills the `dark:invert` hack). The image is on every
authenticated screen, so this is bytes per session-start, not bytes once.

### P-26 — `/admin/loja` product `<Image>` lacks `sizes` — OPEN
**File:** `app/admin/loja/page.tsx:74–80`
`<Image width=64 height=64 ...>` with no `sizes` makes next/image generate a wide default
srcset (8 candidates from 640 up). Add `sizes="64px"` — the optimizer will then only ship the
1x/2x variants needed for a 64-square cell.

---

## What's already done well (don't re-flag as new)

- Above-the-fold `<Suspense>` streaming on dashboards and agenda.
- `Promise.all` fan-out in the hot paths (dashboard, admin agenda, /app/agenda) — no waterfalls
  left in those routes.
- `React.cache()` dedup on `getSessionUser` / `getClaimsUser` / `getCurrentProfile` / credits
  per request.
- `unstable_cache` (Data Cache) on `getPublicTrainerBySlug` and `getActiveTrainersPublic` with
  proper tags + `revalidateTag` invalidation hooks.
- **ES256 asymmetric JWTs** → middleware validates locally; now `getCurrentProfile` too (P-04).
- Middleware also caches `getClaims()` result for 30 s keyed by cookie fingerprint (CB-2),
  collapsing N round-trips from prefetches into 1.
- Cron/webhook/push paths skip the middleware's `getClaims()` entirely (C1).
- Server-only heavy deps (`exceljs`, `web-push`, supabase) externalized from serverless bundles
  — though under the deprecated key, see P-24.
- `optimizePackageImports: ["lucide-react"]`.
- Heavy agenda dialogs `dynamic(..., { ssr: false })` out of the initial bundle.
- Notification badge query removed from layouts; SSR-painted first promo slide w/ ssr:false
  swap; `NotificationBell` pauses its poll on `visibilitychange`.
- `next/image` AVIF/WebP + Supabase remote pattern.
- `_lisbonMinCache` + singleton `Intl.DateTimeFormat` in the admin agenda render hot path
  (CB-4) — `localMinutes` is called 24×7×N times per week render.
- `/api/slots` uses `Cache-Control: private` + `CDN-Cache-Control: public, s-maxage=30` so
  the Vercel Edge can share results across clients without exposing data to unauth (S-12).
- `BookingFlow` keeps a per-mount slot cache keyed by `trainer|date|duration` (CB-3) — re-clicking
  a day is a 0-RTT operation client-side.
- `ReminderSync` runs once per browser-session via `sessionStorage` (QW-4), instead of every
  layout mount.

---

## Suggested fix order (effort vs impact)

1. **P-13 (1-line each, both notif pages)** — fastest GoTrue RTT win, matches P-04's pattern.
2. **P-14 (delete 2 small UPDATE blocks)** — free.
3. **P-16 (parallelize 2 awaits in /app/comprar)** — free; copy the /app/agenda pattern.
4. **P-19 (rearrange existing Promise.all batches in /admin/clientes/[id])** — free.
5. **P-22 (merge two Promise.all batches in getAvailableSlots)** — free; reduces /api/slots RTT.
6. **P-24 (rename one config key)** — clears a recurring deprecation warning in CI logs.
7. **P-18 (trim two select("*") columns)** — small payload win on every client detail load.
8. **P-26 (add sizes="64px")** — free; smaller srcset on /admin/loja.
9. **P-25 (regenerate logo as small PNG or inline SVG)** — small effort, applies to every page.
10. **P-23 (move `InstallPrompt` into authed layouts)** — small refactor; needs a quick check
    that PWA install still fires (the layout switch is the same SPA tree).
11. **P-15 (RPC + trainer-scope on /admin/relatorios)** — needs a SQL migration; pair with the
    SECURITY_AUDIT fix for the trainer-scope leak on the same page.
12. **P-06 (DB-side counts on client dashboard BelowFold)** — small win; same recipe as P-05.
13. **P-17 (notes_clients_index RPC)** — needs a SQL migration; biggest payload reduction
    among the open items.
14. **P-12 (bound the notes IN (...) query)** — same migration sprint as P-17.
15. **P-20 (engagement cron RPC + bounded concurrency)** — biggest backend win; needs SQL +
    careful testing of the cooldown semantics.
16. **P-21 (reminders cron concurrency cap or claim RPC)** — pair with P-20 in the same cron
    refactor session.
17. **P-07 (reserve banner CLS)** — small visual win, improves Lighthouse.
18. **P-03 (fix `eslint --fix` tooling bug, escape PT quotes by hand, re-enable lint)** —
    only after the editor format-on-save hazard is understood.
19. **P-01 (CSP/static rendering trade-off)** — declined; revisit only if you ever want to
    weaken CSP.

## Keeping this stable

Re-run the exhaustive audit prompt and ask the model to *update this file* (flip statuses,
append IDs) rather than starting fresh. Pair with `next build` (bundle/route report),
Lighthouse, and `npm run type-check` so baseline numbers don't drift between runs. **Capture
the bundle/route table inline here next run** — this run couldn't, see the "Baseline
limitation" note above.
