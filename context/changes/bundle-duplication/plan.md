# Bundle Duplication Implementation Plan

## Overview

Add **"duplicate"** as the missing third whole-slot verb alongside `moveBundle` / `removeBundle`: clicking a control on a placed cell copies all of its course-hours into the **next conflict-free empty slot**, leaving the source in place. The feature is **entirely client-side** — it reuses the existing `place_course` fan-out for persistence and the existing `deriveDropHints` oracle for the conflict-free search. No migration, RPC, Astro Action, or Zod schema changes.

This plan builds directly on `context/changes/bundle-duplication/research.md`, which verified feasibility and locked all seven design decisions with the user.

## Current State Analysis

- **Placement state + write path** live in `usePlacements` (`use-placements.ts`). Every mutation is an optimistic state pass over pure transitions (`placement-transitions.ts`) plus async persistence. `moveBundle` / `removeBundle` are whole-slot verbs that read the cell's members via `courseIdsAt(day, period)` and drive a member-set primitive. **Duplicate is the missing third verb of this family.** (`use-placements.ts:96-105`)
- **Group fan-out already does the persistence a duplicate needs.** `persistAddGroup` (`use-placements.ts:126-154`) fans out one idempotent `placeCourse` per eligible member at a target cell, in one optimistic batch + one `settleMany` reconcile. The `place_course` RPC find-or-creates a bundle **keyed by cell**, so placing a member-set at a *fresh empty cell* mints a brand-new independent bundle automatically — exactly what a duplicate produces. (`bundle-operations.integration.test.ts:117-130` proves this.)
- **The conflict-free search is already computed.** `deriveDropHints` (`drop-hints.ts:87`) returns a **sparse** `Map<cellKey, DropHint>` (absent cell = free) for any member-set, honoring collisions, teacher availability, and cross-cohort occupancy. The board already runs it on every drag start within the <200 ms budget; a grid is ≤84 cells/cohort. The bundle-*move* context branch (`drop-hints.ts:63-76`) excludes the source placements — a **copy** must instead judge against the full board (no exclusion, no origin).
- **UI hook points exist.** A ≥2-occupant cell renders a header strip (`SlotCell.tsx:106-137`) carrying the group/ungroup toggle (always) and the bulk-remove trash (`{bundled && …}`). Single-occupant cells have **no** header. Handlers thread `PlannerBoard → PlannerGrid → SlotCell` (e.g. `onRemoveBundle`). The whole bundled cell is the drag surface; interactive `<button>`s opt out via `stopDrag` (`drag-inert.ts:10`).
- **Week (A/B) is a per-placement attribute.** `resolveDropWeek` (`placement-transitions.ts:19`) is cell-local and can re-assign A/B to *different* members at the target, so a faithful copy must carry the **source weeks explicitly** rather than re-resolve.
- **Hours over-allocation is display-only** (`hours.ts:11-25`) — nothing blocks exceeding required hours. Duplicating adds an hour per member; that is allowed by design.

## Desired End State

A plan author can click a `Copy` control on any placed cell and see its course(s) appear at the next conflict-free empty slot — the target scrolled into view and briefly highlighted — with the source untouched and per-member A/B weeks mirrored. The control is present on grouped bundles, on the same bundle after it is ungrouped (ungrouping has no effect on duplicate), and on single-occupant cells. When no empty slot qualifies, the existing error banner explains why. The feature ships with unit, component, integration, and E2E coverage and a green `/verify` gate.

### Key Discoveries

- **Copy context ≠ move context:** build `{ members }` with **no** `excludePlacementIds` / `origin` (`drop-hints.ts:41-78`) — the source stays on the board.
- **Column-major scan anchored after the source (wraps):** the target is the first qualifying empty cell scanning days-outer / periods-inner, starting at the cell **right after the source** (down the source's day first, then the next day) and wrapping to the grid start only if nothing after it qualifies — so on a sparse grid the copy lands just below/after the bundle and **never jumps back before the source**. Deterministic, which the E2E assertion relies on. (Research decision #4, refined during planning.)
- **Two-tier "conflict-free":** prefer a strictly-free empty cell (no hint entry); fall back to a non-blocking empty cell (hint ∈ {`warn`, `opposite-week`}); only if neither exists is it "no slot." (Research decision #3; `drop-hints.ts:14-17`.)
- **Empty cells can still carry hints:** teacher-unavailability and cross-cohort occupancy mark *empty* cells `warn` / `blocked` / `opposite-week` in the hint map (`drop-hints.ts:106-115`), so the oracle — not a bare "is it empty" test — is what makes the search correct.
- **Persistence reuse:** the fan-out path is `place_course` per member; a fresh cell mints an independent bundle. No server work. (`place_course_fn.sql`, `placement-client.ts:6-17`.)
- **`tw-animate-css` is available** (`global.css:2`, `package.json`) for the highlight pulse; no `scrollIntoView` exists in the slice yet (net-new).

## What We're NOT Doing

- **No server / DB / RPC / Action / Zod changes.** Persistence is the existing `place_course` fan-out.
- **No transactional `duplicate_bundle` RPC.** Atomicity reuses the per-member fan-out; partial failure surfaces the existing `groupFailure` banner. (Research decision #7.)
- **No hours-overshoot gate.** Duplicating may push a course over its required hours; allowed, consistent with the advisory hours model. (Research decision #2.)
- **No new `PlacedChip` prop.** The single-occupant control is a sibling element in `SlotCell`, not a chip prop. (Research decision #5; hard constraint.)
- **No per-loose-chip duplicate semantics.** Duplicate is always a **cell-level** operation (copies every occupant of the cell); ungrouping a multi-course cell does not change this. (User decision.)
- **No companion-dropdown reconciliation work.** A stale open companion dropdown after a duplicate is low-risk and self-heals on re-render (research Problem F).

## Implementation Approach

The feature decomposes into a model core (a pure search + a week-faithful fan-out + a first-class hook verb), then UI (two affordance surfaces + threading + scroll/pulse feedback), then two test harnesses the persistence and the gesture genuinely need (integration RPC + browser E2E).

The crux — "where can this whole cell legally land?" — is a pure function over the existing oracle. Keeping it pure and separately tested preserves a single source of truth for placement validity and inherits the <200 ms guarantees structurally.

## Critical Implementation Details

- **Copy vs. move context.** `deriveDropHints` must receive `{ members }` only. If `excludePlacementIds` / `origin` leak in (as the bundle-*move* resolver supplies), the search would lift the source off the board and could even pick the source's own cell — wrong for a copy. This is the single most important correctness distinction in the feature.
- **Scan anchor.** The search starts at the cell *after* the source in column-major order and **wraps** around the grid, so a duplicate lands at the next free slot down/after the bundle — never at the week's top-left. The source cell is occupied, so it is skipped naturally; the wrap only matters when every cell after the source is full.
- **Week faithfulness ordering.** The duplicate must read each source placement's `week` *before* dispatch and pass it through unchanged. Re-resolving via `resolveDropWeek` at the target can swap which member gets A vs B for bi-weekly pairs (`placement-transitions.ts:19-33`).
- **Highlight lifecycle.** The target-cell highlight is transient and must self-clear (timer) and re-fire when a *subsequent* duplicate lands on a different cell; clean up the timer on unmount. Honor `prefers-reduced-motion` (suppress the pulse; the scroll-into-view still runs).

---

## Phase 1: Model — search, week-faithful fan-out, and the `duplicateBundle` verb

### Overview

Add the pure conflict-free target search, extend the group fan-out to carry explicit per-member weeks, and add `duplicateBundle` as a first-class `usePlacements` verb that ties them together and reports the target back for UI feedback.

### Changes Required

#### 1. Pure target search

**File**: `src/_pages/plan-detail/model/duplicate-target.ts` (new; co-located `duplicate-target.test.ts`)

**Intent**: Given the source cell, its member-set, and the current board, find the first empty cell where the whole member-set lands conflict-free — scanning column-major **starting just after the source** (down the source's day, then the next day) and **wrapping** around the grid — applying the two-tier rule. Returns `null` when nothing qualifies. Pure and side-effect-free, reusing `deriveDropHints` + `bucketByCell` so it cannot drift from drag-time validity.

**Contract**: exported `findDuplicateTarget(args): CellData | null` where `args = { source: CellData; members: GroupingCourse[]; placements: PlannerPlacement[]; catalogById: Map<string, GroupingCourse>; availability?: AvailabilityIndex; occupiedByTeacher?: CrossCohortIndex; days: number; periods: number }`. Builds the copy context, runs the oracle once, and scans the column-major cell order rotated to begin at the cell after the source. The anchor + wrap + two-tier preference are the non-obvious parts:

```ts
const hints = deriveDropHints({ members }, placements, catalogById, availability, occupiedByTeacher);
const buckets = bucketByCell(placements, catalogById);
// Column-major cell order (day outer, period inner)…
const order: CellData[] = [];
for (let day = 1; day <= days; day++)
  for (let period = 1; period <= periods; period++) order.push({ day, period });
// …rotated to start at the cell AFTER the source, wrapping around the whole grid.
const start = (source.day - 1) * periods + (source.period - 1) + 1;
let strictlyFree: CellData | null = null;
let nonBlocking: CellData | null = null;
for (let i = 0; i < order.length; i++) {
  const { day, period } = order[(start + i) % order.length];
  const key = cellKey(day, period);
  if (buckets.has(key)) continue;                 // only EMPTY cells (skips the source itself)
  const hint = hints?.get(key);                    // empty cell can still be warn/blocked/opposite-week
  if (hint === undefined) { strictlyFree ??= { day, period }; }
  else if (hint === "warn" || hint === "opposite-week") { nonBlocking ??= { day, period }; }
  // "blocked" / "partial" → skip
}
return strictlyFree ?? nonBlocking ?? null; // prefer a strictly-free cell anywhere in the rotation
```

#### 2. Week-faithful group fan-out

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Let a caller supply the exact week for each member so a duplicate mirrors the source's A/B layout instead of re-resolving it.

**Contract**: widen `addGroup`'s opts to `{ oppositeWeek?: boolean; weekByMember?: Map<string, PlacementWeek> }` and thread `weekByMember` into `persistAddGroup`. In `persistAddGroup`, the `weekFor` precedence becomes `weekByMember?.get(courseId) ?? <oppositeWeek assignment> ?? resolveDropWeek(...)`. Existing call sites (the grouping drop) pass no `weekByMember` and are unaffected.

#### 3. `duplicateBundle` verb + oracle inputs + target outcome

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Add the whole-slot duplicate verb. It reads the source cell's occupants (and their weeks), runs the pure search, and either dispatches the week-faithful fan-out at the target or sets a message error — then records the target so the board can scroll/pulse it.

**Contract**:
- Extend `UsePlacementsArgs` with the oracle inputs already computed at the board: `{ catalogById, availabilityIndex, crossCohortIndex, days, periods }`.
- `duplicateBundle(day, period): void` — reads occupants at `(day, period)` from `placementsRef`; **no-op** if there are none or any is `pending` (mirrors the `moveBundle`/`removeBundle` pending guard). Resolves `members` via `catalogById`, calls `findDuplicateTarget` passing `source: { day, period }` (so the scan anchors after the source). On `null` → `setError({ kind: "message", message: "No empty slot available to duplicate into" })`. On a target → build `weekByMember` from the source rows and call `addGroup(courseIds, target, { weekByMember })`, then publish the target outcome.
- Add a transient outcome `lastDuplicated: (CellData & { nonce: number }) | null` to the hook's state and return value (sibling of `error`); `duplicateBundle` sets it (with a fresh incrementing `nonce`) so the same-cell case still re-fires the effect. `clearError` is unchanged; the board owns clearing the highlight.
- Export `duplicateBundle` and `lastDuplicated` from the hook.

### Success Criteria

#### Automated Verification

- `findDuplicateTarget` unit tests pass — strictly-free preferred over non-blocking; `blocked`/`partial` empty cells skipped; teacher-unavailable / cross-cohort hints on empty cells respected; scan **anchored after the source, down the day then next day**; **never lands before the source** unless it wraps because everything after is full; wrap reaches the earliest free slot; source cell never chosen (copy context, not move); full grid → `null`: `pnpm test`
- Week-faithful fan-out + `duplicateBundle` unit tests pass — source weeks preserved; pending-source no-op; empty-source no-op; no-slot sets the message error: `pnpm test`
- Type check passes: `pnpm check`
- Lint passes: `pnpm lint`
- FSD structure passes: `pnpm steiger`

#### Manual Verification

- Confirmed the search reuses `deriveDropHints` + `bucketByCell` (no constraint logic reinvented) and the copy context omits `excludePlacementIds`/`origin`.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding. Phase blocks use plain bullets; the `## Progress` checkboxes track these items.

---

## Phase 2: UI — affordances, threading, and success feedback

### Overview

Surface the verb on two controls (header button for ≥2-occupant cells, always-visible icon for single-occupant cells), thread the handler through the board, and add scroll-into-view + a self-clearing highlight pulse on the target cell.

### Changes Required

#### 1. Handler threading

**Files**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`, `PlannerGrid.tsx`, `slot-cell/SlotCell.tsx`

**Intent**: Pass the duplicate handler down to the cell, mirroring `onRemoveBundle`.

**Contract**: add `onDuplicateBundle: (day: number, period: number) => void` to `SlotCell` `Props`, `PlannerGrid` `CellWiring` (and the `PeriodRow` pass-through). In `PlannerBoard`, destructure `duplicateBundle` + `lastDuplicated` from `usePlacements` (now passing the oracle inputs into the hook) and wire `onDuplicateBundle={duplicateBundle}` on `PlannerGrid`.

#### 2. Header duplicate button (≥2-occupant cells, grouped OR exploded)

**File**: `src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx`

**Intent**: Add a `Copy`-icon button in the existing header. Unlike the bulk-remove trash (which stays `{bundled && …}`), the duplicate button shows for **every** `hasHeader` cell so ungrouping never hides it.

**Contract**: render a `Button variant="ghost" size="icon"` with a lucide `Copy` icon inside the `hasHeader` block (a sibling of the toggle/trash, **not** inside the `{bundled && …}` guard), wired with `stopDrag(() => onDuplicateBundle(day, period))`, semantic tokens (`text-muted-foreground hover:bg-accent hover:text-accent-foreground`), and `aria-label="Duplicate slot to next free slot"`. Adjust the header layout so toggle stays left and duplicate/trash group right. The `aria-label` doubles as the E2E locator (Phase 4).

#### 3. Single-occupant duplicate control

**File**: `src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx`

**Intent**: For a one-occupant cell (no header today), render an always-visible `Copy`-icon control as a sibling element in the cell — never a `PlacedChip` prop.

**Contract**: when `occupants.length === 1`, render a small `Copy` button positioned top-right of the cell (e.g. absolutely positioned so it doesn't disturb the chip), wired with `stopDrag(() => onDuplicateBundle(day, period))`, semantic tokens, and `aria-label={`Duplicate ${occupants[0].name} to next free slot`}`. Always visible (per user decision), so no hover gating required.

#### 4. Scroll-into-view + highlight pulse

**Files**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`, `PlannerGrid.tsx`, `slot-cell/SlotCell.tsx`

**Intent**: When a duplicate lands, bring the target cell on-screen and pulse it briefly so the author sees where the copy went (the grid is `overflow-auto`, so the target may be off-screen).

**Contract**:
- `PlannerBoard` reads `lastDuplicated` and passes a `justDuplicated: (CellData & { nonce: number }) | null` down through `PlannerGrid` to the matching `SlotCell` (compare by `cellKey`); clear it after the pulse via a timed effect (cleanup on unmount).
- `SlotCell` gains a `justDuplicated: boolean` prop. On its rising edge, capture the cell node (extend the existing `mergeRefs` in `useCellDnd` to also store the node in a local ref) and call `scrollIntoView({ block: "nearest" })`, and apply a one-shot pulse via a `tw-animate-css` utility gated behind `motion-safe:` (so `prefers-reduced-motion` suppresses the animation; scroll still runs). Use a semantic token for the pulse color (e.g. an accent ring), never a palette literal.

#### 5. Component tests

**File**: `src/_pages/plan-detail/ui/slot-cell/SlotCell.test.tsx` (new)

**Intent**: Lock the affordance rules.

**Contract**: render `SlotCell` (RTL, as `GroupingStalePanel.test.tsx`/`PlannerPalette.test.tsx` do) and assert: a ≥2-occupant cell shows the duplicate button when grouped **and** when exploded; a single-occupant cell shows the always-visible duplicate icon; clicking either calls `onDuplicateBundle(day, period)`; the bulk-remove trash remains bundled-gated (unchanged).

### Success Criteria

#### Automated Verification

- `SlotCell.test.tsx` passes (duplicate present on grouped + exploded ≥2 cells and on single cells; calls handler; trash unchanged): `pnpm test`
- Type check passes: `pnpm check`
- Lint passes: `pnpm lint`
- FSD structure passes: `pnpm steiger`
- Production build is clean (Workers runtime): `pnpm build`

#### Manual Verification

- Duplicating a grouped multi-course bundle places its courses at the next free slot; the source is unchanged; the target scrolls into view and pulses.
- Ungroup that bundle, duplicate again → identical result (ungrouping has no impact).
- Duplicating a single-occupant cell via the always-visible icon copies the course to the next free slot.
- Clicking any duplicate control never starts a drag.
- With the grid full (no qualifying empty cell), the duplicate control surfaces the "No empty slot available to duplicate into" banner.
- A/B layout is mirrored when duplicating a bi-weekly pair.
- `prefers-reduced-motion` suppresses the pulse; the scroll still occurs.
- Controls + pulse render correctly in light and dark (semantic tokens only).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Integration test — bundle independence + week faithfulness

### Overview

Prove at the persistence layer what the duplicate relies on: placing the source member-set at a second cell mints an **independent** bundle and **preserves each member's week**.

### Changes Required

#### 1. Duplicate persistence integration test

**File**: `src/_pages/plan-detail/api/duplicate-operations.integration.test.ts` (new)

**Intent**: Drive `place_course` directly against local Supabase (service-role client, as `bundle-operations.integration.test.ts` does), placing a multi-member bundle with mixed weeks at cell X, then the same member-set at cell Y, asserting independence and week persistence across cells — the cross-cell assertion the existing same-cell find-or-create test doesn't make.

**Contract**: mirror the harness in `bundle-operations.integration.test.ts:1-115` (env-gated `describe`, factory plan + `seedPlanCatalog`, `teardown`). Place a 2–3 member set at X with explicit weeks (`a`/`b`/`both`), place the same set at Y, then assert: `bundleAt(Y) !== bundleAt(X)`; Y holds the same course-ids; each placement at Y carries the same `week` as its counterpart at X.

### Success Criteria

#### Automated Verification

- Duplicate integration test passes against local Supabase: `pnpm test:integration`

#### Manual Verification

- Sanity-checked the assertion fails when independence is broken (e.g. temporarily assert equal `bundle_id`), confirming it protects the real risk.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: E2E test + full verification

### Overview

Prove the duplicate **gesture** works through the real board (auth → SSR → hydration → click → search → optimistic render → Astro Action → Supabase → re-derived render) and that the local CI gate is green.

### Changes Required

#### 1. Duplicate E2E spec

**File**: `e2e/specs/duplicate-bundle.spec.ts` (new); shared helper promoted to `e2e/support/board.ts`

**Intent**: Mirror `bundle-operations.spec.ts` — provision co-runnable courses, compute groupings, place a bundle, then duplicate it and assert the copy lands at the deterministic column-major target while the source is retained. Cover the single-occupant control too.

**Contract**:
- Add a `duplicateCell(page, cell)` helper to `support/board.ts` that clicks the duplicate control by accessible name within the `gridcell` (role-based, per `e2e/CLAUDE.md`).
- Place the source bundle at a cell with its day's later periods empty (e.g. day 1, period 1) so the **after-source** target is deterministically the **next period down in the same day** (e.g. day 1, period 2); assert the target holds the members and is `bundled`, and that the source **still** holds them (duplicate, not move).
- Add a single-occupant case: place one course, duplicate, assert the next-period-down cell receives it.
- Own a uniquely-named plan; tear down by deleting the plan.

#### 2. Full local CI gate

**Intent**: Confirm CI will pass before handing off.

**Contract**: run the `/verify` skill (install → `astro sync` → `pnpm check` → `lint` → `steiger` → `pnpm audit` → `test` → `build`). Note: `/verify` does not run integration/E2E — those are the Phase 3 / Phase 4 gates above.

### Success Criteria

#### Automated Verification

- Duplicate E2E spec passes: `pnpm test:e2e` (bundle duplicate lands at the next-period-down target after the source, with the source retained; single-occupant duplicate works)
- Full local CI gate is green: `/verify`

#### Manual Verification

- Observed the E2E run (or its trace) drive the real board end-to-end through workerd → Supabase.

**Implementation Note**: This is the final phase. After automated verification passes, the feature is complete pending the manual sign-off above.

---

## Testing Strategy

### Unit Tests

- `findDuplicateTarget`: strictly-free preferred; non-blocking (`warn`/`opposite-week`) fallback; `blocked`/`partial` empty cells skipped; teacher-unavailable + cross-cohort hints on empty cells honored; scan anchored after the source (down the day, then next day) and wrapping; never lands before the source unless it wraps; copy context never returns the source cell; full grid → `null`.
- Week-faithful fan-out: `weekByMember` takes precedence over `resolveDropWeek`; existing grouping-drop path unaffected.
- `duplicateBundle`: pending-source and empty-source no-ops; no-slot sets the message error; success records `lastDuplicated` with a fresh nonce.

### Component Tests

- `SlotCell`: duplicate control present on grouped + exploded ≥2 cells and on single-occupant cells; click calls `onDuplicateBundle`; trash stays bundled-gated.

### Integration Tests

- `duplicate-operations.integration.test.ts`: independent `bundle_id` + per-member week preserved across two cells.

### E2E Tests

- `duplicate-bundle.spec.ts`: duplicate a placed bundle → copy at the deterministic target, source retained; single-occupant duplicate → next free cell receives the course.

### Manual Testing Steps

1. Place a grouped bundle; click duplicate; confirm the copy at the next free slot, source unchanged, target scrolled into view + pulsing.
2. Ungroup the bundle; duplicate; confirm identical behavior.
3. Duplicate a single-occupant cell via the always-visible icon.
4. Duplicate a bi-weekly pair; confirm A/B layout mirrored.
5. Fill the grid; duplicate; confirm the "no empty slot" banner.
6. Enable reduced-motion; confirm the pulse is suppressed but the scroll runs.

## Performance Considerations

The search reuses `deriveDropHints`, which the board already runs on every drag start within the <200 ms budget over ≤84 cells/cohort. The duplicate adds one synchronous, zero-network pass plus a column-major scan with O(1) per-cell tests — single-digit milliseconds, structurally under budget. The worst case (an empty grid) is the cheapest (no occupants to compare).

## Migration Notes

None. No schema, RPC, Action, or Zod changes. The feature is client-only and reuses `place_course`.

## References

- Research: `context/changes/bundle-duplication/research.md` (verdict + all seven locked decisions)
- Whole-slot verb templates: `src/_pages/plan-detail/model/use-placements.ts:96-154`
- Conflict-free oracle: `src/_pages/plan-detail/model/drop-hints.ts:41-128`
- Week assignment: `src/_pages/plan-detail/model/placement-transitions.ts:19-33`
- UI insertion point: `src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx:106-137`
- Persistence proof (same-cell): `src/_pages/plan-detail/api/bundle-operations.integration.test.ts:117-130`
- E2E sibling: `e2e/specs/bundle-operations.spec.ts`; conventions: `e2e/CLAUDE.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Model — search, week-faithful fan-out, and the `duplicateBundle` verb

#### Automated

- [ ] 1.1 `findDuplicateTarget` unit tests pass (tier preference, skipped/blocked empties, availability + cross-cohort hints, anchored-after-source scan + wrap, never lands before source unless wrapping, copy-context source-excluded, no-slot → null)
- [ ] 1.2 Week-faithful fan-out + `duplicateBundle` unit tests pass (weeks preserved, pending/empty no-ops, no-slot message error)
- [ ] 1.3 Type check passes: `pnpm check`
- [ ] 1.4 Lint passes: `pnpm lint`
- [ ] 1.5 FSD structure passes: `pnpm steiger`

#### Manual

- [ ] 1.6 Confirmed the search reuses `deriveDropHints` + `bucketByCell` and the copy context omits exclude/origin

### Phase 2: UI — affordances, threading, and success feedback

#### Automated

- [ ] 2.1 `SlotCell.test.tsx` passes (duplicate on grouped + exploded ≥2 cells and single cells; calls handler; trash unchanged)
- [ ] 2.2 Type check passes: `pnpm check`
- [ ] 2.3 Lint passes: `pnpm lint`
- [ ] 2.4 FSD structure passes: `pnpm steiger`
- [ ] 2.5 Production build clean: `pnpm build`

#### Manual

- [ ] 2.6 Grouped bundle duplicates to next free slot; source unchanged; target scrolls in + pulses
- [ ] 2.7 Ungrouped bundle duplicates identically (ungrouping has no impact)
- [ ] 2.8 Single-occupant cell duplicates via the always-visible icon
- [ ] 2.9 Clicking a duplicate control never starts a drag
- [ ] 2.10 Full grid surfaces the "no empty slot" banner
- [ ] 2.11 Bi-weekly A/B layout mirrored on duplicate
- [ ] 2.12 `prefers-reduced-motion` suppresses the pulse; scroll still runs
- [ ] 2.13 Controls + pulse correct in light and dark (semantic tokens)

### Phase 3: Integration test — bundle independence + week faithfulness

#### Automated

- [ ] 3.1 Duplicate integration test passes: `pnpm test:integration`

#### Manual

- [ ] 3.2 Verified the assertion fails when bundle independence is broken

### Phase 4: E2E test + full verification

#### Automated

- [ ] 4.1 Duplicate E2E spec passes (next-period-down target after source, source retained): `pnpm test:e2e`
- [ ] 4.2 Full local CI gate green: `/verify`

#### Manual

- [ ] 4.3 Observed the E2E run drive the real board end-to-end through workerd → Supabase
