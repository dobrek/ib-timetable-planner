<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Comparing Plans

- **Plan**: `context/changes/comparing-plans/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-14
- **Verdict**: REVISE → **SOUND** (all 6 findings fixed in-plan)
- **Findings**: 2 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

21/21 paths ✓, 6/6 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (6 phases, 42 criteria, all mapped),
1/2 cited commands ✗ (see F4).

## Findings

### F1 — `courseIdentity` is keyed over the filtered catalog, but its three new consumers need every `courses` row

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1, items 4 and 5
- **Detail**: `CohortCatalog.courses` is a *filtered* projection — `load-cohort-courses.ts:72-74` drops every course with no direct students and no enrolled overlap-dependent, and replaces merge parents with virtual ones. A merge child with no direct choices is therefore absent from it. But the three app-loader queries Phase 1.5 deletes exist precisely to cover that gap: `CourseInfo`'s contract is *"Raw badge/display fields for EVERY course row in the plan — including merge children absent from the grouping catalog (no direct choices), which the course list still renders"* (`widgets/timetable-board/model/course-info.ts:3-6`). Feeding them `courseIdentity` would render those cards' titles as raw UUIDs (`PerspectiveCourseList.tsx:73` falls back to `{ name: item.courseId }`) and export their level as `""` (`perspective-workbook.ts:101`) — the exact UUIDs-where-names-belong failure this change exists to remove. Compounding it: `CourseIdentity` as specified cannot supply `CourseInfo.cohort`/`.hoursPerWeek`, and a course absent from `courses` has no `GroupingCourse` to read `hours` from either.
- **Fix A ⭐ Recommended**: Cut Phase 1.5; scope `courseIdentity` to `catalog.courses`
  - Strength: The comparison feature needs `courseIdentity` only for the analyzer join and the fingerprint — both of which see exactly `catalog.courses`. Phase 2's collapse of the *bench* loader's redundant query is a clean drop-in and is unaffected. Removes the change's only regression risk against three shipped surfaces for zero cost to the end state.
  - Tradeoff: The three redundant-looking `courses` queries stay; the "Phase 1 makes three existing loaders faster" perf note is deferred.
  - Confidence: HIGH — verified the filter at `load-cohort-courses.ts:72-74` and the `CourseInfo` contract docblock directly.
  - Blind spot: None significant.
- **Fix B**: Keep Phase 1.5, but source the map from the full `courseRows` set and widen `CourseIdentity` to `{cohort, name, level, groupIndex, hoursPerWeek}`
  - Strength: Keeps the query-deletion win; the data is already in memory.
  - Tradeoff: `courseIdentity` becomes a deliberate superset of `courses` — an asymmetry that needs a docblock or it becomes the next trap. Re-introduces the display regression risk.
  - Confidence: MEDIUM — no existing test covers merge-child card titles, so the regression would ship silently.
  - Blind spot: Whether any consumer reads `CourseInfo.cohort`/`.hoursPerWeek` at all.
- **Decision**: FIXED via Fix A — Phase 1.5 removed; Phase 1 is now purely additive. Deferral recorded in *What We're NOT Doing* (plan) and *Out of scope* (brief); the Key Discovery reworded to "only one of the four `courses` re-queries is actually redundant"; Performance Considerations corrected.

### F2 — No `pnpm check` gate in phases 1–5, on a type-heavy change

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Success Criteria (line 220), Progress 1.4, and phases 2–5
- **Detail**: The plan read "Type checking + lint pass: `pnpm lint`" — verbatim the anti-pattern `context/foundation/lessons.md` forbids ("Green build/test/lint ≠ type-safe": *never cite `pnpm build` or `pnpm lint` as a type-check; cite `pnpm check`*). esbuild strips types, so build/test/lint go green over a program with type errors, and the flat ESLint config has no type-aware rules. This change is almost entirely type surface — two barrels widened, a *required* field on a shared type — so type breakage is the most likely failure mode, and five of six phases could not see it.
- **Fix**: Add `pnpm check` to every phase's Automated Verification and the matching Progress entries.
- **Decision**: FIXED — all six phases now gate on `pnpm check && pnpm lint && pnpm steiger && pnpm build`; Progress 1.4 / 2.5 / 3.5 / 4.6 / 5.4 updated; the Desired End State verification line corrected.

### F3 — `Promise.all` over a throwing loader is not the plan-view error precedent it claims to follow

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5, item 1 (the route frontmatter)
- **Detail**: The plan claimed error handling "follows the plan-view precedent exactly (404 / 503)". That precedent works because `loadTeacherPlanView` returns a **Result**, which the route branches on (`[teacherId].astro:22`: `result.error.kind === "not-found" ? 404 : 503`). `loadPlanAnalysis` throws `DomainError`, and Phase 2 pins its signature unchanged — an uncaught throw in Astro frontmatter is a **500**. And `Promise.all` is all-or-nothing: with a URL explicitly designed to be shareable and bookmarkable, one deleted plan id takes down the whole page, including the plans that loaded fine. Plans are deletable, so a stale bookmark is the ordinary case, not an edge case.
- **Fix**: Load per-plan (`Promise.allSettled`, or a Result-returning wrapper in the slice's `api/` that keeps the loader's signature intact for `bench/`). Render what loaded, name what didn't; 404 only when zero plans resolved; a missing designated baseline falls back to a loaded plan and says so (deltas are baseline-relative — a silently-missing baseline renders a whole scoreboard of meaningless numbers).
- **Decision**: FIXED — Phase 5 item 1 rewritten with the four-case error table; new automated criterion 5.3 and manual criterion 5.7.

### F4 — The headline verification command does not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 (contract + success criteria), Phase 6 manual verification, plan-brief Success Criteria
- **Detail**: The plan cited `pnpm exec tsx bench/plan-quality.analyze.ts <planId>` four times, including as a Phase 2 success criterion and as the change's headline "digit-for-digit" claim. `tsx` is not a dependency, and `bench/plan-quality.analyze.ts` is not a script — it is a Vitest suite (`vitest.analyze.config.ts`, include `bench/**/*.analyze.ts`) that takes its plan ids from **env vars**, not argv. An implementer following the plan literally gets nothing, and the one check proving the UI and the analyzer agree is the one that wouldn't run.
- **Fix**: Replace all four citations with `ANALYZE_PLAN_A=<plan-id> [ANALYZE_PLAN_B=<plan-id>] pnpm analyze:plans`, noting the local-stack + `.env.test.local` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) prerequisite.
- **Decision**: FIXED — all four citations corrected in plan.md and plan-brief.md; Progress 2.2 reworded.

### F5 — `bench/` → `_pages/` is a new dependency direction, asserted as already-legal

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2, item 4
- **Detail**: Phase 2 justified the re-point with "`bench/` … already imports `@/shared/api` + `@/entities/timetable`". True, but `bench/` has never imported `src/_pages/**` — this is a *new* edge pointing a CLI at a page slice, and nothing enforces it: steiger lints `src/` only, and the flat ESLint config has no `no-restricted-imports` or boundaries rule. The guardrail ("import the `api` segment barrel, never the slice root") was prose with no gate behind it. Concrete hazard: the slice root barrel re-exports `ui/`, so a bench import of the root would drag React and Astro-adjacent modules into `pnpm analyze:plans`, a Vitest **node** run. The home itself is correct — `shared/` cannot import upward to `entities`, and `entities/timetable` is deliberately IO-free.
- **Fix**: Make the boundary a checked criterion: (a) bench imports only `@/_pages/plan-comparison/api`; (b) that segment barrel transitively reaches no `ui/` module; (c) an ESLint `no-restricted-imports` rule scoped to `bench/**` permits that one path and forbids every other `@/_pages/*`.
- **Decision**: FIXED — Phase 2 item 4 rewritten with the three-way enforcement; new automated criterion (Progress 2.4).

### F6 — `CourseIdentity` name collision with an existing, differently shaped type

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1, item 3
- **Detail**: `bench/fixture-courses.ts:20` already exports `CourseIdentity = { id, cohort, name, level, groupIndex }` — docblocked "A course's cross-plan identity. Clones mint new ids, so identity is the natural key." Same concept, different shape, used by `generation.experiment.ts` and `fixture-courses.test.ts`. After Phase 2 re-points `bench/` at this slice, both would be in scope in the same files.
- **Fix**: Name the new type `CourseNaturalKey` and cross-reference the two in its docblock, rather than shadowing.
- **Decision**: FIXED — type renamed to `CourseNaturalKey`; the `CohortCatalog.courseIdentity` *field* name is retained; docblock cross-references the bench type.

## Triage Summary

| Outcome | Findings |
|---|---|
| Fixed | F1 (Fix A), F2, F3, F4, F5, F6 |
| Skipped | — |
| Accepted | — |
| Dismissed | — |

**Verdict after fixes: REVISE → SOUND.** Phase 1 is now purely additive (no shipped surface changes),
every phase gates on the real type-checker, the route survives a stale plan id, the bench→slice boundary
is enforced rather than asserted, and the two mis-stated commands/types are corrected.

## Follow-ups spawned

- **Retire the three app loaders' `courses` queries properly** (`plan-detail`'s `fetchCourseLevels`, both plan-views' `fetchCourseInfo`). Doing it correctly means keying an identity map over the **full** `courses` row set — not the filtered grouping projection — and widening the natural-key type with `cohort` + `hoursPerWeek`. Deferred out of `comparing-plans` because it changes three shipped read surfaces and buys that feature nothing.
