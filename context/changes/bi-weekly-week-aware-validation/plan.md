# Bi-weekly Week-Aware Validation Implementation Plan

## Overview

Most courses meet every week, but a few run **fortnightly** — only on week A or only on week B of a
two-week cycle. This change makes "week" a first-class dimension so the board validator and the
grouping palette understand it:

- A **course** carries an eligibility flag `weekMode ∈ { agnostic, biweekly }` (intrinsic catalog data).
- A **placement** carries the actual assignment `week ∈ { both, a, b }` (invariant: an `agnostic`
  course is always `both`; a `biweekly` course resolves to `a` or `b`).
- The **board** stops flagging two placements that share a `(day, period)` slot on **disjoint weeks**
  (one `a`, one `b`) as a collision. A `both` placement runs every week, so it still collides.
- The **grouping palette** surfaces two normally-conflicting courses that are **both bi-weekly** as a
  placeable **opposite-week (A/B)** grouping, instead of silently excluding them.

This implements PRD FR-002 (mark a course bi-weekly; choose the week at placement), FR-003
(week-aware validator), FR-006's occupancy half (within a cohort), and US-03.

## Current State Analysis

There is **no week concept today** — the only "week" token in the codebase is `hours_per_week`.

- **Schema.** `courses` (`supabase/migrations/20260611180006_plans_as_domain_root.sql:36-43`) and
  `placements` (`:91-103`, unique on `(plan_id, cohort, day, period, course_id)`) carry no week
  column. The live `clone_plan` is `20260621120000_clone_plan_drop_teacher_id.sql` (the
  `20260620120002` version the research cites was superseded by the teacher_id drop) — its courses
  insert is section 3 (`:77-80`) and placements insert section 7 (`:122-127`). Grouping persistence
  flows through the `replace_cohort_groupings` RPC — the **live** definition is in
  `20260611180006_plans_as_domain_root.sql:133-169` (params `p_cohort public.cohort`, column `cohort`);
  the earlier `20260604141213_replace_cohort_groupings_fn.sql` is **superseded** (it used
  `p_cohort_id uuid` + the since-dropped `cohort_id` column — do **not** copy from it) — and the
  `course_groupings` table.
- **Two validation paths, one conflict primitive.** `deriveCellViolations` → `bucketByCell` →
  `explainCell` is the authoritative board path (`collisions.ts:41-90`, `constraints/index.ts:17-18`);
  `violatesAny` → `hasIntersection` is the ctx-free pairwise primitive used by enumeration and drag
  hints (`constraints/index.ts:24-25`). `bucketByCell` currently **discards the placement** and keeps
  only the `GroupingCourse`, so placement week is not visible to the board yet.
- **`BoardContext` is designed for additive board-only fields** (`constraints/types.ts:19-26`) —
  teacher-availability already rides it; week rides the same pattern, leaving the `CellConstraint`
  interface untouched.
- **Catalog projection** `loadCohortCourses` (`load-cohort-courses.ts:19-87`) builds
  `GroupingCourse { id, teacherKeys, studentKeys, hours }` (`catalog-hash/types.ts:8-13`) from
  `courses` rows; `computeCatalogHash` (`compute-catalog-hash.ts:13-26`) fingerprints
  `{id, teacherKeys, hours, studentKeys}` for grouping-staleness detection.
- **Enumeration** `enumerateVariants` (`enumerate.ts:20`) finds maximal conflict-free sets;
  `computeGroupings` (`compute-groupings.ts:7`) scores via `scoreVariant` (`score.ts:3`);
  `persistGroupings` (`persist.ts:21`) dedups member-sets and calls the RPC.
- **Placement runtime** `PlannerPlacement = { id, courseId, day, period }` (`placement.ts:2-7`);
  create/read in `placements.ts` (Zod input `:10-16`, `toPlannerPlacement` `:27-32`, idempotent
  `insertPlacement` `:39-69`).
- **Seed** is catalog-only (`scripts/gen-seed.mjs:53-67` courses INSERT, keyed by `r.name`); EE and
  CAS appear as course names in both `data/dp1` and `data/dp2`, and overlap each other
  (`data/dp1/subjects_overlap.csv:9-10`).
- **UI.** `SlotCell.tsx` renders occupants as `PlacedChip` (`:166-280`) with a destructive ring for
  blocking collisions; `CourseFormDialog.tsx` (`:115-170`) holds the catalog form;
  `GroupingBox.tsx` (`:47-69`) renders palette groupings; `CollisionDetailsDialog.tsx` (`:56-163`)
  explains violations; `drop-hints.ts` derives drag affordances (`DropHint` union `:21`).

## Desired End State

An author can mark a course bi-weekly in the catalog form; place it on the board and assign it to
week A or B from a per-chip control; see week-A and week-B placements stacked in vertical lanes inside
a slot; share a slot between two opposite-week courses with **no** collision ring; and drag a
palette-suggested **opposite-week (A/B)** grouping (e.g. EE + CAS in the seed) into a slot in one
motion. Same-week overlaps still flag exactly as today. The local CI gate (`/verify`), the
integration suite, and the existing e2e suite all stay green.

### Key Discoveries:

- `BoardContext` absorbs week as an additive optional field — **no `CellConstraint` interface change**
  (`constraints/types.ts:19-26`).
- `bucketByCell` is the single choke-point where placement week must be threaded into the board path
  (`collisions.ts:76-90`); each course is unique per cell (unique key), so a per-cell
  `weekByCourseId` map is safe.
- The conflict primitive `violatesAny`/`hasIntersection` is **reused unchanged**; enumeration and the
  drag path *classify* its result (hard vs soft edge) rather than rewrite it.
- `weekMode` must enter `computeCatalogHash`, or grouping-staleness detection drifts
  (`compute-catalog-hash.ts:13-26`).
- The live clone fn is `20260621120000_clone_plan_drop_teacher_id.sql` — not the research-cited
  `20260620120002`.

## What We're NOT Doing

- **No cross-cohort week-aware occupancy** (FR-005/FR-006 across cohorts) — that is the next change
  (S-04). Week is made first-class on the placement as a clean enabler, with **zero** cross-cohort
  scaffolding added now.
- **No enumeration v2** — general mixed sets (an agnostic course plus several bi-weekly courses in one
  slot, resolved by full bipartite 2-coloring). v1 surfaces opposite-week **pairs** only; the board
  still validates any larger week-disjoint set the author hand-builds.
- **No change to the placements unique key** — a course occupies a slot once; splitting one course
  across both weeks of a single slot is out of scope.
- **No week-aware hours/coverage math, and no hours column rename.** One placement row = one placed
  unit, week-blind: a placement is one cell in the weekly grid, which for a bi-weekly course simply
  recurs every other week, so `hours_per_week` read as "hours per active week" already maps cleanly
  (and `deriveHours` counts rows-vs-required identically for both course types). The column keeps its
  name in this change; a fortnight-explicit rename (`hours_per_cycle` / `sessions`) is **deferred to a
  separate, self-contained refactor** — it is cross-cutting (schema + types + transcode + `normHours`
  + courses form/table + clone fn + catalog projection) and orthogonal to bi-weekly *validation*.
  Week-aware contact-load / over-placement semantics belong to the deferred finalize-completeness gate
  (`hours.ts` is display-only today).
- **No change to `duplicate-course` or `teacher-availability`** — both stay week-agnostic (FR-006).
- **No new e2e** — the existing Playwright suite guards UI regressions.

## Implementation Approach

Build bottom-up in five layers, each independently unit/integration-testable:
**data foundation → board validator → catalog + enumeration → course-authoring UI → board week UI.**
Week is plumbed end-to-end first (no behavior change), then the validator relaxes, then the palette
gains value, then the two UI surfaces (input and board) light it up. Reuse beats rewrite throughout:
the conflict primitive, the scoring formula, and the `BoardContext` additive pattern are all reused;
only `bucketByCell`, the two conflict `explain()` bodies, the enumeration post-pass, and the drag
classifier gain week awareness.

## Critical Implementation Details

- **`weeksDisjoint` is the one shared primitive.** `weeksDisjoint(a, b) === a !== "both" && b !== "both" && a !== b`.
  A `both` (agnostic) week overlaps everything. The board relaxation, the enumeration soft-edge
  classifier, and the soft-aware drag hint all derive from this one helper plus the rule **soft edge =
  conflict AND both courses `biweekly`; hard edge = conflict AND ≥1 course `agnostic`.** Keep it a
  named export (`model/week.ts`), not inline — S-04's cross-cohort check reuses it.
- **Relax by removing violations, never by adding a "week-warning" severity.** This preserves the
  `collisions.ts:94-105` invariant that every kind except `teacher-unavailable` is `block`.
- **`teacher-conflict` is multi-course, not pairwise.** A teacher with three courses `{both, a, b}` is
  still conflicted (the `both` course overlaps both single-week ones); only the `a`+`b` pair alone is
  disjoint. The relaxed rule: a teacher conflicts iff ≥2 of its courses are pairwise **non**-disjoint,
  and the violation reports only those overlapping course ids. `student-conflict` is already pairwise,
  so it is a clean per-pair skip.

---

## Phase 1: Data Foundation (week as first-class data)

### Overview

Add the week columns and enums end-to-end with **no behavior change** — schema, clone, generated
types, the reusable `Week` type + `weeksDisjoint` helper, the placement runtime/API + a
`updatePlacementWeek` action, the course-input Zod field + course-action threading, and the seed
(EE/CAS bi-weekly in both cohorts).

### Changes Required:

#### 1. Schema migration — enums + columns

**File**: `supabase/migrations/<timestamp>_bi_weekly_week_columns.sql` (new)

**Intent**: Introduce the two week enums and three new columns, all with safe defaults so existing
rows and the deny-by-default grants are unaffected.

**Contract**: `create type course_week_mode as enum ('agnostic','biweekly')` and
`create type placement_week as enum ('both','a','b')`. `alter table courses add column week_mode course_week_mode not null default 'agnostic'`;
`alter table placements add column week placement_week not null default 'both'`;
`alter table course_groupings add column opposite_week boolean not null default false`. Unique keys
unchanged. No grant changes (additive columns inherit table grants).

#### 2. Schema migration — `clone_plan` replace

**File**: `supabase/migrations/<timestamp>_clone_plan_with_week.sql` (new)

**Intent**: Carry the three new columns through clone so cloned plans preserve week data.

**Contract**: `create or replace function clone_plan(...)` copied verbatim from
`20260621120000_clone_plan_drop_teacher_id.sql`, adding `week_mode` to the courses insert (section 3,
`:77-80`), `week` to the placements insert (section 7, `:122-127`), and `opposite_week` to the
`course_groupings` insert (section 8, `:138-141`). Keeps `security invoker` and the signature.

#### 3. Regenerate database types

**File**: `src/shared/api/database.types.ts`

**Intent**: Reflect the new columns/enums in the generated types after `db reset`.

**Contract**: Regenerated artifact — `courses.week_mode`, `placements.week`,
`course_groupings.opposite_week`, and the two enum unions appear. Generated, not hand-edited.
Regenerate after `db reset` with:
`pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts`.

#### 4. Reusable week primitive

**File**: `src/_pages/plan-detail/model/week.ts` (new) + `week.test.ts`

**Intent**: A single home for the `Week`/`weekMode` types and the `weeksDisjoint` helper that the
board, enumeration, and drag paths all reuse (and S-04's cross-cohort check will reuse).

**Contract**: `export type PlacementWeek = "both" | "a" | "b"`;
`export type WeekMode = "agnostic" | "biweekly"`;
`export const weeksDisjoint = (a: PlacementWeek, b: PlacementWeek): boolean => a !== "both" && b !== "both" && a !== b`.

#### 5. Placement runtime + API + week update + board-load read path

**File**: `src/_pages/plan-detail/model/placement.ts`, `src/_pages/plan-detail/api/placements.ts`,
`src/_pages/plan-detail/api/load.ts`

**Intent**: Make week part of the placement record and let it be set/changed after drop (insert stays
idempotent, so changing a week is an update). The board's **initial hydration** must also read `week`,
or every placement arrives week-less on load/reload and the Phase 2 relaxation has nothing to validate.

**Contract**: `PlannerPlacement` gains `week: PlacementWeek` (`placement.ts:2-7`).
`createPlacementInput` gains `week: placementWeekSchema.default("both")` (`placements.ts:10-16`);
`PlacementRow` + `toPlannerPlacement` carry `week` (`:25-32`); `insertPlacement` writes it and the
idempotent re-select returns it (`:39-69`). Add `updatePlacementWeekInput`
(`{ id: uuid, week: placementWeek }`) and `updatePlacementWeek(supabase, input)` that updates the
single row's `week` and returns the updated `PlannerPlacement`.
**Board load** (`load.ts`): the placements query (`:54`) selects `week` and the `PlannerPlacement`
projection (`:74-79`) maps `week: row.week`. (This is the only path that hydrates the board on page
load; the action path above only covers create/update.)

#### 6. Placement-week Astro action + optimistic hook path

**File**: `src/_pages/plan-detail/api/` (where `placementActions` are defined, composed in
`src/actions/index.ts`) + the full optimistic path the hook actually uses:
`src/_pages/plan-detail/api/placement-client.ts` (transport),
`src/_pages/plan-detail/model/placement-transitions.ts` (pure state transitions),
`src/_pages/plan-detail/model/use-placements.ts` (orchestrator), and `model/placement.ts`
(`LocalPlacement`).

**Intent**: Expose `updatePlacementWeek` as a thin action and an optimistic hook updater so the per-chip
A/B control (Phase 5) can call it — following the **same 3-file split** the add/remove paths use, not
inlined into the hook.

**Contract**: New action delegating to `updatePlacementWeek` (thin — domain logic stays in `api/`).
Mirror the existing optimistic pattern across its three homes: add a transport fn to
`placement-client.ts` (e.g. `updatePlacementWeek(id, week)`); add pure transitions to
`placement-transitions.ts` (`setWeekOptimistic` / `setWeekReconcile` / `setWeekRollback`);
`use-placements.ts` orchestrates them into a `setWeek(placementId, week)` it returns. `LocalPlacement`
gains `week` (alongside `PlannerPlacement.week` from §5), and the optimistic **add** transitions
(`addOptimistic`/`addManyOptimistic`) seed `week` per the §3 drop rule (`both` for agnostic, `a`/`b`
for bi-weekly) so optimistic chips render in the right lane before the server reconciles.

#### 7. Course input + action threading

**File**: `src/_pages/courses/model/schemas.ts`, `src/_pages/courses/api/course-record.ts` (the
create/update row mapping), `src/_pages/courses/model/course.ts` (`CourseRow`), and
`src/_pages/courses/api/loader.ts` (the catalog read path that hydrates `CourseRow` for the table).

**Intent**: Persist `week_mode` through course create/update and surface it on the catalog read (the
form control itself is Phase 4; the table badge in Phase 4 §2 reads `CourseRow.weekMode`).

**Contract**: `courseInput` gains `weekMode: z.enum(["agnostic","biweekly"]).default("agnostic")`
(`schemas.ts:33-46`); `updateCourseInput` inherits it via `.extend`. `toCourseRecord`
(`course-record.ts:7-14`) adds `week_mode: input.weekMode` so create/update write the column.
`CourseRow` (in `courses/model/course.ts:14-29`) gains `weekMode: WeekMode`. The catalog loader
(`loader.ts`) adds `week_mode` to the `courses` select (`:21`) and maps `weekMode: c.week_mode` in the
`CourseRow` projection (`:42-58`).

#### 8. Seed — `week_mode` as CSV data (not generator logic)

**File**: `data/dp1/teachers_subjects.csv`, `data/dp2/teachers_subjects.csv`,
`scripts/lib/catalog-transcode.mjs`, `scripts/gen-seed.mjs`, regenerated `supabase/seed.sql`

**Intent**: Make a course's bi-weekly status a **declarative fact in the fixture data**, not a
hard-coded rule in the seed algorithm. EE/CAS are just the rows we mark today; marking any other
course later is a one-cell CSV edit. The shared transcode reads it, so both the seed **and** the test
factory (which insert the same rows) carry it automatically.

**Contract**:
- **CSV**: `teachers_subjects.csv` is the authoritative course source (headerless
  `code,name,level,group_index,hours`). Add an optional **6th field `week_mode`**; set it to
  `biweekly` on the EE and CAS rows (dp1: CAS `:17-18`, EE `:38-39`; dp2: EE `:8-10`, CAS `:23-25`),
  and leave it empty elsewhere (empty ⇒ `agnostic`). The parser is ragged-tolerant, so untouched rows
  stay 5-field. Each `(name, level, group_index)` is its own course key, so each EE/CAS group row
  carries its own flag.
- **Transcode** (`catalog-transcode.mjs`): add `normWeekMode(raw)` (empty/absent ⇒ `"agnostic"`;
  `"biweekly"`/`"agnostic"` pass through; anything else throws, joining the module's other
  data-consistency aborts). `buildCohort` reads `cols[5]` into the catalog entry's `week_mode` (first
  teacher row sets the meta, mirroring `hours`/`level`); the **other three** `catalog.set` sites
  (student-only `:131`, merge/overlap enrich `:151,:168`) default `week_mode: "agnostic"` so the
  object shape is uniform. `buildCourses` (`:371-385`) emits `week_mode: c.week_mode`. No new
  `randomUUID()` calls ⇒ seed stays structurally stable.
- **Generator** (`gen-seed.mjs:53-67`): courses INSERT column list + values add `week_mode`
  (`q(r.week_mode)`).
- **Test factory**: `seed-plan-catalog.ts` inserts `rows.courses` objects directly, so it carries
  `week_mode` with no change (update the `PlanCatalogRows` JSDoc/type if it enumerates course fields).
- Regenerate: `node scripts/gen-seed.mjs > supabase/seed.sql`.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `pnpm exec supabase db reset`
- Generated types compile: `pnpm exec astro sync && pnpm lint`
- `weeksDisjoint` unit tests pass: `pnpm test`
- Integration: placement insert/read round-trips `week`; `updatePlacementWeek` flips it; `clone_plan`
  preserves `week_mode`/`week`/`opposite_week` — `pnpm test:integration`
- Seed regenerates deterministically and EE/CAS rows carry `week_mode = 'biweekly'` in both cohorts
- Build stays clean: `pnpm build`
- FSD check passes: `pnpm steiger`

#### Manual Verification:

- After `db reset`, Supabase Studio shows EE and CAS with `week_mode = biweekly` in DP1 and DP2; all
  other courses `agnostic`.
- Existing board/placement behavior is visually unchanged (every placement defaults to `both`).

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Board Validator (relaxation)

### Overview

Thread placement week into the board `explain()` path and relax `teacher-conflict` and
`student-conflict` so opposite-week occupants don't collide, while same-week overlaps flag exactly as
today. Extend the collision detail dialog to explain a same-week clash.

### Changes Required:

#### 1. Thread week through the board path

**File**: `src/_pages/plan-detail/model/collisions.ts`

**Intent**: Carry each occupant's placement week from `bucketByCell` into the per-cell `BoardContext`,
without changing the `occupants: GroupingCourse[]` shape the constraints read.

**Contract**: `bucketByCell` return type gains `weekByCourseId: Map<string, PlacementWeek>` per cell,
built from each `placement.week` (course is unique per cell → keying by `courseId` is safe).
`deriveCellViolations` passes `weekByCourseId` into the `explainCell` ctx.

#### 2. `BoardContext` additive field

**File**: `src/_pages/plan-detail/model/constraints/types.ts`

**Intent**: Give the conflict constraints an optional, board-only week lookup.

**Contract**: `BoardContext` gains `weekByCourseId?: Map<string, PlacementWeek>` (`:19-26`). No
`CellConstraint` interface change.

#### 3. Relax `teacher-conflict.explain`

**File**: `src/_pages/plan-detail/model/constraints/teacher-conflict.ts`

**Intent**: A teacher only conflicts among its courses whose weeks overlap; an opposite-week pair
sharing a teacher does not collide.

**Contract**: `explain` reads `ctx.weekByCourseId`; for each teacher, a violation exists only if ≥2 of
its courses are pairwise non-`weeksDisjoint`, and `courseIds` lists only the overlapping courses
(absent week ⇒ `both`). The `test()` fast path is unchanged. Unit tests: two bi-weekly opposite-week
courses sharing a teacher → no violation; same-week or one-agnostic → violation; `{both, a, b}` three
courses → violation citing the `both` course.

#### 4. Relax `student-conflict.explain`

**File**: `src/_pages/plan-detail/model/constraints/student-conflict.ts`

**Intent**: Skip any occupant pair whose placement weeks are disjoint.

**Contract**: In the pairwise loop (`:11-19`), skip the pair when
`weeksDisjoint(weekOf(i), weekOf(j))`. `test()` unchanged.

#### 5. Same-week clash explanation

**File**: `src/_pages/plan-detail/ui/CollisionDetailsDialog.tsx`

**Intent**: When a flagged clash involves bi-weekly courses on the same week, the dialog should make
the week dimension legible (so the author understands the fix is "move one to the other week").

**Contract**: Extend the existing teacher/student sections (`:56-163`) to mention the shared week when
the occupants are bi-weekly; no new violation `kind` required (the relaxation removes violations
rather than adding a new one). Tokens only.

### Success Criteria:

#### Automated Verification:

- Constraint + collisions unit tests pass, incl. new week cases: `pnpm test`
- Type/lint/build clean: `pnpm lint && pnpm build`
- Per-drag validation stays within the <200ms budget (no new per-pair cost beyond O(1) `weeksDisjoint`)

#### Manual Verification:

- Two opposite-week (A/B) bi-weekly courses sharing a teacher/students in one slot show **no**
  destructive ring; the cell counts valid.
- The same two courses set to the **same** week show the destructive ring as before.
- A `both` (agnostic) course sharing a slot with a bi-weekly course still collides if they share a
  teacher/student.
- The collision dialog explains a same-week clash legibly.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Catalog + Enumeration v1 (palette value)

### Overview

Flow `weekMode` into the catalog projection and hash, classify conflict edges (hard vs soft), emit
both-bi-weekly conflicting **pairs** as opposite-week groupings, persist the `opposite_week` marker
through the RPC, and badge them in the palette.

### Changes Required:

#### 1. `GroupingCourse` + catalog projection

**File**: `src/shared/lib/catalog-hash/types.ts`, `src/shared/api/load-cohort-courses.ts`

**Intent**: Make `weekMode` visible to enumeration (which runs on the catalog, not placements).

**Contract**: `GroupingCourse` gains `weekMode: WeekMode` (`types.ts:8-13`). `fetchCourses` selects
`week_mode` (`load-cohort-courses.ts:97-106`); both the regular and virtual/merge-parent projections
carry it (`:59-80`) — a merge parent's `weekMode` derives from the parent course row.

#### 2. Catalog hash includes `weekMode`

**File**: `src/shared/lib/catalog-hash/compute-catalog-hash.ts`

**Intent**: A change to a course's `weekMode` must shift the catalog hash, or grouping-staleness
detection drifts.

**Contract**: Add `weekMode` to the canonical per-course object (`:16-21`). Update the catalog-hash
unit test accordingly.

#### 3. Edge classification + soft-pair enumeration

**File**: `src/_pages/plan-detail/model/enumerate.ts` (+ `enumerate.test.ts`),
`src/_pages/plan-detail/model/compute-groupings.ts`

**Intent**: Keep today's true-parallel enumeration (still excludes on any conflict), and additionally
emit each both-bi-weekly conflicting pair as a distinct opposite-week grouping.

**Contract**: `enumerateVariants` is unchanged (a soft-conflicting pair can't be in a true-parallel
set, so they stay excluded there). Add `enumerateOppositeWeekPairs(courses): GroupingCourse[][]` — an
O(n²)/O(edges) pass returning each unordered pair where `hasIntersection(a,b)` **and** both
`weekMode === "biweekly"`. `computeGroupings` appends these as variants flagged `oppositeWeek: true`,
scored via `scoreVariant`; `GroupingVariant` gains `oppositeWeek?: boolean`.
**Coverage semantics**: an opposite-week pair shares students by construction (that shared set is the
conflict), so the plain `coverageCount = Σ studentKeys.length` (`score.ts:12`) would **double-count**
the shared students and inflate the pair's rank (`compareVariants` sorts on `coverageCount`) and its
displayed count vs a true-parallel grouping (whose members are student-disjoint). For `oppositeWeek`
variants, compute `coverageCount` as the **distinct student union** across members, not the sum.
Add a `score`/`enumerate` unit test pinning this (e.g. two bi-weekly courses sharing N students →
`coverageCount === N`, not `2N`).

#### 4. Persist the `opposite_week` marker

**File**: `src/_pages/plan-detail/api/persist.ts`,
`supabase/migrations/<timestamp>_replace_cohort_groupings_opposite_week.sql` (new)

**Intent**: Carry the marker from compute through the atomic replace into `course_groupings`.

**Contract**: `GroupingPayload` gains `opposite_week: boolean` and `toDistinctMemberSets` carries it
(`persist.ts:7-52`). `create or replace function replace_cohort_groupings` reads `opposite_week` from
the JSON payload and writes it to the `course_groupings` insert. (The column was added in Phase 1.)
**Base the `create or replace` body on the LIVE definition** at
`20260611180006_plans_as_domain_root.sql:133-169` (signature `p_cohort public.cohort`, column
`cohort`) — **not** the superseded `20260604141213` version (`p_cohort_id uuid` / dropped `cohort_id`),
which would fail at `db reset`.

#### 5. Palette badge

**File**: `src/_pages/plan-detail/model/grouping.ts`, `src/_pages/plan-detail/ui/GroupingBox.tsx`,
`src/_pages/plan-detail/api/load.ts` (the board-load read path that builds `PlannerGrouping`)

**Intent**: Tell the author a suggested grouping is an A/B (opposite-week) share, not a simultaneous
parallel one.

**Contract**: `PlannerGrouping` gains `oppositeWeek: boolean` (`grouping.ts:19-25`); the board-load
read path selects `opposite_week` — `load.ts` adds `opposite_week` to the `course_groupings` select
(`:51`) and maps `oppositeWeek: row.opposite_week` in the `PlannerGrouping` projection (`:67-72`).
`GroupingBox` renders a distinguishing badge in the header (`:57-62`) when `oppositeWeek`, reusing
`src/shared/ui/badge.tsx`. Ranking unchanged (reused `scoreVariant`).

### Success Criteria:

#### Automated Verification:

- Enumeration unit tests pass incl. opposite-week pair emission + edge classification: `pnpm test`
- Catalog-hash test reflects `weekMode`: `pnpm test`
- Integration: compute→persist round-trips `opposite_week`; clone preserves it: `pnpm test:integration`
- Enumeration result-space stays within the loud caps (`enumerate.ts:18`) for the seed catalog
- Type/lint/build/steiger clean

#### Manual Verification:

- With the seed loaded, the palette suggests an **EE + CAS** opposite-week grouping carrying the A/B
  badge (they share students via overlap and are both bi-weekly).
- Agnostic-only catalogs produce exactly the same groupings as before (no new boxes).
- Editing a course's `weekMode` and recomputing marks prior groupings stale (hash shifted).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Course Authoring UI (the input)

### Overview

Let the author mark a course bi-weekly in the catalog form and see the flag in the course table.

### Changes Required:

#### 1. `weekMode` form control

**File**: `src/_pages/courses/ui/CourseFormDialog.tsx`

**Intent**: A clear two-state control to set a course agnostic vs bi-weekly, consistent with the
existing form fields.

**Contract**: A `Select` (Agnostic / Bi-weekly) wired through the existing react-hook-form +
`zodResolver(courseInput)` setup, slotted next to `groupIndex`/`cohort` (`:115-170`). The form's
default/empty values include `weekMode: "agnostic"`. Reuses `src/shared/ui/select.tsx`.

#### 2. Course table badge

**File**: `src/_pages/courses/ui/CourseTable.tsx`

**Intent**: Make a bi-weekly course recognizable at a glance in the catalog list.

**Contract**: Render a `Badge` ("Bi-weekly") in the name cell (`:49-55`) when `course.weekMode === "biweekly"`;
agnostic courses show nothing new. Reuses `src/shared/ui/badge.tsx`.

### Success Criteria:

#### Automated Verification:

- Type/lint/build/steiger clean: `pnpm lint && pnpm build && pnpm steiger`
- Existing courses-slice unit tests pass: `pnpm test`

#### Manual Verification:

- Creating/editing a course with "Bi-weekly" persists `week_mode = biweekly` (visible after reload).
- The course table shows the Bi-weekly badge on EE/CAS (and any newly-marked course).
- Switching a course back to Agnostic clears the badge and persists.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Board Week UI (lanes, A/B control, soft-aware drag hint)

### Overview

Render in-cell vertical A/B lanes when a bi-weekly placement is present, give each bi-weekly chip an
A/B control that writes `updatePlacementWeek`, set opposite weeks when an opposite-week grouping is
dropped, and add a soft-aware drag hint so a legal opposite-week drop isn't shown as blocked.

### Changes Required:

#### 1. Vertical A/B lanes

**File**: `src/_pages/plan-detail/ui/SlotCell.tsx`

**Intent**: Spend **vertical** space on the week split (cohort owns the horizontal/column dimension —
FR-007), with progressive disclosure so the ~95% agnostic-only case is visually unchanged.

**Contract**: When at least one occupant is a bi-weekly placement (`week ∈ {a,b}`), the cell body
(below the existing bundle header `:123-164`) renders two stacked lanes with a thin muted left rail
labelled `A` / `B`; an empty lane shows a ghost "free" placeholder; an agnostic (`both`) occupant
spans both lanes. Agnostic-only cells render via the unchanged path (`:91-181`). Opposite-week pairs
carry **no** destructive ring; same-week overlap keeps today's treatment (`:218-226`). Bundle
header/drag-as-unit behavior unchanged. Tokens only; `SlotCell` stays cohort-unaware (drops into a
DP1/DP2 column later with no change).

#### 2. Per-chip A/B control

**File**: `src/_pages/plan-detail/ui/SlotCell.tsx` (PlacedChip `:185-280`)

**Intent**: Move a bi-weekly chip between lanes by setting its placement week.

**Contract**: A per-placement A/B control on `PlacedChip`, shown when **`placement.week ∈ {a, b}`**,
that calls the Phase-1 `setWeek(placementId, week)` optimistic updater (writes `placements.week` via
`updatePlacementWeek`). Agnostic placements are always `both`, so they show no control — and because
the drop path (§3) resolves a bi-weekly course to `a`/`b` at create time, gating on `placement.week`
(not the course `weekMode`) keeps `SlotCell`/`PlacedChip` taking only `occupants`/`names` (no new
catalog/weekMode prop threaded down).

#### 3. Drop-time week assignment (single bi-weekly course + opposite-week grouping)

**File**: the placement/drop handler in plan-detail (drag drop → create placements) — the
`usePlacements` add path (`addCourse`/`addGroup`) + `placement-transitions.ts` optimistic add, which
must read the dropped course's `weekMode` from the catalog the board already holds (`PlannerBoardProps.catalog`).

**Intent**: Enforce the invariant **`agnostic ⇒ both`, `biweekly ⇒ a|b`** at drop time, so a
bi-weekly course is never persisted as `both`. A single bi-weekly drop resolves to a concrete week;
an opposite-week grouping lands its two members on opposite weeks automatically.

**Contract**:
- **Single course drop**: if the dropped course is `biweekly`, create its placement with `week = "a"`
  by default (deterministic; the per-chip control then swaps to `b`). Optionally pick the first
  **free** week in the target cell (the week not already taken by a same-cell opposite-week occupant),
  falling back to `"a"`. Agnostic courses create `both` as today.
- **Opposite-week grouping drop**: when the dropped grouping has `oppositeWeek === true`, assign its two members opposite
weeks deterministically — sort the two member ids, first → `a`, second → `b` — when creating their
placements; the per-chip control can then swap. A grouping of agnostic members creates `both`
placements as today; the single-course rule above governs a lone bi-weekly drop.

#### 4. Soft-aware drag hint

**File**: `src/_pages/plan-detail/model/drop-hints.ts` (+ `drop-hints.test.ts`), `SlotCell.tsx` render

**Intent**: Don't show "blocked" on a cell where a dragged bi-weekly course could legally share on the
opposite week; week is still chosen after drop.

**Contract**: `DropHint` gains an `"opposite-week"` kind. In `classifyCell` (`:148-162`), when a
dragged member only conflicts with occupants such that every conflicting pair is a **soft** edge
(dragged course `biweekly` and each conflicting occupant `biweekly`), classify the cell
`"opposite-week"` instead of `"blocked"`/`"partial"`. Reuse the Phase-3 soft-edge rule
(`hasIntersection` + both `biweekly`). `SlotCell` renders the new hint with a distinct, non-destructive
affordance. Precedence (`drop-hints.ts:19-20`) updated to place `"opposite-week"` above plain free but
below hard `blocked`.

### Success Criteria:

#### Automated Verification:

- `drop-hints` unit tests pass incl. the soft-aware case: `pnpm test`
- Type/lint/build/steiger clean
- The full local gate passes: `/verify`

#### Manual Verification:

- A slot with one week-A and one week-B placement renders stacked A/B lanes; an empty lane shows the
  ghost placeholder; an agnostic occupant spans both lanes.
- The per-chip A/B control appears only on bi-weekly chips and moves the chip between lanes
  (persisted).
- Dragging the EE+CAS opposite-week grouping onto an empty slot lands EE and CAS on opposite weeks
  with no collision ring.
- Dragging a single bi-weekly course over a slot occupied by a soft-conflicting bi-weekly course shows
  the opposite-week affordance (not "blocked"); after drop + week assignment the cell is valid.
- Agnostic-only cells look and behave exactly as before.
- The existing e2e suite still passes (`pnpm test:e2e`).

**Implementation Note**: Final phase — confirm the whole feature end-to-end before closing the change.

---

## Testing Strategy

### Unit Tests:

- `weeksDisjoint` truth table (`both` overlaps everything; only `a`/`b` are disjoint).
- `teacher-conflict` / `student-conflict` `explain` relaxation: opposite-week no-conflict; same-week
  conflict; agnostic-in-mix conflict; three-course `{both,a,b}` teacher case.
- `collisions` derivation threads week and clears the flag when a participant moves to the other week.
- `enumerate` edge classification + opposite-week pair emission; true-parallel groupings unchanged for
  agnostic-only catalogs; caps respected.
- `compute-catalog-hash` shifts when `weekMode` changes.
- `drop-hints` soft-aware classification (opposite-week vs blocked vs partial).

### Integration Tests:

- Placement `week` insert/read round-trip; `updatePlacementWeek` flips A↔B.
- `clone_plan` preserves `week_mode`, `week`, `opposite_week`.
- compute→persist→read round-trips `opposite_week` through the RPC.

### Manual Testing Steps:

1. `db reset`; confirm EE/CAS bi-weekly in DP1+DP2 (Studio).
2. Place EE and CAS in one slot; assign opposite weeks via the per-chip control → no collision ring,
   stacked lanes.
3. Set them to the same week → destructive ring returns.
4. Drag the palette EE+CAS opposite-week grouping onto an empty slot → opposite weeks auto-assigned.
5. Drag a single bi-weekly course over a soft-conflicting occupied cell → opposite-week affordance.
6. Confirm an agnostic course sharing a teacher/student with a bi-weekly course still collides.

## Performance Considerations

The board check adds one O(1) `weeksDisjoint` test per occupant pair inside the existing
O(occupants²)-over-tiny-N derivation — no risk to the <200ms drag budget. The enumeration soft-pair
pass is O(edges); the true-parallel traversal and its loud caps (`enumerate.ts:18`) are unchanged.
Watch result-space growth only if/when v2 mixed sets land (out of scope here).

## Migration Notes

All three columns are additive with defaults (`agnostic` / `both` / `false`), so existing rows and the
deny-by-default grants are unaffected — no backfill needed. `clone_plan` and `replace_cohort_groupings`
are `create or replace` (must land before/with the code that writes the new columns). There is no
production data to preserve at this stage; prefer the additive path and re-push if hosted state needs
resetting.

## References

- Research: `context/changes/bi-weekly-week-aware-validation/research.md`
- PRD: `context/foundation/prd.md` (FR-002/003/006, US-03)
- Live clone fn: `supabase/migrations/20260621120000_clone_plan_drop_teacher_id.sql`
- Constraint core: `src/_pages/plan-detail/model/collisions.ts`, `model/constraints/`
- Enumeration: `src/_pages/plan-detail/model/enumerate.ts`, `compute-groupings.ts`,
  `api/persist.ts`
- Next change (enabler target): roadmap S-04 `two-cohort-board-cross-cohort`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data Foundation

#### Automated

- [ ] 1.1 Migrations apply cleanly (`supabase db reset`)
- [ ] 1.2 Generated types compile (`astro sync && lint`)
- [ ] 1.3 `weeksDisjoint` unit tests pass (`pnpm test`)
- [ ] 1.4 Integration: placement week round-trip, `updatePlacementWeek`, clone preserves columns
- [ ] 1.5 Seed regenerates deterministically; EE/CAS `biweekly` in both cohorts
- [ ] 1.6 Build clean (`pnpm build`)
- [ ] 1.7 FSD check passes (`pnpm steiger`)

#### Manual

- [ ] 1.8 Studio shows EE/CAS `biweekly` in DP1+DP2; others `agnostic`
- [ ] 1.9 Board/placement behavior visually unchanged (all `both`)

### Phase 2: Board Validator

#### Automated

- [ ] 2.1 Constraint + collisions unit tests pass (incl. week cases)
- [ ] 2.2 Type/lint/build clean
- [ ] 2.3 Per-drag validation within <200ms budget

#### Manual

- [ ] 2.4 Opposite-week shared slot shows no destructive ring; cell valid
- [ ] 2.5 Same-week version shows the destructive ring
- [ ] 2.6 Agnostic + bi-weekly sharing a teacher/student still collides
- [ ] 2.7 Collision dialog explains a same-week clash legibly

### Phase 3: Catalog + Enumeration v1

#### Automated

- [ ] 3.1 Enumeration unit tests pass (opposite-week emission + edge classification)
- [ ] 3.2 Catalog-hash test reflects `weekMode`
- [ ] 3.3 Integration: compute→persist round-trips `opposite_week`; clone preserves it
- [ ] 3.4 Enumeration result-space within caps for the seed catalog
- [ ] 3.5 Type/lint/build/steiger clean

#### Manual

- [ ] 3.6 Palette suggests EE+CAS opposite-week grouping with A/B badge
- [ ] 3.7 Agnostic-only catalogs produce identical groupings to before
- [ ] 3.8 Editing a course's `weekMode` marks prior groupings stale

### Phase 4: Course Authoring UI

#### Automated

- [ ] 4.1 Type/lint/build/steiger clean
- [ ] 4.2 Existing courses-slice unit tests pass

#### Manual

- [ ] 4.3 Create/edit "Bi-weekly" persists `week_mode = biweekly`
- [ ] 4.4 Course table shows Bi-weekly badge on EE/CAS
- [ ] 4.5 Switching back to Agnostic clears the badge and persists

### Phase 5: Board Week UI

#### Automated

- [ ] 5.1 `drop-hints` unit tests pass (incl. soft-aware case)
- [ ] 5.2 Type/lint/build/steiger clean
- [ ] 5.3 Full local gate passes (`/verify`)

#### Manual

- [ ] 5.4 Slot with A and B placements renders stacked lanes; ghost on empty lane; agnostic spans both
- [ ] 5.5 Per-chip A/B control appears only on bi-weekly chips and moves the chip (persisted)
- [ ] 5.6 Dragging EE+CAS opposite-week grouping auto-assigns opposite weeks, no ring
- [ ] 5.7 Single bi-weekly drag over soft-conflicting cell shows opposite-week affordance, not blocked
- [ ] 5.8 Agnostic-only cells unchanged
- [ ] 5.9 Existing e2e suite passes (`pnpm test:e2e`)
