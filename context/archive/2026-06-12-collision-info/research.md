---
date: 2026-06-12T23:25:30+02:00
researcher: Claude (Fable 5)
git_commit: cde5c8f462bbbdc2a92fd190732e742a0b68ed47
branch: main
repository: ib-timetable-planner
topic: "Verbose collision feedback — explain which subject/teacher/student caused a collision, open-closed for new constraints"
tags: [research, codebase, plan-detail, collisions, validation, constraints, open-closed, ui]
status: complete
last_updated: 2026-06-12
last_updated_by: Claude (Fable 5)
last_updated_note: "Follow-up: resolved student-name display (full names), BoardContext shape (minimal-now), and tooltip scope (no descriptive tooltip — Dialog is the single detail surface)"
---

# Research: Verbose Collision Feedback (collision-info)

**Date**: 2026-06-12T23:25:30+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: `cde5c8f462bbbdc2a92fd190732e742a0b68ed47`
**Branch**: `main`
**Repository**: `ib-timetable-planner`

## Research Question

Drag-and-drop on the plan board gives instant but **binary** collision feedback (badge + generic tooltip: "teacher or student"). The author needs to know **which subject, which teacher, which student** caused the collision. Two sub-questions:

1. **UI**: how to surface the detail (dialog / drawer on click?).
2. **Architecture**: make the collision algorithm verbose, or keep it and add an explainability mechanism — while honoring the **open-closed principle** (open to new constraints, closed for modification) and the ≤200ms validation budget.

## Summary

- The collision core is deliberately tiny: a single boolean predicate [`hasIntersection`](https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/src/_pages/plan-detail/model/collision.ts#L3-L13) with three inlined checks (duplicate course, shared teacher, shared student), wrapped by [`deriveCollisions`](https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/src/_pages/plan-detail/model/collisions.ts#L17-L42) which returns `Map<cellKey, Set<courseId>>` — *which* courses collide, never *why* or *via whom*. There is **no constraint registry and no open-closed seam today**.
- **Everything needed to explain a collision is already in scope at the detection site** — full `GroupingCourse` objects with `teacherKey` and `studentKeys` are in hand inside `deriveCollisions`; nothing is erased into bitsets or counters. The blocker is **display names**: by design the island ships only course-id→name; **teacher and student names never reach the client** (`drag.ts:5` — "Identity is opaque ids — never names").
- **Performance is a non-issue for explanation**: the board path is O(occupants²) per cell over tiny N (microseconds–low ms). The real perf consumer of `hasIntersection` is the **server-side grouping enumerator** (`enumerate.ts`), which is combinatorial and must keep a short-circuiting boolean.
- The PRD **already promises** this feature: validation must report invalid "**with the specific class(es) of violation named**" ([prd.md:148](https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/context/foundation/prd.md)). S-01 shipped the generic tooltip explicitly as a stopgap ("tooltip naming the collision generically — teacher/student split is S-03").
- **Recommended path (Option C below)**: extract a **constraint registry** — each constraint is a self-contained evaluator producing structured `CollisionViolation` values; the boolean verdict is derived from it (with a short-circuit mode for the enumerator). The UI gets a **clickable badge → Dialog** (exact precedent: `CourseOverlaps` in the courses slice), with ids resolved to names at the render edge via name records added to `loadPlannerData`.

## Detailed Findings

### 1. The collision core today (model layer)

| File | Role |
|---|---|
| [`src/_pages/plan-detail/model/collision.ts:3-13`](https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/src/_pages/plan-detail/model/collision.ts#L3-L13) | `hasIntersection(course, list): boolean` — the single predicate |
| [`src/_pages/plan-detail/model/collisions.ts:17-42`](https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/src/_pages/plan-detail/model/collisions.ts#L17-L42) | `deriveCollisions` — buckets placements per cell, pairwise-tests, returns `Map<cellKey, Set<courseId>>` |
| [`src/shared/lib/catalog-hash/types.ts:8-13`](https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/src/shared/lib/catalog-hash/types.ts#L8-L13) | `GroupingCourse = { id, teacherKey: string \| null, studentKeys: string[], hours }` |
| [`src/_pages/plan-detail/model/enumerate.ts:38,53`](https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/src/_pages/plan-detail/model/enumerate.ts#L38) | **Second consumer** of `hasIntersection` — combinatorial grouping enumeration |

The predicate, verbatim:

```ts
export const hasIntersection = (course: GroupingCourse, list: GroupingCourse[]): boolean => {
  if (list.some((item) => item.id === course.id)) return true;
  if (
    course.teacherKey !== null &&
    list.some((item) => item.teacherKey !== null && item.teacherKey === course.teacherKey)
  )
    return true;
  return list.some((item) => item.studentKeys.some((s) => course.studentKeys.includes(s)));
};
```

Three constraints, **monolithic, early-return, no registry**. Note it short-circuits — it finds *a* conflict, not *all* conflicts. An explanation variant must enumerate instead.

Constraint-adjacent checks living elsewhere (out of collision scope but part of the "constraint landscape"):
- Duplicate course-hour in cell — `occupiesCell` (`model/placement.ts:16-20`), the only check that actually *blocks* a drop (`placement-transitions.ts:7-9`).
- Hours completeness — `model/hours.ts:14,32` (display-only).
- Catalog `ComputeWarning` — `types.ts:15-19`, shape `{ courseId, kind, message }`.

### 2. Validation is reactive, not a drop gate (critical invariant)

Drops **always land** ("accept-and-flag", PRD open question 8 resolved to option b — see Historical Context). Collisions are a **derived, memoized computation** re-run on every placement change:

1. `handleDrop` ([`PlannerBoard.tsx:34-52`](https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/src/_pages/plan-detail/ui/PlannerBoard.tsx#L34-L52)) → optimistic state via `usePlacements` (`model/use-placements.ts:42-173`).
2. `useCollisions` (`PlannerBoard.tsx:101-104`) — `useMemo(deriveCollisions(placements, catalogById), [placements, catalogById])`.
3. `Map<cellKey, Set<courseId>>` → `PlannerGrid.tsx:79` (`collisions.get(cellKey(day, period))`) → `SlotCell.tsx:28` (cell ring `:39`) and per-chip `conflicted` flag (`:48`).

No collision check exists server-side; the Astro Action validates shape/bounds only (`api/placements.ts:11-17`); the DB enforces only uniqueness + ranges. Any explanation mechanism is therefore **purely client-side model work** — no API/action changes needed for detection, only (possibly) for name data.

### 3. Current UI feedback — the binary ceiling

[`SlotCell.tsx:87-96`](https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/src/_pages/plan-detail/ui/SlotCell.tsx#L87-L96):

```tsx
{conflicted && (
  <Badge variant="destructive" data-slot="collision-badge"
    title="Collision: shares a student or teacher with another course in this slot" ...>
    <TriangleAlert className="size-3" />
    <span className="sr-only sm:not-sr-only">collision</span>
  </Badge>
)}
```

- Static `<span>`-based badge, **hover-only native `title` tooltip**, not clickable, not focusable. The message is a fixed string covering both possible causes.
- Cell-level cue: destructive ring (`SlotCell.tsx:39`).
- No collision-aware feedback *during* drag — only the generic drop-target highlight (`SlotCell.tsx:40`).
- Available shadcn primitives in `src/shared/ui/`: **Dialog, Popover, AlertDialog, DropdownMenu, Sonner, Tabs, Command**. **Not present: HoverCard, Drawer/Sheet, Accordion, Radix Tooltip.** None are used in plan-detail yet.
- Established click-to-inspect precedent: [`src/_pages/courses/ui/CourseOverlaps.tsx:30-52`](https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/src/_pages/courses/ui/CourseOverlaps.tsx#L30-L52) — controlled `Dialog` with intent-named `onClose`, per the documented dialog contract (`context/foundation/ui-conventions.md:77-85`).

### 4. Data availability — what an explanation needs

**In scope at detection time (free):** inside `deriveCollisions` the pairwise loop holds full `GroupingCourse` objects. Computing "course A and course B share teacher `t1` and students `[s2, s5]`" is a pairwise diff of data already in hand. Course display names are available client-side via `names: Record<string, string>` (`model/drag.ts:22`, populated in [`api/load.ts:80`](https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/src/_pages/plan-detail/api/load.ts#L80)).

**Missing (the only real data gap):** teacher and student **display names**. `teacherKey`/`studentKeys` are uuids; the island intentionally ships ids only. To say "Ms. Smith teaches both" or list affected students, `loadPlannerData` (`api/load.ts:30-85`) must additionally ship `teacherNames` / `studentNames` records (~10s of teachers, ~50–150 students — trivial payload). This follows the house pattern exactly: *ids in the model, names resolved at the render edge via a names record* (see `PlacementError` + `placementErrorMessage`, `placement-transitions.ts:68-76`, and the lessons.md "port the mechanism" rule).

A counts-only explanation ("shares 4 students with Math HL") needs **no new data at all**.

### 5. Performance envelope

- The ≤200ms p95 budget is PRD-level ([prd.md:129](https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/context/foundation/prd.md)); **no benchmark asserts it in code**.
- Board path: full recompute per change, O(occupants²·students²-ish) per cell over tiny N → microseconds to low ms. **Eager structured explanation on this path is safe.**
- Enumerator path (`enumerate.ts`): combinatorial, guarded by traversal caps (`TRAVERSAL_LIMIT_FACTOR`, `EnumerationCapError`). **This consumer must keep a short-circuiting boolean** — handing it an enumerating explainer would multiply work at combinatorial scale.
- Standing invariant from `port-grouping-algorithm` research: *"never embed the combinatorial generator in the validator"* — and symmetrically, don't slow the generator with validator verbosity.

### 6. Extensibility seams that already exist

- `Result<T,E>` (`src/shared/lib/result.ts`) — house pattern for typed outcomes.
- `MoveRejection` / `RemoveRejection` string enums + `PlacementError` discriminated union (`placement-transitions.ts:68-76, 86, 119`) — the closest existing "reason taxonomy", with name resolution at the edge.
- `ComputeWarning` (`types.ts:15-19`) — a per-course `{ courseId, kind, message }` template.
- The cohort dimension is handled by **data partition**, not by check (`load.ts:13-14`, `BOARD_COHORT = "dp1"`); cross-cohort teacher constraints (S-09) will need the evaluator to see *more context than cell occupants* — this materially shapes the registry signature (see Options).

## Options Analysis

The decision has two independent axes: **where the explanation comes from** (model architecture) and **how it's shown** (UI surface).

### Axis 1 — Model architecture

#### Option A — Make the algorithm verbose (modify the core)

Rewrite `hasIntersection`/`deriveCollisions` so every call returns structured violations; boolean callers adapt.

- ✅ Single source of truth; explanation can never drift from detection.
- ❌ **Modifies the shared contract** with `enumerate.ts` — the combinatorial enumerator would pay enumeration cost (or need an awkward dual API), risking the server compute path.
- ❌ Most invasive; violates "closed for modification" today *and* every time a constraint changes shape.

#### Option B — Keep the algorithm, bolt on an explainer

Leave `hasIntersection`/`deriveCollisions` untouched. Add a separate pure `explainCell(occupants): Violation[]`, invoked lazily (on badge click) only for flagged cells.

- ✅ Zero risk to existing paths; zero perf cost until the user asks.
- ✅ Smallest diff.
- ❌ **Two parallel rule sets**: every future constraint (teacher availability S-03 remnants, cross-cohort S-09, rooms, …) must be added to *both* the detector and the explainer — the classic drift bug. This is the *opposite* of open-closed: extension requires coordinated modification in two places.

#### Option C — Constraint registry; verdict and explanation both derived from it ⭐ recommended

Invert the dependency: constraints become **data** (a registry of self-contained evaluators); both the boolean verdict and the explanation are derived views over the same registry.

```ts
// model/constraints/types.ts
export type CollisionViolation =
  | { kind: "duplicate-course"; courseIds: string[] }
  | { kind: "teacher"; teacherKey: string; courseIds: string[] }
  | { kind: "student"; studentKeys: string[]; courseIds: string[] };
  // future: | { kind: "teacher-availability"; ... } | { kind: "cross-cohort"; ... }

export type CellConstraint = {
  id: string;
  // ctx anticipates S-09/availability: constraints that need more than cell occupants
  explain(occupants: GroupingCourse[], ctx: BoardContext): CollisionViolation[];
  // optional fast-path override; defaults to explain(...).length > 0
  test?(course: GroupingCourse, others: GroupingCourse[], ctx: BoardContext): boolean;
};
```

- `deriveCollisions` is replaced (or superseded) by `deriveCellViolations(placements, catalogById): Map<cellKey, CollisionViolation[]>`; the current `Map<cellKey, Set<courseId>>` is a trivial projection of it (so `PlannerGrid`/`SlotCell` props barely change).
- `enumerate.ts` keeps a short-circuiting boolean built from the same registry's `test` functions — `hasIntersection` can remain as that composed fast path, now *derived from* the registry rather than hand-rolled beside it. One rule set, two consumption modes.
- **Open-closed, concretely**: adding "room conflict" = one new file exporting a `CellConstraint` + one union member + one entry in the registry array + a renderer case. `deriveCellViolations`, the grid, the badge, and existing constraints are untouched.
- Eager vs lazy becomes a tuning knob, not architecture: at current N, computing violations eagerly for flagged cells is microseconds. If scale ever bites, switch the detail pass to on-click without changing the types.
- ✅ Matches house patterns (discriminated unions, ids-in-model/names-at-edge, pure `model/` functions, newspaper order).
- ❌ Slightly larger initial diff than B (refactor of `collision.ts` + tests), but it's the diff the roadmap already owes (S-03's "named classes" promise).

### Axis 2 — UI surface

| Surface | Exists? | Fit |
|---|---|---|
| **Dialog on badge click** ⭐ | Yes (`shared/ui/dialog.tsx`), precedent `CourseOverlaps` | Handles long student lists (scroll), documented `onClose` contract, zero new primitives. Recommended first step. |
| Popover on badge click | Yes (`shared/ui/popover.tsx`), unused in plan-detail | Lighter, keeps board context; cramped for many students. Good alternative if Dialog feels heavy. |
| Drawer / Sheet | **No** — primitive would need to be added (+ detokenization per lessons.md) | Only worth it if this grows into a persistent board-level "problems panel". |
| Board-level problems panel | n/a | Natural follow-up: `deriveCellViolations` output is already board-wide, so an aggregated list ("3 collisions: …") costs nothing extra in the model. Out of scope for v1. |

Concrete UI shape for v1:
- Make the badge an interactive trigger (real `<button>`, focusable — fixes the current a11y gap where the `title` tooltip is mouse-only).
- Dialog content: violations for the cell grouped by `kind`, each line resolving ids → names: *"**Teacher**: Jane Smith teaches both Math HL and Physics SL"*, *"**Students**: 4 shared between Math HL and Chemistry HL — Anna K., …"*.
- Per ui-conventions: open/close state in a dedicated hook (`useCollisionInspection` or co-located private hook), dialog as a declarative child with `onClose`, name resolution at the render edge.
- Optionally upgrade the badge tooltip to a one-line summary ("teacher + 4 students") — cheap once violations are structured.

### Required data change (either UI)

Extend `loadPlannerData` (`api/load.ts`) to ship `teacherNames: Record<string,string>` and `studentNames: Record<string,string>` alongside the existing course `names`. Read-only, additive, follows the existing names-record pattern. Consider whether full student names are appropriate in this surface or whether count + expandable list suffices (privacy/clutter call for the author).

## Code References

- `src/_pages/plan-detail/model/collision.ts:3-13` — `hasIntersection`, the monolithic boolean predicate (refactor target).
- `src/_pages/plan-detail/model/collisions.ts:6,17-42` — `cellKey`, `deriveCollisions` returning `Map<cellKey, Set<courseId>>`.
- `src/_pages/plan-detail/model/enumerate.ts:38,53` — second consumer of `hasIntersection`; must keep short-circuit boolean.
- `src/shared/lib/catalog-hash/types.ts:8-19` — `GroupingCourse`, `ComputeWarning` (template for a violation type).
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:34-52,89,101-104` — drop handler, `useCollisions`, prop wiring.
- `src/_pages/plan-detail/ui/PlannerGrid.tsx:79` — per-cell conflict lookup.
- `src/_pages/plan-detail/ui/SlotCell.tsx:28,39-40,48,87-96` — droppable, collision ring, `conflicted` flag, the badge + static tooltip.
- `src/_pages/plan-detail/model/placement-transitions.ts:68-76,86,119` — `PlacementError`/rejection-reason precedent (ids in model, names at edge).
- `src/_pages/plan-detail/model/drag.ts:5,22` — "identity is opaque ids — never names"; course `names` record.
- `src/_pages/plan-detail/api/load.ts:30-85` — `loadPlannerData`; extension point for teacher/student name records.
- `src/_pages/courses/ui/CourseOverlaps.tsx:30-52` — the click-to-inspect Dialog precedent to copy.
- `src/_pages/plan-detail/model/collision.test.ts`, `collisions.test.ts` — existing tests asserting boolean / `Map`+`Set` shapes (will extend, not break, under Option C's projection approach).

Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/cde5c8f462bbbdc2a92fd190732e742a0b68ed47/`

## Architecture Insights

- **Accept-and-flag is load-bearing**: collisions are derived state, never a drop gate. Explanation must stay a derived/reactive view too — never a captured verdict inside `onDragEnd` (documented footgun).
- **Two consumers, two cadences**: the board (tiny N, can afford enumeration) vs the grouping enumerator (combinatorial, needs short-circuit). Any redesign must serve both from one rule set without slowing the second — the registry with `explain` + optional fast `test` does exactly this.
- **Ids in the model, names at the edges** is an enforced house invariant (lessons.md "port the mechanism"; `PlacementError` pattern). The violation type must carry uuids; the Dialog resolves names via records shipped by `load.ts`.
- The constraint evaluator signature should accept a **context object** beyond cell occupants now, because the roadmap's S-09 cross-cohort and teacher-availability constraints need non-local inputs — designing the seam for them today is what makes the registry genuinely open for extension.
- Per FSD + ui-conventions: violation derivation in `model/` (pure, tested), inspection open/close state in a hook, Dialog as declarative child with `onClose`.

## Historical Context (from prior changes)

- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md:39-43` — PRD Q8 resolved to **accept-and-flag**; validation defined as reactive per-cell derivation with course-id attribution; tooltip wording explicitly **generic as a stopgap** ("teacher/student split is S-03").
- `context/archive/2026-06-05-first-valid-drop-with-validation/plan.md:49,257-259` — stale-closure footgun; attribution (course ids) chosen over bare boolean precisely so UI/resolution could grow.
- `context/archive/2026-06-04-port-grouping-algorithm/research.md:143` — "two paired rules, two cadences"; never embed the combinatorial generator in the validator (and vice-versa).
- `context/foundation/prd.md:115-116,129,148` — FR-012 lists four collision classes; **"invalid (with the specific class(es) of violation named)"** — this change fulfills an explicit PRD promise; ≤200ms p95 is the only hard number in the PRD.
- `context/foundation/roadmap.md:37-45,147,224` — collision classes grew incrementally (S-01 student → S-03 teacher → S-09 cross-cohort, deferred); grouping runtime is off the hot path.
- `context/archive/2026-06-11-multi-variant-management/plan.md:43-47` — Y1-first workflow; Y1 placements become fixed teacher-occupancy constraints for Y2 (the future constraint the registry must accommodate).
- `context/foundation/lessons.md` — "port the mechanism, not the legacy type shape" (opaque ids, display at edges); semantic tokens + detokenize-shadcn rules apply to any new Dialog/Drawer work.

## Related Research

- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md` — original validation design.
- `context/archive/2026-06-04-port-grouping-algorithm/research.md` — grouping/validator separation.
- `context/changes/group-dragging/` — most recent board interaction change (drop batching: one `setPlacements` per group drop keeps derivations to one recompute).

## Open Questions

1. ~~**Student names in the UI**~~ — **RESOLVED 2026-06-12 (author decision)**: show **full student names**. The names are actionable — seeing *which* student causes the collision lets the planner decide to move that student to another group. Consequence: `studentNames: Record<string,string>` ships to the client via `loadPlannerData`.
2. ~~**Tooltip upgrade scope**~~ — **RESOLVED 2026-06-12 (author decision)**: **no descriptive tooltip**. The Dialog is the single detail surface; a hover summary would duplicate it and only serve mouse users. The clickable badge keeps an accessible *action* label only (e.g. `aria-label`/`title` = "Show collision details") — required anyway since the badge text is `sr-only` below the `sm` breakpoint.
3. ~~**`BoardContext` shape**~~ — **RESOLVED 2026-06-12**: **minimal-now**. See Follow-up Research below.
4. **Should `hasIntersection` survive as a name** (re-exported composition of registry `test`s for `enumerate.ts`) or be deprecated in favor of a registry-derived `violatesAny`? Parity tests between board and enumerator semantics would guard drift either way.
5. **Board-level "problems panel"** (aggregate of all cell violations) — explicitly out of scope for this change, or a stretch goal? The model output makes it nearly free.

## Follow-up Research 2026-06-12 (evening)

### Decision: full student names in the collision detail UI

Author decision: display **full student names**, not counts. Rationale: the name is actionable information — the planner may resolve a collision by moving that specific student to another group (changing the student's course choices), not only by moving courses. This means:

- `loadPlannerData` (`api/load.ts:30-85`) ships both `teacherNames` and `studentNames` records.
- The Dialog lists shared students by name per conflicting course pair (scrollable; a cell-wide collision can involve dozens of students — Dialog over Popover is reinforced by this decision).
- A possible later extension (out of scope here): linking a student name to the students/choices UI for direct resolution.

### Clarification + decision: what `BoardContext` is and why it exists

**The problem it solves.** Today every collision check is answerable from one cell's occupants alone — `hasIntersection(course, others)` receives the cell's `GroupingCourse[]` and nothing else. But two roadmap constraints cannot be computed from cell occupants:

- **Cross-cohort teacher occupancy (S-09)**: needs the *other cohort's* placements for the same `(day, period)` — data not even loaded by the board today (`BOARD_COHORT = "dp1"`, `api/load.ts:13-14`).
- **Teacher availability**: needs per-teacher availability calendars, which live outside the placement state entirely.

If evaluators were typed `explain(occupants)`, adding S-09 would force a signature change on every existing constraint — breaking open-closed at the first real extension. Hence a context bag as a stable second parameter:

```ts
type BoardContext = {
  cell: { day: number; period: number };
  catalogById: Map<string, GroupingCourse>;
  // future fields, added when their slices ship (additive, non-breaking):
  // otherCohortPlacements?: …   (S-09 cross-cohort teacher occupancy)
  // teacherAvailability?: …     (availability rules)
};
```

Adding a field to `BoardContext` is **not a modification**: existing evaluators ignore fields they don't read and their signatures never change. New constraint = new evaluator file + (if needed) a new optional ctx field.

**Decision: minimal-now.** `BoardContext` ships with only `cell` + `catalogById` (data `PlannerBoard` already holds). No speculative pre-plumbing of empty S-09/availability fields — the architectural commitment made today is solely that the second parameter exists and is a bag, so future inputs arrive additively.
