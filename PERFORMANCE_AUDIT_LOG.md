# Performance Audit — Change Log (2026-06-12)

Restore point before any changes: git commit `eb22b9b`.
Every code change is git-diffable. The one DB change is additive and gated by a
runtime fallback, so the app keeps working whether or not it is applied.

To revert EVERYTHING at once:
    git checkout eb22b9b -- next.config.mjs lib/notes.ts components/top-bar.tsx \
      app/admin/relatorios/page.tsx app/admin/clientes/page.tsx \
      public/images/logo.png public/images/logo-slogan.png
    rm supabase/migrations/0024_perf_client_list_rpcs.sql
    # (and, if the migration was already applied to Supabase:)
    #   drop function if exists clients_by_booking(uuid[],boolean,int,int);
    #   drop function if exists clients_low_sessions(uuid[],int,int);

Original full-size logos are also kept at: .perf-audit-backup/*.orig

---

## 1. Logo images recompressed in place  (asset win, zero code risk)
Files: public/images/logo.png, public/images/logo-slogan.png
- logo.png:        1080x1080, 175 KB  ->  192x192,  28 KB
- logo-slogan.png: 7200x5400, 646 KB  -> 1280x960,  84 KB
Filenames unchanged, so no code reference changes. Display sizes are tiny
(44px / ~512px), so the source images were massively oversized.
Revert: git checkout eb22b9b -- public/images/logo.png public/images/logo-slogan.png
NOTE: public/images/.orig_backup/ may still exist (sandbox could not delete it).
      Safe to delete manually — the originals are also in .perf-audit-backup/.

## 2. next.config.mjs — modern image formats
Added:  images: { formats: ["image/avif", "image/webp"] }
Lets the Vercel optimizer serve AVIF/WebP (AVIF is opt-in; Next defaults to webp
only). next/image falls back automatically on unsupported browsers. No behavior change.
Revert: git checkout eb22b9b -- next.config.mjs

## 3. components/top-bar.tsx — sizes hint on logo
Added sizes="44px" to the TopBar <Image>, so the optimizer picks the smallest
candidate for the 44px logo. Purely additive.
Revert: git checkout eb22b9b -- components/top-bar.tsx

## 4. lib/notes.ts — getMyNotesMapForBookings column projection
Changed select("*") -> select("booking_id, body") for the agenda note map.
The agenda only consumes note.body (editor prefill + the "✓" indicator), so the
other columns (id/subject_id/author_id/created_at/updated_at) were wasted payload
for every booking in the visible range. Editor prefill is preserved (body still
fetched), so note editing is unaffected.
Revert: git checkout eb22b9b -- lib/notes.ts

## 5. app/admin/relatorios/page.tsx — narrowed queries + Suspense streaming
- select("*") -> select("amount_cents, sessions_total") on purchases
- select("*") -> select("status") on bookings
  (only the columns the reduces/filters actually use; filter columns don't need
   to be returned). Big payload cut over arbitrary date ranges.
- The KPI grid is now streamed inside <Suspense>; the page shell (header, date
  filter, export links) renders immediately instead of blocking on both queries.
Output values are identical to before.
Revert: git checkout eb22b9b -- app/admin/relatorios/page.tsx

## 6. app/admin/clientes/page.tsx + migration 0024 — DB-side pagination
Problem: upcoming/past tabs fetched up to 1000 booking rows to dedupe+paginate in
JS (and broke past 1000); the "esgotar" tab scanned the whole purchases table
twice and aggregated in memory — on every page load.

Change:
- New migration supabase/migrations/0024_perf_client_list_rpcs.sql adds two
  read-only RPCs (SECURITY INVOKER — same RLS as today, no privilege change):
    * clients_by_booking(trainer_ids, upcoming, offset, limit)
    * clients_low_sessions(trainer_ids, offset, limit)
  They return only the deduped, ordered, paginated client_ids + total count.
- The page calls these RPCs. The rest of the UI (profile load + sessions chip)
  is unchanged downstream.

SAFETY / NO-BREAKAGE GUARANTEE:
  The RPC call is wrapped in try/catch. If the migration has NOT been applied yet
  (or the RPC errors for any reason), the code falls back to the ORIGINAL in-JS
  logic — behavior identical to before. So the code is safe to deploy immediately;
  applying the migration only flips on the fast path.

To activate the fast path: apply migration 0024 to Supabase via your normal
migration flow (supabase db push / migration apply). Applying it will validate
the SQL. Until then, the page transparently uses the old logic.

Revert:
  git checkout eb22b9b -- app/admin/clientes/page.tsx
  rm supabase/migrations/0024_perf_client_list_rpcs.sql
  (if applied: drop the two functions — see top of file)

---

## Verification performed
- TypeScript (tsc --noEmit): ZERO new errors in any edited file. (The project's
  ~250 pre-existing supabase-typing errors are unchanged — that's why
  next.config has ignoreBuildErrors: true.)
- All edited files: braces balanced, files end cleanly, configs parse.
- A full `next build` could not run in the audit sandbox (needs the Linux SWC
  binary, no network) — but the production build runs the same TS through SWC and
  these files are syntactically clean. Recommend one `npm run build` locally /
  on a Vercel preview deploy before promoting to production.

## Not changed (and why)
- Middleware getUser() per request: this is the correct secure Supabase pattern
  and you already skip it on RSC prefetches; Supabase region is fra1 (co-located),
  so it's not a meaningful latency source.
- Note bodies were NOT lazy-fetched (an alternative optimization) because a failed
  lazy fetch could risk overwriting a note with an empty save — column narrowing
  was the safe win instead.
