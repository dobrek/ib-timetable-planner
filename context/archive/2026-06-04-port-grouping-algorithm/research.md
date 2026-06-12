---
date: 2026-06-04T08:53:14+02:00
researcher: Dobromir Kropielnicki
git_commit: ee924485e05b9ad4ce057f2cc1c2232ccf0fd075
branch: main
repository: ib-timetable-planner
topic: "Options for porting the legacy Bun grouping algorithm into the Astro/workerd app"
tags: [research, codebase, grouping-algorithm, porting, edge-runtime, supabase, constraint-model]
status: complete
last_updated: 2026-06-04
last_updated_by: Dobromir Kropielnicki
---

# Research: Options for porting the legacy Bun grouping algorithm

**Date**: 2026-06-04T08:53:14+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: ee924485e05b9ad4ce057f2cc1c2232ccf0fd075
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

What options do we have to port the legacy grouping algorithm (source-only, originally built on Bun, placed at `legacy-grouping-algorithm/src/`) into the current project?

**Scope locked with the user:** target = **runtime in-app feature**; data source = **Supabase (live)**; relationship to existing solver = **compare & reconcile**.

## Summary

**The port is already a planned, scoped, and unblocked piece of foundation work.** The roadmap names it `F-03: port-grouping-algorithm` (`context/foundation/roadmap.md:36,101-115`) and the schema needed to receive it (`F-02`) landed in commit `ee92448` ("Minimal domain scheme"). So this is **greenfield logic written against a ready, purpose-built schema** — not a risky reverse-engineering exercise.

Key findings:

1. **No existing solver to reconcile with.** The live `src/` has **zero** grouping, validation, or conflict logic — only a data model (schema + generated types) and auth. The legacy algorithm *complements* the codebase; it does not duplicate or conflict with anything. (Agent 1)
2. **The schema is a deliberate 1:1 port target.** Tables `course_groupings` / `course_grouping_members` are built to hold the algorithm's exact output shape (`coverage_count` ≈ legacy `students`, `score` ≈ legacy `similar`), and `course_overlaps` / `course_merges` mirror the legacy overlap/merge CSVs. Two `supabase/snippets/*.csv.sql` files are the Rosetta stone (DB → original CSV shape). (Agent 2)
3. **Clean three-layer port.** Pure algorithm + utils lift-and-shift into `src/lib/`; the entire Bun CSV file layer is **rewritten as Supabase queries (not ported)** — workerd has no filesystem; the `Bun.file`/`Bun.write` top-level-await entry becomes an API route / compute action. (Agent 4)
4. **Two real tensions to resolve in planning** (both already flagged by the roadmap):
   - **Determinism vs. randomness.** The legacy algorithm is *randomized* (`Math.random` + 1000 retries), but F-03 requires *deterministic output for a given catalog snapshot* and parity against a golden file. (Agents 3 & 4)
   - **CPU budget / cadence.** It's a combinatorial random-greedy generator — CPU-bound. It must run as an **explicit, cached, off-hot-path** computation (the F-03 → S-06 design), never inside the per-drop 200ms validation path (which is a *separate, lighter* online function). (Agent 3)
5. **Collision-model scope.** Legacy checks only **shared teacher OR shared student** within one cohort. That is the correct scope for the *grouping recommendation rule* (PRD scopes grouping to the current cohort). The richer collision classes (teacher-availability, cross-cohort fixed-teacher) belong to the **validator**, a different component built incrementally in the placement slices. (Agents 1 & 3)

## Detailed Findings

### What the legacy algorithm actually does

For one cohort (`getSubjectsBy("DP2")`, hardcoded), it assembles `Subject {id, name, course, hours, students[], teacher}` from four CSVs, then:

- `hasIntersection` (`legacy-grouping-algorithm/src/index.ts:8-14`) — two subjects conflict if they **share a teacher OR share any student** (plus identity check).
- `findOptions` (`index.ts:16-23`) — random greedy expansion: repeatedly pick a `randomElement` of still-compatible subjects, building a maximal compatible set (an independent set in the conflict graph).
- `allList` (`index.ts:25-34`) — repeats expansion up to `tries = 1000`, collecting de-duplicated variants (`isUnique`, `index.ts:36-48`).
- Ranking — each variant scored by `similar` (hours similarity, `index.ts:54-58`), `students` (coverage), `rank` (`index.ts:62-63`); sorted by `similar` desc (`index.ts:74`).
- Output — flattened to CSV via `Bun.write` (`index.ts:82-88`, `utils/saveAsCsv.ts:5-6`).

This maps directly onto the PRD's **recommendation rule** / **FR-013** ("App computes ranked 'compatible course groupings' … exposes them as draggable building blocks").

### Existing solver core — absent (compare & reconcile)

- **No** validation/conflict/grouping/solver code anywhere in `src/`. `src/lib/` holds only `supabase.ts` (client), `config-status.ts`, `utils.ts` (Tailwind `cn`), `database.types.ts`. API routes are auth-only. (Agent 1)
- The only domain "logic" is structural DB constraints (uniqueness/range), e.g. `placements_unique`, `placements_day_range` in `supabase/migrations/20260602185012_minimal_domain_schema.sql`. No trigger/function/view detects shared teacher/student.
- **Reconciliation verdict:** the port is additive greenfield logic. The schema anticipates it (`course_groupings`, `course_grouping_members`) but nothing populates those tables yet.

### Supabase mapping — every legacy concept has a home

Schema: `supabase/migrations/20260602185012_minimal_domain_schema.sql`; types mirror in `src/lib/database.types.ts`.

| Legacy CSV input | Live schema equivalent | Derivation |
| --- | --- | --- |
| `students_subjects.csv` (student, subject, level, group) | `student_choices` ⋈ `students` ⋈ `courses` | enrollment join; see `supabase/snippets/students_subjects.csv.sql` |
| `teachers_subjects.csv` (teacher, subject, level, group, hours) | folded into `courses` | `courses.teacher_id → teachers.code`, `courses.hours_per_week`; see `supabase/snippets/teachers_subjects.csv.sql` |
| `subjects_overlap.csv` | `course_overlaps` (base/dependent) | union the partner side's students — **edge direction must be verified at integration** |
| `merge_subjects.csv` | `course_merges` (parent/child) | virtual parent subject unions child students; parent may have `hours_per_week = 0` |

- Legacy subject name `[subject, level, group]` (`loaders.ts:50-52`) reconstructs from `courses.name` + `courses.level` (sentinel `'none'`) + `courses.group_index` (sentinel `0`).
- Cohorts: `cohorts` table seeded with exactly two rows (`supabase/seed.sql:4-6`); legacy `"DP1"|"DP2"` (`types.ts:1`) maps to Year 1 / Year 2.
- **Caveat:** the app currently uses Supabase **only for auth** — there are **no `.from(<table>)` data queries in `src/`** yet, so the port writes the first real data-query pattern. Client factory: `src/lib/supabase.ts:6` (`createClient(headers, cookies)`, returns `null` if env unset). (Agent 2)

### Edge/runtime portability — per-coupling verdict

Toolchain: Vite + `@astrojs/cloudflare` `output:"server"` (`astro.config.mjs:7,11,16`), `compatibility_flags:["nodejs_compat"]` (`wrangler.jsonc:4-6`), `moduleResolution:"Bundler"` + `allowImportingTsExtensions` (Astro base tsconfig). (Agent 4)

| Legacy coupling | Verdict on workerd | Replacement |
| --- | --- | --- |
| `Bun.file(...).text()` (`loaders.ts:21,33,42`) | **Incompatible** — no Bun, no FS | Drop the file layer; query Supabase tables |
| `Bun.write(...)` (`saveAsCsv.ts:5-6`) | **Incompatible** — no FS to write | Return CSV as a `Response`, or persist to `course_groupings`. Serialization logic itself is pure & portable |
| `csv-simple-parser` (`loaders.ts:2`) | Pure-JS (would run) but **removable** | Disappears once data is structured Supabase rows. Not currently in `package.json` |
| top-level `await` (`index.ts:6`) | Allowed but **architecturally wrong** — runs at worker init, no request context | Move body into the API-route handler scope |
| `.ts` import specifiers | **Compatible** | Optional cleanup: drop extensions, use `@/*` alias for consistency with `src/` |
| pure algorithm + `utils/array.ts` | **Fully compatible** | Lift-and-shift into `src/lib/grouping/` |

`Math.random()` is supported on workerd but may be deterministic in global scope → another reason the randomized search must run **inside the request handler**, not at module load. The recursive search is CPU-bound (`allSubjects.map × allList`, up to 1000 retries each); watch the Workers CPU ceiling. (Agent 4)

### PRD / roadmap alignment (compute cadence is the crux)

- **Generating groupings is REQUIRED** (PRD FR-013, `prd.md:116`; recommendation rule, `prd.md:135-147`). **Auto-placement is a NON-GOAL** (`prd.md:173`). The legacy algorithm = the recommendation rule, not auto-placement. (Agent 3)
- **The 200ms budget is the VALIDATOR's, not the generator's** (PRD §NFR, `prd.md:128`). The roadmap explicitly splits the two by cadence: "grouping is a one-shot computation over the catalog snapshot (re-run only when the catalog changes), while validation is an online per-drop function" (`roadmap.md:22`). Grouping is deliberately moved **off** the hot path — "the grouping algorithm's own runtime is _not_ on the hot path — it ran once during S-06 and the output is cached" (`roadmap.md:224`).
- **F-03 explicitly requires:** pure function in `src/lib/`, operates on domain types not CSVs, edge-safe, **deterministic for a given catalog snapshot**, handles all collision classes the existing algorithm handles, output shape matches existing (`roadmap.md:101-115`). Risk: "must preserve the algorithm's collision rules verbatim" + parity test against `data/out/dp2-variants-2.csv` (`roadmap.md:114`).
- **S-06 `compute-groupings-from-catalog`** (`roadmap.md:186-198`) is the UI trigger: a "Compute groupings" action, output persisted to `course_groupings`, re-run explicit on catalog change, with "groupings out of date" detection.

## Porting options (within the locked scope)

All options run live against Supabase and feed `course_groupings`. They differ mainly on **where compute runs** and **how determinism is achieved**.

### Option A — Faithful port as a cached compute endpoint *(recommended; this is F-03 → S-06)*
- Three layers: (1) lift-and-shift pure algorithm + types + `utils/array.ts` into `src/lib/grouping/`; (2) rewrite the CSV loaders as Supabase queries (mirror the `snippets/*.sql` joins, expand overlaps/merges); (3) new `POST /api/grouping` (or an Astro server action) that fetches catalog, runs the solver in request scope, and upserts results into `course_groupings` / `course_grouping_members`.
- **Pros:** matches roadmap/PRD exactly; in-process (no external service, per PRD `prd.md:58`); off the 200ms hot path; reuses the ready schema.
- **Cons / must-resolve:** randomness vs. determinism (see Option A1/A2); Workers CPU ceiling for large catalogs.

  - **A1 — Make it deterministic.** Replace `Math.random` greedy + 1000 retries with a deterministic search (seeded PRNG, or exhaustive/ordered enumeration of maximal compatible sets). Satisfies F-03's determinism + golden-file parity. **Recommended sub-path.**
  - **A2 — Keep randomness, seed it.** Inject a seeded PRNG so output is reproducible per snapshot. Lower fidelity to "deterministic" intent; parity test harder.

### Option B — Compute in Postgres (SQL/RPC) instead of TS
- Express grouping as a recursive SQL query / Supabase RPC writing straight to `course_groupings`.
- **Pros:** zero Workers CPU cost; no data round-trip; naturally cached in DB.
- **Cons:** loses the "no external scheduling service / in-process" framing less cleanly; harder to unit-test in isolation; rewriting a graph independent-set search in SQL is non-trivial; diverges from F-03's "pure function in `src/lib/`" wording. Consider only if Option A hits the CPU ceiling.

### Option C — Async/queued compute (deferred)
- If catalog sizes outgrow a single Worker request, move compute to a queue/Durable Object/scheduled job and poll for results.
- **Cons:** tech-stack says "no background-job infrastructure is needed in MVP" (`tech-stack.md:36-38`). Premature now; note as a scale escape hatch.

### Rejected by scope
- Offline batch tool keeping CSV/`Bun.file` — the user chose runtime + Supabase. (Was a viable low-effort path otherwise.)

## Code References

- `legacy-grouping-algorithm/src/index.ts:8-14` — `hasIntersection` (teacher/student collision = the collision rule to preserve verbatim)
- `legacy-grouping-algorithm/src/index.ts:16-48` — `findOptions` / `allList` / `isUnique` (random greedy + 1000-retry search)
- `legacy-grouping-algorithm/src/index.ts:54-74` — variant scoring (`similar`, `students`, `rank`) and sort
- `legacy-grouping-algorithm/src/repository/loaders.ts:21,33,42` — `Bun.file` CSV reads (rewrite as Supabase queries)
- `legacy-grouping-algorithm/src/repository/subjects.ts:36-47` — subject assembly incl. overlap expansion + virtual merge subjects
- `legacy-grouping-algorithm/src/utils/saveAsCsv.ts:5-6` — `Bun.write` (replace with `Response` / DB upsert)
- `supabase/migrations/20260602185012_minimal_domain_schema.sql` — full domain schema (`course_groupings` L131, `course_grouping_members` L142, `course_overlaps` L51, `course_merges` L60, `courses` L29)
- `supabase/snippets/students_subjects.csv.sql`, `supabase/snippets/teachers_subjects.csv.sql` — DB→CSV mapping (the input-query blueprint)
- `src/lib/supabase.ts:6` — `createClient(headers, cookies)`; env via `astro:env/server`
- `src/pages/api/auth/signin.ts:1-9` — `APIRoute` handler template for the new endpoint
- `src/middleware.ts:7-11` — deny-by-default auth gate (new `/api/grouping` is auto-protected)
- `astro.config.mjs:7,11,16-22`, `wrangler.jsonc:4-6` — Cloudflare adapter + `nodejs_compat`

## Architecture Insights

- **Two paired rules, two cadences.** Recommendation (grouping — one-shot, cached, this port) vs. validation (per-drop, ≤200ms, online, built incrementally). Keep them as separate components; never embed the combinatorial generator in the validator.
- **Schema-first port.** F-02 pre-built the destination tables and dependency tables; porting is filling in behavior, not reshaping data.
- **Edge runtime is the binding constraint.** Anything Bun/FS-coupled is rewritten, not ported; everything pure lifts-and-shifts. Data always comes from Supabase.
- **Determinism is a first-class requirement** here (parity test + cache-by-snapshot), in direct tension with the legacy randomized search — the central design decision for `/10x-plan`.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:101-115` — **F-03 `port-grouping-algorithm`** fully specifies this work (pure function, edge-safe, deterministic, output-shape parity). Status `proposed`, promotes to `ready` once F-02 done (`roadmap.md:261`).
- `context/foundation/roadmap.md:186-198` — **S-06** defines the UI trigger + persistence + out-of-date detection.
- `context/foundation/roadmap.md:88-97` — **F-02** schema outcome + open question: `course_groupings` as materialized table vs. JSONB keyed by `(plan_id, cohort, catalog_hash)`.
- Commit `ee92448` "Minimal domain scheme" — landed the F-02 schema this port targets.
- `context/changes/minimal-domain-schema/` — the change that produced that schema (prior art for the data model).

## Open Questions

1. **Determinism strategy** (F-03 hard requirement): seed the PRNG vs. replace random-greedy with a deterministic/exhaustive maximal-compatible-set search? Affects the golden-file parity test against `data/out/dp2-variants-2.csv`.
2. **Output persistence** (F-02 open question): materialized `course_groupings` rows vs. JSONB blob keyed by `(plan_id, cohort, catalog_hash)`. Drives the "out of date" detection mechanism (timestamp compare vs. `catalog_hash` column, `roadmap.md:195`).
3. **`course_overlaps` direction**: legacy pulls `overlap`-side students *into* the subject; confirm the schema's `base`/`dependent` naming matches that direction before relying on it (Agent 2 caveat).
4. **Workers CPU ceiling**: no CPU-time limit is quoted in the foundation docs. For a real IB catalog (~30–60 courses, per PRD), does the random-greedy search complete within a single Worker request, or is Option B/C needed? Measure early (F-03 risk note).
5. **Compute surface**: Astro server action vs. dedicated `POST /api/grouping` endpoint — both edge-safe; pick during `/10x-plan`.

## Related Research

- None yet under `context/changes/**/research.md`. This is the first research artifact for `port-grouping-algorithm`.
- Closest sibling work: the `minimal-domain-schema` change (schema this port consumes).
