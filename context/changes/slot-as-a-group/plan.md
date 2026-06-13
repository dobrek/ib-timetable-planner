# Slot-as-a-group (Slot Bundles) Implementation Plan

## Overview

Make all placements in a `(day, period)` slot behave as **one unit**: move them together, remove them together, with courses **grouped by default** (opt-out). An inline lock-icon toggle in the slot header ungroups a cell (re-enabling per-chip drag/remove) and re-groups it; an inline trash icon bulk-removes a grouped slot. Grouped/ungrouped state is **persisted in Supabase** and survives reload + plan clone.

The feature plugs into the existing implicit-slot model — a "slot" is the coordinate `(plan_id, cohort, day, period)`, already the unit of the `placements_unique` key, the `cellKey` collision bucketing, and per-cell rendering. It reuses the established optimistic-batch idiom (`addManyOptimistic`/`settleMany`) and leaves the per-cell constraint core completely untouched.

## Current State Analysis

- **A "slot" has no row today.** It is the implicit coordinate `(plan_id, cohort, day, period)`. Multiple `placements` rows legally share one cell with no binding between them; uniqueness is per-course (`placements_unique (plan_id, cohort, day, period, course_id)`, `20260611180006_plans_as_domain_root.sql:98-99`). The UI already buckets placements by `cellKey(day, period)` (`collisions.ts:6`).
- **`grouping` is a taken term.** `course_groupings` is the catalog-derived palette suggestion engine; the bare `addGroup`/`dropGroup` path fans a dropped palette grouping into N independent placements. The new feature uses a **distinct** vocabulary: `slotBundle` / `slot_bundles` / `kind:"bundle"`.
- **Batch-as-one-state-update already exists.** `eligibleMembers` → `addManyOptimistic` → `Promise.all(createPlacement)` → `settleMany` (`use-placements.ts:81-103`, `placement-transitions.ts:34-58`) is the template for bundle move/remove.
- **Constraints are per-cell and grouping-agnostic.** `deriveCellViolations` recomputes the whole board from `placements` on every change (`PlannerBoard.tsx`). A bundle move is the set-union of N placement moves; the verdict is correct from the resulting occupant set regardless of how courses arrived. The <200 ms budget is structurally untouched.
- **Mutations are single-row Astro Actions** via `defineDomainAction` → framework-free domain fns → `placement-client.ts` (`createPlacement`/`deletePlacement`). `insertPlacement` is idempotent on its unique key (`placements.ts:40-70`).
- **`clone_plan`** (`20260611180100_clone_plan_fn.sql`) is `SECURITY INVOKER`, atomic, remaps UUIDs via temp map tables; placements clone by remapping only `course_id`, copying `cohort/day/period` verbatim.

### Key Discoveries:

- The **opt-out simplification** (resolved in research): a bundle move/remove **never writes** `slot_bundles`. The table holds only explicit *unbundle overrides*. `isBundled(cell) = occupants(cell).length >= 2 && !hasOverride(cell)`. The table is written **only** by the lock-icon toggle. Move/remove are therefore pure placement operations.
- `DragHintContext.excludePlacementId` is **singular** (`drop-hints.ts:14`) — a whole-slot drag must exclude **all** dragged placements, so this needs a multi-exclude variant. `classifyCell` already supports N `members`, so previews otherwise work unchanged.
- The whole-group drag precedent is `GroupingBox.tsx` (outer `ref` draggable + header `handleRef` as the grab area) and `GroupDragOverlay.tsx` (a `kind`-gated overlay). The bundle reuses both shapes.
- `PlacedChip` is defined **inline** in `SlotCell.tsx:89-162` (no separate file). The per-chip `useDraggable` already takes `disabled: placement.pending` and the remove `Button` already takes `disabled={placement.pending}` — both extend cleanly to `|| bundled`.
- The `dropdown-menu` primitive is **not needed** — the chosen UX is two inline icon-buttons in the header.

## Desired End State

On the dp1 planning board:

- Any slot with **≥2 courses** is, by default, a **bundle**: its chips render without a per-chip "×" and are not individually draggable; the cell shows a faint containment cue and a header strip carrying a **lock/link icon** (left) and a **trash icon** (right).
- **Dragging the header strip** moves all of the slot's courses to a target slot as one unit (POST-new → DELETE-old per course, in a single optimistic state update; collisions flag at the destination; same-course members already at the target are skipped; dropping onto an occupied slot merges).
- **Clicking the lock icon** ungroups the slot (persists an override): chips regain their "×" and individual draggability, the icon flips to a broken-link state, the trash icon and containment cue disappear, and the slot is no longer draggable-as-a-unit. Clicking again re-groups it (deletes the override).
- **Clicking the trash icon** removes all of the bundle's placements at once, with no confirmation (consistent with the per-chip "×").
- Override state **persists across reload** and is **carried by `clone_plan`**. Re-adding a 2nd course to a default (no-override) slot re-bundles it automatically; a slot dropping to a single course is simply not a bundle.

**Verification:** integration test proves `clone_plan` copies overrides and the bundle/unbundle actions round-trip; unit tests cover `isBundled`, override transitions, batch move/remove, and the multi-exclude hint; manual board testing confirms the drag/toggle/remove interactions and that the grouped cue gates off under collision/drop-target.

## What We're NOT Doing

- **No change to the constraint core** (`constraints/*`, `collision.ts`, `collisions.ts` verdict logic). Grouping has zero semantic effect.
- **No partial-slot bundles** (binding a subset of a cell's courses). Bundling is always whole-slot — this is why the coordinate-keyed table is correct and a per-placement `slot_group_id` column is rejected.
- **No atomic move/remove RPC.** Move/remove are best-effort client batches; partial failure is tolerated and surfaced, the board recomputes from `placements`.
- **No grouping identity on placement rows** — placements stay ordinary, individually-addressable rows (honors the resolved `group-dragging` decision).
- **No dp2 UI** — `slot_bundles` carries `cohort` for readiness, but every read/write is scoped to `BOARD_COHORT` ("dp1").
- **No override garbage collection** — overrides are sticky across occupancy wobble and clone verbatim.
- **No confirmation dialog / undo** for bulk-remove (consistent with the existing per-chip "×").
- **No `dropdown-menu` usage** for this feature.
- **No `grouped boolean` column** — the row's presence alone encodes the override (opt-out).

## Implementation Approach

Three phases in dependency order:

1. **Persistence backbone** — create the `slot_bundles` table + RLS, extend `clone_plan`, regenerate types, and build the full server path (domain fns → action pair → client wrapper → `load.ts` seeding). Independently verifiable headless (integration test + build), with **no UI**.
2. **Model & state** — extend the drag union with `kind:"bundle"`, add pure `model/slot-bundle.ts` logic + a `use-slot-bundles` hook mirroring `usePlacements`, add batch move/remove placement transitions, and generalize the drop-hint exclude to multi. Unit-tested.
3. **UI & interaction** — `SlotCell` header (lock toggle + trash icons, drag handle), whole-slot draggable, faint grouped cue, inert chips; `GroupDragOverlay` bundle branch; `PlannerBoard` `handleDrop` case + hook wiring. Manually verified.

## Critical Implementation Details

- **Batch as one state update.** Bundle move and remove MUST apply all affected placements in a **single** `setPlacements` call (mirroring `addManyOptimistic`), so the board derives only the initial and final states — never a transient mid-move state that briefly flags a phantom duplicate (one row at origin + one already created at target). This is the one place the <200 ms / no-flicker property can be accidentally broken.
- **The table is written only by the toggle.** Bundle move/remove are pure placement operations and never touch `slot_bundles`. A dragged source carries no override; emptying it cleans nothing. The destination's bundled-ness is purely *its* occupancy + *its* override — so a move never silently re-groups a slot the planner chose to ungroup (destination state wins).
- **Grouped cue gating.** The faint containment treatment on the cell root must be gated off when `hasCollision || isDropTarget` (and is naturally overridden by hint classes during a drag), exactly as the existing hint/collision ring gating works — otherwise the grouped ring would compete with `ring-destructive` / `ring-ring`.
- **Toggle icon vs drag handle coexistence.** The header strip is the whole-slot drag handle (`handleRef`); the lock and trash icons are buttons inside it and must `stopPropagation` (pointerdown + click) so interacting with them never starts a drag — the same way `PlacedChip`'s remove button already guards its clicks.

## Phase 1: Persistence backbone

### Overview

Create the persisted `slot_bundles` override store and the entire server-side path to read/write it, plus the clone edit — with no UI. Verifiable via an integration test and a clean build.

### Changes Required:

#### 1. Migration — `slot_bundles` table

**File**: `supabase/migrations/<timestamp>_slot_bundles.sql` (create via `pnpm exec supabase migration new slot_bundles`)

**Intent**: Add a coordinate-keyed marker table whose row presence records an *unbundled override* for a cell. Mirror the placements table's plan FK, cohort enum, day/period checks, RLS, and uniqueness.

**Contract**: Table `slot_bundles (id uuid pk default gen_random_uuid(), plan_id uuid not null references plans(id) on delete cascade, cohort cohort not null, day smallint not null, period smallint not null, created_at timestamptz not null default now())`; `unique (plan_id, cohort, day, period)`; checks `day between 1 and 7`, `period between 1 and 12`; `enable row level security` + a single `for all to authenticated using (true) with check (true)` policy. **No `grouped` boolean** — presence is the marker.

#### 2. Migration — extend `clone_plan`

**File**: `supabase/migrations/<timestamp>_clone_plan_with_slot_bundles.sql`

**Intent**: `create or replace function clone_plan` (full body, copied from `20260611180100_clone_plan_fn.sql`) with one added statement that copies overrides by coordinate. No temp map needed — the table has no UUID members to remap.

**Contract**: Inside the existing function body, after the placements insert, add:

```sql
insert into public.slot_bundles (plan_id, cohort, day, period)
select v_new_plan_id, sb.cohort, sb.day, sb.period
  from public.slot_bundles sb
 where sb.plan_id = p_source_plan_id;
```

Keep `SECURITY INVOKER` and the existing signature/return.

#### 3. Regenerate database types

**File**: `src/shared/api/database.types.ts`

**Intent**: Regenerate after the migration applies so `slot_bundles` Row/Insert types and the `clone_plan` signature are available to the typed Supabase client.

**Contract**: `pnpm exec supabase db reset` then `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts`. New `slot_bundles` entry must appear in `Tables`.

#### 4. Domain functions + Zod inputs

**File**: `src/_pages/plan-detail/api/slot-bundles.ts` (new)

**Intent**: Two framework-free domain fns following `placements.ts`. `unbundleSlot` inserts an override row (idempotent on the unique key, like `insertPlacement`); `bundleSlot` deletes the override row by coordinate. Both scoped by `(planId, cohort, day, period)`.

**Contract**: Export `bundleSlotInput` / `unbundleSlotInput` Zod schemas `z.object({ planId: z.uuid(), cohort: cohortSchema, day: z.int().min(1).max(GRID_BOUNDS.maxDays), period: z.int().min(1).max(GRID_BOUNDS.maxPeriods) })`; export `insertOverride(supabase, input): Promise<void>` (insert, swallow `UNIQUE_VIOLATION`) and `deleteOverride(supabase, input): Promise<void>` (delete by the four coordinate columns). Throw `DomainError("INTERNAL_SERVER_ERROR", …)` on genuine errors. **Add a file-level doc-comment restating the inversion** — `slot_bundles` row **present ⇒ slot is UNbundled**; so `unbundleSlot` (UI verb) **inserts** the override and `bundleSlot` (UI verb) **deletes** it — so the verb→op mapping isn't wired backwards by a future reader.

#### 5. Action pair

**File**: `src/_pages/plan-detail/api/slot-bundle-actions.ts` (new)

**Intent**: Register the two domain fns as Astro Actions via `defineDomainAction`, mirroring `placement-actions.ts`.

**Contract**: `export const slotBundleActions = { unbundleSlot: defineDomainAction({ input: unbundleSlotInput, run: insertOverride }), bundleSlot: defineDomainAction({ input: bundleSlotInput, run: deleteOverride }) }`. (Action name = UI verb: `unbundleSlot` inserts the override, `bundleSlot` deletes it.)

#### 6. Client wrapper

**File**: `src/_pages/plan-detail/api/slot-bundle-client.ts` (new)

**Intent**: Thin client wrappers over `actions.unbundleSlot` / `actions.bundleSlot`, mirroring `placement-client.ts`.

**Contract**: `export async function unbundleSlot(args: { planId; cohort: Cohort; day; period }): Promise<void>` and `bundleSlot(args)` — call the action, throw on `error`.

#### 7. Wire action exports

**File**: `src/_pages/plan-detail/api/index.ts` and `src/actions/index.ts`

**Intent**: Re-export `slotBundleActions` from the slice index and spread it into the root `server` object so `astro:actions` registers it.

**Contract**: add `export { slotBundleActions } from "./slot-bundle-actions";` to the slice `index.ts`; import + spread `...slotBundleActions` in `src/actions/index.ts`.

#### 8. `SlotOverride` type + load overrides + seed props

**File**: `src/_pages/plan-detail/model/slot-bundle.ts` (new — type only this phase), `src/_pages/plan-detail/api/load.ts`, and `src/_pages/plan-detail/model/drag.ts`

**Intent**: Define the `SlotOverride` coordinate type now (so the server path compiles in Phase 1), query `slot_bundles` for the plan/cohort in the existing `Promise.all`, map rows to override coordinates, and add them to `PlannerBoardProps`. Phase 2 §2 enriches `slot-bundle.ts` with predicates/transitions on top of this type.

**Contract**: Create `model/slot-bundle.ts` exporting `export type SlotOverride = { day: number; period: number };` (the predicates/transitions land in Phase 2 §2 — keep this file minimal here). In `load.ts`, add `supabase.from("slot_bundles").select("cohort, day, period").eq("plan_id", id).eq("cohort", BOARD_COHORT)` to the parallel load; map to `SlotOverride[]`. In `drag.ts`, extend `PlannerBoardProps` with `overrides: SlotOverride[]`. Phase 1 build (1.2) must compile with this type present.

#### 9. Integration test

**File**: `src/_pages/plan-detail/api/slot-bundles.integration.test.ts` (new)

**Intent**: Prove the persistence backbone end-to-end against local Supabase: `unbundleSlot` then `bundleSlot` round-trip + insert idempotency, and that `clone_plan` copies an override to the new plan.

**Contract**: `*.integration.test.ts` (excluded from `pnpm test`, run via `pnpm test:integration`). Assert: insert override → row exists; insert again → still one row (idempotent); delete → gone; create plan with an override → `clone_plan` → cloned plan has the same coordinate override.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `pnpm exec supabase db reset`
- Types regenerated and compile: `pnpm build`
- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Integration tests pass: `pnpm test:integration`

#### Manual Verification:

- `slot_bundles` table is visible in Supabase Studio with the RLS policy after `db reset`
- Cloning a plan that has an override (via the existing clone flow / Studio) produces a new plan carrying the same override coordinate

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Model & state

### Overview

Add the client-side domain model and optimistic state for bundles: the drag union variant, pure bundle logic, the `use-slot-bundles` hook, batch move/remove placement transitions, and the multi-exclude drop-hint generalization. Unit-tested; not yet wired to visible UI.

### Changes Required:

#### 1. Drag union — `bundle` kind

**File**: `src/_pages/plan-detail/model/drag.ts`

**Intent**: Add a whole-slot drag payload carrying the source cell coordinate.

**Contract**: `export type BundleDrag = { kind: "bundle"; day: number; period: number };` added to the `DragData` union.

#### 2. Pure bundle logic

**File**: `src/_pages/plan-detail/model/slot-bundle.ts` (extend — `SlotOverride` created in Phase 1 §8)

**Intent**: Framework-free types and predicates for override state. No React, no I/O.

**Contract**: `SlotOverride` already exists from Phase 1 §8 (`export type SlotOverride = { day: number; period: number }`); this phase adds to the same file `export type LocalSlotOverride = SlotOverride & { pending?: boolean }`. Functions: `hasOverride(overrides, day, period): boolean` (keyed via `cellKey`); `isBundled(occupantCount: number, overridden: boolean): boolean` = `occupantCount >= 2 && !overridden`; optimistic transitions `addOverrideOptimistic` / `removeOverrideOptimistic` / `*Rollback` mirroring the placement add/remove transition shape (pending flag, immutable).

#### 3. `use-slot-bundles` hook

**File**: `src/_pages/plan-detail/model/use-slot-bundles.ts` (new)

**Intent**: Own optimistic override state, seeded from `props.overrides`, mirroring `usePlacements` (optimistic state + client + pure transitions) — NOT the `localStorage`/`useSyncExternalStore` shape of `useHintMode` (this is persisted shared state, not a per-device cosmetic).

**Contract**: `useSlotBundles(initial: SlotOverride[], ctx: { planId; cohort }): { overrides: LocalSlotOverride[]; isOverridden: (day, period) => boolean; toggleBundle: (day, period, currentlyBundled: boolean) => void; error: PlacementError | null; clearError }`. **Reuse the existing `PlacementError` `{ kind: "message" }` shape** (not a bespoke error type) so the toggle error renders through the same `ErrorBanner` path and the two streams can be merged into one banner in Phase 3 §1. `toggleBundle`: if currently bundled → optimistically add override + call `unbundleSlot`; else → optimistically remove override + call `bundleSlot`; rollback on failure and set the error. Use a `useLatest` ref for the async path (same pattern as `use-placements.ts`).

#### 4. Batch move/remove placement transitions

**File**: `src/_pages/plan-detail/model/placement-transitions.ts`

**Intent**: Add pure transitions for moving and removing **all** placements of a cell in one immutable state update, reusing the established `BatchEntry`/`BatchOutcome` shape. Kept separate from the palette `addGroup` path.

**Contract**: A bundle move must **partition** the source cell's occupants by the destination, because move semantics (POST-new + DELETE-old) duplicate a course that already sits at the target:

- **movers** — occupant's course is **absent** at the target: coords changed to the target + `pending` (the existing single-`moveOptimistic` shape).
- **mergers** — occupant's course is **already present** at the target: **removed from state** in the same pass (its target twin stays); never moved onto its twin (which would create a transient *and* post-settle `duplicateCourse` collision, since `insertPlacement` is idempotent and reconcile would leave the existing row in state twice).

Export: `partitionBundleMove(placements, ids, target): { movers: string[]; mergers: string[] }` (mergers = ids whose course already occupies `target`); `moveManyOptimistic(prev, movers, mergers, target)` — **one pass**: movers → coord change + `pending`, mergers → filtered out (no intermediate twin); `moveManyReconcile`/settle swapping each mover's id→server row; `removeManyOptimistic(prev, ids)`; plus an `occupantPlacementIds(placements, cell)` selector. (`partitionBundleMove` is the batch analogue of `moveIntent`'s per-row `occupiesCell` check, generalized from reject to skip.)

#### 5. `use-placements` — bundle move/remove orchestration

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Add `moveBundle(day, period, target)` and `removeBundle(day, period)` to the hook, mirroring `persistAddGroup`/`persistMove`/`persistRemove`: one optimistic `setPlacements`, `Promise.all` of single-row `createPlacement`/`deletePlacement`, settle in one pass, tolerate + surface partial failure.

**Contract**: Extend the `UsePlacements` return type with `moveBundle` and `removeBundle`. `moveBundle`: `partitionBundleMove` → `moveManyOptimistic(movers, mergers, target)` (single `setPlacements`) → `Promise.all` of **POST-new for movers only** → `settleMany` reconcile (mover temp/old ids → server rows) → **DELETE-old for both movers and mergers** (so the source empties). Collisions flag at the destination; partial failure tolerated + surfaced. `removeBundle` = batch delete of the cell's occupants in one optimistic update. Both build the moved/removed set in a single optimistic `setPlacements`.

#### 6. Multi-exclude drop hints

**File**: `src/_pages/plan-detail/model/drop-hints.ts`

**Intent**: Generalize the singular exclude to a set so a whole-slot drag excludes all of its dragged placements, and resolve a `bundle` drag's members from the source cell's occupants.

**Contract**: Change `DragHintContext.excludePlacementId?: string` → `excludePlacementIds?: string[]` (update the single `deriveDropHints` consumer). In `resolveDragHintContext`, handle `kind:"bundle"`: members = the source cell's occupant `GroupingCourse[]`, `excludePlacementIds` = all source placement ids, `origin` = the source cell. `classifyCell` is unchanged.

#### 7. Unit tests

**File**: co-located `*.test.ts` next to each new/changed model file

**Intent**: Cover the pure logic that's most likely to regress.

**Contract**: `slot-bundle.test.ts` (`isBundled` boundary at occupants 1/2, `hasOverride`, override transitions + rollback; **direction guard** — a currently-bundled cell's toggle path adds an override / a currently-unbundled cell's removes it, locking the verb↔presence mapping against an inverted wiring); `placement-transitions.test.ts` additions (`partitionBundleMove` splits movers/mergers; `moveManyOptimistic` single-pass correctness; **merge onto an occupied target yields exactly one row per course and an empty source** — no duplicate-course row survives settle; `removeManyOptimistic`); `drop-hints.test.ts` (bundle kind excludes all source placements; multi-exclude prevents phantom self-collision in preview).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type check / build clean: `pnpm build`
- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`

#### Manual Verification:

- No board behavior change yet: with Phase 2 merged (new model/hook/transitions present but **not** composed into `PlannerBoard` — wiring is Phase 3 §1), the board loads and renders exactly as before, no regressions

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: UI & interaction

### Overview

Surface bundles on the board: the slot header with the lock toggle + trash icons doubling as the drag handle, the whole-slot draggable, the faint grouped cue, inert chips while bundled, the drag overlay, and `handleDrop` wiring.

### Changes Required:

#### 1. `PlannerBoard` — wire hook + drop + drag-start

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Compose `useSlotBundles` into the hook stack, add the `bundle` case to `handleDrop`, ensure `handleDragStart` feeds bundle drags to `startDragHints`, and thread bundle state/handlers down to the grid + overlay.

**Contract**: `case "bundle": moveBundle(data.day, data.period, cell); break;` in `handleDrop`. Pass `isOverridden`/`toggleBundle`/`removeBundle` and an `isBundled` derivation down through `PlannerGrid`. `startDragHints` already routes through `resolveDragHintContext`, which now handles `bundle`. **Merge the two error streams into the single existing `ErrorBanner`**: render from `const banner = error ?? slotBundleError` (both are `PlacementError`); `onDismiss` calls both `clearError` and `clearSlotBundleError`. The toggle (and bundle move/remove) failures now surface — no silent rollback.

#### 2. `PlannerGrid` — compute + pass bundle props

**File**: `src/_pages/plan-detail/ui/PlannerGrid.tsx`

**Intent**: Per cell, derive `bundled = isBundled(occupants.length, isOverridden(day, period))` and pass it plus `onToggleBundle`/`onRemoveBundle` to each `SlotCell`.

**Contract**: Extend `SlotCell` props with `bundled: boolean`, `onToggleBundle: (day, period, bundled) => void`, `onRemoveBundle: (day, period) => void`.

#### 3. `SlotCell` — header, drag handle, grouped cue, inert chips

**File**: `src/_pages/plan-detail/ui/SlotCell.tsx`

**Intent**: When `occupants.length >= 2`, render a header strip; make it the whole-slot drag handle when bundled; show the faint containment cue (gated); render the lock toggle and (when bundled) trash icons; pass `bundled` to inline `PlacedChip` to disable its drag and hide its "×".

**Contract**:
- Add a whole-slot `useDraggable<BundleDrag>({ id: \`bundle:${cellKey(day,period)}\`, data: { kind:"bundle", day, period }, disabled: !bundled })`; put `handleRef` on the header strip.
- Header strip (`flex items-center justify-between`, rendered when `occupants.length >= 2`): left = a lock/link toggle icon `Button` (lucide `Link`/`Lock` when bundled, `Unlink`/`LockOpen` when overridden) calling `onToggleBundle(day, period, bundled)`; right = a trash icon `Button` (lucide `Trash2`) rendered only when `bundled`, calling `onRemoveBundle(day, period)`. Both buttons `stopPropagation` on click + pointerdown.
- Grouped cue on the cell root: `ring-ring ring-1 ring-inset rounded-md` + `bg-accent/40`, applied only when `bundled && !hasCollision && !isDropTarget` (tokens only).
- Pass `bundled` to `PlacedChip`; in `PlacedChip`, extend `useDraggable({ disabled: placement.pending || bundled })`, hide/disable the remove `Button` when `bundled`, and drop `cursor-grab` when `bundled`. The read-only conflict-inspect badge stays.

#### 4. `GroupDragOverlay` — bundle branch

**File**: `src/_pages/plan-detail/ui/GroupDragOverlay.tsx`

**Intent**: Render pointer-following feedback for a bundle drag (the source cell's course names), alongside the existing `grouping` branch.

**Contract**: Broaden the overlay `disabled` predicate to also enable `kind:"bundle"`; add a `data.kind === "bundle"` branch that looks up the source cell's occupants (needs `placements` + `names`, passed as props) and renders the same compact card shape as the grouping overlay.

### Success Criteria:

#### Automated Verification:

- Build clean: `pnpm build`
- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Unit tests pass: `pnpm test`

#### Manual Verification:

- A slot with ≥2 courses shows the header with the lock icon; its chips have no "×" and are not draggable; the faint cue is visible
- Clicking the lock icon ungroups: chips regain "×" + individual drag, the icon flips to the broken-link state, trash + cue disappear; clicking again re-groups
- Dragging the header moves all courses to another slot as one unit; collisions flag at the destination; dropping onto an occupied slot merges (same-course skipped); the move shows no transient collision flicker
- Clicking the trash icon removes all of the bundle's placements at once (no confirmation)
- Override and re-grouping persist across a page reload; an ungrouped slot stays ungrouped after reload; cloning preserves overrides
- The grouped cue correctly yields to the collision ring and the drop-target ring
- Drag feel stays within the <200 ms budget (no perceptible lag)

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `slot-bundle.ts`: `isBundled` boundary (occupants 1 → false, 2 → true; override flips to false), `hasOverride`, optimistic override add/remove + rollback.
- `placement-transitions.ts`: `partitionBundleMove` classifies movers vs. mergers; `moveManyOptimistic` applies all moves in one pass with no intermediate duplicate; merge onto an occupied target leaves exactly one row per course and empties the source (the merger's source row is removed, not moved onto its twin); `removeManyOptimistic` clears the set.
- `drop-hints.ts`: a `bundle` drag resolves members from the source cell and excludes **all** its placements; multi-exclude prevents a phantom self-collision in the preview.

### Integration Tests:

- `slot-bundles.integration.test.ts` (local Supabase): override insert idempotency, insert→delete round-trip, and `clone_plan` copies overrides to the cloned plan.

### Manual Testing Steps:

1. Place ≥2 courses in a slot → confirm it auto-bundles (no per-chip "×", header lock icon, faint cue).
2. Drag the header to an empty slot → all courses move together; original slot empties.
3. Drag the header onto an occupied slot → courses merge; same-course duplicates skipped; collisions flag.
4. Click the lock icon → slot ungroups; verify per-chip "×" and individual drag return; reload → still ungrouped.
5. Click the lock icon again → re-bundles; reload → still bundled.
6. Click the trash icon on a bundle → all placements removed, no prompt.
7. Reduce a bundle to one course (remove others while ungrouped) → confirm it is no longer a bundle.
8. Clone the plan (existing flow) → confirm overrides carry over.

## Performance Considerations

The <200 ms per-drag budget is met structurally and is preserved: validation remains a pure, in-memory full recompute from `placements`, and bundle move/remove apply as a **single** optimistic `setPlacements` so the board derives only initial and final states (no mid-move flicker). No network call sits on the validation path. Max 84 cells/cohort keeps override and placement sets tiny.

## Migration Notes

- Additive only: a new `slot_bundles` table and a `create or replace` of `clone_plan`. No changes to `placements`. No production data to preserve.
- Apply locally with `pnpm exec supabase db reset`; push to hosted with `pnpm exec supabase db push` (migrations only — seed is dev-only). Regenerate `database.types.ts` after applying.
- Verify table reachability after a hosted push (grants vs RLS), per the README note.

## References

- Research: `context/changes/slot-as-a-group/research.md`
- Resolved decisions: `context/changes/slot-as-a-group/research.md:206-215`
- Batch idiom template: `src/_pages/plan-detail/model/use-placements.ts:81-103`, `placement-transitions.ts:34-58`
- Whole-group drag precedent: `src/_pages/plan-detail/ui/GroupingBox.tsx`, `ui/GroupDragOverlay.tsx`
- Action pattern: `src/_pages/plan-detail/api/{placements,placement-actions,placement-client}.ts`, `src/shared/lib/actions/index.ts`
- Clone edit site: `supabase/migrations/20260611180100_clone_plan_fn.sql`
- Prior art: `context/changes/group-dragging/`, `context/changes/collision-info/`, `context/changes/collision-free-slots/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Persistence backbone

#### Automated

- [x] 1.1 Migrations apply cleanly: `pnpm exec supabase db reset` — 5621020
- [x] 1.2 Types regenerated and compile: `pnpm build` — 5621020
- [x] 1.3 Lint passes: `pnpm lint` — 5621020
- [x] 1.4 FSD structure check passes: `pnpm steiger` — 5621020
- [x] 1.5 Integration tests pass: `pnpm test:integration` — 5621020

#### Manual

- [x] 1.6 `slot_bundles` table visible in Studio with RLS policy after `db reset` — 5621020
- [x] 1.7 Cloning a plan with an override carries the override to the new plan — 5621020

### Phase 2: Model & state

#### Automated

- [x] 2.1 Unit tests pass: `pnpm test`
- [x] 2.2 Type check / build clean: `pnpm build`
- [x] 2.3 Lint passes: `pnpm lint`
- [x] 2.4 FSD structure check passes: `pnpm steiger`

#### Manual

- [x] 2.5 No board behavior change: Phase 2 code present but not composed into `PlannerBoard` (wiring is Phase 3); board loads/renders as before, no regressions

### Phase 3: UI & interaction

#### Automated

- [ ] 3.1 Build clean: `pnpm build`
- [ ] 3.2 Lint passes: `pnpm lint`
- [ ] 3.3 FSD structure check passes: `pnpm steiger`
- [ ] 3.4 Unit tests pass: `pnpm test`

#### Manual

- [ ] 3.5 ≥2-course slot shows header lock icon; chips have no "×" and aren't draggable; faint cue visible
- [ ] 3.6 Lock icon toggles ungroup/regroup; per-chip "×" + drag return when ungrouped
- [ ] 3.7 Header drag moves all courses as one unit; merge onto occupied target skips same-course; collisions flag; no mid-move flicker
- [ ] 3.8 Trash icon removes all bundle placements with no confirmation
- [ ] 3.9 Override / regroup state persists across reload; clone preserves overrides
- [ ] 3.10 Grouped cue yields to collision ring and drop-target ring
- [ ] 3.11 Drag feel within the <200 ms budget
