---
date: 2026-06-24T15:54:25+0200
researcher: Dobromir Kropielnicki
git_commit: f2407eb95f40e651b3205cc242434bf07db42337
branch: main
repository: dobrek/ib-timetable-planner
topic: "Refreshing a stale grouping — feasibility, UI surface, and impact on the grouping/validation core"
tags: [research, codebase, grouping, staleness, catalog-hash, validation, placements, plan-detail]
status: complete
last_updated: 2026-06-24
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Resolved open questions — scope, indicator surface, and trigger decisions captured"
---

# Research: Refreshing a stale grouping

**Date**: 2026-06-24T15:54:25+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: f2407eb95f40e651b3205cc242434bf07db42337
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

The grouping algorithm is triggered when a user opens a board without any group — effectively we compute the cohort's groupings once. If the user later changes courses, student assignments, or teacher assignments, the board keeps using the grouping computed earlier. There is no indication that the grouping is out of date and no way to regroup. Is a "refresh grouping" feature feasible? What does it mean from the UI perspective — which views must be extended, or do we need a new view? How does it affect the current implementation, the grouping mechanism, the model, and the validation logic?

## Summary

**The feature is highly feasible — most of it is already built and tested, just never wired to the UI.** Two prior changes (`port-grouping-algorithm`, `first-valid-drop-with-validation`) deliberately shipped the *detection primitive* and the *recompute engine* but deferred the authoring/refresh surface to a slice historically called **"S-06"**, which was then orphaned when the roadmap was rewritten (current S-06 now means "combined two-cohort view"). So this change revives an explicitly-planned-but-dropped feature rather than inventing one.

What already exists and works:

- **Staleness detection** — `course_groupings.catalog_hash` (a SHA-256 fingerprint of the cohort catalog) plus `isGroupingStale(supabase, {planId, cohort})`, which recomputes the live hash and compares it to the stored one. Built, unit/integration-tested, **but called by no UI or loader** ([staleness.ts:13](https://github.com/dobrek/ib-timetable-planner/blob/f2407eb95f40e651b3205cc242434bf07db42337/src/_pages/plan-detail/api/staleness.ts#L13)).
- **A recompute engine that is already idempotent** — `computeGroupings` Action → `computeAndPersistGroupings` → `replace_cohort_groupings` RPC does an atomic `DELETE`+`INSERT` per `(plan_id, cohort)`. Re-running on a cohort that already has groupings simply overwrites them. **No backend blocker exists.**

What is missing is purely UI wiring:

1. The only entry point to compute is `ComputeGroupingsEmptyState`, which renders **only when `groupings.length === 0`** ([PlannerBoard.tsx:113](https://github.com/dobrek/ib-timetable-planner/blob/f2407eb95f40e651b3205cc242434bf07db42337/src/_pages/plan-detail/ui/PlannerBoard.tsx#L113)). Once groupings exist, there is no recompute control.
2. `isGroupingStale` is never called in `loadPlannerData`, so the board has no `stale` flag to render.

**The single most important safety finding for impact analysis:** placements/bundles are *fully decoupled* from groupings at the data layer — there is **no foreign key** from `placements` or `bundles` to `course_groupings`. Regrouping (the atomic replace) therefore **cannot touch placements at all** — no orphaning, no cascade-delete. Groupings drive only the *palette suggestions*; the board state and the validation core read `placements` + the live catalog, never the stored groupings. Consequently:

- **Regroup has zero impact on validation** — validation never consumes groupings.
- **Validation is already evaluated against the *live* catalog on every load**, so stale data already re-validates correctly today; staleness only makes the *palette* misleading (it suggests sets computed from an old catalog), never the board's collision verdicts.

So the work is small, localized, and low-risk: wire `isGroupingStale` into the load path, thread a per-cohort `stale` flag to the board, render an "out of date" indicator, and expose the existing `computeGroupings` Action as a "Recompute" control outside the empty-state branch.

## Detailed Findings

### 1. Current grouping lifecycle — trigger, algorithm, persistence

**Trigger is *not* automatic on page load.** Server load is a pure read; computation is a separate, user-clicked Astro Action.

- Route frontmatter reads existing rows: `src/pages/plans/[id]/index.astro:12` → `loadPlannerData(supabase, id, cohort)`. `loadPlannerData` only *reads* `course_groupings` (+ members); if none exist, `groupings` is `[]` (`src/_pages/plan-detail/api/load.ts:49-86`).
- The "no group exists" check is client-side: `if (groupings.length === 0)` renders the empty state instead of the board (`src/_pages/plan-detail/ui/PlannerBoard.tsx:113`).
- The empty state's "Compute groupings" button calls the client wrapper → Action, then `location.reload()` so the board re-renders from freshly persisted rows (`src/_pages/plan-detail/ui/ComputeGroupingsEmptyState.tsx:31,47-58`; `src/_pages/plan-detail/api/grouping-client.ts:7`).

So grouping is **run once, persisted, then read on every subsequent load** — never recomputed on load.

**Algorithm** (orchestration in `api/`, pure core in `model/`):

- Handler: `computeAndPersistGroupings(supabase, {planId, cohort})` — verify plan → `loadCohortCourses` → `computeGroupings(courses)` → `computeCatalogHash(courses)` → `persistGroupings(...)` (`src/_pages/plan-detail/api/grouping-compute.ts:26-47`).
- Pure core: `computeGroupings(courses, opts?)` enumerates maximal conflict-free sets per seed course plus an opposite-week (bi-weekly A/B) pass, scores and sorts; default cap 10,000 (`src/_pages/plan-detail/model/compute-groupings.ts:7`; `enumerate.ts:20,75`; `score.ts:4`).
- Inputs assembled by `loadCohortCourses` into `GroupingCourse[]` = `{ id, teacherKeys[], studentKeys[], hours, weekMode }` — folding course hours/week_mode, `course_teachers`, `student_choices`, `course_overlaps` (dependents), `course_merges` (children) (`src/shared/api/load-cohort-courses.ts:20-91`).
- Output: `GroupingResult { seedId, variants }` → persisted → read back as `PlannerGrouping { id, memberIds, coverageCount, score, oppositeWeek }`, the palette hint box (`src/_pages/plan-detail/model/grouping.ts:6,16,22`).

**Persistence** — tables `course_groupings` and `course_grouping_members` (`supabase/migrations/20260602185012_minimal_domain_schema.sql:131-147`, re-keyed to a native `cohort` enum in `20260611180006_plans_as_domain_root.sql:107-123`). The write path is a single atomic-replace RPC `replace_cohort_groupings(p_plan_id, p_cohort, p_catalog_hash, p_groupings jsonb)` that **deletes all rows for `(plan, cohort)` then reinserts** (`supabase/migrations/20260621130002_replace_cohort_groupings_opposite_week.sql:7-44`; called from `src/_pages/plan-detail/api/persist.ts:22`).

**Re-run is already possible at the domain layer.** Nothing guards "only if empty"; the replace RPC overwrites any existing rows transactionally. The compute Action takes only `{ planId, cohort }`. **The only thing blocking regroup today is that the UI gates the compute button behind `groupings.length === 0`.**

### 2. The staleness primitive already exists (and is unused)

- Column `course_groupings.catalog_hash text` (nullable) — `supabase/migrations/20260604141212_course_groupings_catalog_hash.sql:5-6`. Its comment: a stored hash differing from the live catalog hash = stale; null reads as stale. Indexed via `course_groupings_plan_cohort_hash_idx`.
- Hash function: `computeCatalogHash(courses)` — single SHA-256 (Web Crypto `crypto.subtle.digest`, workerd-safe) over a canonical, **code-point-sorted** serialization of `{id, teacherKeys, hours, studentKeys, weekMode}` (`src/shared/lib/catalog-hash/compute-catalog-hash.ts:13-27`; types at `src/shared/lib/catalog-hash/types.ts:10-17`). Shared by both persist and detection.
- Detector: `isGroupingStale(supabase, {planId, cohort})` — recompute current hash, fetch latest `course_groupings.catalog_hash` for `(plan_id, cohort)` ordered by `created_at DESC`, return stale if absent / null / mismatched (`src/_pages/plan-detail/api/staleness.ts:13-33`).
- **It is dead-ish code:** the only non-test reference is the integration test (`src/_pages/plan-detail/api/endpoint.integration.test.ts:5,78`). It is not even exported from `api/index.ts`. The JSDoc says "surfaces in the UI (no UI here)."

**Determinism caveat to preserve:** the canonical sort must stay code-point based — a prior `localeCompare` bug could "silently corrupt the catalog-staleness/clone feature" by producing different hashes across runtimes (fixed in `clean-up-shared-lib`). A fixed-digest test locks this. Don't reintroduce locale-sensitive sorting in any hashing path.

### 3. Feasibility of staleness detection — strategy comparison

The inputs that can invalidate a grouping, and the Actions that mutate them:

- **Courses / teacher set:** `createCourse`, `updateCourse` (delete+reinsert via `replace_course_teachers` RPC), `deleteCourse`, `createMerge`, `dissolveMerge`, `updateMergeHours`, `createOverlap`, `deleteOverlap` (all under `src/_pages/courses/api/`). Tables: `courses`, `course_teachers`, `course_overlaps`, `course_merges`.
- **Student assignments:** `createStudent`, `updateStudent` (insert/delete choice diff), `deleteStudent` (`src/_pages/students/api/`). Tables: `students`, `student_choices`.
- **Teacher assignments:** the teacher→course link lives only in `course_teachers` and is mutated *through course actions*, not the teacher slice. `deleteTeacher` cascades into `course_teachers`. **`teacher_availability` is NOT a grouping input** (it feeds validation only), so availability edits do not invalidate a grouping.

Strategy feasibility against *this* codebase:

| Strategy | Verdict | Why |
| --- | --- | --- |
| **(b) Content hash / fingerprint** | ✅ **Recommended — already built** | `catalog_hash` + `computeCatalogHash` + `isGroupingStale` exist. Folds overlaps/merges into `studentKeys`, so it catches *all* edits including row *removals*. Order-insensitive. Only work left is wiring. |
| (a) Timestamp comparison (`max(input.updated_at) > grouping.created_at`) | ❌ Not viable as-is | The high-churn junction tables (`student_choices`, `course_teachers`, `course_overlaps`, `course_merges`) have **only `created_at`, no `updated_at`**, and are *delete-reconciled* — a removed choice leaves no surviving row to carry a fresh timestamp. Would need new columns + triggers AND a deletes solution (soft-delete/tombstones). More schema, weaker correctness than the hash. |
| (c) Explicit version counter bumped per edit | ❌ Redundant | Needs a per-`(plan,cohort)` counter bumped in ~12 mutation paths (incl. cascade deletes and the `replace_course_teachers` RPC); easy to miss one → silent drift. The hash gives this for free and is content-addressed (a no-op edit doesn't falsely invalidate). |
| (d) Manual refresh only (no detection) | ⚠️ The de-facto state | `computeGroupings` is already user-triggered; this is "ship a button with no signal." Zero schema work, but it's exactly the gap the question targets — no indication the grouping is stale. |

Only **two `updated_at`-bearing strategies would be needed if we *didn't* have the hash** — but we do, so (b) dominates.

**`updated_at` availability (audited across all migrations):** present (via `moddatetime` trigger) only on `plans`, `teachers`, `courses`, `students`. Absent on every grouping/junction/placement table (`course_groupings`, `course_grouping_members`, `student_choices`, `course_overlaps`, `course_merges`, `course_teachers`, `placements`, `bundles`).

**Cohort scoping:** grouping, inputs, and detection are all strictly per-cohort (`cohort` enum `'dp1'|'dp2'`). `isGroupingStale` already filters `.eq("plan_id").eq("cohort")`. **Staleness must be computed and surfaced per-cohort** — dp1 can be fresh while dp2 is stale.

**One efficiency gotcha for wiring:** `isGroupingStale` calls `loadCohortCourses` again, and `loadPlannerData` *already* loads the catalog (`load.ts:65`). Wiring should reuse the already-loaded catalog (compute the hash once, compare) rather than double-fetch — keep it off the hot path.

### 4. Impact on placements & validation — the decoupling (key safety finding)

**Placements do not reference groupings.** `placements` columns are `id, plan_id, cohort, day, period, course_id, week, bundle_id`; its only FKs are `→ courses(plan_id, id)` and `→ bundles(plan_id, id)`. `bundles` references only `plans`. **Neither table has any FK to `course_groupings`/`course_grouping_members`** (verified across migrations).

Consequences of the atomic regroup (`replace_cohort_groupings` = delete+insert):

- Cascade is contained entirely within the grouping subtree (`course_grouping_members.grouping_fkey ... on delete cascade`). There is **no FK path from groupings to placements**, so regroup **does not orphan and does not cascade-delete any placement or bundle**. Existing board state is left fully intact.

**The board splits its data sources cleanly** (`src/_pages/plan-detail/api/load.ts:49-67` — two independent queries, no join):

- **Palette** is grouping-driven: `PlannerPalette` lists `PlannerGrouping[]` and filters by `memberIds` (`PlannerPalette.tsx:22-34`). Dragging a grouping resolves its `memberIds` against the *catalog*, not placement rows (`model/drop-hints.ts:58-60`). The grouping identity is **not** persisted onto the resulting placements.
- **Board state** is placement-driven: `usePlacements(props.placements, …)`; writes go through `place_course`/`move_bundle_members`/`remove_bundle_members` RPCs — none read or write groupings (`use-placements.ts`).

**Validation core** lives in `src/_pages/plan-detail/model/` — a five-constraint registry run by `explainCell` / `deriveCellViolations(placements, catalogById, availability, occupiedByTeacher)` (`model/constraints/index.ts:10-20`, `model/collisions.ts:37-67`): duplicate-course, teacher-conflict (week-aware), student-conflict (week-aware), teacher-availability, cross-cohort-teacher. **It consumes `placements` + the live catalog (and availability/sibling-occupancy) — never the stored groupings.** (Note the naming trap: the validation catalog type is also called `GroupingCourse`, but it is the live catalog projection from `loadCohortCourses`, not `course_groupings`.)

Therefore:

- **A catalog change DOES change validation outcomes for already-placed courses** — e.g. a course that gains a student will, on next board load, collide with co-located courses sharing that student, even though the placement row never changed. This happens **regardless of grouping** (validation re-runs over the live catalog every render: `PlannerBoard.tsx:60,190-196`).
- **Stale grouping does NOT cause incorrect validation.** Validation already evaluates against the new catalog. What goes stale is only the *palette's suggestions* (member-sets computed from an old catalog) — exactly what the hash flags. This is the precise scope of the problem: **a stale grouping misleads the author's drag palette; it does not silently corrupt collision verdicts.**

**One genuine silent gap (pre-existing, not caused by regroup):** placements whose course is absent from the validation catalog are *defensively skipped* — `bucketByCell` skips a placement when its `courseId` is not in `catalogById` ("cannot judge, skip defensively", `collisions.ts:88-89`), and sibling occupancy skips likewise (`load.ts:139`). This can only arise from a **course moved to the other cohort** (the placement keeps its old cohort). Such a placement renders/validates as a silent no-op. A "course delete" instead hard-deletes its placements via `placements_course_fkey ... on delete cascade`, so deletes need no reconciliation; the cohort-move case does.

### 5. Regroup trade-offs — what to do with existing placements (survey, no decision pre-locked)

Because placements survive regroup untouched, the trade-off is **not** "preserve vs discard at the data layer" (the data layer always preserves). It is about *what the author experiences after a refresh*:

- **Option A — Refresh palette only, keep placements (lowest risk, matches existing design intent).** Recompute replaces the palette; placements stay; the reactive validator re-flags any real conflict on next render ("accept-and-flag", the recorded stance in `group-dragging/research.md:54`). Pros: trivial, zero reconciliation code, consistent with the decoupled architecture. Cons: a placed course that the new catalog dropped from every candidate set is no longer *offered* in the palette but still sits on the board — acceptable (validation still judges it), but the author gets no explicit "this placement is now off-palette" hint.

- **Option B — Refresh + surface orphaned placements.** Same as A, plus a load-time diff of `placements.course_id` against the live catalog to emit an "orphaned placement" signal (covers the cohort-move silent gap in §4). Pros: closes the only real silent gap. Cons: new reconciliation logic in the load layer + a UI affordance to resolve (re-cohort or remove).

- **Option C — Refresh + clear board.** Drop placements on regroup. Pros: guarantees board only contains currently-groupable courses. Cons: destroys the author's manual scheduling work for what is usually a *small* catalog edit — almost certainly the wrong default; would need a hard confirm and likely an "are you sure" with undo. Not recommended except possibly as an explicit secondary action.

Recommended framing for planning: **default to Option A** (it's what the architecture already implies and what the historical design assumed), and treat **Option B's orphan detection** as an optional enhancement that also fixes a pre-existing bug. Reserve Option C, if at all, as an explicit destructive secondary action.

### 6. UI/UX surface — which views to extend (no new view required)

The board page tree (`src/pages/plans/[id]/index.astro` → `PlannerBoard.tsx`):

| Region | File | Role |
| --- | --- | --- |
| Header | `BoardHeader.tsx:12-20` | Plan name + `CohortSwitcher` + trailing `{children}` slot |
| Summary bar | `PlanSummaryBar.tsx:7-25` | Fills the header trailing slot with an incomplete-count message (`ml-auto`) |
| Palette (left aside) | `PlannerPalette.tsx:22-38` | Scrollable list of `GroupingBox` suggestions + leading-course filter |
| Grid (right main) | `PlannerGrid.tsx` | Slot timetable; an `ErrorBanner` already renders above it for placement errors |
| Empty state | `ComputeGroupingsEmptyState.tsx:18-41` | The existing compute UX (button → Action → reload), gated to `groupings.length === 0` |
| Cohort switcher | `CohortSwitcher.tsx:12-38` | Segmented links `?cohort=dp1/dp2`; switching = navigate + island remount |

**No new view is needed** — extend existing surfaces. Concrete options surfaced by the inventory:

1. **Stale indicator** — three placements, in increasing prominence:
   - a `Badge` in the `PlanSummaryBar` trailing slot (mirrors the "n courses left to place" pattern);
   - a full-width banner above the grid, reusing the `ErrorBanner` shape with `warning` tokens (`bg-warning/10 text-warning border-warning/50`) — the most visible;
   - a small badge atop the palette / in the `GroupingFilter` header (scopes the signal to where it matters most).
2. **Recompute control** — reuse the existing `computeGroupings` client wrapper + Action, exposed *outside* the empty-state branch. Natural home: a "Recompute groupings" button inside the stale banner, or an action in the header.
3. **Confirm dialog** — reuse `AlertDialog` (`src/shared/ui/alert-dialog.tsx`) following the `DeleteCourseDialog` / `MergeManageDialog` precedent and the `useConfirmAction` hook (`src/shared/lib/forms/use-confirm-action.ts`). Copy should state the actual effect, e.g. *"Recomputing replaces the suggestion palette with freshly calculated groupings. Your placed timetable is kept."* (true, per §4). If Option B/C is chosen, adjust copy accordingly.
4. **Refresh idiom** — follow the established pattern: compute Action → `location.reload()` / remount (board state hooks are init-once; the repo's convention is remount-to-reflect-new-server-data, see `cohort-switching`). Avoid introducing a live client store just for this.
5. **Per-cohort** — the indicator must reflect the *active* cohort's staleness (dp1/dp2 independent). The `stale` flag should be computed for the cohort being loaded and re-evaluated on cohort switch (which already remounts).

Reusable primitives confirmed present: `Badge` (`secondary`/`destructive`/`warning` variants), `Dialog`, `AlertDialog`, `sonner` toasts, `ErrorBanner`. Theme is token-driven — use semantic tokens (`bg-warning/10`, `text-warning`, `text-muted-foreground`), never palette colors (per the lessons register).

## Code References

Keystone files (permalinks at commit `f2407eb`):

- [src/_pages/plan-detail/api/staleness.ts:13](https://github.com/dobrek/ib-timetable-planner/blob/f2407eb95f40e651b3205cc242434bf07db42337/src/_pages/plan-detail/api/staleness.ts#L13) — `isGroupingStale` detector (built, tested, **unwired**).
- [src/_pages/plan-detail/api/grouping-compute.ts:26](https://github.com/dobrek/ib-timetable-planner/blob/f2407eb95f40e651b3205cc242434bf07db42337/src/_pages/plan-detail/api/grouping-compute.ts#L26) — `computeAndPersistGroupings` (recompute engine; already idempotent).
- [src/_pages/plan-detail/api/grouping-actions.ts:5](https://github.com/dobrek/ib-timetable-planner/blob/f2407eb95f40e651b3205cc242434bf07db42337/src/_pages/plan-detail/api/grouping-actions.ts#L5) — `computeGroupings` Astro Action (reuse for "Recompute").
- [src/_pages/plan-detail/api/load.ts:49](https://github.com/dobrek/ib-timetable-planner/blob/f2407eb95f40e651b3205cc242434bf07db42337/src/_pages/plan-detail/api/load.ts#L49) — `loadPlannerData`; where a per-cohort `stale` flag would be computed and threaded.
- [src/_pages/plan-detail/ui/PlannerBoard.tsx:113](https://github.com/dobrek/ib-timetable-planner/blob/f2407eb95f40e651b3205cc242434bf07db42337/src/_pages/plan-detail/ui/PlannerBoard.tsx#L113) — the `groupings.length === 0` gate; where a stale banner/recompute control plugs in.
- [src/_pages/plan-detail/ui/ComputeGroupingsEmptyState.tsx:14](https://github.com/dobrek/ib-timetable-planner/blob/f2407eb95f40e651b3205cc242434bf07db42337/src/_pages/plan-detail/ui/ComputeGroupingsEmptyState.tsx#L14) — existing compute UX + the "S-06 deferred" note to mirror.
- [src/shared/lib/catalog-hash/compute-catalog-hash.ts:13](https://github.com/dobrek/ib-timetable-planner/blob/f2407eb95f40e651b3205cc242434bf07db42337/src/shared/lib/catalog-hash/compute-catalog-hash.ts#L13) — the shared SHA-256 fingerprint (code-point sort; don't reintroduce `localeCompare`).
- [src/shared/api/load-cohort-courses.ts:20](https://github.com/dobrek/ib-timetable-planner/blob/f2407eb95f40e651b3205cc242434bf07db42337/src/shared/api/load-cohort-courses.ts#L20) — the catalog projection that feeds both grouping and validation (reuse to avoid double-fetch).
- [src/_pages/plan-detail/model/collisions.ts:37](https://github.com/dobrek/ib-timetable-planner/blob/f2407eb95f40e651b3205cc242434bf07db42337/src/_pages/plan-detail/model/collisions.ts#L37) — `deriveCellViolations` (validation; consumes placements + live catalog, not groupings; defensive off-catalog skip at L88-89).

Supporting:

- `supabase/migrations/20260604141212_course_groupings_catalog_hash.sql:5` — `catalog_hash` column.
- `supabase/migrations/20260621130002_replace_cohort_groupings_opposite_week.sql:7` — atomic replace RPC (delete+insert).
- `supabase/migrations/20260611180006_plans_as_domain_root.sql:91-123` — placements→courses/bundles and grouping_members→groupings/courses FK shape (no placement→grouping link).
- `src/_pages/plan-detail/model/constraints/index.ts:10` — the five-constraint validation registry.
- `src/_pages/plan-detail/ui/CohortSwitcher.tsx:12` — per-cohort navigation/remount.
- `src/shared/ui/alert-dialog.tsx`, `src/_pages/courses/ui/DeleteCourseDialog.tsx`, `src/shared/lib/forms/use-confirm-action.ts` — destructive-confirm precedent.

## Architecture Insights

- **The detection + compute machinery was built ahead of its UI, then orphaned.** This is a "finish the wiring" change, not a greenfield feature. The risk profile is unusually low: the hard parts (deterministic edge-safe hashing, atomic replace, idempotent compute) are done and tested.
- **Groupings are suggestions; placements are truth.** The deliberate absence of a `placements → course_groupings` FK is the architectural reason regroup is safe. Any plan must preserve this decoupling — do **not** introduce a FK or otherwise couple placements to a grouping identity.
- **Validation is grouping-agnostic and always live.** It recomputes over `placements` + current catalog every render. This means "stale grouping" is purely a palette-fidelity problem; the board's correctness is already guaranteed by the reactive validator. Frame the feature to the user as "your suggestions are out of date," not "your timetable may be invalid."
- **Staleness is a per-cohort property.** dp1/dp2 hash independently; the indicator and recompute must be cohort-scoped, and cohort switching already remounts (so re-evaluation is free).
- **The hash is the source of truth for "out of date."** It correctly catches removals (which timestamps can't, given delete-reconciled junctions). Keep the canonical serialization deterministic (code-point sort, Web Crypto).
- **Keep compute off the hot path.** Grouping is a one-shot computation; the <200ms budget is for the per-drop validator, not compute. But avoid double-loading the catalog when computing the stale flag on every board load — reuse the catalog `loadPlannerData` already fetches.

## Historical Context (from prior changes)

- `context/archive/2026-06-04-port-grouping-algorithm/plan.md:40,310` and `research.md:95-97` — shipped the algorithm + persistence + the `catalog_hash` staleness *helper*, explicitly **deferring** the "Compute groupings" management UI, the ranked-list rendering, and the "out of date" badge to "S-06". Chose `catalog_hash` over timestamp comparison for out-of-date detection (`plan-brief.md:25`). Recorded that grouping is a one-shot cached computation, off the validation hot path.
- `context/archive/2026-06-05-first-valid-drop-with-validation/plan.md:35,136` — re-confirmed the deferral: shipped only a single bootstrap "Compute groupings" button gated behind the empty state; "re-compute on catalog change, staleness badges — that is S-06."
- `context/foundation/archive/2026-06-18-roadmap.md:185-194` — old **S-06 = "compute-groupings-from-catalog"**: *"The author can re-run the computation explicitly when the catalog changes; the UI surfaces 'groupings out of date' when catalog mutations have happened since the last run."* The open question (timestamp vs hash) was resolved in favor of the hash.
- `context/foundation/roadmap.md:24,147` — current **S-06 = "Combined two-cohort view"**. The recompute/staleness slice no longer has a roadmap home — this change revives it. (Caution: "S-06" in old code comments ≠ current S-06.)
- `context/archive/2026-06-12-group-dragging/research.md:54` — the only explicit acknowledgment of stale-catalog-vs-stored-groupings: *"the `catalog_hash` staleness machinery exists … and `deriveCollisions` would still flag any real conflict post-drop — accept-and-flag covers the edge."* This is the recorded reconciliation stance: don't pre-reconcile; let the validator self-heal.
- `context/archive/2026-06-13-slot-as-a-group/` — note the naming overlap: the lock-icon "ungroup/regroup" of co-located chips writes `slot_bundles`/bundles and is **unrelated** to catalog staleness. Don't conflate "regroup a slot" with "regroup the cohort."
- `context/archive/2026-06-11-multi-variant-management/` — clone is the only place placement-vs-grouping consistency was engineered: a deep clone recomputes `catalog_hash` JS-side so cloned groupings don't read as falsely stale, *assuming a stale-handling UI that doesn't yet exist*. Confirms this change closes a known loop.
- `context/archive/2026-06-14-clean-up-shared-lib/research.md:98` — the `localeCompare`-in-hash bug that "can silently corrupt the catalog-staleness/clone feature"; locked by a fixed-digest test. Preserve code-point sorting.
- `context/archive/2026-06-22-cohort-switching/plan-brief.md:23` — cohort switch = navigate + island remount; board state hooks are init-once. The refresh idiom should follow reload/remount, not a live store.

Relevant lessons (`context/foundation/lessons.md`): "Port the mechanism, not the legacy type shape" (the validation `GroupingCourse` is a catalog projection — keep identity opaque); "Use semantic theme tokens" (stale banner must use `warning`/token classes); "Astro Actions are the single transport" (reuse `computeGroupings`, no new API route); "`astro check` is the mandatory type gate" (for any plan's success criteria).

## Related Research

- `context/archive/2026-06-04-port-grouping-algorithm/research.md` — original grouping algorithm exploration.
- `context/archive/2026-06-12-group-dragging/research.md` — palette→board drag and the accept-and-flag stance.
- `context/archive/2026-06-13-slot-as-a-group/research.md` — board bundling and reactive validation.

## Decisions (2026-06-24)

The open questions were resolved with the user. These are the agreed constraints for `/10x-frame` / `/10x-plan`:

1. **Regroup placement policy → keep placements, refresh palette only (Option A).** Recompute replaces only `course_groupings`; the timetable is untouched. The reactive validator re-flags any real conflict on next render (accept-and-flag). No board-clear, no placement migration. Tightest scope.
2. **Indicator + control → palette-scoped notice with an inline "Recompute" button**, at the top of `PlannerPalette` (above the leading-course filter). Rationale: only the *suggestions* are stale, not the timetable — a palette-local notice is the most honest placement and avoids implying board-wide invalidity. Use `warning` semantic tokens (`bg-warning/10`, `text-warning`); reuse the existing `computeGroupings` Action + reload/remount idiom. Must be **per-cohort** (re-evaluated on cohort switch, which already remounts).
3. **Trigger → manual only.** Author clicks "Recompute" when the stale notice shows. No auto-recompute on catalog change (avoids overwriting the ranked palette mid-edit and extra write load; matches the one-shot/off-hot-path design).
4. **Catalog load → reuse, don't double-fetch.** Compute the stale flag from the catalog `loadPlannerData` already loads (`load.ts:65`); compute the hash once and compare to the stored `catalog_hash`. Refactor `isGroupingStale` to accept an already-loaded catalog and export it from `api/index.ts` (keeps it unit-testable, off the hot path).

## Deferred / follow-up (out of scope for this change)

- **Cohort-move orphaned placements (pre-existing silent bug).** A course moved to the other cohort leaves a placement under the old cohort whose `course_id` is absent from that cohort's catalog; `bucketByCell` then *defensively skips* it (`collisions.ts:88-89`), so it renders/validates as a silent no-op (can sit colliding yet show clean). This is **independent of grouping refresh** and was deliberately scoped out (decision #1 = keep placements only). Recommend opening a separate change to detect and surface/repair such orphaned placements at the load layer. Flagged here so it isn't lost.

## Open Questions

- None blocking. Detailed UX wording, the exact notice copy, and whether the notice also shows a "last computed" timestamp are design details for `/10x-frame` / `/10x-plan`.
