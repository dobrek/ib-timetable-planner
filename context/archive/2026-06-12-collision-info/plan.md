# Collision Info (Explainable Collision Feedback) Implementation Plan

## Overview

Replace the binary collision flag on the plan board with explainable feedback: a constraint registry in the model produces structured `CollisionViolation` values (which courses, which teacher, which students), and clicking a collision badge opens a Dialog that explains every collision in that cell — grouped by cause, with the clicked course emphasized and ids resolved to display names at the render edge.

This fulfills the PRD's explicit promise (`prd.md:148`): validation reports invalid "with the specific class(es) of violation named."

## Current State Analysis

- Collision detection is a single boolean predicate `hasIntersection` (`src/_pages/plan-detail/model/collision.ts:3-13`) with three inlined checks: duplicate course id, shared `teacherKey`, shared `studentKeys`. It short-circuits — finds *a* conflict, not all.
- `deriveCollisions` (`src/_pages/plan-detail/model/collisions.ts:17-42`) buckets placements per cell and returns `Map<cellKey, Set<courseId>>` — *which* courses collide, never *why*. The full `GroupingCourse` objects (with `teacherKey`/`studentKeys`) are in hand at the detection site; nothing blocks explanation except the return shape.
- The UI badge (`src/_pages/plan-detail/ui/SlotCell.tsx:87-96`) is a static span with a generic `title` tooltip ("shares a student or teacher"), not clickable, not focusable.
- Teacher/student **display names never reach the client** — the island ships only course `names` (`model/drag.ts:21-22`, `api/load.ts:80`). `teachers.full_name` is nullable with required unique `code`; `students.full_name` is required (migration `20260602185012_minimal_domain_schema.sql:17-23,69-75`).
- `enumerate.ts:38,53` is the second consumer of `hasIntersection`, inside a combinatorial traversal guarded by caps — it must keep a short-circuiting boolean.
- Drops always land (accept-and-flag); collisions are a reactive `useMemo` derivation (`PlannerBoard.tsx:101-104`), never a drop gate.

## Desired End State

- The model exposes a **constraint registry** (`model/constraints/`): each constraint is one file producing `CollisionViolation[]`; the boolean verdict (`hasIntersection`) is derived from the registry's fast path. Adding a constraint = new file + union member + registry entry — no existing code modified.
- `loadPlannerData` ships `teacherNames` and `studentNames` records alongside course `names`.
- The collision badge is a focusable button (`aria-label="Show collision details"`); clicking it opens a Dialog showing **all** collisions in that cell, grouped by cause (Teacher / Students / Duplicate sections), full student names listed, and the clicked course visually emphasized.
- Board behavior is otherwise unchanged: same flags, same accept-and-flag policy, same drag interactions.

Verify by: `pnpm test` (unit + parity), `pnpm test:integration` (name records), `pnpm lint`, `pnpm steiger`, `pnpm build`, and manual click-through on a seeded local plan.

### Key Discoveries:

- All explanation data is already in scope in `deriveCollisions` — explanation is a structured pairwise diff, no new lookups (`collisions.ts:32-40`).
- `MoveRejection`/`PlacementError` + `placementErrorMessage` (`placement-transitions.ts:68-76`) establish the house pattern: ids in the model, names resolved at the render edge via records.
- `CourseOverlaps` (`src/_pages/courses/ui/CourseOverlaps.tsx:30-52`) is the click-to-inspect Dialog precedent: controlled `open`, intent-named `onClose`, body conditional inside `DialogContent`.
- The remove button shows the pointer-event pattern a clickable element inside a draggable chip needs (`SlotCell.tsx:105-112`).
- Constraints that require `BoardContext` simply omit the ctx-free `test` — they then never participate in grouping enumeration, which is the correct semantic for future board-only constraints (cross-cohort, availability).

## What We're NOT Doing

- **No board-level "problems panel"** (aggregated collision list) — explicitly out of scope; the registry output makes it nearly free as a future change.
- **No descriptive hover tooltip** — the Dialog is the single detail surface; the badge keeps only an action label.
- **No new constraint kinds** (availability, cross-cohort/S-09, rooms) — only the existing three checks gain explainability. `BoardContext` ships minimal (`cell` + `catalogById`), no speculative fields.
- **No changes to `enumerate.ts`**, the grouping algorithm, drop policy (accept-and-flag), or server-side validation.
- **No Drawer/Sheet primitive** — Dialog only.
- **No linking student names to the students/choices UI** (possible follow-up).

## Implementation Approach

Three phases, each independently shippable and verifiable:

1. **Model**: introduce the registry and verbose derivation behind the existing behavior — pure refactor, parity-tested, zero UI change.
2. **Data**: ship teacher/student name records to the island — additive props, integration-tested.
3. **UI**: clickable badge + `CollisionDetailsDialog` consuming the violations and name records.

The registry is the open-closed seam: `CellConstraint = { id, explain(occupants, ctx), test?(course, others) }`. `explain` enumerates violations for the Dialog; the optional ctx-free `test` short-circuits for the hot boolean path (`hasIntersection`, used by `enumerate.ts`). Both views derive from one rule set, so detector and explainer cannot drift.

## Critical Implementation Details

- **Badge click vs drag**: the badge sits inside a `useDraggable` chip. The button must stop `pointerdown` propagation (same pattern as the remove button, `SlotCell.tsx:109-112`) or the click starts a drag instead of opening the Dialog.
- **Enumerator stays on the fast path**: `enumerate.ts` keeps calling `hasIntersection(course, list)` — never pass the enumerating `explain` into the combinatorial traversal; its cost there is multiplied factorially.
- **Teacher display name**: `full_name` is nullable — resolve as `full_name ?? code`. Student `full_name` is non-null.
- **Eager derivation is safe**: per-cell occupant counts are tiny (O(occupants²·|students|) ≈ microseconds), so violations are computed eagerly in the same pass as the flags — no lazy machinery. Do not snapshot violations inside `onDragEnd` (documented stale-closure footgun); they remain a `useMemo` derivation.

## Phase 1: Constraint Registry + Verbose Derivation (model)

### Overview

Restructure the three existing checks into a registry of constraint evaluators producing structured violations; derive both the boolean verdict and the per-cell violation map from it. Pure model refactor — UI props and rendered behavior are unchanged.

### Changes Required:

#### 1. Constraint types

**File**: `src/_pages/plan-detail/model/constraints/types.ts` (new)

**Intent**: Define the violation vocabulary and the evaluator contract — the open-closed seam everything else builds on.

**Contract**: Other phases and future constraints depend on these exact shapes:

```ts
export type CollisionViolation =
  | { kind: "duplicate-course"; courseId: string }
  | { kind: "teacher"; teacherKey: string; courseIds: string[] }
  | { kind: "student"; studentKeys: string[]; courseIds: [string, string] };

export type BoardContext = {
  cell: { day: number; period: number };
  catalogById: Map<string, GroupingCourse>;
};

export type CellConstraint = {
  id: string;
  /** Enumerates ALL violations among the cell's occupants (no short-circuit). */
  explain(occupants: GroupingCourse[], ctx: BoardContext): CollisionViolation[];
  /** Ctx-free pairwise fast path (short-circuit). Omit for board-only constraints —
   *  omitted constraints do not participate in grouping enumeration. */
  test?(course: GroupingCourse, others: GroupingCourse[]): boolean;
};
```

Ids stay opaque (uuids); names are never part of violations.

#### 2. The three constraint evaluators

**Files**: `src/_pages/plan-detail/model/constraints/duplicate-course.ts`, `teacher-conflict.ts`, `student-conflict.ts` (new, one per constraint)

**Intent**: Port the three checks from `hasIntersection` into self-contained evaluators, each with both `explain` (enumerating) and `test` (short-circuit), preserving today's matching semantics exactly.

**Contract**:
- `duplicate-course`: a course id appearing more than once among occupants → one violation per duplicated id. The `test` path keeps the raw predicate's semantics — "course.id present among `others`" — NOT "appears more than once"; the existing parity case `hasIntersection(c, [c]) === true` (`collision.test.ts:15`) depends on it.
- `teacher-conflict`: occupants grouped by non-null `teacherKey`; each group of ≥2 → one violation carrying that `teacherKey` and all member course ids. Null teachers never conflict. Match by strict `!== null` equality, never truthiness — an empty-string `teacherKey` is a valid colliding key (add a `""` fixture to the constraint tests; the existing `t1`/null fixtures would not catch truthiness drift).
- `student-conflict`: each unordered occupant pair with a non-empty `studentKeys` intersection → one violation carrying the shared student ids and the pair `[a.id, b.id]`.

#### 3. Registry index

**File**: `src/_pages/plan-detail/model/constraints/index.ts` (new)

**Intent**: Single registration point and the two derived views over it.

**Contract**: Exports `CELL_CONSTRAINTS: CellConstraint[]` (the registry array), `explainCell(occupants, ctx): CollisionViolation[]` (flatMap of all `explain`s), and `violatesAny(course, others): boolean` (`some` over defined `test`s). Re-exports the types. Adding a constraint touches only this array.

#### 4. Derive `hasIntersection` from the registry

**File**: `src/_pages/plan-detail/model/collision.ts`

**Intent**: Keep the export and its call sites (`enumerate.ts` untouched) but make it a delegation to `violatesAny`, so there is one rule set. Update the doc comment to say it is registry-derived.

**Contract**: Signature unchanged: `hasIntersection(course: GroupingCourse, list: GroupingCourse[]): boolean`.

#### 5. Verbose per-cell derivation

**File**: `src/_pages/plan-detail/model/collisions.ts`

**Intent**: Supersede `deriveCollisions` with a single-pass derivation that returns both the flag projection (what the grid uses today) and the violations (what the Dialog needs).

**Contract**:

```ts
export type CellCollisions = {
  conflictingIds: Set<string>;   // projection: today's Set<courseId> semantics
  violations: CollisionViolation[];
};
export const deriveCellViolations = (
  placements: PlannerPlacement[],
  catalogById: Map<string, GroupingCourse>,
): Map<string, CellCollisions>;
```

`conflictingIds` is the union of course ids across the cell's violations. Cell bucketing, the not-in-catalog defensive skip, and the multi-occupancy early-continue all carry over. `deriveCollisions` is removed (its two consumers — tests and `PlannerBoard` — are updated in this phase). The module's `cellKey` export and semantics stay unchanged — it has importers outside this change's consumer list (`PlannerGrid.tsx`, `SlotCell.tsx`).

#### 6. Wire the board to the new derivation (no behavior change)

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`, `src/_pages/plan-detail/ui/PlannerGrid.tsx`

**Intent**: `useCollisions` returns the `Map<string, CellCollisions>`; `PlannerGrid` passes the per-cell entry down; `SlotCell` keeps receiving a `Set<string>` (`conflictingIds`) so its rendering is untouched in this phase.

**Contract**: `PlannerGrid`'s `collisions` prop type changes to the new map; `SlotCell` props unchanged.

#### 7. Tests

**Files**: `src/_pages/plan-detail/model/constraints/constraints.test.ts` (new), `src/_pages/plan-detail/model/collision.test.ts`, `src/_pages/plan-detail/model/collisions.test.ts`

**Intent**:
- Per-constraint unit tests on `explain` and `test` (matching semantics: null teachers never conflict, pairwise student sharing, duplicates).
- **Parity tests** guarding the refactor: the 6 existing `hasIntersection` cases keep passing unchanged; for the existing `deriveCollisions` fixtures, `deriveCellViolations(...).conflictingIds` equals the old expected sets; and the invariant `conflictingIds === union of violation courseIds` holds across fixtures.
- Violation-content assertions: shared-student lists are exact, teacher violations carry all member courses.

### Success Criteria:

#### Automated Verification:

- Unit + parity tests pass: `pnpm test`
- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build stays clean: `pnpm build`

#### Manual Verification:

- Board renders identical collision flags as before the refactor (rings + badges on a seeded local plan with known collisions)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the board behavior is unchanged before proceeding.

---

## Phase 2: Teacher/Student Name Records to the Island (api)

### Overview

Ship the display names the Dialog needs, following the existing course-`names` record pattern. Additive, read-only.

### Changes Required:

#### 1. Extend the planner data loader

**File**: `src/_pages/plan-detail/api/load.ts`

**Intent**: After the catalog resolves, collect the unique non-null `teacherKey`s and unique `studentKeys` across catalog courses, then fetch the two name sets in parallel and assemble records.

**Contract**: `teacherNames: Record<string, string>` resolved as `full_name ?? code`; `studentNames: Record<string, string>` from `students.full_name`. Queries select by `.in("id", ids)` (id counts are small: ≤~60 teachers, ≤~150 students). Empty id lists skip the query (return `{}`), matching the `fetch*` guards in `load-cohort-courses.ts`.

#### 2. Extend the island props

**File**: `src/_pages/plan-detail/model/drag.ts`

**Intent**: Add `teacherNames` and `studentNames` to `PlannerBoardProps` with doc comments mirroring the existing `names` field ("resolved at the edge — never baked into drag payloads or violations").

**Contract**: Both `Record<string, string>`, required fields.

#### 3. Integration test

**File**: `src/_pages/plan-detail/api/load.integration.test.ts` (new, `*.integration.test.ts` convention — runs via `pnpm test:integration`)

**Intent**: Against the seeded local Supabase, assert `loadPlannerData` ships non-empty `teacherNames`/`studentNames` covering every `teacherKey`/`studentKey` present in the returned catalog, and that a teacher without `full_name` resolves to their `code`.

**Contract**: Follows the setup pattern of the existing `api/adapter-parity.integration.test.ts`.

### Success Criteria:

#### Automated Verification:

- Unit suite still passes: `pnpm test`
- Integration test passes against local Supabase: `pnpm test:integration`
- Build stays clean: `pnpm build`

#### Manual Verification:

- Plan page loads normally in `pnpm dev` (props assembly didn't break the island)

---

## Phase 3: Clickable Badge + Collision Details Dialog (ui)

### Overview

Turn the badge into an accessible trigger and add the Dialog that renders the cell's violations grouped by cause, with full names and the clicked course emphasized.

### Changes Required:

#### 1. Badge becomes a button trigger

**File**: `src/_pages/plan-detail/ui/SlotCell.tsx`

**Intent**: Replace the static badge span with a focusable button styled as the destructive badge. Remove the descriptive `title`; the only accessible text is the action label. Clicking reports the inspected cell + course upward; it must not start a drag or bubble into droppable handling (stop `pointerdown` propagation like the remove button at `SlotCell.tsx:109-112`).

**Contract**: New `SlotCell` prop `onInspect: (target: { day: number; period: number; courseId: string }) => void`; badge gets `aria-label="Show collision details"`; visible content stays `TriangleAlert` + "collision" (`sr-only sm:not-sr-only`). `SlotCell` also receives the cell's `CellCollisions | undefined` instead of the bare set (it reads `conflictingIds` for rendering).

#### 2. Inspection state hook

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Per ui-conventions (private hooks below the component), add a `useCollisionInspection` private hook holding the inspected target (`{ day, period, courseId } | null`) with `open`/`close` transitions. `PlannerBoard` looks up the cell's violations from the derivation map and renders the Dialog declaratively.

**Contract**: Dialog receives data + `onClose` only; no state inside the Dialog component. Wiring: `onInspect={inspection.open}`, `onClose={inspection.close}`. If the inspected cell's violations disappear while open (placement removed elsewhere — e.g. server reconciliation), the Dialog closes.

#### 3. Collision details Dialog

**File**: `src/_pages/plan-detail/ui/CollisionDetailsDialog.tsx` (new)

**Intent**: Declarative Dialog (CourseOverlaps pattern: controlled `open`, `onClose`, body conditional inside `DialogContent`) rendering the cell's violations **grouped by cause** — one section per violation kind present (Teacher / Students / Duplicate) — with ids resolved through the three name records and every mention of the clicked course visually emphasized (semantic token styling, e.g. `font-medium text-foreground` vs `text-muted-foreground` — no palette classes).

**Contract**: Props: `target: { day, period, courseId } | null`, `violations: CollisionViolation[]`, `names`, `teacherNames`, `studentNames`, `onClose`. Section copy per kind:
- Teacher: "*{teacher}* teaches both/all of: {course list}".
- Students: "*{course A}* ↔ *{course B}* — {n} shared student(s):" followed by the full name list.
- Duplicate: "*{course}* is placed more than once in this slot."
Title names the cell using the same day/period labels `PlannerGrid` renders in its headers. Long student lists scroll within the Dialog body. Unknown ids fall back to the raw id (same `names[x] ?? x` idiom as `SlotCell.tsx:47`). The kind→section mapping is exhaustive over the union so a future kind is a compile-time reminder, not a silent omission.

#### 4. Pass name records through + shared slot labels

**Files**: `src/pages/plans/[id]/index.astro` (props spread — verify it forwards the new fields), `src/_pages/plan-detail/ui/PlannerGrid.tsx` (forward `onInspect`; switch headers to the shared label helpers), `src/_pages/plan-detail/lib/slot-labels.ts` (new)

**Intent**: Plumb `teacherNames`/`studentNames` from the island props to the Dialog and `onInspect` from the board to `SlotCell`. The grid itself doesn't read names. The day/period labels the Dialog title needs are **not** currently reusable — `DAY_LABELS` is a non-exported const in `PlannerGrid.tsx` and period labels are inlined JSX — so extract them once instead of duplicating the format.

**Contract**: Props pass-through only; no logic — except `slot-labels.ts`, which exports `dayLabel(day): string` (`DAY_LABELS[day - 1] ?? \`Day ${day}\``) and `periodLabel(period): string` (`P${period}`), consumed by both `PlannerGrid` headers and the Dialog title.

### Success Criteria:

#### Automated Verification:

- Unit suite passes: `pnpm test`
- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Build stays clean: `pnpm build`

#### Manual Verification:

- Clicking a collision badge opens the Dialog with the cell's collisions grouped by cause; teacher and student full names render; the clicked course is visibly emphasized
- A cell with multiple collisions shows all of them; the clicked course's rows stand out
- Badge click does not start a drag; chip drag still works; remove button still works
- Keyboard: Tab reaches the badge, Enter opens the Dialog, Esc closes it, focus returns to the badge
- Resolving the collision (moving a participant) while the Dialog is closed clears the badge as before; the Dialog closes if its cell's collisions vanish while open
- Light and dark themes both render with semantic tokens (no literal colors)

**Implementation Note**: After automated verification passes, pause for manual UX confirmation before closing the change.

---

## Testing Strategy

### Unit Tests:

- Per-constraint `explain`/`test` semantics (null-teacher non-conflict, pairwise student intersection exactness, duplicate detection, multi-course teacher groups)
- `deriveCellViolations`: bucketing, defensive catalog skip, single-occupant skip, auto-clear on recompute, `conflictingIds` = union-of-violation-courseIds invariant
- Parity: existing `hasIntersection` and `deriveCollisions` fixtures keep their expected outcomes through the refactor

### Integration Tests:

- `load.integration.test.ts`: name records cover all catalog teacher/student keys; nullable teacher `full_name` falls back to `code`

### Manual Testing Steps:

1. `pnpm exec supabase db reset && pnpm dev`, open a plan, place two courses sharing a teacher in one cell → badge appears; click → Teacher section names the teacher and both courses
2. Place two courses sharing students → Students section lists full names; verify count matches seed data
3. Click the badge on course A vs course B in the same cell → same content, different emphasis
4. Keyboard-only pass (Tab/Enter/Esc) and dark-mode pass

## Performance Considerations

Violation enumeration runs eagerly in the same `useMemo` pass as the flags — per-cell occupant counts and student lists are small enough that this stays microseconds, far inside the ≤200ms p95 budget. The combinatorial enumerator keeps the short-circuiting ctx-free `test` path; the enumerating `explain` never runs there.

## Migration Notes

No schema changes, no data migration. `deriveCollisions` is removed in the same phase its consumers are updated — no deprecation window needed (single consumer + tests).

## References

- Related research: `context/changes/collision-info/research.md` (options analysis, resolved decisions, historical context)
- Dialog precedent: `src/_pages/courses/ui/CourseOverlaps.tsx:30-52`
- Names-at-the-edge precedent: `src/_pages/plan-detail/model/placement-transitions.ts:68-76`
- Conventions: `context/foundation/ui-conventions.md` (hooks, dialog contract), `context/foundation/lessons.md` (semantic tokens, mechanism-not-shape)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Constraint Registry + Verbose Derivation (model)

#### Automated

- [x] 1.1 Unit + parity tests pass: `pnpm test` — 9874e35
- [x] 1.2 Lint passes: `pnpm lint` — 9874e35
- [x] 1.3 FSD structure check passes: `pnpm steiger` — 9874e35
- [x] 1.4 Production build stays clean: `pnpm build` — 9874e35

#### Manual

- [x] 1.5 Board renders identical collision flags as before the refactor — 9874e35

### Phase 2: Teacher/Student Name Records to the Island (api)

#### Automated

- [x] 2.1 Unit suite still passes: `pnpm test` — f9e76af
- [x] 2.2 Integration test passes against local Supabase: `pnpm test:integration` — f9e76af
- [x] 2.3 Build stays clean: `pnpm build` — f9e76af

#### Manual

- [x] 2.4 Plan page loads normally in `pnpm dev` — f9e76af

### Phase 3: Clickable Badge + Collision Details Dialog (ui)

#### Automated

- [x] 3.1 Unit suite passes: `pnpm test` — 85c106d
- [x] 3.2 Lint passes: `pnpm lint` — 85c106d
- [x] 3.3 FSD structure check passes: `pnpm steiger` — 85c106d
- [x] 3.4 Build stays clean: `pnpm build` — 85c106d

#### Manual

- [x] 3.5 Badge click opens Dialog: grouped by cause, full names, clicked course emphasized — 85c106d
- [x] 3.6 Multi-collision cell shows all collisions with correct emphasis — 85c106d
- [x] 3.7 Badge click doesn't start a drag; drag and remove still work — 85c106d
- [x] 3.8 Keyboard pass: Tab → Enter opens, Esc closes, focus returns — 85c106d
- [x] 3.9 Reactive behavior: flags clear on resolution; Dialog closes if its collisions vanish — 85c106d
- [x] 3.10 Light/dark theme pass with semantic tokens — 85c106d
