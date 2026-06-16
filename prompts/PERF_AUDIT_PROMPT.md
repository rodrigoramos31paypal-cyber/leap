# Reusable prompt — Exhaustive Performance Audit

Copy everything in the box below into a new chat, attached to the project you want audited.
It is written to produce a **complete, severity-ranked inventory** (not a shifting "top 3"),
and to **update an existing audit file** on repeat runs so results are stable and cumulative.

Why this is different from a "find the bottlenecks" prompt: it forbids stopping at the biggest
issues, forces a fixed output schema with IDs + severity + status, requires the findings to be
written to a file, and anchors the analysis to deterministic tooling so the baseline doesn't
drift between runs.

---

```
Act as a Senior Performance Engineer + Web Vitals specialist. Conduct an EXHAUSTIVE
performance audit of the attached project. This is an optimization-only pass: do not
propose features.

## Mindset (read first)
- Enumerate EVERY performance issue you can find. Do NOT stop at the biggest ones, and do
  NOT return a curated "top 3". Completeness is the goal; ranking is secondary metadata.
- If an existing audit file (e.g. PERF_AUDIT.md) is present, UPDATE it: keep finding IDs
  stable, flip Status fields, and append new findings. Do not regenerate from scratch.
- Distinguish what's genuinely wrong from what's already optimized. Add a short "already
  done well" section so future runs don't re-report solved problems as new.
- Ground every claim in a real file + line reference. No generic advice.

## Before analyzing, establish a deterministic baseline
Run (or ask me to run) and read the output of whatever applies:
- production build report (bundle sizes, route render mode: static vs dynamic)
- Lighthouse / PageSpeed (LCP, CLS, INP, TBT) on the 2-3 most important routes
- type-check and lint
- any profiler data I can provide (React Profiler, flame charts, slow query logs)
Cite the numbers. If you can't run something, say so and proceed from source.

## Coverage checklist — walk through ALL of these, report findings or "no issue found"
1. Rendering strategy: static vs SSR vs ISR per route. Flag anything that forces dynamic
   rendering app-wide (e.g. cookies()/headers() in a root layout), missing caching, or
   unnecessary client components. Check the full-route cache and data cache usage.
2. Data fetching: request waterfalls (sequential awaits that could be Promise.all),
   over-fetching (SELECT * / fetching rows just to count/aggregate in JS), N+1 patterns,
   missing pagination/limits, duplicate fetches not deduped.
3. Caching: server-side (revalidate, unstable_cache/tags, CDN headers, stale-while-
   revalidate), client-side (query cache), and edge/CDN utilization.
4. Bundle & assets: large JS chunks, heavy deps that could be dynamic-imported or moved
   server-only, unoptimized images (missing priority/sizes/modern formats), fonts
   (render-blocking webfonts, missing display:swap, unused declared fonts), CSS weight.
5. Runtime/UI: heavy synchronous work on the main thread, effects that re-run on every
   render/navigation, missing memoization where it measurably matters, Rules-of-Hooks
   violations, layout thrash / CLS sources, unthrottled polling or realtime subscriptions.
6. Edge/serverless specifics: cold-start cost, per-request auth round-trips, middleware
   running on prefetches, runtime selection (edge vs node), function size.
7. Build hygiene: anything disabled (lint/type-check in build) that hides perf/correctness
   bugs.

## Output format — write to PERF_AUDIT.md (create if absent, update if present)
1. A findings INDEX table: | ID | Severity | Area | Title | Status |
   - Severity: Critical / High / Medium / Low.
   - Status: OPEN / IN PROGRESS / FIXED / ACCEPTED.
   - IDs are stable across runs (P-01, P-02, ...). New findings get new IDs.
2. For EACH finding: file + line(s), what it is, measurable impact, the exact rewrite/fix,
   and how to verify the fix (what metric or build-output should change).
3. An "Already optimized" section listing what's correctly done, so it isn't re-flagged.
4. A suggested fix order (effort vs impact).
After writing, give me the index table inline and a one-paragraph summary. Do not bury the
file behind prose.

## Rules
- Prefer DB-side aggregation, edge caching, and static rendering over micro-optimizations.
- Don't claim something is slow without saying why and roughly how much.
- Be explicit when a finding is a deliberate trade-off (mark ACCEPTED, don't keep re-raising it).
```
