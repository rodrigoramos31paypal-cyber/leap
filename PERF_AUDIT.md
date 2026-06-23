# LEAP — Performance Audit (stable baseline)

**Date:** 2026-06-23 (last update)
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

`next build` could not be executed in the audit sandbox: it has **no network access**, so
`next` aborts while downloading `@next/swc-linux-x64-gnu` (`getaddrinfo EAI_AGAIN
registry.npmjs.org`). `tsc --noEmit` is likewise unreliable here (FUSE mount mangles UTF-8
accents). **All findings below are grounded in source reads with file/line refs, not build
output.** Re-run `next build` + Lighthouse on the host and record the bundle/route table
here to make future deltas measurable — still the biggest gap in this file.

---

## Progress log — 2026-06-23 (b) — fixes implemented

Implemented the free wins this session (code in tree; one migration to apply):

- **P-13 — FIXED.** Both notification pages now use `getSessionUser()` (cookie-only) instead
  of `supabase.auth.getUser()` (GoTrue RTT). `app/app/notificacoes/page.tsx:8`,
  `app/admin/notificacoes/page.tsx:7`.
- **P-14 — FIXED.** Removed the duplicate page-level mark-read `UPDATE` from both pages; the
  layouts (`app/app/layout.tsx:27-33`, `app/admin/layout.tsx:26-32`) remain the single source.
- **P-27 — FIXED (apply migration).** Removed the per-render pruning `DELETE` from
  `app/app/notificacoes/page.tsx`; retention moved to an AFTER INSERT trigger
  `prune_notifications_keep_recent` (keep-last-10 per user) in
  `supabase/migrations/0111_prune_notifications_on_insert.sql` + a supporting index
  `idx_notifications_user_created`. Steady state (≤10/user) is identical, so the delete UX
  (10→9→8, no reappear) is preserved. **Note:** the admin page previously did *not* prune, so
  after this trigger admin users are also capped at 10 in the DB (both pages already only
  display 10). **The notifications page is now a pure read.** ⚠️ Apply migration 0111 in
  Supabase for this to take effect.
- **P-16 — FIXED.** `/app/comprar` now resolves `getActiveTrainersPublic()` and
  `getTrainerForClient()` with `Promise.all` (and skips the latter when `?trainer=` is
  present). `app/app/comprar/page.tsx:16-24`.
- **P-22 — FIXED.** `getAvailableSlots` merged the two independent query batches
  (bookings+blocks and recurring+skips) into a single `Promise.all` of 4 — one fewer RTT per
  `/api/slots` call (every day-switch in the booking flow). `lib/availability.ts:108-133`.
- **P-18 — FIXED.** `/admin/clientes/[id]` purchases/bookings `select("*")` trimmed to the
  consumed columns. `app/admin/clientes/[id]/page.tsx:30-50`.
- **P-19 — FIXED.** Same page: the 3-stage waterfall (notes → packs+notes → duoPartner) was
  collapsed into one `Promise.all` after the first batch. Saves ~2 RTT per load.

---

## Progress log — 2026-06-23 (a)

- **P-24 — FIXED & shipped.** `next.config.mjs:51` now uses the top-level
  `serverExternalPackages: ["exceljs", "web-push", "@supabase/supabase-js"]` (the deprecated
  `experimental.serverComponentsExternalPackages` is gone). No more deprecation warning.
- **P-03 — re-classified ACCEPTED (Next 16 design).** The `eslint` key was removed from
  `next.config.mjs` (lines 25-34 document why): Next 16 no longer runs ESLint inside
  `next build` at all, so there is nothing to "ignore". `tsc --noEmit` still blocks the
  build (type-check is the real CI gate). Lint debt (~20 `react/no-unescaped-entities`)
  remains a CI/IDE task; not a build-perf issue any more. Still avoid `eslint --fix` here.
- **P-15 — partial progress (still OPEN).** `ReportStats` now selects only the columns it
  reduces (`amount_cents, sessions_total` / `status`) instead of `*` — the over-fetch half
  is done. The two remaining halves are unchanged: it still **aggregates in JS** and is
  **not scoped to the trainer** (no `.in("trainer_id", scope)`), so a non-owner trainer sees
  studio-wide numbers. The `get_report_stats(...)` RPC + scope filter is still the fix.
- **P-12 — partial (still OPEN).** `listMyNotes({clientId})` now runs two focused queries
  instead of fetching 500 rows, but the booking-notes branch still does an **unbounded
  `IN (bookingIds)`** (`lib/notes.ts:72-79`). Cap or push into an RPC join.
- **New findings — P-27, P-28.** Both surfaced this run: a write on the notifications read
  path, and leading-wildcard `ILIKE` seq-scans in the client-scope helpers. See details.
- **Re-verified still OPEN:** P-06, P-07, P-13, P-14, P-16, P-17, P-18, P-19, P-20, P-21,
  P-22, P-23, P-25, P-26 — all confirmed unchanged at the cited lines.
- **Re-verified still FIXED:** P-02 (`promo-carousel.tsx:66` guard is below all hooks),
  P-04 (`getClaimsUser` in `getCurrentProfile`), P-05 (`get_dashboard_kpis` RPC, fallback
  retained).

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
| P-03  | 🟧  | Build hygiene      | `eslint.ignoreDuringBuilds: true` ships bugs / hides regressions                     | ACCEPTED (Next 16 drops eslint-in-build)   |
| P-04  | 🟧  | Edge/Auth          | `getCurrentProfile()` did a GoTrue round-trip (`getUser`) on every page              | FIXED                                      |
| P-05  | 🟧  | Data               | Admin dashboard KPIs over-fetch rows and aggregate in JS                             | FIXED                                      |
| P-06  | 🟨  | Data               | Client dashboard "BelowFold" fetches full rows to compute counts                     | OPEN                                       |
| P-07  | 🟨  | UX/CLS             | Promo banner computes `aspect-ratio` from `onLoad` → layout shift                    | OPEN                                       |
| P-08  | 🟨  | Assets             | `font-family: Inter` declared but no font is loaded (dead intent)                    | SKIPPED                                    |
| P-09  | 🟦  | Images             | Above-the-fold images lack `priority` / explicit `sizes` audit                       | SKIPPED                                    |
| P-10  | 🟦  | Edge               | API routes could declare `runtime`/`revalidate` explicitly                           | SKIPPED                                    |
| P-11  | 🟦  | Realtime           | `NotificationBell` realtime + poll + immediate refresh redundancy                    | ACCEPTED                                   |
| P-12  | 🟦  | Data               | `listMyNotes` `IN (bookingIds)` can grow unbounded                                   | OPEN                                       |
| P-13  | 🟧  | Edge/Auth          | `/app/notificacoes` and `/admin/notificacoes` still call `supabase.auth.getUser()`   | FIXED                                      |
| P-14  | 🟨  | Data               | Duplicate "mark notifications read" — layout + page both run the UPDATE              | FIXED                                      |
| P-15  | 🟨  | Data               | `/admin/relatorios` aggregates in JS and is **not scoped to the trainer**            | OPEN                                       |
| P-16  | 🟨  | Data               | `/app/comprar` serial `await getActiveTrainersPublic()` then `getTrainerForClient()` | FIXED                                      |
| P-17  | 🟨  | Data               | `/admin/notas` index fetches up to 500 notes and group-bys in JS                     | OPEN                                       |
| P-18  | 🟨  | Data               | `/admin/clientes/[id]` uses `select("*")` on purchases + bookings                    | FIXED                                      |
| P-19  | 🟨  | Data               | `/admin/clientes/[id]` waterfalls 3 round-trips that can run as 1 parallel batch     | FIXED                                      |
| P-20  | 🟧  | Edge/Data          | Engagement cron pulls ALL confirmed purchases + N×2 serial per-client awaits         | OPEN                                       |
| P-21  | 🟨  | Edge/Data          | Reminders cron is a serial per-booking loop with 4 awaits each                       | OPEN                                       |
| P-22  | 🟦  | Data               | `getAvailableSlots` has 3 sequential `Promise.all` batches; last two can merge       | FIXED                                      |
| P-23  | 🟦  | Bundle             | `InstallPrompt` in root layout — client JS ships on landing + auth + `/t/<slug>`     | OPEN                                       |
| P-24  | 🟦  | Build hygiene      | `experimental.serverComponentsExternalPackages` renamed in Next 15+                  | FIXED                                      |
| P-25  | 🟦  | Assets             | `/images/logo.png` 28 KB rendered at 44×44 in every TopBar                           | OPEN                                       |
| P-26  | 🟦  | Images             | `/admin/loja` product `<Image>` 64×64 lacks `sizes` → wider srcset than needed       | OPEN                                       |
| P-27  | 🟨  | Data/Render        | `/app/notificacoes` runs a pruning `DELETE` (+`UPDATE`) on every page render — write on a read path | FIXED (migration 0111)     |
| P-28  | 🟨  | Data               | `getClientIdsInScope`/`getClientCountInScope` use leading-wildcard `ILIKE '%@removido.invalid'` → seq-scan of `profiles` | OPEN     |

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

### P-03 — ESLint not run in build — ACCEPTED (Next 16 design)
**File:** `next.config.mjs:25-34`
Status changed this run. Next 16 **removed** the `eslint` config key and no longer runs
ESLint during `next build` at all — so there is nothing left to "ignore", and the build-perf
angle is moot. The type-check gate (`tsc --noEmit` in CI) still blocks the build, which is the
control that actually catches correctness/perf regressions (e.g. an action missing the
`requireStaff`/`requireOwner` guard, or a mis-typed return). Remaining lint debt (~20
`react/no-unescaped-entities`, PT quotes) is now a CI/IDE concern — run `npm run lint` in a
dedicated PR. **Still avoid `eslint --fix` in this folder** until the file-truncation tooling
hazard (noted in the 2026-06-16 log) is understood; escape the quotes by hand.

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

### P-13 — Notification pages called `supabase.auth.getUser()` — FIXED
**Files:** `app/app/notificacoes/page.tsx:8`, `app/admin/notificacoes/page.tsx:7`
Both pages now call `await getSessionUser()` (cookie-only, deduped by `React.cache`) instead
of `supabase.auth.getUser()`, removing a GoTrue round-trip (≈30–80 ms cold) per visit — the
same fix P-04 applied to the layouts. The middleware already validated the JWT upstream.
**Verify:** flame chart shows the GoTrue call gone; the page still streams under the layout's
`getCurrentProfile()` cache hit.

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

### P-14 — Duplicate "mark notifications read" UPDATE — FIXED
**Files:** `app/app/layout.tsx:27–33` + `app/admin/layout.tsx:26–32` (canonical), page UPDATEs
removed from `app/app/notificacoes/page.tsx` and `app/admin/notificacoes/page.tsx`.
The layouts already run `UPDATE notifications SET read_at=now() WHERE user_id=… AND read_at IS
NULL` when the path is the notifications page; the duplicate page-level UPDATE was deleted, so
the write happens once. Both notification pages are now pure reads.
**Verify:** only one `UPDATE … read_at` per notifications-page open in `pg_stat_statements`.

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

### P-16 — `/app/comprar` serial waterfall on trainer resolution — FIXED
**File:** `app/app/comprar/page.tsx:16–24`
Now resolved with `Promise.all([getActiveTrainersPublic(), …getTrainerForClient(user.id)])`,
and the fallback lookup is skipped entirely when `?trainer=` is present
(`searchParams.trainer ? Promise.resolve(null) : getTrainerForClient(user.id)`). Saves one
round-trip on the common path.
**Verify:** the two reads overlap in the flame chart instead of running back-to-back.

### P-17 — `/admin/notas` index over-fetches and groups in JS — OPEN
**File:** `app/admin/notas/page.tsx:110–129`
`listMyNotes({ limit: 500, include: "meta" })` is used solely to compute a count + last-seen
per client and render at most **10** cards. With volume the 500-cap drops clients from the
index; with low volume it still ships hundreds of rows for ≤10 cards.
**Fix:** add an RPC `notes_clients_index(p_trainer_id, p_q, p_limit)` returning
`(client_id, full_name, email, phone, count, last_at)` ordered by `last_at DESC`, supports the
`q` search server-side. Drops payload by an order of magnitude and fixes the silent 500-cap.

### P-18 — `/admin/clientes/[id]` `select("*")` on purchases and bookings — FIXED
**File:** `app/admin/clientes/[id]/page.tsx:30–50`
Trimmed to the columns the render actually reads:
`purchases → id, pack_snapshot, created_at, amount_cents, sessions_remaining, sessions_total`;
`bookings → id, starts_at, session_type, status`. Drops the unread columns (`stripe_*`,
`confirmed_*`, `cancelled_*`, `series_id`, `credit_charged`, …) from the wire. Render output
is unchanged (verified against every `p.`/`b.` field access in the JSX).
**Verify:** response payload for the two queries shrinks; page renders identically.

### P-19 — `/admin/clientes/[id]` 3-step waterfall collapsed to 1 batch — FIXED
**File:** `app/admin/clientes/[id]/page.tsx:30–58`
Previously 3 sequential rounds: (1) trainerIds+credits+purchases+bookings → (2) serial
`getClientNotesMapForBookings` → (3) packs+`getMyNotesMapForBookings`, then a 4th serial
`getDuoPartner`. All of packs (needs `trainerIds`), both note-maps (need `bookingIds`) and
`duoPartner` (needs only `profileId`) have their inputs ready after round 1, so they now run in
a **single `Promise.all`**. Collapses ~3 serial stages into 1 — saves ~2 RTT per client-detail
load. `duoPartner` keeps its `isDeleted` short-circuit (`Promise.resolve(null)`).
**Verify:** flame chart shows packs/notes/duo issuing concurrently after the first batch.

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

### P-22 — `getAvailableSlots` unnecessary serial batch boundary — FIXED
**File:** `lib/availability.ts:108–133`
The (bookings + blocks) and (recurring + skips) batches were independent and now run in a
single `Promise.all` of 4 after the availability short-circuit. (The first batch — avail +
settings — stays separate because the empty-availability early-return must short-circuit
before the rest.) One fewer RTT per `/api/slots` call, i.e. per day-switch in the booking flow.
**Verify:** `/api/slots` server timing drops by ~1 RTT; 4 queries issue concurrently.

### P-27 — `/app/notificacoes` writes to the DB on every render — FIXED (apply migration 0111)
**File:** `app/app/notificacoes/page.tsx:21-39` (admin variant `app/admin/notificacoes/page.tsx:18-23`
does the `UPDATE` half only)
The client notifications **page** (a Server Component, rendered on a GET navigation) performs
up to **two writes per render**:
1. **Pruning DELETE** (lines 26-32): when the most-recent fetch returns exactly 10 rows, it
   runs `DELETE FROM notifications WHERE user_id=… AND id NOT IN (<10 ids>)`. This fires on
   *every* visit where the user has ≥10 notifications — a write + index maintenance on a read
   path, plus it ships the 10 ids back up in the statement each time.
2. **Mark-read UPDATE** (lines 35-39): `UPDATE … SET read_at=now() WHERE read_at IS NULL` —
   and the **layout already did the same UPDATE** for this path (`app/app/layout.tsx:27-33`),
   so this is the duplicate from P-14, compounded here.
Net: a notification-page open = 1 GoTrue RTT (P-13) + 1 DELETE + 2 identical UPDATEs. The
notifications page is the landing target of every notification CTA, so it's hit often.
**Impact:** turns an idempotent read into 2-3 writes per view; under load these take row locks
and write WAL for no user-visible benefit. Also makes the route impossible to ever cache.
**Fix applied (migration `0111_prune_notifications_on_insert.sql`):**
- Retention moved to an AFTER INSERT trigger `prune_notifications_keep_recent` (keep-last-10
  per `user_id`) + index `idx_notifications_user_created (user_id, created_at desc)`. The write
  now happens on INSERT (already a write), not on read.
- Removed the render-path `DELETE` and the page-level `UPDATE` (P-14) from
  `app/app/notificacoes/page.tsx`; the page is now a pure `SELECT … LIMIT 10`.
- Steady state is ≤10/user, identical to before, so the delete UX (10→9→8, no reappear) is
  preserved. Behavior change: the admin page previously didn't prune, so admin users are now
  also capped at 10 in the DB (both pages already display only 10). KEEP=10 must stay in sync
  with the pages' `.limit(10)`.
**⚠️ Apply migration 0111 in Supabase** for the fix to take effect (the code change alone
just stops pruning on read; the trigger does the retention).
**Verify:** `pg_stat_statements` shows the per-render `DELETE` and the second `UPDATE` gone
from a notifications-page open; only `SELECT … LIMIT 10` remains. After an INSERT for a user
with 10 rows, `select count(*) from notifications where user_id=…` stays at 10.

### P-28 — Anonymized-account filter uses leading-wildcard `ILIKE` (seq scan) — OPEN
**File:** `lib/trainer.ts:136-140` (`getClientIdsInScope`) and `:165-170`
(`getClientCountInScope`, owner branch)
Both helpers exclude deleted accounts with `…ilike("email", "%@removido.invalid")` /
`.not("email","ilike","%@removido.invalid")`. A **leading-wildcard** `ILIKE` cannot use a
btree index on `email` → Postgres does a **sequential scan of `profiles`** every time. These
run on the admin **client list** (`/admin/clientes`) and the **dashboard** client-count KPI —
hot, frequently-rendered admin routes. Cost is negligible today (small `profiles`) but grows
linearly with total registered users and is paid on every admin page load.
**Impact:** O(rows) seq scan on `profiles` per admin client-list / dashboard render; today
single-digit ms, but unbounded as the user base grows, and it defeats any index on `email`.
**Fix (pick one):**
- Add a boolean column `profiles.is_anonymized` (set by `anonymize_*` RPCs) and filter on
  `eq("is_anonymized", false)` — index-friendly, O(log n). Cleanest.
- Or store anonymization as `profiles.deleted_at timestamptz` and filter `is("deleted_at", null)`.
- Or, if you must keep the email convention, add a functional/partial index and switch to a
  suffix match that an index can serve (e.g. a generated `email_domain` column).
Fold the `getClientIdsInScope` 3-read union into the same migration if you move to a flag.
**Verify:** `EXPLAIN` on the client-list query shows an `Index Scan`/`Index Only Scan` instead
of `Seq Scan on profiles`.

### Currently fixed/skipped Medium-severity items
P-08 stays SKIPPED. P-24 moved to FIXED. New Mediums this run: P-27, P-28.

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

### P-24 — `serverComponentsExternalPackages` renamed — FIXED
**File:** `next.config.mjs:51`
Done this run (already in tree). The config now uses the top-level
`serverExternalPackages: ["exceljs", "web-push", "@supabase/supabase-js"]`; the deprecated
`experimental.serverComponentsExternalPackages` key is gone. No more per-build deprecation
warning. The externalization benefit (heavy server-only deps kept out of serverless bundles
→ faster cold starts) is unchanged.

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
  via the current top-level `serverExternalPackages` key (P-24 FIXED).
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

1. **P-13 — DONE** (both notif pages → `getSessionUser`).
2. **P-14 + P-27 — DONE** (page-level UPDATE removed; prune moved to trigger `0111`).
   ⚠️ apply migration 0111.
3. **P-16 — DONE** (`/app/comprar` parallelized).
4. **P-22 — DONE** (`getAvailableSlots` batches merged).
5. **P-19 — DONE** (clientes/[id] waterfall collapsed to 1 batch incl. `getDuoPartner`).
6. **P-18 — DONE** (clientes/[id] `select("*")` trimmed).
7. **P-26 (add sizes="64px")** — free; smaller srcset on /admin/loja.
8. **P-25 (regenerate logo as small PNG or inline SVG)** — small effort, applies to every page.
9. **P-23 (move `InstallPrompt` into authed layouts)** — small refactor; needs a quick check
   that PWA install still fires (the layout switch is the same SPA tree).
10. **P-28 (add `is_anonymized`/`deleted_at` flag + index; replace leading-wildcard ILIKE)** —
    small SQL migration; removes a seq-scan from the admin client list + dashboard.
11. **P-15 (RPC + trainer-scope on /admin/relatorios)** — needs a SQL migration; pair with the
    SECURITY_AUDIT trainer-scope fix for the same page (column trim already done).
12. **P-06 (DB-side counts on client dashboard BelowFold)** — small win; same recipe as P-05.
13. **P-17 (notes_clients_index RPC)** — needs a SQL migration; biggest payload reduction
    among the open items.
14. **P-12 (bound the notes IN (...) query)** — same migration sprint as P-17.
15. **P-20 (engagement cron RPC + bounded concurrency)** — biggest backend win; needs SQL +
    careful testing of the cooldown semantics. Note the `confirmed` purchases scan
    (`route.ts:61-64`) is still unfiltered — full-system payload every run.
16. **P-21 (reminders cron concurrency cap or claim RPC)** — pair with P-20 in the same cron
    refactor session.
17. **P-07 (reserve banner CLS)** — small visual win, improves Lighthouse. Partially mitigated
    (`md:aspect-[3/1]` fallback) but desktop still shifts when the natural ratio ≠ 3:1.
18. **P-24 — DONE.** **P-03 — ACCEPTED** (Next 16 drops eslint-in-build; run `npm run lint`
    in CI when convenient, by hand not `--fix`).
19. **P-01 (CSP/static rendering trade-off)** — declined; revisit only if you ever want to
    weaken CSP.

## Keeping this stable

Re-run the exhaustive audit prompt and ask the model to *update this file* (flip statuses,
append IDs) rather than starting fresh. Pair with `next build` (bundle/route report),
Lighthouse, and `npm run type-check` so baseline numbers don't drift between runs. **Capture
the bundle/route table inline here next run** — this run couldn't, see the "Baseline
limitation" note above.
