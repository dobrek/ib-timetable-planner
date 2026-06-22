# Cohort Switching (S-04) Implementation Plan

## Overview

Unlock free DP1/DP2 cohort switching on the planner board and add a **symmetric, week-aware cross-cohort teacher-occupancy** constraint. Today the board is pinned to DP1 by a single module constant and the validator never sees the other cohort — so the same teacher can be silently double-booked across cohorts at the same slot. This slice removes the pin, surfaces a cohort switcher, and adds the missing constraint as a board-only rule that reuses the existing constraint machinery. It is deliberately built so that S-06 (the combined DP1|DP2 view) becomes a pure assembly/render slice — a reuse, not a rewrite.

## Current State Analysis

The codebase was staged for this slice by S-02 (symmetric teacher sets) and S-03 (first-class placement week):

- **Board pin:** `const BOARD_COHORT: Cohort = "dp1"` (`src/_pages/plan-detail/api/load.ts:15`) scopes four of five loads (groupings, placements, slot_bundles, validation catalog); availability is deliberately not cohort-filtered (`load.ts:56-57`). The chosen cohort is baked into returned props at `load.ts:99`.
- **Route:** the plan is identified by `[id]` UUID only (`src/pages/plans/[id]/index.astro:9`); cohort is absent from the URL. `loadPlannerData` is called from the page via the `@/_pages/plan-detail/api` barrel.
- **Constraint core:** `BoardContext` (`src/_pages/plan-detail/model/constraints/types.ts:20-30`) names cross-cohort occupancy as the next additive field in its own doc comment. `teacher-availability.ts` is the board-only pattern to mirror: it omits `test` (so it never enters the `violatesAny` drag fast path), reads a pre-built index from `BoardContext`, and is wired separately into `drop-hints.classifyCell`. `weeksDisjoint` (`week.ts:19`) was kept a named export specifically for this rule's reuse.
- **Index pattern:** `availability-index.ts` is the template — a JSON-serializable cell array crosses the server→island boundary, then `buildAvailabilityIndex` turns it into the `Map`/`Set` the derivations read (Maps/Sets can't cross the boundary).
- **State hooks init once** from props (`use-placements.ts:63`, no `useEffect` re-sync) — so switching cohort by **navigation/remount** is the clean mechanism; a client tab swap would need a `key={cohort}` reset.
- **Acceptance spec pre-authored:** six `it.todo` cross-cohort guards at `collision-parity.test.ts:240-247` (plus an S-06 combined-view todo at `:249-251`).
- **Switcher UI:** none exists. `PlanSummaryBar.tsx` renders the plan name + incomplete-count; the empty-state branch (`PlannerBoard.tsx:112-123`) renders its own header. Cohort config (`COHORTS`, `cohortSchema`) is switcher-ready (`src/shared/config/cohorts.ts`).
- **Persistence:** zero schema change — placements carry `cohort` with `unique (plan_id, cohort, day, period, course_id)`; `week` column present. Teacher is reached via `course_id → course_teachers` (no teacher column on placements).

## Desired End State

- Opening `/plans/{id}` shows the DP1 board (default); a DP1/DP2 switcher next to the plan name navigates to `/plans/{id}?cohort=dp2`, remounting the island onto the other cohort. Either cohort opens first; no fixed start order (FR-005).
- A placement that puts a teacher in a slot already occupied by that same teacher in the **other** cohort, in an overlapping week, is flagged **blocking** (destructive ring, counts toward plan invalidity) — symmetrically, both directions, week-aware (opposite-week A/B does not collide; an agnostic `both` occupant overlaps every week) (FR-006).
- The same signal appears during drag as a `blocked` (or `opposite-week`, for a bi-weekly drag against an opposite-week sibling) hint, agreeing with committed validation (parity-harness guaranteed).
- The collision detail dialog explains the violation generically: the teacher is also teaching in the other cohort at this slot.
- The six `it.todo` cross-cohort parity guards are implemented and green; an E2E spec drives the switcher + cross-cohort flag end-to-end.

**Verify:** `pnpm check`, `pnpm test`, `pnpm steiger`, `pnpm build` clean; the six parity guards pass; `pnpm test:e2e` cohort spec passes; manual DP1↔DP2 switch + cross-cohort flag observed in the UI.

### Key Discoveries

- The cross-cohort rule is structurally identical to `teacher-availability` **except it is week-aware** — the one novel piece is mirroring a week-aware check into `drop-hints.classifyCell`, where availability only needed flat cell membership (`drop-hints.ts:156-176`).
- Students are single-cohort (`prd.md:412`) — only the **teacher** check spans cohorts. The sibling signal must arrive as a *separate context index*, never by merging placement lists into one `(day,period)` bucket (that would false-flag a DP1 student vs a DP2 student). See Traps in `research.md:142-148`.
- Symmetry is what makes S-06 a reuse: a rule with no "primary" cohort validates both columns by the same operation applied both ways.
- The sibling index must be **week-rich** (`Map<teacherKey, Map<cellKey, Set<PlacementWeek>>>`), co-teacher-expanded, and **projected server-side** in `load.ts` (ship only the index, not full sibling objects) — per the recorded decision in `change.md`.

## What We're NOT Doing

- **No combined DP1|DP2 side-by-side view** (that is S-06). This slice shows one cohort at a time; it only makes the validator *aware of* both.
- **No dual-live editable stores.** The sibling cohort is a read-only committed snapshot projected at SSR; switching is navigate/remount, so the snapshot can't go stale. The dual-live case is deferred to S-06.
- **No schema/migration change.** No new columns, no new tables.
- **No client-side tab swap** (no `key={cohort}` reset path) — switching is navigation.
- **No richer "name the conflicting sibling course" messaging** — the index carries no sibling course identity by decision; messages stay generic.
- **No change to availability** (stays week-agnostic + cohort-independent) and **no change to student/duplicate constraints** (stay per-cohort).

## Implementation Approach

Three phases. Phase 1 lands the correctness core against the still-fixed DP1 board (the DP1 board begins reflecting DP2 occupancy before any switcher exists — independently testable by seeding DP2 placements). Phase 2 generalizes "which cohort is active" from a URL query param and adds the switcher. Phase 3 adds the browser-level spec.

Follow the board-only constraint contract throughout: omit `test`, add an additive `BoardContext` field, register in the constraint array, mirror week-aware into drop-hints, and keep the hot combinatorial path (`violatesAny`) untouched so the <200ms drag budget holds.

## Critical Implementation Details

- **Week-aware drag mirroring (the one subtle piece).** During drag the dragged course's week is not yet chosen (week is picked after drop), exactly like the existing soft-edge `softFitsOppositeWeek` rule (`drop-hints.ts:183-187`). So the sibling-occupancy check in `classifyCell` must follow the same shape: a sibling occupying the cell with week `both` overlaps every week → `blocked`; a sibling occupying only a single week (`a`/`b`) is escapable iff the dragged member is bi-weekly (`weekMode === "biweekly"`) → contributes `opposite-week`, else `blocked`. Empty cells where a dragged member's teacher is occupied in the sibling must be added to the candidate set (mirroring the availability candidate-expansion at `drop-hints.ts:111-118`), since board-only rules are invisible to `violatesAny`.
- **Serialization boundary.** The index `Map`/`Set` cannot cross server→island. Project to a flat JSON array server-side (`{ teacherKey, day, period, week }[]`, co-teacher-expanded), ship that as the board prop, and rebuild the `Map` in the island via a `buildCrossCohortIndex` builder — exactly the `availability-index.ts` split.
- **Import cycle.** `availability-index.ts` imports `cellKey` from `collisions.ts`, while `collisions.ts` keeps a local `NO_AVAILABILITY` default to avoid a runtime cycle. Mirror that: format the cell key inline inside the new constraint (as `teacher-availability.ts:23` does) rather than importing `cellKey` into the constraint.

---

## Phase 1: Cross-cohort occupancy constraint (correctness core)

### Overview

Project the sibling cohort's teacher occupancy into a week-rich index at SSR, add the board-only `cross-cohort-teacher` constraint, wire it through `BoardContext` → committed validation → drag hints → detail dialog, and implement the six pre-authored parity guards. The board stays DP1-fixed in this phase; the sibling is DP2.

### Changes Required

#### 1. Cross-cohort index (model)

**File**: `src/_pages/plan-detail/model/cross-cohort-index.ts` (new)

**Intent**: Define the serializable sibling-occupancy cell, the in-island index type, an empty default, and the builder — mirroring `availability-index.ts`. Co-teacher expansion has already happened server-side, so the builder just groups rows.

**Contract**: Exports `type SiblingOccupancyCell = { teacherKey: string; day: number; period: number; week: PlacementWeek }`; `type CrossCohortIndex = Map<string, Map<string, Set<PlacementWeek>>>` (teacherKey → cellKey → set of occupied weeks); `EMPTY_CROSS_COHORT_INDEX`; `buildCrossCohortIndex(cells: SiblingOccupancyCell[]): CrossCohortIndex`. Format the cell key as `${day}:${period}` consistent with `collisions.cellKey`.

#### 2. BoardContext + violation union (constraint types)

**File**: `src/_pages/plan-detail/model/constraints/types.ts`

**Intent**: Add the cross-cohort index as a new optional `BoardContext` field (the additive seam the doc comment already promises) and add the new violation kind to `CollisionViolation`.

**Contract**: New optional field `occupiedByTeacher?: Map<string, Map<string, Set<PlacementWeek>>>` on `BoardContext` (teacherKey → cellKey → occupied weeks in the *other* cohort). New union member `{ kind: "cross-cohort-teacher"; teacherKey: string; courseIds: string[] }`. Keep the doc comment's promise intact (extend, don't replace).

#### 3. The constraint (board-only, week-aware)

**File**: `src/_pages/plan-detail/model/constraints/cross-cohort-teacher.ts` (new)

**Intent**: For each occupant, for each of its co-teachers, raise a blocking violation iff that teacher is occupied in the other cohort at this cell in a week that is **not** disjoint from the occupant's own week. Board-only: omit `test` (so it never enters grouping enumeration / the drag fast path), reuse `weeksDisjoint`.

**Contract**: `export const crossCohortTeacher: CellConstraint` with `id: "cross-cohort-teacher"` and only `explain`. Read `ctx.occupiedByTeacher`; absent ⇒ return `[]` (single-cohort regression path). Occupant week via `ctx.weekByCourseId?.get(course.id) ?? "both"`. A sibling occupancy collides iff `!weeksDisjoint(occupantWeek, siblingWeek)` for any sibling week in the cell's set. Emits `{ kind: "cross-cohort-teacher", teacherKey, courseIds: [course.id] }`. Format the cell key inline (do not import `cellKey` — see Critical Implementation Details).

#### 4. Register the constraint

**File**: `src/_pages/plan-detail/model/constraints/index.ts`

**Intent**: Add `crossCohortTeacher` to the `CELL_CONSTRAINTS` array. No other change — `explainCell` and `violatesAny` already iterate the array, and the board-only constraint is correctly absent from `violatesAny` (no `test`).

**Contract**: `CELL_CONSTRAINTS` gains the new entry; import added.

#### 5. Thread the index through committed validation

**File**: `src/_pages/plan-detail/model/collisions.ts`

**Intent**: Pass the cross-cohort index into the `BoardContext` built per cell in `deriveCellViolations`, with an empty-map default so existing 3-arg / no-index callers and tests are unaffected.

**Contract**: `deriveCellViolations` gains an optional `occupiedByTeacher` parameter (defaulting to an empty `Map`, kept local like `NO_AVAILABILITY` to avoid an import cycle) and forwards it into the `explainCell` ctx as `occupiedByTeacher`.

#### 6. Mirror week-aware into drag hints

**File**: `src/_pages/plan-detail/model/drop-hints.ts`

**Intent**: Make `classifyCell` consult the sibling index so drag hints agree with committed validation. A sibling occupying the cell for a dragged member's teacher with week `both` → that member hard-conflicts; a single-week sibling occupancy is escapable only by a bi-weekly member (opposite-week) and otherwise hard-conflicts. Add empty cells where a dragged member's teacher is occupied in the sibling to the candidate set.

**Contract**: `deriveDropHints` gains an optional `occupiedByTeacher` param (empty-map default). Candidate-cell expansion mirrors the availability block (`drop-hints.ts:111-118`) for sibling-occupied cells. `classifyCell` gains the sibling check folded into its existing precedence (`blocked > partial > opposite-week > warn > free`): a `both` sibling occupancy counts as a hard conflict; a single-week sibling occupancy counts as an opposite-week (soft) fit for a bi-weekly member, else a hard conflict — composing with the existing `softFitsOppositeWeek` result, not bypassing it.

#### 7. Render the violation

**File**: `src/_pages/plan-detail/ui/CollisionDetailsDialog.tsx`

**Intent**: Add a branch for the `cross-cohort-teacher` kind with a generic message naming the teacher and the *other* cohort (e.g. "Mr. Lewis is also teaching in DP2 at this time"). Resolve the teacher name via the existing `teacherNames` record; derive the other cohort's label from the active cohort.

**Contract**: Dialog accepts the active `cohort` (new prop, threaded from `PlannerBoard`); message uses `cohortLabel(siblingCohort(cohort))` and `teacherNames[teacherKey]`. No week named (generic, per decision) — optional week mention left to the implementer if cheap.

#### 8. Sibling-cohort helper (config)

**File**: `src/shared/config/cohorts.ts`

**Intent**: Add a tiny `siblingCohort(cohort)` helper returning the other cohort, used by both `load.ts` (which cohort to project) and the dialog (which label to show).

**Contract**: `export const siblingCohort = (cohort: Cohort): Cohort => ...` over the fixed two-value set.

#### 9. Project the sibling index server-side

**File**: `src/_pages/plan-detail/api/load.ts`

**Intent**: Load the sibling cohort's placements and its course→teacherKeys mapping, project to a co-teacher-expanded `SiblingOccupancyCell[]`, and add it to the returned board props. In this phase the sibling is the constant `siblingCohort(BOARD_COHORT)` (= dp2).

**Contract**: Add a sibling placements query (`course_id, day, period, week` for `plan_id`, sibling cohort) and a sibling catalog load (reuse `loadCohortCourses` for teacherKeys) to the existing `Promise.all`. Map each sibling placement → its course's `teacherKeys` → one `{ teacherKey, day, period, week }` row per teacher. Ship as a new prop `crossCohortOccupancy: SiblingOccupancyCell[]`. Sibling course missing from its catalog ⇒ skip defensively (mirror `bucketByCell`).

#### 10. Wire the prop into the island

**Files**: `src/_pages/plan-detail/model/drag.ts` (props type), `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Add `crossCohortOccupancy` to `PlannerBoardProps`, build the index once with `useMemo`, and feed it into both the collisions derivation and the drag-hints derivation. Pass the active `cohort` to `CollisionDetailsDialog`.

**Contract**: `PlannerBoardProps` gains `crossCohortOccupancy: SiblingOccupancyCell[]`. New `useCrossCohortIndex` memo (mirror `useAvailabilityIndex`). `useCollisions` and `useDragHints` take the index and pass it to `deriveCellViolations` / `deriveDropHints`. Dialog gets `cohort={cohort}`.

#### 11. Implement the six parity guards

**File**: `src/_pages/plan-detail/model/collision-parity.test.ts`

**Intent**: Replace the six `it.todo` cross-cohort guards (`:241-246`) with real cases driven through the parity boundary, extending the fixture to supply a sibling occupancy index. **First make the boundary actually assert committed↔drag agreement** — today `assertParity` (`collision-parity.test.ts:48-68`) calls only `deriveCellViolations` (the committed path) and never `deriveDropHints`, so the "parity" it enforces is per-validator-class vs. the oracle on the committed path, *not* committed-vs-drag. The cross-cohort drag mirror in `classifyCell` is the slice's #1 correctness risk and must not ship behind a guard that doesn't run it.

**Contract**: Extend `assertParity` so each case is asserted through **both** paths: the existing `deriveCellViolations` committed verdict *and* a `deriveDropHints` what-if for the case's dragged member (mapped from the case's occupant/weekMode to a pre-drop drag — week is chosen after drop), asserting the resulting hint agrees with the committed verdict (`invalid`→`blocked`, opposite-week `valid`→`opposite-week`, no-collision `valid`→`free`/omitted). Thread `occupiedByTeacher` into both calls. Then implement: (1) symmetric same-week occupancy blocks both directions; (2) opposite-week accepted; (3) agnostic `both` sibling overlaps every week; (4) different slot no collision; (5) param-off single-cohort regression behaves as today; (6) availability orthogonal to the cross-cohort axis. Reuse the shared fixture builder. (The dual-path assertion also retroactively strengthens the existing S-02/S-03 rows at no extra case cost — confirm they still pass.)

### Success Criteria

#### Automated Verification

- Type check passes: `pnpm check`
- Unit + parity tests pass (incl. the six new guards): `pnpm test`
- FSD structure check passes: `pnpm steiger`
- Lint passes: `pnpm lint`
- Build is clean (Workers runtime): `pnpm build`

#### Manual Verification

- With DP2 placements seeded, a DP1 placement of the same teacher in the same slot/overlapping week shows the destructive ring and a `cross-cohort-teacher` entry in the detail dialog.
- An opposite-week (A/B) cross-cohort pair is NOT flagged; an agnostic (`both`) sibling occupant flags every week.
- During drag, the cross-cohort hint (`blocked` / `opposite-week`) matches what the committed cell shows after dropping.
- Per-drag validation stays visibly snappy (well within the <200ms budget) on a populated board.

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Cohort switcher (UI + route)

### Overview

Generalize the active cohort from a `?cohort=` query param (default/coerce → dp1) and add a DP1/DP2 switcher next to the plan name that switches by navigation (remount). The sibling becomes "the other cohort" relative to the active one.

### Changes Required

#### 1. Read & validate the cohort param

**File**: `src/pages/plans/[id]/index.astro`

**Intent**: Parse `?cohort=` from the URL, coerce missing/invalid to dp1 via `cohortSchema`, and pass the resolved cohort into `loadPlannerData`.

**Contract**: `const cohort = cohortSchema.catch("dp1").parse(Astro.url.searchParams.get("cohort"))` (or `safeParse` with dp1 fallback); call `loadPlannerData(supabase, Astro.params.id, cohort)`.

#### 2. Parameterize the loader

**File**: `src/_pages/plan-detail/api/load.ts`

**Intent**: Replace the `BOARD_COHORT` constant with a `cohort` parameter; the active cohort scopes the four cohort-scoped loads, and the sibling (`siblingCohort(cohort)`) drives the cross-cohort projection from Phase 1.

**Contract**: `loadPlannerData(supabase, id, cohort: Cohort)`; remove the `BOARD_COHORT` constant and its comment; `props.cohort = cohort`. The `@/_pages/plan-detail/api` barrel signature updates accordingly.

#### 3. Cohort switcher component

**File**: `src/_pages/plan-detail/ui/CohortSwitcher.tsx` (new)

**Intent**: A segmented DP1/DP2 control rendered as cohort-scoped links so selecting the inactive cohort navigates (full SSR remount). Uses `COHORTS` for labels and marks the active segment.

**Contract**: Props `{ planId: string; cohort: Cohort }`. Renders an anchor/segment per `COHORTS` entry to `/plans/${planId}?cohort=${value}`; active segment is visually marked and non-navigating. Style with semantic theme tokens only (per lessons.md), preferring existing DS primitives.

#### 4. Mount the switcher next to the plan name

**Files**: `src/_pages/plan-detail/ui/PlanSummaryBar.tsx`, `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Render `CohortSwitcher` adjacent to the plan name in `PlanSummaryBar`, and also in the empty-state header branch (`PlannerBoard.tsx:112-123`) so the switcher is reachable even when the active cohort has no computed groupings yet.

**Contract**: `PlanSummaryBar` gains `planId` + `cohort` props and renders the switcher next to the `<h1>`. The empty-state branch renders the switcher beside its `<h1>`. Both receive `planId` + `cohort` (already in scope in `PlannerBoard`).

### Success Criteria

#### Automated Verification

- Type check passes: `pnpm check`
- Unit + parity tests pass: `pnpm test`
- FSD structure check passes: `pnpm steiger`
- Lint passes: `pnpm lint`
- Build is clean: `pnpm build`

#### Manual Verification

- `/plans/{id}` defaults to DP1; the switcher shows DP1 active.
- Clicking DP2 navigates to `?cohort=dp2`, remounts the board onto DP2 placements, and the switcher reflects DP2 active.
- A hand-edited `?cohort=garbage` falls back to DP1 (no error page).
- Cross-cohort flags are symmetric: a clash visible on DP1 is also visible on DP2 after switching.
- The switcher is reachable on a cohort that has no groupings yet (empty state).

**Implementation Note**: After Phase 2 automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: End-to-end spec

### Overview

A Playwright spec driving the switcher and the cross-cohort flag through the real workerd preview, modeled on `e2e/specs/co-teaching.spec.ts` and the `e2e/CLAUDE.md` rules.

### Changes Required

#### 1. Cohort-switching E2E spec

**File**: `e2e/specs/cohort-switching.spec.ts` (new)

**Intent**: Authenticated spec that seeds a plan with a shared teacher placed in both cohorts at the same overlapping slot, asserts the cross-cohort collision surfaces (via the chip's `aria-invalid` / detail dialog) on the active cohort, switches cohort, and asserts the symmetric flag on the other cohort. Teardown by deleting the plan.

**Seed prerequisite**: the cross-cohort flag only fires when the **same teacher** teaches a placeable course in **both** dp1 and dp2. Before writing the spec, confirm such a teacher/course pair is reachable in the e2e fixtures (a teacher with a course in each cohort); if none exists, provision one in the spec's setup (or the e2e seed). Name the concrete pair the spec uses so the dependency is explicit, not discovered mid-run. Edit one cohort at a time (place in dp1 → switch → place the same teacher's dp2 course at the same slot/overlapping week → switch back), since the board edits a single cohort.

**Contract**: In `e2e/specs/`, `chromium` (authenticated) project. Role-based locators only (`gridcell`, chip by course name + `aria-invalid`, switcher segments by role+name); switch cohort via the switcher control (or `page.goto(?cohort=...)`) and `waitForURL`. Unique entities suffixed with `randomUUID()`. Wait for state, never time. Assert the business outcome: the flag appears on both cohorts (symmetric) and not on an opposite-week arrangement.

### Success Criteria

#### Automated Verification

- E2E suite passes against the workerd preview: `pnpm test:e2e`
- Full local gate passes: `/verify` (install → astro sync → check → lint → steiger → audit → test → build)

#### Manual Verification

- The spec fails when the cross-cohort constraint is reverted (it protects the real risk, not decoration).

---

## Testing Strategy

### Unit Tests

- The six cross-cohort parity guards in `collision-parity.test.ts` (symmetric same-week block both directions; opposite-week accepted; agnostic `both` overlaps every week; different-slot no collision; param-off single-cohort regression; availability orthogonal), each asserted through the committed↔drag parity boundary — which Phase 1 §11 first upgrades to run `deriveDropHints` alongside `deriveCellViolations` (today it asserts only the committed path), so the drag mirror is genuinely guarded.
- Builder coverage for `buildCrossCohortIndex` (co-teacher rows group into the right teacher/cell/week sets) if not fully exercised by the parity fixtures.

### Integration Tests

- None required: zero schema change and the projection is pure over already-tested loaders. (If the loader's sibling projection warrants it, an optional `*.integration.test.ts` can assert the index shape from seeded placements — not required to mark the slice done.)

### Manual Testing Steps

1. Seed DP1 and DP2 placements sharing a teacher at the same slot/week; open the plan — confirm the DP1 cell flags blocking with a `cross-cohort-teacher` dialog entry.
2. Move one to the opposite week — confirm the flag clears.
3. Switch to DP2 — confirm the symmetric flag is present there.
4. Drag a course over a sibling-occupied slot — confirm the drag hint (`blocked` / `opposite-week`) matches the post-drop committed state.
5. Hand-edit `?cohort=` to an invalid value — confirm fallback to DP1.

## Performance Considerations

The cross-cohort rule is board-only (omits `test`), so it never enters the `violatesAny` short-circuit drag fast path — the <200ms per-drag budget is preserved. Validation is a pure in-memory lookup against the eager-loaded index (no per-drag round-trip — the governing reason for eager-load-both, `change.md`). The `explain` path runs only on committed multi-occupancy cells, O(occupants²) over tiny N. The added SSR cost is one extra placements query + one catalog load for the sibling, projected once.

## Migration Notes

None — no schema or data migration. The change is additive at the type level (new optional `BoardContext` field, new violation union member, new board prop), so existing callers and tests compile unchanged.

## References

- Research: `context/changes/cohort-switching/research.md`
- Recorded decision (eager-load-both + watch-items): `context/changes/cohort-switching/change.md`
- Board-only constraint pattern to mirror: `src/_pages/plan-detail/model/constraints/teacher-availability.ts`
- Index pattern to mirror: `src/_pages/plan-detail/model/availability-index.ts`
- Week primitive: `src/_pages/plan-detail/model/week.ts:19` (`weeksDisjoint`)
- Pre-authored acceptance spec: `src/_pages/plan-detail/model/collision-parity.test.ts:240-247`
- E2E exemplar + rules: `e2e/specs/co-teaching.spec.ts`, `e2e/CLAUDE.md`
- Traps that would block S-06: `research.md:142-148`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cross-cohort occupancy constraint (correctness core)

#### Automated

- [x] 1.1 Type check passes: `pnpm check` — 4de99f7
- [x] 1.2 Unit + parity tests pass (incl. the six new guards): `pnpm test` — 4de99f7
- [x] 1.3 FSD structure check passes: `pnpm steiger` — 4de99f7
- [x] 1.4 Lint passes: `pnpm lint` — 4de99f7
- [x] 1.5 Build is clean (Workers runtime): `pnpm build` — 4de99f7

#### Manual

- [ ] 1.6 Cross-cohort same-week clash shows destructive ring + dialog entry (DP2 seeded)
- [ ] 1.7 Opposite-week not flagged; agnostic `both` flags every week
- [ ] 1.8 Drag hint matches committed cell after drop
- [ ] 1.9 Per-drag validation stays within the <200ms budget

### Phase 2: Cohort switcher (UI + route)

#### Automated

- [x] 2.1 Type check passes: `pnpm check`
- [x] 2.2 Unit + parity tests pass: `pnpm test`
- [x] 2.3 FSD structure check passes: `pnpm steiger`
- [x] 2.4 Lint passes: `pnpm lint`
- [x] 2.5 Build is clean: `pnpm build`

#### Manual

- [ ] 2.6 `/plans/{id}` defaults to DP1, switcher shows DP1 active
- [ ] 2.7 Clicking DP2 navigates + remounts onto DP2; switcher reflects DP2
- [ ] 2.8 Invalid `?cohort=` falls back to DP1 (no error page)
- [ ] 2.9 Cross-cohort flags are symmetric across the switch
- [ ] 2.10 Switcher reachable on a cohort with no groupings (empty state)

### Phase 3: End-to-end spec

#### Automated

- [ ] 3.1 E2E suite passes against workerd preview: `pnpm test:e2e`
- [ ] 3.2 Full local gate passes: `/verify`

#### Manual

- [ ] 3.3 Spec fails when the cross-cohort constraint is reverted (protects the real risk)
