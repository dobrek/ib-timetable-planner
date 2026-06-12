# Group Dragging Implementation Plan

## Overview

Add whole-group drag-and-drop to the plan board: dragging a `GroupingBox` header onto a slot cell fans the grouping's member courses into that cell as N ordinary per-course placements. The existing per-course drag is untouched — both gestures coexist as variants of the same `DragData` union flowing through the same `handleDrop`. As part of this change, the GroupingBox collapse/expand feature is removed: it carried almost no information when collapsed ("N courses" headers are indistinguishable) and freeing the header of the toggle click makes the whole header a clean, unambiguous drag target.

This closes the deferral recorded in S-01 (`context/archive/2026-06-05-first-valid-drop-with-validation/plan.md:40`), where whole-group bulk-drop was explicitly descoped.

## Current State Analysis

From `context/changes/group-dragging/research.md` (verified against source on this branch):

- **Drag payloads** are a discriminated union of opaque ids — `CourseDrag | PlacementDrag` (`src/_pages/plan-detail/model/drag.ts:6-8`). `handleDrop` branches on `kind` (`src/_pages/plan-detail/ui/PlannerBoard.tsx:32-41`).
- **GroupingBox** (`src/_pages/plan-detail/ui/GroupingBox.tsx`) renders a collapse-toggle header button ("N courses" + chevron, backed by `useExpanded`) over individually draggable `PaletteCourse` rows. Its doc comment states "the box never drops as a unit" — that changes here.
- **Validation reuses as-is.** The board is accept-and-flag: drops always land; `deriveCollisions` (`model/collisions.ts:17-42`) recomputes over the whole placements array on every change. Grouping members are pairwise conflict-free by construction (`model/enumerate.ts:20-60`), so a group can never conflict with itself.
- **Optimistic write path**: `usePlacements` (`model/use-placements.ts`) orchestrates pure transitions from `placement-transitions.ts` (`canAdd`/`addOptimistic`/`addReconcile`/`addRollback`) around `createPlacement` (`api/placement-client.ts` → Astro Action → `insertPlacement`, idempotent on `placements_unique`).
- **No batch path exists** — every transition and insert is single-row today.

## Desired End State

- A grouping header can be dragged onto any slot cell; on drop, one placement per member course (not already in that cell) appears optimistically with the `pending` treatment, then reconciles to real rows.
- GroupingBox has no collapse: members are always visible; the header shows the grip icon + "N courses" and a grab cursor.
- Per-course palette drag and placed-chip move/remove behave exactly as before.
- Partial persistence failure rolls back only the failed chips and shows a named message in the existing `ErrorBanner` (e.g. "2 of 6 courses failed to save: Math HL, Physics SL").
- A group drop on a cell already containing some members silently adds only the missing ones; a full-duplicate drop is a silent no-op.

Verify by: `pnpm test` (new batch-transition tests pass), `/verify` gate clean, and the manual steps in Testing Strategy.

### Key Discoveries:

- `DragData` union is the dual-mode mechanism — group drag is a third variant, not a new system (`model/drag.ts:8`).
- `deriveCollisions` and `deriveHours` are whole-board derivations — appending N placements in one state update and recomputing is their normal operation; zero changes needed (`research.md` §2).
- `insertPlacement` is idempotent on `placements_unique` — retries reconcile instead of erroring, which is why N parallel single inserts (Option A) is safe (`api/placements.ts:40-70`).
- The `canAdd` duplicate guard is a per-member **filter** for group drops: members are distinct courses, so all can be checked against the same pre-drop state (`model/placement-transitions.ts:7-9`).
- `@dnd-kit/react` 0.4 is pre-1.0; with collapse removed, the header draggable and row draggables are sibling elements with one job each, so the nested-interaction risk largely dissolves — but Phase 1 still ends with a manual drag-behavior checkpoint before batch state is built on top.

## What We're NOT Doing

- **No atomic `create_placements` RPC / migration** — persistence is Option A (decision recorded in `change.md`, 2026-06-12). Option B stays a documented follow-up if partial-failure UX proves confusing.
- **No "fill the week" semantics** — a group drop places exactly one hour of each member into the target cell, mirroring per-course drag.
- ~~No custom drag-feedback element~~ — **amended during Phase 1 manual testing.** A header-only clone was uninformative, and the default feedback left an empty palette gap plus a drop bounce-back. Final mechanism: `ui/GroupDragOverlay.tsx` renders a compact pointer-following clone (header + member names) via `<DragOverlay>`, disabled for course/placement drags; while the overlay is mounted the Feedback plugin leaves the source box in the palette layout (no placeholder), and the box shows an "in use" treatment (dimmed + dashed border) via `isDragging`. Note: per-entity `feedback: "none"` must NOT be combined with `DragOverlay` — the overlay renders through the Feedback plugin, so `"none"` kills both the overlay and drop-target tracking (verified against `@dnd-kit/dom` source during Phase 1).
- **No pre-drop group validation** — accept-and-flag stands; `deriveCollisions` flags conflicts after the drop.
- **No keyboard/a11y group drag** — keyboard DnD remains deferred from S-01 (Q11); this change must simply not regress current pointer behavior.
- **No schema changes** — placements stay grouping-agnostic; after a group drop every chip is an ordinary per-course placement.
- **No replacement for palette collapse** (e.g. virtualization) — if palette length ever becomes a problem, that's a separate change.
- **No new non-error notice surface** — duplicate-member skips are silent, matching today's single-course duplicate no-op.

## Implementation Approach

Two phases. Phase 1 reworks the UI and wires the full drag path end-to-end using an interim per-member `addCourse` loop, ending with a manual checkpoint that verifies `@dnd-kit/react` 0.4 handles the sibling draggables cleanly. Phase 2 replaces the interim loop with proper batch state: pure `addMany*` transitions (single `setPlacements` per batch so collision/hours derivations recompute once, preserving the <200ms feel), a `persistAddGroup` orchestrator over `Promise.allSettled`, and the named partial-failure banner message.

## Critical Implementation Details

- **One state update per batch step.** The optimistic fan-out must land in a single `setPlacements` (and the post-settlement reconcile/rollback in another single update), not N sequential updates — `deriveCollisions`/`deriveHours` recompute per placements-array change, and N updates would also produce N interleaved renders of pending chips. This is the reason Phase 2 exists rather than keeping the Phase 1 loop.
- **Filter eligibility once, against pre-drop state.** All members are `canAdd`-checked against the same `placementsRef.current` snapshot before any state update. This is correct because members are distinct course ids and the guard only matches same-course-same-cell; do not re-check between inserts.
- **Drag payload stays opaque.** `GroupDrag` carries only `groupingId`; member ids are resolved in `handleDrop` from the `groupings` prop (per the "port the mechanism" lesson — identity as opaque tokens, display at the edges).

## Phase 1: Group drag mechanism + GroupingBox rework

### Overview

Make the grouping header draggable, remove collapse, and wire the third `handleDrop` branch end-to-end via an interim per-member `addCourse` loop — so the dnd-kit behavior is verified before batch machinery is built on top.

### Changes Required:

#### 1. Drag payload variant

**File**: `src/_pages/plan-detail/model/drag.ts`

**Intent**: Extend the discriminated union with the group-drag variant so both gestures flow through one payload type.

**Contract**: `export type GroupDrag = { kind: "grouping"; groupingId: string }`; `DragData = CourseDrag | PlacementDrag | GroupDrag`. Opaque ids only — no member lists, no names.

#### 2. GroupingBox rework

**File**: `src/_pages/plan-detail/ui/GroupingBox.tsx`

**Intent**: Remove the collapse feature (`useExpanded`, chevron icons, conditional member render); replace the header `Button` with a header row registered as a `useDraggable<GroupDrag>` (`id: \`grouping:${grouping.id}\``). The header keeps the "N courses" label, gains a decorative `GripVertical` icon and `cursor-grab`/`active:cursor-grabbing` styling consistent with `PaletteCourse` rows. Update the doc comment (currently "the box never drops as a unit"). `PaletteCourse` rows are untouched.

**Contract**: Members are always rendered. The header element and the per-course rows are sibling draggables — the header must not wrap the member list in its draggable element. Styling uses semantic tokens only (lessons.md).

#### 3. Drop handler branch

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Add the `"grouping"` branch to `handleDrop`: resolve the grouping's `memberIds` from the `groupings` prop and fan out. In this phase the fan-out is an interim loop calling the existing `addCourse(courseId, cell)` per member (correct but N state updates); Phase 2 swaps it for `addGroup`.

**Contract**: Member resolution happens here (a `groupingId → memberIds` lookup from props), never in the drag payload. Unknown `groupingId` → no-op.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Existing unit tests pass: `pnpm test`
- Production build passes: `pnpm build`

#### Manual Verification:

- Grouping header drags onto a cell and all members land as chips (pending → settled)
- Per-course palette rows still drag individually; placed chips still move and remove
- No pointer mis-capture between header and row draggables (drag each in turn, several times, including drag-cancel via Escape/outside drop)
- Collapse is gone: members always visible; header shows grip + "N courses" with grab cursor
- Collision flags appear post-drop when a dropped group conflicts with existing occupants of the cell

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase — this checkpoint is the `@dnd-kit/react` 0.4 risk gate.

---

## Phase 2: Batch optimistic state + Option A persistence

### Overview

Replace the interim loop with proper batch state: pure `addMany*` transitions applied in single state updates, a `persistAddGroup` orchestrator over N parallel idempotent inserts, and named partial-failure reporting via the existing `ErrorBanner`.

### Changes Required:

#### 1. Batch transitions (pure)

**File**: `src/_pages/plan-detail/model/placement-transitions.ts`

**Intent**: Add batch counterparts to the single-row add transitions, in the same pure style: an eligibility filter (members passing `canAdd` against one pre-drop snapshot), a batch optimistic append (one new pending row per `(tempId, courseId)` pair), and a single settlement transition that maps each tempId to either its real row (reconcile) or removal (rollback) in one pass.

**Contract**: All functions are pure, never mutate inputs, and compose so the hook needs exactly one `setPlacements` for the optimistic step and one for settlement. Suggested shapes — `eligibleMembers(placements, memberIds, cell): string[]`, `addManyOptimistic(prev, entries: { tempId; courseId }[], cell)`, `settleMany(prev, outcomes: { tempId; result: PlannerPlacement | null }[])` (null → rollback). Also add a pure message helper `groupFailureMessage(failedNames: string[], attempted: number): string` producing "X of N courses failed to save: name, name" — testable without React.

#### 2. Batch transition tests

**File**: `src/_pages/plan-detail/model/placement-transitions.test.ts`

**Intent**: Cover the new pure functions, modeled on the existing add/move/remove suites (lines 35-199): eligibility filtering (all eligible / some duplicates / all duplicates), optimistic append of N pending rows, mixed settlement (some reconcile, some rollback) in one pass, full-failure settlement, and `groupFailureMessage` formatting (singular/plural, name joining).

**Contract**: Co-located `*.test.ts`, Vitest, same fixture style as the existing suites.

#### 3. Group orchestrator in the hook

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Add `addGroup(memberIds: string[], cell: CellData)` to the hook's API, backed by `persistAddGroup`: filter eligibility against `placementsRef.current` (silent no-op when empty), apply the batch optimistic update, run `Promise.allSettled` over the existing `createPlacement` client per member (per-row idempotency already handles retries), then apply settlement in a single state update. On any failures, set the error to `groupFailureMessage` with display names of the failed members.

**Contract**: `UsePlacements` gains `addGroup`; `usePlacements` needs access to the `names: Record<string, string>` map (extend `UsePlacementsArgs`) solely for failure-message formatting — drag payloads and transitions stay id-only. Exactly two `setPlacements` calls per group drop (optimistic, settlement).

#### 4. Swap the interim loop

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Replace the Phase 1 per-member `addCourse` loop in the `"grouping"` branch with a single `addGroup(memberIds, cell)` call; pass `names` through to `usePlacements`.

**Contract**: `handleDrop` stays a thin kind-switch; no other branches change.

### Success Criteria:

#### Automated Verification:

- New batch-transition tests pass: `pnpm test`
- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build passes: `pnpm build`

#### Manual Verification:

- Group drop lands all N chips at once (single pending flash, no chip-by-chip trickle) and feels instant (<200ms)
- Partial failure (simulate via devtools network throttle/offline mid-drop or a temporarily failing member) rolls back only failed chips and shows the named banner message
- Re-dropping a group on a cell containing some members adds only the missing ones, silently; full-duplicate drop is a silent no-op
- Hours counters and collision flags update correctly after a group drop
- Per-course drag, move, and remove still behave exactly as before

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the manual testing was successful before closing out the change.

---

## Testing Strategy

### Unit Tests:

- `eligibleMembers`: all eligible / partial duplicates / all duplicates → empty
- `addManyOptimistic`: appends N pending rows with the given temp ids, preserves existing rows, does not mutate input
- `settleMany`: mixed reconcile+rollback in one pass; all-fail; all-succeed; unknown tempId ignored
- `groupFailureMessage`: "1 of 6 courses failed to save: X" vs "2 of 6 courses failed to save: X, Y"

### Integration Tests:

- None added — explicit author decision (2026-06-12): the persistence path reuses the existing `createPlacement` action and idempotent `insertPlacement`; no new server surface is introduced (no new action, no migration). The one untested assumption this introduces — parallel idempotent fan-out (N concurrent `insertPlacement` calls, including the `UNIQUE_VIOLATION` → load-existing recovery under simultaneous duplicates) — is deliberately deferred to **end-to-end testing**, where a real group drop exercises the same concurrent pattern through the full stack. Per the lessons.md rule, this deferral is recorded here rather than left implicit.

### Manual Testing Steps:

1. Drag a grouping header onto an empty cell → all members appear, pending then settled; hours counters increment.
2. Drag the same grouping onto the same cell again → nothing changes (silent no-op).
3. Place one member individually first, then group-drop onto that cell → only the missing members are added.
4. Drop a group onto a cell whose occupants conflict with a member → destructive ring + collision badges appear immediately.
5. Go offline (devtools), group-drop, go back online → all chips roll back, banner names every member; retry succeeds.
6. Interleave gestures: drag a course row, then the header, then move a placed chip — no mis-captured drags.

## Performance Considerations

Batch optimistic + batch settlement each trigger exactly one placements-array change, so `deriveCollisions` (O(occupants²) per cell) and `deriveHours` recompute once per step — well within the <200ms budget for 6-8 member groups. N parallel inserts add network fan-out but do not block the UI (chips are optimistic).

## Migration Notes

None — no schema or server changes. The collapse removal is purely client-side UI; no persisted user preference exists for it.

## References

- Related research: `context/changes/group-dragging/research.md`
- Persistence decision (Option A): `context/changes/group-dragging/change.md` (Notes, 2026-06-12)
- S-01 deferral being closed: `context/archive/2026-06-05-first-valid-drop-with-validation/plan.md:40`
- Single-row transition templates: `src/_pages/plan-detail/model/placement-transitions.ts:7-26`
- Test templates: `src/_pages/plan-detail/model/placement-transitions.test.ts:35-199`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Group drag mechanism + GroupingBox rework

#### Automated

- [x] 1.1 Lint passes: `pnpm lint` — 32977fe
- [x] 1.2 FSD structure check passes: `pnpm steiger` — 32977fe
- [x] 1.3 Existing unit tests pass: `pnpm test` — 32977fe
- [x] 1.4 Production build passes: `pnpm build` — 32977fe

#### Manual

- [x] 1.5 Grouping header drags onto a cell and all members land as chips — 32977fe
- [x] 1.6 Per-course rows still drag; placed chips still move/remove — 32977fe
- [x] 1.7 No pointer mis-capture between header and row draggables — 32977fe
- [x] 1.8 Collapse removed; members always visible; grip + grab cursor on header — 32977fe
- [x] 1.9 Collision flags appear post-drop on conflicting group drops — 32977fe

### Phase 2: Batch optimistic state + Option A persistence

#### Automated

- [x] 2.1 New batch-transition tests pass: `pnpm test` — f71feea
- [x] 2.2 Lint passes: `pnpm lint` — f71feea
- [x] 2.3 FSD structure check passes: `pnpm steiger` — f71feea
- [x] 2.4 Production build passes: `pnpm build` — f71feea

#### Manual

- [x] 2.5 Group drop lands all chips at once, feels instant (<200ms) — f71feea
- [x] 2.6 Partial failure rolls back only failed chips with named banner message — f71feea
- [x] 2.7 Duplicate-member skips are silent; full-duplicate drop is a no-op — f71feea
- [x] 2.8 Hours counters and collision flags correct after group drop — f71feea
- [x] 2.9 Per-course drag/move/remove unchanged — f71feea
