---
date: 2026-06-12T21:04:24+02:00
researcher: Claude (Fable 5)
git_commit: 913604a801d4adf1842f8d0c25ea4e7879a79326
branch: feat/group-dragging
repository: 10xdev3 (ib-timetable-planner)
topic: "Whole-group drag-and-drop onto a slot: effort, logic reuse, dual-mode support, UI patterns"
tags: [research, codebase, plan-detail, drag-and-drop, groupings, placements, dnd-kit]
status: complete
last_updated: 2026-06-12
last_updated_by: Claude (Fable 5)
last_updated_note: "Resolved Open Question 1: persistence = Option A (N parallel idempotent inserts); author decision recorded in change.md"
---

# Research: Whole-group drag-and-drop onto a slot

**Date**: 2026-06-12T21:04:24+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: 913604a801d4adf1842f8d0c25ea4e7879a79326
**Branch**: feat/group-dragging
**Repository**: 10xdev3 (ib-timetable-planner)

## Research Question

The plan board currently supports dragging one individual course out of a grouping and dropping it onto a slot. Users want an additional mechanism: drag the **whole group** at once and drop it onto a slot. Questions: What is the effort and which logic changes are needed? Can we reuse the existing logic or must it change fundamentally? How do we support both modes (individual course + whole group)? Which UI elements change, and what are the established patterns for this situation?

## Summary

**This feature was anticipated by the original design and explicitly descoped — it is a planned deferral being picked up, not a redesign.** The S-01 research resolved (with the author, 2026-06-05) that "dropping a grouping is a **bulk-drop convenience** that fans its courses into a cell as individual course placements" (`context/archive/2026-06-05-first-valid-drop-with-validation/research.md:38`), and the S-01 plan then listed "whole-group bulk-drop" as out of scope (`plan.md:40`). The architecture already in place makes this cheap:

1. **Validation reuses as-is, zero changes.** The board uses an **accept-and-flag** policy (drops always land; conflicts are flagged post-hoc), and the flagging validator `deriveCollisions` already recomputes over the *whole board state* on every change — appending N placements at once is exactly its existing contract. Better still, grouping members are **mutually conflict-free by construction** (the enumeration algorithm only builds pairwise-compatible sets), so a group dropped into an empty cell can never conflict with itself.
2. **The drag plumbing extends, not changes.** `DragData` is a discriminated union (`course` | `placement`); group drag is a third variant plus one new `useDraggable` on the grouping header and one new branch in `handleDrop`. Both modes coexist naturally — this is the union's whole purpose.
3. **The only new logic is batch optimistic state + a persistence decision.** `placement-transitions.ts` needs `addMany*` counterparts (trivial extensions of the existing pure functions), and `use-placements.ts` needs a `persistAddGroup` orchestrator. The persistence choice — N idempotent single inserts vs. one atomic RPC — was already leaned on in the original research: "per-row + array-insert for the fan-out for MVP simplicity" (`research.md:177`).

**Effort estimate: small-to-medium (roughly one focused day including tests).** Touches ~6 files in `src/_pages/plan-detail/` plus optionally one migration if the atomic-RPC route is chosen.

## Detailed Findings

### 1. Current drag-and-drop mechanism

- Library: **`@dnd-kit/react` 0.4.0 + `@dnd-kit/dom` 0.4.0** (`package.json:30-31`) — the new-generation dnd-kit, chosen over legacy `@dnd-kit/core`, `react-dnd`, and Pragmatic DnD in the S-01 research (alternatives documented at `context/archive/2026-06-05-first-valid-drop-with-validation/research.md:76-93`).
- `DragDropProvider` wraps the board in `src/_pages/plan-detail/ui/PlannerBoard.tsx:57` with `onDragEnd={handleDrop}` and `Feedback.configure({ dropAnimation: null })` (palette drags are copies, so the default drop animation would look like a bounce — `PlannerBoard.tsx:94-100`).
- Drag payloads are a **discriminated union of opaque ids** in `src/_pages/plan-detail/model/drag.ts:5-11`:
  - `CourseDrag = { kind: "course"; courseId }` — palette chip (`GroupingBox.tsx:72-75`); the `groupingId` appears only in the draggable's DOM id for uniqueness, never in the payload.
  - `PlacementDrag = { kind: "placement"; placementId; courseId }` — placed chip (`SlotCell.tsx:67-71`), disabled while `pending`.
- Drop target: `SlotCell` is the only droppable (`useDroppable<CellData>` at `SlotCell.tsx:27`), keyed by `cellKey(day, period)`. **There is no canDrop/accept logic anywhere** — drops always land (accept-and-flag, `PlannerBoard.tsx:17-21`). Drag-over feedback is a generic highlight (`SlotCell.tsx:40`).
- Drop call chain: `handleDrop` (`PlannerBoard.tsx:32-41`, branches on `data.kind`) → `usePlacements.addCourse/movePlacement` (`model/use-placements.ts:41-49`) → pure transitions in `model/placement-transitions.ts` (optimistic add with temp uuid + `pending: true`, then reconcile or rollback) → `createPlacement` action client (`api/placement-client.ts:5`) → `createPlacement` Astro Action (`api/placement-actions.ts:4-7`, via `defineDomainAction`) → `insertPlacement` domain function (`api/placements.ts:40-70`).

### 2. Validation core — reuses without modification

- **Accept-and-flag, not block-on-drop** (PRD Q8, resolved): a colliding drop lands and persists, flagged afterward. The author can park a course to see where it fits. This removes the hardest part of group drop — there is no "is this whole group allowed here?" gate to build.
- The only pre-drop guard is the duplicate check `canAdd` (`model/placement-transitions.ts:7-9` → `occupiesCell`, `model/placement.ts:16-20`): rejects "same course already in this cell". For a group drop this becomes a per-member **filter**, not a fold: `memberIds.filter(id => canAdd(placements, id, cell))` — all members can be checked against the same pre-drop state because members are distinct courses and the guard only matches same-course-same-cell.
- Conflict flagging: `deriveCollisions` (`model/collisions.ts:17-42`) recomputes `Map<cellKey, Set<conflictingCourseId>>` from the **entire placements array** on every change (memoized in `PlannerBoard.tsx:83-86`), using `hasIntersection` (`model/collision.ts:3-13`: same id / shared non-null `teacherKey` / shared student key). It is already a whole-board validator — adding N placements in one state update and recomputing is its normal operation. **No change needed.**
- **Intra-group conflicts are impossible by construction**: `enumerateVariants` (`model/enumerate.ts:20-60`) only emits maximal sets of pairwise-`hasIntersection`-free courses. A stale catalog vs. stored groupings is theoretically possible, but the `catalog_hash` staleness machinery exists (`api/staleness.ts`) and `deriveCollisions` would still flag any real conflict post-drop — accept-and-flag covers the edge.
- Performance: `deriveCollisions` is O(occupants²) per cell, pure and synchronous, well within the <200ms budget even for a 6-8 member group landing at once. Hours counters (`model/hours.ts`) likewise just re-derive.

### 3. Persistence — the one real design decision

Current state: strictly one row per call. `insertPlacement` (`api/placements.ts:43-47`) does a single-row `.insert().select().single()` and is **idempotent** on the `placements_unique (plan_id, cohort, day, period, course_id)` constraint — on `UNIQUE_VIOLATION` it loads and returns the existing row (`placements.ts:49-63`), so retries reconcile instead of erroring. No batch insert exists today.

Two viable paths for the fan-out:

| Option | Mechanics | Pros | Cons |
| --- | --- | --- | --- |
| **A. N parallel single inserts** (original research's lean, `research.md:177`) | `Promise.allSettled` of existing `createPlacement` calls; per-member reconcile/rollback | Zero server changes; idempotency per row already works; partial success tolerable under accept-and-flag | Partial-failure UX needs thought (some chips reconcile, some roll back); N round-trips |
| **B. Atomic `create_placements` RPC** | New Postgres function `create_placements(plan_id, cohort, day, period, course_ids[])` with `on conflict do nothing` + `returning`, wrapped in one Astro Action | Single round-trip; all-or-nothing; precedent exists (`replace_cohort_groupings` called at `api/persist.ts:26`; `clone_plan` bulk-inserts placements in `supabase/migrations/20260611180100_clone_plan_fn.sql:108-111`) | One migration + new action + new client fn; `returning` must map real ids back to N temp ids for reconcile |

A plain Supabase `.insert([...])` multi-row insert is *not* a good middle ground: a single duplicate aborts the whole statement, and the per-row unique-violation recovery doesn't transfer.

### 4. UI changes — what to add and what to keep

Current grouping UI: `GroupingBox` (`ui/GroupingBox.tsx:22-51`) renders a header button ("N courses" + collapse chevron, `GroupingBox.tsx:27-35`) over `PaletteCourse` rows, each with a cosmetic `GripVertical` handle (`GroupingBox.tsx:87` — the whole `<li>` is the draggable). The doc comment at `GroupingBox.tsx:17-21` currently states "the box never drops as a unit" — that comment changes with this feature.

Recommended UI shape (consistent with existing affordances):

1. **Group-level drag handle on the `GroupingBox` header** — a dedicated `GripVertical` handle element registered as its own `useDraggable<GroupDrag>` with `id: \`grouping:${groupingId}\``. Making the *handle* (not the whole box) the draggable element sidesteps nested-draggable ambiguity with the per-course rows and keeps the header's collapse-toggle click intact. This mirrors the per-course pattern at `GroupingBox.tsx:72-75`.
2. **Keep per-course rows exactly as they are** — both modes coexist with no interaction change for the existing gesture.
3. **Drag overlay**: during a group drag, show a compact representation ("N courses" pill or stacked chips) rather than the full box. `@dnd-kit/react` renders feedback from the source element by default; a `<DragOverlay>`-equivalent or a feedback element on the handle's draggable keeps it light.
4. **Drop highlight**: nothing changes — `SlotCell`'s existing `isDropTarget` ring (`SlotCell.tsx:40`) applies to any drag kind.
5. **Pending state**: all N optimistic chips render with the existing `pending` treatment until reconciled (`model/placement.ts:14`, `SlotCell.tsx:67-71` already disables interaction on pending chips).
6. Tokens: any new styling uses semantic tokens per `lessons.md` (no palette-named classes).

### 5. Logic changes, file by file

| File | Change |
| --- | --- |
| `model/drag.ts:5-11` | Add `GroupDrag = { kind: "grouping"; groupingId: string }` to the `DragData` union (keep payload as opaque ids; resolve `memberIds` from props/state in the handler, per the "port the mechanism" lesson) |
| `ui/GroupingBox.tsx` | Add group-level `useDraggable` on a header handle; update the doc comment at lines 17-21 |
| `ui/PlannerBoard.tsx:32-41` | Third branch in `handleDrop`: `"grouping"` → `addGroup(groupingId, cell)`; resolve members via the groupings prop |
| `model/placement-transitions.ts` | `addManyOptimistic` / `addManyReconcile` / `addManyRollback` (per-member temp ids), plus the `canAdd` filter — same pure style as lines 7-26, with co-located tests modeled on `placement-transitions.test.ts:35-199` |
| `model/use-placements.ts` | `addGroup` + `persistAddGroup` orchestrator (the Option A/B decision lands here) |
| `api/placements.ts` / `api/placement-actions.ts` / migration | Only if Option B (atomic RPC) is chosen |

What does **not** change: `deriveCollisions`, `hasIntersection`, `deriveHours`, `SlotCell` droppable config, move/remove flows, the `placements` schema (no grouping identity on rows — a deliberate, resolved decision).

## Code References

- `src/_pages/plan-detail/model/drag.ts:5-11` — `DragData` discriminated union; the extension point for `GroupDrag`
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:32-41` — `handleDrop` kind-branching; gets the third branch
- `src/_pages/plan-detail/ui/GroupingBox.tsx:17-21, 27-35, 72-75` — group box doc comment, header affordance, per-course draggable pattern
- `src/_pages/plan-detail/ui/SlotCell.tsx:27, 40, 67-71` — droppable cell, drop highlight, pending-gated placed chip
- `src/_pages/plan-detail/model/placement-transitions.ts:7-26` — `canAdd`/`addOptimistic`/`addReconcile`/`addRollback`; template for batch variants
- `src/_pages/plan-detail/model/use-placements.ts:36-95` — optimistic orchestration hook; home of `persistAddGroup`
- `src/_pages/plan-detail/model/collisions.ts:17-42` — whole-board conflict derivation (reused unchanged)
- `src/_pages/plan-detail/model/enumerate.ts:20-60` — groupings are pairwise conflict-free by construction
- `src/_pages/plan-detail/api/placements.ts:40-70` — idempotent single-row insert (Option A building block)
- `src/_pages/plan-detail/api/persist.ts:26` + `supabase/migrations/20260611180100_clone_plan_fn.sql:108-111` — RPC precedents (Option B)
- `src/_pages/plan-detail/model/placement-transitions.test.ts:35-199`, `model/collisions.test.ts:22-73` — test templates

## Architecture Insights

- **Accept-and-flag is the keystone.** Because drops are never rejected, "can this group go here?" never needs an answer before the drop — the whole-board derivation answers it immediately after. Any design that adds a blocking pre-drop group validation would fight the architecture, not extend it.
- **The discriminated drag union is the dual-mode mechanism.** Individual-course and whole-group drag are not competing mechanisms needing reconciliation; they are two variants of one payload type flowing through one `handleDrop`. The placement rows that result are identical in both cases — after a group drop, every chip is an ordinary per-course placement, individually movable/removable, exactly as the original design intended ("identity is the course, not the group").
- **Drag payloads stay opaque-id-only** (`kind` + ids, no names, no member lists) — consistent with the "port the mechanism, not the type shape" lesson; member resolution happens at the handler from already-loaded props.
- **One state update for N chips.** The batch optimistic transition should append all N placements in a single `setPlacements` so `deriveCollisions`/`deriveHours` recompute once, keeping the <200ms feel.

## Historical Context (from prior changes)

- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md:36-38, 143, 155, 175` — **The grouping was always "a hint + bulk-drop convenience"**; the resolved design even sketched the handler: "If source is a grouping → insert one course placement per member into the target cell (bulk-drop)."
- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md:177` — Placements-API granularity question already leaned "per-row + array-insert for the fan-out for MVP simplicity" (today's Option A).
- `context/archive/2026-06-05-first-valid-drop-with-validation/plan.md:21, 40` and `plan-brief.md:25, 39` — S-01 deliberately **descoped** whole-group bulk-drop to ship the per-course MVP. This change closes that deferral.
- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md:76-93` — DnD library alternatives considered and rejected; Pragmatic DnD remains the documented fallback if `@dnd-kit/react` pre-1.0 churn bites.
- `context/archive/2026-06-04-port-grouping-algorithm/plan.md:30-31` — groupings persisted as deduped member-sets; no seed/grouping identity beyond membership.
- `context/foundation/lessons.md:5-10, 19-25` — opaque-id domain modeling; all mutations via Astro Actions (`defineDomainAction` pattern).

## Related Research

- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md` — the founding DnD + validation research; this document builds directly on its resolved decisions.
- `context/archive/2026-06-04-port-grouping-algorithm/research.md` — grouping enumeration core.

## Open Questions

1. **Persistence: Option A (N idempotent inserts) vs Option B (atomic RPC)?** — **RESOLVED 2026-06-12: Option A** (author decision, recorded in change.md Notes). Accept-and-flag tolerates partial success and per-row idempotency already handles retries; B remains a follow-up if partial-failure UX proves confusing.
2. **Partial-failure UX under Option A** — if 5 of 6 members persist and one rolls back, is the existing `ErrorBanner` enough, or does the rolled-back chip need a callout?
3. **Multi-hour courses**: a group drop should place **one hour of each member** into the cell (consistent with per-course drag = one course-hour per drop). Confirm this matches user expectation, vs. any notion of "place the whole week's hours".
4. **Dedupe behavior**: members already occupying the target cell are silently skipped by the `canAdd` filter. Silent skip vs. a subtle toast — probably silent, matching the existing no-op behavior of a duplicate single-course drop.
5. **`@dnd-kit/react` 0.4 nested-draggable behavior**: verify during implementation that a draggable handle inside a box containing draggable rows doesn't mis-capture pointer events; the handle-element pattern should avoid it, but 0.4.x is pre-1.0 — a quick spike is warranted.
6. **A11y/keyboard for group drag** — keyboard DnD was descoped in S-01 (Q11); group drag should not regress whatever exists, but full keyboard support stays deferred.
