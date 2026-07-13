<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Plan-Quality Analyzer

- **Plan**: `context/changes/plan-quality-analyzer/plan.md`
- **Scope**: Full plan (Phases 1–4)
- **Date**: 2026-07-13
- **Verdict**: NEEDS ATTENTION → **all findings triaged, 8 fixed / 1 skipped**
- **Findings**: 0 critical, 5 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING → resolved (F1 fixed) |
| Scope Discipline | WARNING → resolved (F6 recorded as addendum) |
| Safety & Quality | WARNING → resolved (F2, F3, F4, F8, F9 fixed; F5 skipped) |
| Architecture | PASS |
| Pattern Consistency | WARNING → resolved (F7 fixed) |
| Success Criteria | PASS |

Gate verified live, before and after the fixes: `pnpm check` (0 errors) · `pnpm lint` · `pnpm steiger`
· `pnpm test` (159 files, 1336 tests) · `pnpm build` · `pnpm analyze:plans` graceful skip.

Guardrails all held: no schema change, no engine/objective change, no in-app surface, no report-file
emission, `GroupingCourse` and the shared loaders untouched, module stays Workers-safe.

**Post-fix regression run** (Golden Plan vs Golden Catalog Clone, local stack): every golden number
unchanged after the F3 refactor — 48/47 occupied slots, 0 unplaced, 101/125 adjacent pairs, 0 splits,
86 cohort switches, **9 mirrored cells**, oracle-valid YES / 0 soft warns.

## Findings

### F1 — comparison-report.md still asserts 10 mirrored cells

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `context/changes/plan-quality-analyzer/comparison-report.md:171,173`
- **Detail**: The analyzer found 9 mirrored cells, not the 10 the Phase-4 contract demanded. The correction is sound and evidenced (analyzer enumerates 9 by name; fresh SQL agrees under both candidate keys; the report's own prose enumerates nine). But it was never propagated: `comparison-report.md` — the plan's named "acceptance numbers" doc and the input to the next change — still said "10 — all deliberate", and `change.md` carried both claims. Same class as the lessons.md rule on docs coupled to the mechanisms they cite.
- **Fix**: Corrected both docs to 9 with a dated "corrected by analyzer run #1" note.
- **Decision**: FIXED

### F2 — Runner uses the service-role key with no local-stack guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Security)
- **Location**: `bench/plan-quality.analyze.ts:30-31,74`
- **Detail**: `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` came from `.env.test.local` with the client built on the service-role key (RLS bypass), and nothing enforced the plan's "local stack only" guardrail. A mis-set env file would silently point the runner at the hosted project and print real course names, student keys and teacher ids to stdout. Read-only, so the exposure is disclosure, not mutation.
- **Fix**: Added `assertLocalStack` — refuses a non-`127.0.0.1`/`localhost` host before `createClient`, with an explicit `ANALYZE_ALLOW_REMOTE=1` override.
- **Decision**: FIXED

### F3 — Delimiter round-trip on free-text course names

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Correctness)
- **Location**: `src/entities/timetable/model/analysis/cross-cohort.ts:143,153`
- **Detail**: `mirroredCells` built the key `${name}|${level}|${day}|${period}` and parsed it back with `key.split("|")`. Unlike `lanes.ts` (UUID keys, documented as such), `name`/`level` are free-text DB columns: a course named `"Math AA | HL"` makes `day`/`period` parse to `NaN` and mislabels the cell. `sharedSubjectEditionDays` shared the collision hazard. This is the fixture detector the next change pre-pins from.
- **Fix**: Identity is now carried in the Map *value*, never parsed back out; grouping keys are JSON-encoded via a `groupKey` helper so a `|` in a name cannot collide.
- **Decision**: FIXED

### F4 — Loader silently drops the catalog's data-quality warnings

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: `bench/load-plan-analysis-input.ts:102-107`
- **Detail**: `loadCohortCourses` returns `catalog.warnings` (`no-students`, `zero-hours`) and the loader discarded them. A `zero-hours` course reads as "complete"; a `no-students` course contributes nothing to the slot census — silent distortion in a tool whose whole product is trustworthy figures.
- **Fix**: `warnings` carried on `LoadedPlan` (cohort-tagged) and printed beside each plan's verdict.
- **Correction found while verifying**: the review's original rationale claimed this channel would have caught the dp1 Chemistry finding. It would **not**. `collectWarnings` (`load-cohort-courses.ts:188`) only walks courses that *survived* the projection, so a course dropped for zero direct enrolments can never warn about itself. Both real catalogs currently raise zero warnings. The detector for that class is `uncataloguedRows` / `overplacedHours` in `completeness.ts` — a course-shaped hole is only visible from the board side. Recorded accurately in the plan addendum.
- **Decision**: FIXED

### F5 — Gitignore glob is name-specific, not directory-wide

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Data safety)
- **Location**: `.gitignore:74`
- **Detail**: `/data/golden-plan*.sql` ignores today's dump (verified untracked), but only that one name — `data/gold-plan.sql`, `data/golden.sql` or `data/plan-dump.sql` would all be committed with real student and teacher names. No legitimate `.sql` belongs under `data/` (the seed lives at `supabase/seed.sql`).
- **Fix**: Broaden to `/data/*.sql`.
- **Decision**: SKIPPED — still open; worth revisiting if another dump format lands under `data/`.

### F6 — completeness.ts exceeds its "thin wrapper" contract

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `src/entities/timetable/model/analysis/completeness.ts:28-36`
- **Detail**: The plan specified a thin wrapper over `deriveGenerationDeficits`; the implementation adds `overplacedHours`, `overplaced` and `uncataloguedRows` (correctly never netted against the shortfall). Unauthorized metric surface — but it is what surfaced the change's most valuable discovery (the dp1 Chemistry overlap-base modeling gap). Related benign extras: `stats.ts`, `TeacherFeatures.strongAvailabilityHits`, `snapshot`/`board` on the loader, and `reporters: ["verbose"]` in `vitest.bench.config.ts` (a genuine fix — Vitest 4 was swallowing the bench's printed report).
- **Fix A ⭐ Recommended**: Record the extras as a plan addendum.
- **Decision**: FIXED via Fix A — plan.md gained an "Addendum — implemented beyond contract" section covering all extras, including the two fixes from this review.

### F7 — Entity barrel re-exports the analyzer's entire surface

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/entities/timetable/index.ts:29`
- **Detail**: `export * from "./model/analysis"` published 14 functions (`expandLanes`, `laneStats`, `distribution`, `worstOf`, `subjectByName`…) and 24 types into the app-facing barrel — directly beneath the comment explaining why the greedy engine is exported *narrowly*, "not test-only internals". Bundle cost is nil (verified: Rollup tree-shakes the module out of `dist/`), so the cost is public-API width. `ANALYZED_COHORTS` was exported through both barrels with zero consumers.
- **Fix**: Narrowed to `{ analyzePlan, AnalyzerCourse, AnalyzerRow, Distribution, PlanAnalysisInput, PlanQualityFeatures }`; deleted the dead `ANALYZED_COHORTS`. The module's own tests import relatively, so nothing broke.
- **Decision**: FIXED

### F8 — Empty days inflate the "free at day start" headline

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Correctness)
- **Location**: `src/entities/timetable/model/analysis/board-shape.ts:34`
- **Detail**: An entirely unused day has no span, so all of its periods count as "before the first lesson" and land in `freeSlotsAtDayStart`. The runner prints that as the headline "Free at day START" — the metric meant to separate the expert's packed mornings from the engine's free ones. An unscheduled Friday would read as +10 free mornings, inverting the metric's meaning.
- **Fix**: Added `emptyDays` to `BoardShapeFeatures`, printed beside the edge counts — the same invariant the runner already enforces for slots-vs-unplaced-hours. Per-day identity (`occupied + freeAtStart + freeAtEnd + interiorHoles === periods`) left intact. Both current boards report 0, so the caveat is inert today.
- **Decision**: FIXED

### F9 — Bench ignores the teacher_availability query error

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: `bench/generation.bench.ts:86-91`
- **Detail**: `availability` was consumed as `(availability.data ?? [])` with `.error` never checked. A failed read silently degraded the bench to "no availability constraints" and it still passed — a green bench proving nothing. Pre-existing, but the file is in this diff and the sibling loader already models it correctly.
- **Fix**: Reuses `loadTeacherAvailability` + `unwrapMany`, so a failed read throws.
- **Decision**: FIXED

## What came out clean

- The lane primitive is **semantically identical** to `countStudentHoles` (not merely similar), and the parity is pinned by a real assertion against the shipped function rather than a restatement.
- `stats.ts` handles empty and single-element arrays without NaN; every division site is guarded or provably non-empty.
- No `.sort()` mutates a parameter anywhere in the diff.
- The Supabase loader has no N+1 (4 parallel top-level reads, 3 parallel per cohort) and checks `.error` on every query. Nothing in `bench/` writes to the DB.
- `git diff` over `model/generation/`, `src/shared/`, and `supabase/` is empty — the engine, the shared loaders, and the schema are untouched.
