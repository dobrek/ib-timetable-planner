# Combined-view park-to-shelf gap — Implementation Plan

## Overview

In the combined two-cohort view (`/plans/[id]/combined`), dragging a palette **course** or **grouping**
directly onto the shelf does nothing — the drag is silently dropped. The single-cohort board parks it.
This plan closes that gap so the combined view mirrors the single board: a palette course/grouping
dropped on the shelf **parks** under the palette's currently active cohort, tagged + place-back routable
to that cohort's board, with the same auto-collapse behavior.

It is a **behavior-preserving bug fix** for every existing drop path — only the two missing branches are
added. It is also the **prerequisite** for `plan-detail-refactor`: it produces the park-capable
`resolveCombinedDrop` and the shared member-resolution helper that the refactor later unifies the single
board's `handleDrop` onto.

## Current State Analysis

- **The router rejects both drops.** `resolveCombinedDrop` (`model/combined-drop.ts:24-51`) returns
  `null` for `course→shelf` (`:30`) and `grouping→shelf` (`:32`) — the `cell` is `null` on a shelf target
  and there is no park branch. Its 6 action variants (`addCourse | dropGroup | movePlacement | moveBundle
  | liftBundle | placeBack`) have **no park**.
- **The single board parks them** (`PlannerBoard.tsx:121-133`): `course→shelf` →
  `parkToShelf([{ courseId, week: defaultParkedWeek(courseId) }])`; `grouping→shelf` →
  `parkToShelf(groupingMembers(groupingId))`. `parkToShelf` calls `parkMembers` + `collapseUnlessPinned`
  (`:165-169`). The two member-resolvers `groupingMembers`/`defaultParkedWeek` are **pure and inlined**
  (`PlannerBoard.tsx:174-185`), closing over `groupings` + `weekModeByCourseId`.
- **Everything the combined board needs is already exposed.** `CombinedPlannerBoard` holds `paletteCohort`
  (`:43`) — the only cohort signal for a cohort-free palette drag dropped on the cell-less shelf — and a
  `byCohort` record (`:37`) whose `CohortBoardState` exposes `actions.parkMembers`
  (`use-cohort-board-state.ts:167`), `weekModeByCourseId` (`:155`), and `groupings`; the shell owns
  `collapseUnlessPinned` (`:39`). The combined board's `handleDrop` already dispatches on the router's
  action kind (`:96-122`).
- **The router is densely unit-tested** (`combined-drop.test.ts`) — the safety net. One existing
  assertion (`:74-80`) pins `course→shelf` as a no-op and **must flip** with this fix. The router has
  exactly two call sites: `CombinedPlannerBoard.tsx:96` and the test.
- **E2E asymmetry.** The single board has `shelf-durability.spec.ts` (test 2 at `:72-102` proves a palette
  grouping parks straight to the shelf). The combined route has one spec (`combined-view.spec.ts`) that
  never mutates inside the combined view. The shelf locators/gestures are **local** to
  `shelf-durability.spec.ts` (`:105-159`).

## Desired End State

In `/plans/[id]/combined`, dragging a palette course or grouping onto the shelf **parks it** under the
palette's active cohort (DP1/DP2): the parked card is tagged with that cohort and is place-back routable
to that cohort's column; the shelf auto-collapses unless pinned. Both boards resolve parked
members/weeks through **one shared `model/` helper**. Every other drop path is unchanged.

Verified by: extended router unit tests (two park variants + `activeCohort` routing), a new helper unit
test, a green combined-route e2e (park + cohort-routed place-back), and a manual smoke in the browser
confirming the single board is unregressed.

### Key Discoveries:

- `resolveCombinedDrop` needs a 3rd `activeCohort: Cohort` arg — the cohort signal for a cell-less shelf
  drop (`combined-drop.ts:24`; the value is `paletteCohort`, `CombinedPlannerBoard.tsx:43`).
- `actions.parkMembers` + `weekModeByCourseId` + `groupings` are already on `CohortBoardState`
  (`use-cohort-board-state.ts:155,167`) — the board wiring is a pure call, no new state.
- The single board's `groupingMembers`/`defaultParkedWeek` (`PlannerBoard.tsx:174-185`) are pure and lift
  verbatim into `model/`; both boards then call them (settled: migrate both).
- `combined-drop.test.ts:74-80` asserts `course→shelf` returns `null` — this assertion flips to a
  `parkCourse` action; both router call sites gain the 3rd arg.
- The combined palette **defaults collapsed** (`CombinedPlannerBoard.tsx:41`) — the e2e must expand it
  before dragging the grouping box (unlike the single-board spec).

## What We're NOT Doing

- **No drop-router unification** and no `BoardShell` / shared-`PLUGINS` extraction — those belong to
  `plan-detail-refactor`, which rebases on top of this change.
- **No `ui/` folder restructure**, renames, `model/` grouping, or `api/` cleanup (all `plan-detail-refactor`).
- **No schema/migration changes** — parking reuses the existing `shelf_bundles` RPC via `parkMembers`.
- **No new park parity for the single board** — its behavior is preserved exactly; only its inline
  member-resolvers move to the shared helper.
- **No constraint-core changes** — the <200ms drag budget is untouched (`parkMembers` is the existing
  optimistic path).
- **No reload-durability leg in the new e2e** — server-durability is already proven by
  `shelf-durability.spec.ts` over the identical `parkMembers → Astro Action → Supabase` path.

## Implementation Approach

Land the **pure model first** (Phase 1): one shared member-resolution helper and the park-capable router,
both fully unit-tested — this is the safety net and the contract Phase 2 wires against. Then **wire both
boards** onto that model (Phase 2): the combined board gains its two missing branches; the single board
swaps its inline resolvers for the shared helper (behavior-preserving). Finally **prove the
combined-specific behavior** with one e2e (Phase 3): park a palette grouping to the shelf in the combined
view and place it back into the correct cohort's column.

## Critical Implementation Details

- **Cohort source for a shelf drop.** A palette `course`/`grouping` drag is cohort-free; when dropped on
  the cell-less shelf there is no target cell to adopt a cohort from. The only signal is the palette's
  active cohort (`paletteCohort`), which the router cannot see — so it must be **passed in** as the new
  third argument and stamped onto the park action. This already matches the drag-hint path, which uses
  `paletteCohort` as the target signal for a cohort-free drag (`CombinedPlannerBoard.tsx:82`).
- **Router stays pure of catalog/grouping data.** Mirroring the existing `dropGroup`/`addCourse` variants
  (which carry ids, not resolved members), the new variants carry `courseId`/`groupingId` + `cohort`; the
  **board** resolves `ParkedMember[]` via the shared helper. Do not thread `groupings`/`weekMode` into the
  router.

## Phase 1: Pure model core — shared member resolver + park-capable router

### Overview

Extract the member-resolution logic into a pure `model/` helper and extend the drop router with the two
park variants and the `activeCohort` argument. All unit-tested; no UI touched.

### Changes Required:

#### 1. Shared parked-member resolver

**File**: `src/_pages/plan-detail/model/parked-members.ts` (new)

**Intent**: Lift the single board's inline `groupingMembers` + `defaultParkedWeek`
(`PlannerBoard.tsx:174-185`) into a pure, framework-free helper both boards consume, so they resolve
parked members/weeks identically.

**Contract**: Two pure exports (no React):
- `defaultParkedWeek(courseId, weekModeByCourseId): PlacementWeek` — `biweekly → "a"`, else `"both"`
  (verbatim from `PlannerBoard.tsx:184-185`).
- `groupingParkedMembers(groupingId, groupings, weekModeByCourseId): ParkedMember[]` — unknown id → `[]`;
  an `oppositeWeek` grouping alternates members a/b via `oppositeWeekAssignment` (`placement-transitions.ts:31`);
  every other member takes its `defaultParkedWeek` (verbatim from `PlannerBoard.tsx:174-182`).

  Reuse the existing `ParkedMember` type (`model/parked.ts:4`) and the `weekModeByCourseId` map type
  already built in both boards (`PlannerBoard.tsx:49`, `use-cohort-board-state.ts:75-78`).

#### 2. Park-capable drop router

**File**: `src/_pages/plan-detail/model/combined-drop.ts`

**Intent**: Add a third `activeCohort` argument and two park action variants so a palette course/grouping
dropped on the shelf routes to a park under the active cohort instead of `null`. Update the type doc to
note the park branch + the cohort source.

**Contract**: Extend `CombinedDropAction` and the signature; the `course`/`grouping` cases return a park
action (stamped with `activeCohort`) when the target is the shelf (`cell == null`):

```ts
export type CombinedDropAction =
  | /* …existing 6 variants… */
  | { kind: "parkCourse"; cohort: Cohort; courseId: string }
  | { kind: "parkGroup"; cohort: Cohort; groupingId: string };

export const resolveCombinedDrop = (
  data: DragData,
  target: DropTargetData,
  activeCohort: Cohort,
): CombinedDropAction | null => { /* course/grouping: cell ? addCourse/dropGroup : park*(activeCohort) */ };
```

All other branches (`placement`/`bundle`/`parked`, cross-cohort guard, shelf-lift) are unchanged.

#### 3. Helper unit test

**File**: `src/_pages/plan-detail/model/parked-members.test.ts` (new)

**Intent**: Pin the resolver's behavior so the Phase-2 board migration is provably behavior-preserving.

**Contract**: Cover `defaultParkedWeek` (biweekly → `a`, agnostic → `both`) and `groupingParkedMembers`
(opposite-week alternation, plain-grouping defaults, unknown-id → `[]`).

#### 4. Router unit tests

**File**: `src/_pages/plan-detail/model/combined-drop.test.ts`

**Intent**: Add the two park variants and the `activeCohort` routing; flip the now-invalid no-op
assertion; pass the new arg at every existing call.

**Contract**: New cases — `course→shelf` → `{ kind: "parkCourse", cohort: activeCohort, courseId }`;
`grouping→shelf` → `{ kind: "parkGroup", cohort: activeCohort, groupingId }`; the same shelf drop with
`activeCohort` `dp1` vs `dp2` yields the matching cohort. Remove the `course`-on-shelf `null` case from
the `:74-80` test (keep `placement`/`parked` on-shelf as no-ops). Thread `activeCohort` through every
existing `resolveCombinedDrop(...)` call in the file.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Unit tests pass: `pnpm test`
- Lint passes: `pnpm lint`
- Structure check passes: `pnpm steiger`

#### Manual Verification:

- The new router variants and helper exports read as natural extensions of the existing patterns (no
  catalog/grouping data leaked into the router).

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Board wiring — both boards onto the model

### Overview

Wire the combined board's two missing park branches against the new router + helper, and migrate the
single board's inline resolvers to the shared helper (behavior-preserving).

### Changes Required:

#### 1. Combined board park wiring

**File**: `src/_pages/plan-detail/ui/CombinedPlannerBoard.tsx`

**Intent**: Pass `paletteCohort` to the router and handle the two park actions by resolving members via
the shared helper and calling the active cohort's `parkMembers` + `collapseUnlessPinned`.

**Contract**: `resolveCombinedDrop(source.data, target.data, paletteCohort)` (`:96`). Add `parkCourse`
and `parkGroup` cases to the `handleDrop` switch (`:100-121`): `parkCourse` parks
`[{ courseId, week: defaultParkedWeek(courseId, byCohort[cohort].weekModeByCourseId) }]`; `parkGroup`
parks `groupingParkedMembers(groupingId, byCohort[cohort].groupings, byCohort[cohort].weekModeByCourseId)`.
Route both through a small local `parkMembers(cohort, members)` that no-ops on empty and calls
`byCohort[cohort].actions.parkMembers(members)` + `collapseUnlessPinned()` — mirroring the single board's
`parkToShelf` (`PlannerBoard.tsx:165-169`).

#### 2. Single board adopts the shared helper

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Replace the inline `groupingMembers`/`defaultParkedWeek` with calls to the shared helper so
both boards resolve identically; no behavior change.

**Contract**: Delete the two inline functions (`:174-185`); `handleDrop`'s `course→shelf` and
`grouping→shelf` branches (`:124,132`) call `defaultParkedWeek(...)` / `groupingParkedMembers(...)` from
`model/parked-members`. `parkToShelf`, `collapseUnlessPinned`, and the `weekModeByCourseId` map (`:49`)
stay as-is.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Unit tests pass: `pnpm test`
- Lint passes (incl. `react-compiler` purity): `pnpm lint`
- Production build is clean (Workers runtime): `pnpm build`

#### Manual Verification:

- In `/plans/[id]/combined`, dragging a palette **course** onto the shelf parks it under the active
  cohort; the parked card is tagged with that cohort.
- Dragging a palette **grouping** onto the shelf parks all members; switching the palette cohort first
  parks under the other cohort.
- The shelf auto-collapses on park unless pinned; place-back from the parked card lands in the correct
  cohort's column.
- The single board (`/plans/[id]`) parks course + grouping exactly as before — no regression.

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 3: E2E — combined park + cohort-routed place-back

### Overview

Add one combined-route e2e proving the combined-specific behavior unit tests can't reach: a palette
grouping parks to the shelf and places back into the correct cohort's column.

### Changes Required:

#### 1. Promote shared shelf + combined-cell locators to `support/`

**File**: `e2e/support/board.ts` (and consuming spec imports)

**Intent**: This is the second consumer of the shelf locators/gestures (currently local to
`shelf-durability.spec.ts:105-159`) and the combined-cell locators (local to `combined-view.spec.ts:21-26`),
so promote them per the e2e convention ("promote a helper to `support/` only once a second spec needs it").

**Contract**: Move `shelf`, `parkedBadge`, `parkedCard`, `parkGroupingFromPalette`, `placeBackOnto`
(from `shelf-durability.spec.ts`) and `combinedCell`/`combinedChip` (from `combined-view.spec.ts`) into
`support/board.ts`; update both existing specs to import them. Keep `provisionCourses` local (test-specific).

#### 2. Combined park e2e spec

**File**: `e2e/specs/combined-shelf-park.spec.ts` (new)

**Intent**: Drive the combined route end-to-end: provision a DP1 grouping, park it from the palette onto
the shelf, then place the parked card back into a DP1 cell and assert it lands in the DP1 column and the
shelf empties.

**Contract**: Mirror `shelf-durability.spec.ts` test 2 on `/plans/[id]/combined`. Sequence: provision two
co-runnable DP1 courses + compute the grouping; navigate to the combined route; **expand the combined
palette** (it defaults collapsed — `CombinedPlannerBoard.tsx:41`) with DP1 active; drag `groupingBox(page, 2)`
→ `shelf`; assert `parkedBadge` shows `1 parked`; open + pin the drawer; `placeBackOnto` a DP1 combined
cell (`combinedCell(page, "DP1", slot)`) and assert the members land there (`combinedChip`) and
`parkedBadge` clears. Authenticated `chromium` project; teardown by `deletePlan`. Follow `e2e/CLAUDE.md`
(role-based locators, wait-for-state, unique data).

### Success Criteria:

#### Automated Verification:

- Combined park e2e passes: `pnpm test:e2e` (or the single spec via `pnpm exec playwright test combined-shelf-park`)
- The two refactored specs (`shelf-durability`, `combined-view`) still pass after the locator promotion.
- Lint + type check pass: `pnpm lint`, `pnpm check`

#### Manual Verification:

- The new spec fails if the park branch is reverted (delete the `parkGroup` case → spec red), confirming
  it guards the real risk.

**Implementation Note**: Final phase — confirm the full local CI gate is green via the `/verify` skill
before opening the PR.

---

## Testing Strategy

### Unit Tests:

- `parked-members.test.ts` — `defaultParkedWeek` (biweekly/agnostic); `groupingParkedMembers`
  (opposite-week alternation, plain defaults, unknown-id → `[]`).
- `combined-drop.test.ts` — `parkCourse`/`parkGroup` variants, `activeCohort` routing (dp1 vs dp2), and
  the flipped no-op assertion; all existing cases re-pass with the new 3rd arg.

### Integration Tests:

- None new — parking reuses the already-covered `shelf_bundles` RPC path (no new server surface).

### E2E (browser):

- `combined-shelf-park.spec.ts` — combined-route palette-grouping park + cohort-routed place-back.

### Manual Testing Steps:

1. `/plans/[id]/combined`: with DP1 active, drag a palette course onto the shelf → it parks, card tagged DP1.
2. Switch the palette to DP2, drag a grouping onto the shelf → it parks under DP2, card tagged DP2.
3. Place each parked card back → it lands in its own cohort's column; the other column is untouched.
4. Confirm the shelf auto-collapses on park unless pinned.
5. `/plans/[id]` (single board): park a course and a grouping → behavior unchanged.

## Performance Considerations

No constraint-core changes; `parkMembers` is the existing optimistic write path, so the <200ms drag
budget is unaffected. The router gains one argument and two branches — negligible.

## Migration Notes

None. No schema or data migration — parking reuses the existing `shelf_bundles` RPC.

## References

- Bug + fix sketch: `context/changes/combined-view-park-gap/change.md`
- Parity matrix + analysis: `context/changes/plan-detail-refactor/research.md` §C
- Single-board park reference: `src/_pages/plan-detail/ui/PlannerBoard.tsx:121-185`
- Router: `src/_pages/plan-detail/model/combined-drop.ts:24-51`
- Combined board drop dispatch: `src/_pages/plan-detail/ui/CombinedPlannerBoard.tsx:87-122`
- Exposed cohort actions: `src/_pages/plan-detail/model/use-cohort-board-state.ts:155,167`
- E2E exemplar (palette grouping → shelf park): `e2e/specs/shelf-durability.spec.ts:72-102`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure model core — shared member resolver + park-capable router

#### Automated

- [x] 1.1 Type check passes: `pnpm check` — ecf0f94
- [x] 1.2 Unit tests pass: `pnpm test` — ecf0f94
- [x] 1.3 Lint passes: `pnpm lint` — ecf0f94
- [x] 1.4 Structure check passes: `pnpm steiger` — ecf0f94

#### Manual

- [x] 1.5 New router variants + helper exports read as natural extensions (no catalog/grouping data in the router) — ecf0f94

### Phase 2: Board wiring — both boards onto the model

#### Automated

- [x] 2.1 Type check passes: `pnpm check` — a6e56a1
- [x] 2.2 Unit tests pass: `pnpm test` — a6e56a1
- [x] 2.3 Lint passes (incl. react-compiler purity): `pnpm lint` — a6e56a1
- [x] 2.4 Production build is clean: `pnpm build` — a6e56a1

#### Manual

- [x] 2.5 Combined view: palette course → shelf parks under the active cohort, card tagged with that cohort — a6e56a1
- [x] 2.6 Combined view: palette grouping → shelf parks all members; switching palette cohort parks under the other cohort — a6e56a1
- [x] 2.7 Shelf auto-collapses on park unless pinned; place-back lands in the correct cohort's column — a6e56a1
- [x] 2.8 Single board parks course + grouping exactly as before — no regression — a6e56a1

### Phase 3: E2E — combined park + cohort-routed place-back

#### Automated

- [x] 3.1 Combined park e2e passes: `pnpm test:e2e` — 067a7f1
- [x] 3.2 Refactored `shelf-durability` + `combined-view` specs still pass after locator promotion — 067a7f1
- [x] 3.3 Lint + type check pass: `pnpm lint`, `pnpm check` — 067a7f1

#### Manual

- [x] 3.4 Spec fails when the `parkGroup` branch is reverted (guards the real risk) — 067a7f1
