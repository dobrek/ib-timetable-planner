---
date: 2026-06-13T01:15:12+02:00
researcher: Claude (Fable 5)
git_commit: 3213909762af71ecbe99a2e8dfb9c9dacd2e0684
branch: main
repository: dobrek/ib-timetable-planner
topic: "Upfront mechanism to mark collision-free slots when the user starts dragging"
tags: [research, codebase, plan-detail, collisions, drag-and-drop, constraints, dnd-kit]
status: complete
last_updated: 2026-06-13
last_updated_by: Claude (Fable 5)
last_updated_note: "Added follow-up research for the all-slots-at-once marking scenario and the mark-free vs mark-collisions user setting"
---

# Research: Upfront mechanism to mark collision-free slots at drag start

**Date**: 2026-06-13T01:15:12+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: `3213909762af71ecbe99a2e8dfb9c9dacd2e0684`
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Collision detection works fine and gives good feedback when the user drops a subject or a group of subjects into a slot. Design an upfront mechanism that marks which slots are collision-free when the user **starts dragging**, hinting where a drop is possible.

## Summary

The feature is a thin composition over machinery that already exists — no new validation logic, no server changes, no data loading changes are needed:

1. **The what-if predicate already exists.** `hasIntersection(course, occupants)` / `violatesAny` ([model/collision.ts:10](https://github.com/dobrek/ib-timetable-planner/blob/3213909762af71ecbe99a2e8dfb9c9dacd2e0684/src/_pages/plan-detail/model/collision.ts#L10), [model/constraints/index.ts:18](https://github.com/dobrek/ib-timetable-planner/blob/3213909762af71ecbe99a2e8dfb9c9dacd2e0684/src/_pages/plan-detail/model/constraints/index.ts#L18)) is a pure, short-circuiting, context-free "would this course collide against these occupants?" check. Today only the server-side grouping enumerator uses it; it has never been wired to the drag UI.
2. **All inputs are already in client memory.** The validation catalog (`GroupingCourse[]` with `teacherKey` + `studentKeys`), placements, and groupings are island props; collision validation is entirely client-side (the Astro Action only checks shape/bounds).
3. **The missing pieces are exactly three**: (a) an `onDragStart` handler — `DragDropProvider` currently wires only `onDragEnd` ([PlannerBoard.tsx:78](https://github.com/dobrek/ib-timetable-planner/blob/3213909762af71ecbe99a2e8dfb9c9dacd2e0684/src/_pages/plan-detail/ui/PlannerBoard.tsx#L78)); (b) a pure `model/` derivation `Map<cellKey, free?>` over the ≤84 grid cells for the dragged course-set; (c) threading the result to `SlotCell` and a "valid target" visual treatment (only hover + destructive states exist today — no success token).
4. **Cost is a non-issue.** Grid is 5×10=50 cells (cap 7×12=84), cells hold single-digit occupants, catalog is ~37 courses. A naive per-cell what-if at drag start is tens of thousands of primitive ops — far below the <200ms budget. No conflict-matrix precompute is required (it remains an optional optimization).
5. **One real subtlety**: for `kind: "placement"` drags (moving an already-placed chip), the dragged placement must be subtracted from the candidate cell's occupants before checking — no existing helper does this.

Architecturally, the hint is **advisory, not a gate**: the resolved PRD policy is accept-and-flag (drops always land). Highlighting collision-free slots is orthogonal to that decision and doesn't conflict with it.

## Detailed Findings

### 1. Constraint/validation core (`src/_pages/plan-detail/model/`)

**Two validation views derived from one registry** (`CELL_CONSTRAINTS` at [constraints/index.ts:8](https://github.com/dobrek/ib-timetable-planner/blob/3213909762af71ecbe99a2e8dfb9c9dacd2e0684/src/_pages/plan-detail/model/constraints/index.ts#L8)):

- `explain(occupants, ctx)` — full violation enumeration; drives the post-drop UI via `deriveCellViolations` ([collisions.ts:25-38](https://github.com/dobrek/ib-timetable-planner/blob/3213909762af71ecbe99a2e8dfb9c9dacd2e0684/src/_pages/plan-detail/model/collisions.ts#L25-L38)), recomputed in `useMemo` on every placement change (`useCollisions`, PlannerBoard.tsx:114-117).
- `test?(course, others)` — short-circuiting boolean fast path, surfaced as `hasIntersection` (collision.ts:10). **This is the predicate the new feature should reuse** — it answers "would collide?" without enumerating details.

**Three constraints exist** (open-closed registry; new constraint = new file + union member + registry entry):

| Constraint | File | Rule |
|---|---|---|
| duplicate-course | `constraints/duplicate-course.ts:5-9` | same course id twice in one cell |
| teacher-conflict | `constraints/teacher-conflict.ts:8-17` | ≥2 occupants share non-null `teacherKey` |
| student-conflict | `constraints/student-conflict.ts:8-22` | occupant pair with non-empty `studentKeys` intersection |

**Key types** (input: `shared/lib/catalog-hash/types.ts:8-13`; output: `model/collisions.ts:9-14`, `constraints/types.ts:7-10`):

```ts
type GroupingCourse = { id: string; teacherKey: string | null; studentKeys: string[]; hours: number };
type CellCollisions = { conflictingIds: Set<string>; violations: CollisionViolation[] };
// cells keyed by cellKey(day, period) = `${day}:${period}`  (collisions.ts:7)
```

**Purity and cost.** All checks are pure, synchronous, zero I/O. Per-cell cost is O(occupants²) with student intersection as an `Array.includes` scan ([student-conflict.ts:21](https://github.com/dobrek/ib-timetable-planner/blob/3213909762af71ecbe99a2e8dfb9c9dacd2e0684/src/_pages/plan-detail/model/constraints/student-conflict.ts#L21)). Scale: ~37 dp1 courses, studentKeys typically <25, grid 50–84 cells, single-digit occupants per cell. Worst-case "what-if every cell for a 10-member group" ≈ low millions of primitive ops; realistic case tens of thousands — trivially inside the <200ms budget.

**Scope caveat**: the board renders **only Y12 (dp1)** today — `BOARD_COHORT` is hardcoded at `api/load.ts:15` ("Year 2 arrives with S-09"). All validation is single-cohort, per-cell.

**Existing memoization is minimal**: `catalogById` Map and the two derivations (`useCollisions`, `useHours`) at PlannerBoard.tsx:114-117,140-144. No per-course student Sets, no pairwise conflict matrix. The private cell-bucketing helper in `collisions.ts:40-54` would need exporting (or a sibling) for the new derivation.

### 2. Drag-and-drop lifecycle (`src/_pages/plan-detail/ui/`)

**Library**: new dnd-kit — `@dnd-kit/react` + `@dnd-kit/dom` pinned `0.4.0` (package.json:26-27). Provider at [PlannerBoard.tsx:78](https://github.com/dobrek/ib-timetable-planner/blob/3213909762af71ecbe99a2e8dfb9c9dacd2e0684/src/_pages/plan-detail/ui/PlannerBoard.tsx#L78) with custom `PLUGINS` (Feedback `dropAnimation: null`, PlannerBoard.tsx:150-152).

**Three draggable kinds**, discriminated payload at [model/drag.ts:6-9](https://github.com/dobrek/ib-timetable-planner/blob/3213909762af71ecbe99a2e8dfb9c9dacd2e0684/src/_pages/plan-detail/model/drag.ts#L6-L9):

```ts
type DragData =
  | { kind: "course"; courseId: string }                        // palette row (GroupingBox.tsx:75-78)
  | { kind: "placement"; placementId: string; courseId: string } // placed chip move (SlotCell.tsx:76-80)
  | { kind: "grouping"; groupingId: string };                    // whole group (GroupingBox.tsx:27-30)
```

Grouping drags resolve `groupingId → memberIds` in `dropGroup` (PlannerBoard.tsx:59-62) — the same resolution an `onDragStart` hook would perform.

**Droppables**: every `SlotCell` is `useDroppable({ id: cellKey(day, period), data: { day, period } })` ([SlotCell.tsx:30](https://github.com/dobrek/ib-timetable-planner/blob/3213909762af71ecbe99a2e8dfb9c9dacd2e0684/src/_pages/plan-detail/ui/SlotCell.tsx#L30)).

**Only `onDragEnd` is wired today** (`handleDrop`, PlannerBoard.tsx:38-56). The library also exposes `onBeforeDragStart`, `onDragStart`, `onDragMove`, `onDragOver`, `onCollision` provider props, plus `useDragDropMonitor` and `useDragOperation()` hooks (`@dnd-kit/react/index.d.ts:11-18, 80-85`) — multiple clean subscription points for "a drag started, carrying X".

**Component tree** (island root → cell): `PlannerBoard` → `PlannerGrid` (builds `byCell` via `groupByCell`, PlannerGrid.tsx:98-108) → `PeriodRow` → `SlotCell` → `PlacedChip`. **No `React.memo`/`useCallback` anywhere in the slice** — every placement change re-renders the full grid, accepted at ≤84 cells. A drag-start state change adds one more full-grid render; fine, with `React.memo` on `SlotCell` as the first lever if ever needed.

**Existing per-slot drag visuals**: only the hover target — `isDropTarget` → `bg-accent ring-ring ring-2 ring-inset` (SlotCell.tsx:44). Collision state uses `ring-destructive` / `border-destructive` / `bg-destructive/10` (SlotCell.tsx:43,90). **There is no "valid drop target" token yet**; per the semantic-tokens lesson, a success-style token would need adding to `global.css` (`:root` + `.dark` + `@theme inline`) rather than a palette class.

**Drag state**: no app-level store; dnd-kit's signal-based `DragDropManager` holds it. Placement state lives in `usePlacements` ([model/use-placements.ts:42](https://github.com/dobrek/ib-timetable-planner/blob/3213909762af71ecbe99a2e8dfb9c9dacd2e0684/src/_pages/plan-detail/model/use-placements.ts#L42)), owned by `PlannerBoard` — so `PlannerBoard` is the natural owner of `draggedCourses: GroupingCourse[] | null` state set in `onDragStart` and cleared in `handleDrop`/drag end.

**Drop flow**: pure guards (`canAdd`, `moveIntent` in `model/placement-transitions.ts`) → optimistic state with temp UUID + `pending: true` → Astro Action (`placement-client.ts:12` → `placement-actions.ts:4-7`) → reconcile or rollback. Server does **zero** collision validation.

### 3. Historical context and constraints

- **Accept-and-flag is a resolved PRD decision** (PRD Q8, option b): drops always land; collisions are flagged after the fact (`context/changes/collision-info/`, `context/archive/2026-06-05-first-valid-drop-with-validation/`). The hint feature must stay **advisory** — it must not become a drop gate.
- **group-dragging plan explicitly scoped out "pre-drop group validation"** (`context/changes/group-dragging/plan.md`, "What We're NOT Doing") — but that referred to validation *gates*. Read-only validity hints are orthogonal and were never deferred or rejected.
- **Intra-group conflicts are impossible by construction** — the enumeration algorithm only emits pairwise-compatible member sets (`context/changes/group-dragging/research.md:51`). So for a grouping drag, per-cell validity = every member passes against the cell's occupants; members never need checking against each other.
- **Reactive derivation over snapshots** is the established pattern (first-valid-drop research): compute from live state via `useMemo`, never snapshot inside a drag handler. The validity map should be `useMemo([draggedCourses, placements, catalogById])` so it stays correct if placements settle/rollback mid-drag.
- **<200ms p95 budget** (PRD FR-012/NFR, prd.md:129) for cohorts of 50–150 students / 30–60 courses — comfortably met by naive per-cell what-if (§1 cost analysis).
- **Opaque ids, names at the render edge** (lessons.md "Port the mechanism"): the validity map should key cells by `cellKey(day, period)` and carry no display data.

### 4. Proposed mechanism (synthesis)

1. **Capture drag identity** — add `onDragStart` to the `DragDropProvider` (PlannerBoard.tsx:78): resolve `DragData` → `GroupingCourse[]` (course → 1 course; placement → its course + its `placementId` for exclusion; grouping → memberIds via `groupings`). Store in `PlannerBoard` state; clear on drag end (also on `event.canceled`).
2. **Pure derivation** — new `model/` function (sibling of `deriveCellViolations`, e.g. `deriveFreeCells(dragged, placements, catalogById, grid)`): bucket placements by cell (reuse/export the bucketing in collisions.ts:40-54), then for each of the ≤84 cells run `violatesAny` for each dragged course against the cell's occupants. Empty cells are trivially free. For placement moves, exclude the dragged `placementId` from the candidate cell's occupants (this also makes the origin cell evaluate correctly). Wrap in `useMemo`.
3. **Thread + render** — pass the `Set<cellKey>` (or `Map`) down `PlannerGrid → PeriodRow → SlotCell` exactly like `collisions` is threaded today (PlannerGrid.tsx:14,45,84); add a `data-valid-target` attribute and a token-based highlight in the `cn(...)` at SlotCell.tsx:41-45, coexisting with `isDropTarget` hover and the destructive collision ring.

Design questions to settle at plan time (see Open Questions): visual treatment (highlight free vs dim colliding), whether a "same cell / duplicate" no-op cell counts as unavailable (`canAdd`/`moveIntent` semantics vs constraint semantics), and partial-group nuance (group drops currently filter to `eligibleMembers`, so a cell can be "partially free").

## Code References

- `src/_pages/plan-detail/model/collision.ts:10` — `hasIntersection(course, list)`: the existing pure what-if predicate to reuse
- `src/_pages/plan-detail/model/constraints/index.ts:8,18-19` — `CELL_CONSTRAINTS` registry + `violatesAny` fast path
- `src/_pages/plan-detail/model/constraints/types.ts:7-10,23-30` — `CollisionViolation` union, `CellConstraint` contract
- `src/_pages/plan-detail/model/collisions.ts:7,25-38,40-54` — `cellKey`, `deriveCellViolations`, private cell-bucketing helper (export candidate)
- `src/_pages/plan-detail/model/constraints/student-conflict.ts:21` — O(|A|·|B|) includes-scan intersection
- `src/_pages/plan-detail/model/drag.ts:6-12` — `DragData` discriminated union + `CellData`
- `src/_pages/plan-detail/model/use-placements.ts:42-173` — optimistic placement state (the live input to validity)
- `src/_pages/plan-detail/model/placement-transitions.ts:7-9,88-99` — `canAdd` / `moveIntent` guards (same-cell/duplicate no-op semantics)
- `src/_pages/plan-detail/model/grid.ts:10,18` — `GRID_BOUNDS` 7×12 cap, `DEFAULT_GRID` 5×10
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:38-62,78,114-117,150-152` — `handleDrop`, `DragDropProvider` (no `onDragStart` yet), derivation hooks, plugins
- `src/_pages/plan-detail/ui/SlotCell.tsx:30,41-45,76-80,96-114` — droppable cell, visual-state `cn(...)`, placed-chip draggable, collision badge
- `src/_pages/plan-detail/ui/PlannerGrid.tsx:14,45,84,98-108` — collisions threading pattern + `groupByCell`
- `src/_pages/plan-detail/ui/GroupingBox.tsx:27-30,75-78` — grouping and palette-course draggables
- `src/_pages/plan-detail/ui/GroupDragOverlay.tsx:20-24` — `DragOverlay` reading live drag `source`
- `src/_pages/plan-detail/api/load.ts:15,31-65` — `BOARD_COHORT = "dp1"`, island props assembly (catalog + names)
- `src/shared/lib/catalog-hash/types.ts:8-13` — `GroupingCourse` validation-catalog shape

## Architecture Insights

- **Two-tier constraint API is the load-bearing seam**: `explain` for rich post-drop feedback, `test` for cheap boolean what-if. The hint feature is the first UI consumer of the `test` tier — detector and hint can't drift because both derive from one registry.
- **Validation is fully client-side and pure**; the server never checks collisions. Everything the hint needs is already island props — no API work.
- **Accept-and-flag stands**: hints are an affordance layered on top, not a gate. An "invalid" cell must still accept drops (and then flag, as today).
- **Reactive `useMemo` derivations from live placement state** are the house pattern; the validity map should follow it (keyed on dragged set + placements), not be snapshotted in a handler.
- **No memoized components in the slice** — a drag-start re-render of ~50 cells is the accepted cost model; `React.memo` on `SlotCell` is the documented first optimization lever if needed.
- **Semantic tokens only**: a "valid target" treatment needs a new token in `global.css` (no `green-*` utilities), per lessons.md.

## Historical Context (from prior changes)

- `context/changes/collision-info/plan.md` — constraint registry design (open-closed, explain/test split); per-cell cost "≈ microseconds"; names resolved at render edge
- `context/changes/collision-info/research.md` — confirms no server-side collision check; explanation is "purely client-side model work"
- `context/changes/group-dragging/plan.md` — "No pre-drop group validation" scoped out (gates, not hints); batch state updates so derivations recompute once; opaque drag payload
- `context/changes/group-dragging/research.md` — intra-group conflicts impossible by construction; `deriveCollisions` reused with zero changes
- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md` — accept-and-flag resolution (PRD Q8), reactive per-cell derivation over `onDragEnd` snapshots, per-cell collision scope, <200ms northstar
- `context/foundation/prd.md:129,145-148` — FR-012 + ≤200ms p95 validation-responsiveness NFR

## Related Research

- `context/changes/collision-info/research.md` — collision detection internals (direct predecessor)
- `context/changes/group-dragging/research.md` — drag lifecycle and group-drop fan-out
- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md` — original validation architecture

## Open Questions

1. **Visual semantics** — highlight free cells (positive) vs dim/desaturate colliding cells (negative) vs both? Needs a new semantic token either way; also decide treatment for the *origin* cell of a placement move.
2. **Group partial validity** — group drops filter to `eligibleMembers`, so a cell can be free for some members and colliding for others. Binary hint (all-free), ternary (all/some/none), or per-member count?
3. **No-op cells** — should cells where the drop would be a silent no-op (`canAdd` duplicate, `moveIntent` same-cell) be marked unavailable even though they're not "collisions"? Likely yes for honest affordance, but it mixes guard semantics into constraint semantics.
4. **Live recompute during drag** — if a pending placement settles or rolls back mid-drag, the `useMemo` recomputes and hints shift under the cursor. Acceptable (correct) or visually jarring? Probably accept; scale makes it cheap.
5. **Future constraints** — when teacher cross-cohort (S-09) or availability constraints land in the registry, hints inherit them automatically only if the derivation uses `violatesAny` over the registry rather than a bespoke check — worth stating as a plan invariant.

## Follow-up Research 2026-06-13 (all slots marked at once on drag start)

**Question**: the user starts dragging and *all* the places where the dragged course/group could be dropped are marked simultaneously — does the proposed mechanism cover that?

**Answer: yes, natively — the design is whole-grid by construction, not hover-driven.**

- The derivation proposed in §4 evaluates **every cell in one pure sweep** at `onDragStart` and returns the full `Set<cellKey>` of free cells. Because the set is threaded as props and the slice has no memoized components, a single state change re-renders all ~50 cells in one pass — the entire validity map appears at once. No `onDragOver`/per-hover computation exists or is needed.
- **Cost of the whole-grid sweep** (worst case): 84 cells × ~10 group members × single-digit occupants × short-circuiting `test` checks ≈ tens of thousands of ops — single-digit ms, far under the 200ms budget (see §1 cost analysis). The all-at-once scenario does not change the cost class.
- **Marks stay live during the drag**: the `useMemo` keys on `placements`, so if an optimistic placement settles or rolls back mid-drag, every cell's mark refreshes in the same render — consistent with the house "reactive derivation, never snapshot" pattern.

**New design consideration raised by all-at-once marking — signal density.** Early in planning the grid is mostly empty, so almost *every* cell is collision-free: positively highlighting free cells floods the grid with ~50 highlights (pure noise), while the number of *blocked* cells starts near zero and grows as the board fills. The inverse encoding — visually **recede/dim the blocked cells** (e.g. reduced opacity / muted background) and leave free cells neutral — keeps the signal sparse at every stage of planning and makes the remaining "droppable" cells pop by contrast. This sharpens Open Question 1: for the all-at-once scenario the dim-the-blocked treatment is likely the right default, with the strong positive highlight reserved for the hovered cell (`isDropTarget`, already present). A ternary treatment (free / partially free for groups / blocked) remains the open sub-question.

**Group drags ("those groups")**: a cell counts as fully free only when *every* member passes against the cell's occupants (members are pairwise conflict-free by construction, so no intra-group checks). Cells where only some members fit are the "partially free" middle state — `eligibleMembers` filtering (`use-placements.ts:34-36`) means a drop there still lands the fitting members, so marking them as fully blocked would be dishonest; this pushes toward the ternary encoding.

## Follow-up Research 2026-06-13 (user setting: "mark collisions" vs "mark free slots")

**Question**: can the signal-density encoding be a user-facing option — a setting that switches between highlighting free slots and dimming/marking colliding slots?

**Answer: yes, and it is almost free — the encoding choice is purely presentational.**

- **The derivation is encoding-agnostic by construction.** It computes the full per-cell validity map (`Set<cellKey>` of free cells, or a ternary `Map` if partial-group states are kept); "free" and "blocked" are complements over the known grid. Both modes read the same memoized result — the toggle never touches `model/` logic and has zero performance or validation implications. This should be stated as a plan invariant: the derivation returns the complete map; the mode only selects which side gets visual ink in `SlotCell`.
- **Implementation surface**: one piece of preference state in `PlannerBoard`, one class branch in the `SlotCell` `cn(...)` (SlotCell.tsx:41-45) — e.g. mode `"free"` → positive highlight token on free cells; mode `"collisions"` → dim/mute treatment on blocked cells. Both modes still need the partial-group middle treatment (the mode decides emphasis, not the existence of the third state).
- **Persistence tier — follow the existing precedent.** The codebase already persists exactly this kind of cosmetic, per-device preference in `localStorage`: `theme` (`src/app/layouts/BaseLayout.astro:22`, `SidebarLayout.astro:153`) and `sidebar-collapsed` (`SidebarLayout.astro:42,171`). A `planner-drag-hint-mode` (or similar) localStorage key fits the same pattern. **No Supabase work is justified** — there is no user-preferences table, and a cosmetic toggle doesn't warrant a migration or server round-trips.
- **SSR/hydration is a non-issue here**, conveniently: the setting only manifests while a drag is in progress, and drag state is always `null` at island SSR/hydration time — so reading localStorage lazily on the client (lazy `useState` initializer with a `typeof window` guard, or read-on-first-drag) can never cause a hydration mismatch in the visible UI.
- **UI placement options**: a small segmented control or icon toggle on the planner board (near `PlanSummaryBar`), or inside a board-options popover. Note the control configures something visible only during drags — labeling should make that clear (e.g. "While dragging: highlight free slots / mark collisions").
- **Scoping recommendation**: build the encoding-agnostic derivation + one default mode (dim-blocked, per the signal-density analysis above) first; the toggle is a small, cleanly separable increment that can land in the same change or as an immediate follow-up. If the team prefers shipping without a setting, the encoding-agnostic invariant keeps the door open at near-zero cost.
