---
date: 2026-06-13T12:44:40+0200
researcher: Dobromir Kropielnicki
git_commit: 83783a5379d5628963c352da8d78ec77204f5499
branch: main
repository: ib-timetable-planner
topic: "Slot-as-a-group: treating all placements in a (day,period) slot as one move/remove unit"
tags: [research, codebase, plan-detail, placements, drag-drop, grouping, persistence]
status: complete
last_updated: 2026-06-13
last_updated_by: Dobromir Kropielnicki
---

# Research: Slot-as-a-group

**Date**: 2026-06-13T12:44:40+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 83783a5379d5628963c352da8d78ec77204f5499
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

For the planning board, the user wants slotted courses to behave as **one group**: move all courses from one slot to another and remove all courses from a slot at once. Courses inside a slot should be **automatically grouped**, with an **ungroup** option that re-enables operating on individual courses. While grouped, only the whole group can be moved or removed. What UI and model changes are needed?

**Confirmed scope (from clarifying questions):** grouped/ungrouped state is **persisted in Supabase** (survives reload + plan clone). All four dimensions in depth: drag-drop & transitions, constraint/validation interplay, UI affordances, and naming vs. the existing "grouping" concept.

## Summary

Three findings shape the whole design:

1. **A "slot" has no row today — it is the implicit coordinate `(plan_id, cohort, day, period)`.** Multiple `placements` rows legally share one cell, with **no binding between them**. The DB unique key is per-*course* in a cell (`placements_unique (plan_id, cohort, day, period, course_id)`), and the collision/UI layers already bucket placements by `cellKey(day, period)`. This is the natural seam the feature plugs into.

2. **"Grouping" is already taken — by a different concept.** `course_groupings` is a *catalog-derived suggestion engine*: it enumerates compatible course-combos per `(plan, cohort)`, shows them as palette "hint boxes" (`PlannerGrouping`), and lets you drag one onto the grid (`GroupDrag`, `kind: "grouping"`). Dropping it **fans out into N independent placements with no shared identity** — exactly the gap this feature fills. The new feature must use a **distinct name** for its domain types/DB objects (recommendation below) to avoid colliding with this machinery.

3. **Grouping is purely an interaction/persistence concern — it does NOT change constraint semantics.** A group move is the set-union of N independent placement moves; the pure, per-cell constraint core produces the correct verdict from the *resulting* occupant set regardless of how courses arrived. The only validation-side care needed is to apply the multi-placement optimistic state change in **one** `setPlacements` update (mirroring the existing `addManyOptimistic`/`settleMany` batch) so the board never renders transient mid-move collision flicker. The <200 ms budget is structurally untouched.

The work splits into: a small persisted **slot-bundle marker** (table + two single-row Astro Actions + a clone-RPC edit), **batch move/remove transitions** modeled on the existing group fan-out, a new **whole-slot drag kind + overlay**, and **SlotCell UI** (a per-slot action menu via the existing `dropdown-menu` primitive, a grouped bounding-ring visual, and disabling per-chip drag/remove while grouped).

## Key Design Decisions (with recommendations)

These three forks change the shape of the implementation. Decide them before planning.

### Decision 1 — Naming (avoid the `grouping` collision)  ✅ RESOLVED → `slotBundle`

**Resolved 2026-06-13: use `slotBundle` / `slot_bundles` / `kind:"bundle"` for all domain/DB identifiers; UI labels stay "Group slot" / "Ungroup slot".** Chosen for zero overlap with any existing "group"/"grouping" usage (including the already-ambiguous `addGroup`/`dropGroup` palette path). The analysis that led here is retained below.



The stem `grouping`/`Grouping` is saturated: `course_groupings` / `course_grouping_members` (DB), `PlannerGrouping` / `GroupingVariant` / `GroupingResult` / `GroupingCourse` (types), `computeGroupings` / `persistGroupings` / `isGroupingStale` (fns), `GroupingBox` / `GroupingFilter` / `ComputeGroupingsEmptyState` (UI), and `GroupDrag` with `kind: "grouping"`. Separately, the placement fan-out path already uses the **bare** stem "group": `addGroup` / `dropGroup` / `persistAddGroup` / `groupFailureMessage` all mean "drop a *palette grouping* and fan it out." And `course.group_index` is the unrelated **IB subject group**.

Two clean candidates are currently unused across `src/` + `supabase/`:

- **`slotGroup` / `slot_groups` / `kind: "slotGroup"`** — matches the user's and the UI's vocabulary ("Group slot" / "Ungroup slot") and reuses the codebase's established "slot" term for a cell (`SlotCell`, `slot-labels.ts`, `cellKey`). Risk: sits near `course_groupings` and overloads the already-ambiguous `addGroup` palette path.
- **`slotBundle` / `slot_bundles` / `kind: "bundle"`** — zero collision with any existing "group" usage; greps cleanly; reads as "a set tied together." Risk: an internal-vs-UI translation layer (code says `bundle`, UI says "Group").

**Recommendation: `slotGroup` for domain/DB identifiers, with UI labels "Group slot" / "Ungroup slot".** It keeps code and user vocabulary aligned and leans on the existing "slot = cell" convention; the `slot` qualifier disambiguates from `course_groupings`/`PlannerGrouping` (which are consistently the gerund "grouping"). **Do not reuse or extend `addGroup`/`dropGroup`/`persistAddGroup`** for the new path — author fresh `*Slot*`-named transitions so the palette fan-out and the slot-group move/remove stay distinct. `slotBundle` is the safe fallback if the team prefers a stem with no overlap at all.

### Decision 2 — Grouped-by-default (opt-out) vs. explicit-group (opt-in)  ✅ RESOLVED → opt-out

The request says courses are **"automatically grouped … with an option to ungroup."** That implies **grouped is the default** for any multi-occupant slot, and ungroup is an explicit, persisted *opt-out*. (The sub-agents initially modeled the inverse — "grouped iff a marker row exists" — which is opt-in.) The distinction matters because it flips what the marker row *means*:

- **Opt-out (recommended, matches the wording):** `isGrouped(cell) = occupants(cell).length >= 2 && !hasUngroupOverride(cell)`. The persisted row records an **ungrouped exception**. Most multi-course slots are grouped with **no row**; only deliberately-ungrouped slots cost a row. A clone re-groups everything by default except the source's explicit exceptions.
- **Opt-in:** `isGrouped(cell) = hasGroupMarker(cell)`. The persisted row records a **group**. Slots are independent chips until the planner explicitly groups them. This contradicts "automatically grouped."

**Recommendation: opt-out / grouped-by-default**, persisting ungroup overrides. Grouping is only meaningful for `occupants >= 2`; a single-occupant slot is never "grouped." Either way the table shape is identical (a coordinate-keyed marker) — only the presence/absence semantics flip — so this can be confirmed late, but it drives the UI copy ("Ungroup slot" is the primary action) and the default a freshly-dropped multi-course slot exhibits.

### Decision 3 — Persistence model: marker table vs. column on placements  ✅ RESOLVED → marker table (`slot_bundles`)

- **(a) Coordinate-keyed marker table** `slot_bundles (plan_id, cohort, day, period, …)`, placements untouched.
- **(b) `slot_group_id uuid` column on `placements`**, pointing each row at a group parent.

**Recommendation: (a), the coordinate-keyed table.** The codebase already treats `(plan_id, cohort, day, period)` as the slot's identity everywhere (the unique key, `cellKey` collision bucketing, per-cell rendering in `load.ts`), and the feature is inherently **per-cell** ("*all* placements in a slot"), not per-placement. Option (a):
- honors the **resolved prior decision** that placement rows carry *no grouping identity* (`group-dragging/research.md:94`) — placements stay grouping-agnostic;
- leaves the validated <200 ms placement hot-path (`insertPlacement` idempotency) untouched;
- **clones trivially** — a coordinate copy (`insert … select`) with no UUID remap, vs. (b) which needs a new `_slot_group_map` temp table in `clone_plan`.

Option (b) only earns its complexity if you need *partial-slot* groups (a subset of a cell's courses bound together) — which the request explicitly does not ask for ("all placements in a given slot").

## Detailed Findings

### Data model: what a "slot" and a "placement" are

A **placement** is one placed course-hour: `{ id, courseId, day, period }`, with `LocalPlacement` adding an optimistic `pending?` flag ([placement.ts:2-14](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/model/placement.ts#L2-L14)). A **slot** is the implicit `(plan, cohort, day, period)` cell — there is no slot entity. Multiple placements share a cell; uniqueness is per-course: `placements_unique unique (plan_id, cohort, day, period, course_id)` ([20260611180006_plans_as_domain_root.sql:98-99](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/supabase/migrations/20260611180006_plans_as_domain_root.sql#L98-L99)).

The canonical "placements in a cell" derivation is `bucketByCell`, keyed by `cellKey(day, period)` = `"${day}:${period}"` ([collisions.ts:7,46-60](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/model/collisions.ts#L46-L60)); the grid slices placements into per-cell `occupants` for each `SlotCell` ([PlannerGrid.tsx:123-133](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/ui/PlannerGrid.tsx#L123-L133)). The board is single-cohort: `BOARD_COHORT = "dp1"` ([load.ts:15](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/api/load.ts#L15)).

### Drag-drop & transitions (add / move / remove)

dnd-kit's `DragDropProvider` is mounted once in `PlannerBoard`, with `onDragEnd={handleDrop}` ([PlannerBoard.tsx:52-71,93](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/ui/PlannerBoard.tsx#L52-L71)). `handleDrop` reads `source.data` (a `DragData`) + `target.data` (a `CellData`) and switches on `data.kind` — `course → addCourse`, `placement → movePlacement`, `grouping → dropGroup`. **Removal is only via the chip "×"** (drop-outside is a no-op).

The three drag payloads ([drag.ts:6-9](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/model/drag.ts#L6-L9)):
```ts
type CourseDrag    = { kind: "course"; courseId: string };
type PlacementDrag = { kind: "placement"; placementId: string; courseId: string };
type GroupDrag     = { kind: "grouping"; groupingId: string };
```

Optimistic flow is owned by `usePlacements` ([use-placements.ts](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/model/use-placements.ts)) over pure, immutable transitions in `placement-transitions.ts`:
- **Add** (`persistAdd`, use-placements.ts:63-76): `canAdd` guard → mint `crypto.randomUUID()` tempId → `addOptimistic` (pending) → `createPlacement` → `addReconcile` (swap temp→server id) / `addRollback`.
- **Move** (`persistMove`, use-placements.ts:120-145): modeled as **POST-new → DELETE-old** (no UPDATE). `moveIntent` guard rejects `not-found` / `pending` / `same-cell` / `occupied` ([placement-transitions.ts:88-99](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/model/placement-transitions.ts#L88-L99)); a failed old-cell delete is a soft error, not a rollback.
- **Remove** (`persistRemove`, use-placements.ts:147-160): `removeTarget` guard (rejects `not-found` / `pending`) → `removeOptimistic` (filter out) → `deletePlacement` / `removeRollback`.

The `pending` flag gates move/remove in both the pure guards and the UI (chip `useDraggable({ disabled: placement.pending })`, remove button `disabled={placement.pending}`). Async paths re-read live state via a `placementsRef` (`useLatest`) to avoid stale closures.

**Existing GroupDrag fan-out is the template for batch ops.** Dropping a palette grouping resolves `groupingId → memberIds` then `persistAddGroup` does "Option A: N parallel idempotent single inserts" ([use-placements.ts:81-118](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/model/use-placements.ts#L81-L118)): `eligibleMembers` filters members already in the target, `addManyOptimistic` appends **all** pending rows in **one** state update, `Promise.all` of per-member `createPlacement`, then `settleMany` reconciles successes / drops failures in **one** pass. Per-member failure is tolerated and surfaced as `groupFailure`. This single-state-update batch shape is exactly what a bundle **move** and **remove** should reuse.

### Constraint / validation interplay

The constraint system is a registry of self-contained **per-cell** rules: `CELL_CONSTRAINTS = [duplicateCourse, teacherConflict, studentConflict]` ([constraints/index.ts:8](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/model/constraints/index.ts#L8)). Each implements `explain(occupants, ctx) → CollisionViolation[]` (verbose, enumerates all violations) and an optional `test(course, others) → boolean` (cheap pairwise fast path). Input is `GroupingCourse[]` (`{ id, teacherKey, studentKeys, hours }`); output carries **opaque ids only** (names resolved at the render edge).

Three layers, often confused:
- **`constraints/*`** — the rules themselves (duplicate / teacher / student), single-cell scope.
- **`collision.ts`** — a one-line adapter `hasIntersection` → `violatesAny`, the **cheap boolean** the offline grouping enumerator depends on (where the verbose path must never run).
- **`collisions.ts`** — the **board-wide derivation** `deriveCellViolations(placements, catalogById)` → `Map<cellKey, CellCollisions>` (`{ conflictingIds, violations }`), only for cells with ≥2 occupants.

Validation is a **full reactive recompute over all placements**, client-side, never incremental: `useCollisions = useMemo(() => deriveCellViolations(placements, catalogById), [placements, catalogById])` ([PlannerBoard.tsx:139-141](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/ui/PlannerBoard.tsx#L139-L141)). Any change to `placements` re-derives the whole board. There is **no explicit 200 ms timer** — the budget is met structurally (pure, in-memory, O(cells × occupants²) over tiny N, no network on the path).

**Verdict on grouping's effect:** none, semantically. Constraints have zero notion of grouping; only the resulting per-cell occupant set matters. A bundle move = the set-union of N placement moves. The single real care: build the moved set in **one** `setPlacements` (like `addManyOptimistic`) so the board derives only the initial and final states — never transient mid-move states that could briefly flag a phantom duplicate (one row at origin + one already created at target). The one concrete extension point is the **drag-time hint preview**: `DragHintContext.excludePlacementId` is singular ([drop-hints.ts](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/model/drop-hints.ts)); a whole-slot drag must exclude **all** dragged placements, so this needs a multi-exclude variant. `classifyCell`'s `free`/`partial`/`blocked` rollup already supports N dragged `members` (that's how palette groupings preview), so it works for a slot drag unchanged otherwise.

### UI affordances

Component tree: `PlannerBoard` → `PlannerGrid` → `PeriodRow` → `SlotCell` → `PlacedChip`. **There is no `src/components/ui/`** — shadcn primitives live in `src/shared/ui/` (`button`, `badge`, `dialog`, `alert-dialog`, **`dropdown-menu`**, `popover`, `tabs`, …). **No `context-menu`, `tooltip`, or `hover-card` primitive exists.**

`SlotCell` is a single droppable `flex flex-col gap-1` of chips, keyed by `cellKey(day, period)` ([SlotCell.tsx:37-87](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/ui/SlotCell.tsx#L37-L87)). Each `PlacedChip` is a per-placement `useDraggable` (`disabled: placement.pending`) carrying the course name, an optional conflict `Badge` (opens the collision dialog), and a remove "×" `Button` (`onRemove(placement.id)`, `stopPropagation` on click + pointerdown). Every Tailwind ring writes the same custom property, so collision (`ring-destructive`) and drop-target (`ring-ring ring-2`) rings are mutually gated; hint classes come from `HINT_CLASS[hintMode][hintState]`.

**Recommended group/ungroup UI:**
- **Per-slot action menu via the existing `dropdown-menu` primitive** (already detokenized: `bg-popover`, `focus:bg-accent`, `data-[variant=destructive]:text-destructive`). Add a thin **header row inside `SlotCell`, rendered only when `occupants.length >= 2`**: a `flex items-center justify-between` strip with a grouped indicator (a `Link`/`Lock` lucide icon, `text-muted-foreground`) on the left and a ghost icon `Button` (`MoreHorizontal`) as the `DropdownMenuTrigger` on the right. Menu items: a **"Ungroup slot" / "Group slot"** toggle (a `DropdownMenuCheckboxItem` reads well) and, when grouped, a destructive **"Remove all"** (`DropdownMenuItem variant="destructive"`). Rationale: `context-menu` doesn't exist, cells are narrow (`min-w-[7rem]`), and a 1–2 action menu is a textbook dropdown.
- **The header doubles as the whole-slot drag handle** (`handleRef`), exactly as `GroupingBox`'s header is its `handleRef`.
- **Grouped visual:** a bounding treatment on the `SlotCell` root using tokens only — `ring-ring ring-1 ring-inset rounded-md` + a subtle `bg-accent/40` tint — **gated off when `hasCollision || isDropTarget`** so those rings still win (same pattern as the hint-class gating).
- **While grouped:** disable the per-chip `useDraggable` (extend `disabled: placement.pending` to `|| grouped`), hide/disable the per-chip remove "×", and drop `cursor-grab` from chips. Pass a `grouped` flag from `SlotCell` down to `PlacedChip`. (The read-only conflict-inspect badge can stay.)

**Hook placement:** `PlannerBoard` already composes one hook per independent flow (`usePlacements`, `useCatalogById`, `useCollisions`, `useDragHints`, `useHintMode`, `useCollisionInspection`, `useHours`). Add a **`useSlotBundles`** sibling hook consumed at the top, with pure logic in a new `model/slot-bundles.ts` (guards/transitions: "is a cell grouped", "toggle a cell", "is a slot eligible to group" = `>= 2` occupants). Because grouped-state is **persisted** (Decision 3), `useSlotBundles` should mirror `usePlacements` — optimistic state + an API client + pure transitions, seeded from `PlannerBoardProps` — **not** the `localStorage`/`useSyncExternalStore` shape of `useHintMode` (that's the precedent for per-device cosmetics like drag-hint mode, which is explicitly *not* what this is).

### Persistence & migrations

Current `placements` shape ([20260602185012_minimal_domain_schema.sql:115-128](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/supabase/migrations/20260602185012_minimal_domain_schema.sql#L115-L128), re-keyed at [20260611180006:91-103](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/supabase/migrations/20260611180006_plans_as_domain_root.sql#L91-L103)): `id`, `plan_id` (FK → plans, cascade), `cohort` (enum `'dp1'|'dp2'`), `course_id` (composite FK `(plan_id, course_id)` → courses), `day` / `period` smallint, `created_at`; unique `(plan_id, cohort, day, period, course_id)`; DB CHECKs `day between 1 and 7`, `period between 1 and 12` (never dropped). App-side grid bounds are validated separately in Zod via `GRID_BOUNDS = { maxDays: 7, maxPeriods: 12 }` ([grid.ts:10](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/src/_pages/plan-detail/model/grid.ts#L10)) consumed by `createPlacementInput`.

**Recommended migration sketch (Option a, opt-out semantics):**
```sql
create table slot_bundles (
  id      uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  cohort  cohort not null,
  day     smallint not null,
  period  smallint not null,
  created_at timestamptz not null default now(),
  constraint slot_bundles_unique unique (plan_id, cohort, day, period),
  constraint slot_bundles_day_range    check (day between 1 and 7),
  constraint slot_bundles_period_range check (period between 1 and 12)
);
alter table slot_bundles enable row level security;
create policy "Authenticated users have full access" on slot_bundles
  for all to authenticated using (true) with check (true);
```
If Decision 2 is **opt-out**, a row means "this cell is **ungrouped**" (the exception); if **opt-in**, a row means "this cell is **grouped**." Same DDL, inverted read in `model/slot-bundles.ts`. (Consider an explicit `grouped boolean not null` column if you want the row to self-document which semantics it carries.)

**Clone is a mandatory edit site.** `clone_plan` ([20260611180100_clone_plan_fn.sql](https://github.com/dobrek/ib-timetable-planner/blob/83783a5379d5628963c352da8d78ec77204f5499/supabase/migrations/20260611180100_clone_plan_fn.sql)) is `SECURITY INVOKER`, atomic, and remaps UUIDs in topological order via temp map tables. Placements are cloned by remapping only `course_id` (placement `id` defaults fresh; `day`/`period`/`cohort` copied verbatim — slot coordinates preserved). Because Option (a) is coordinate-keyed with no UUID members, cloning slot bundles is one extra `insert … select` with `v_new_plan_id` and the same `cohort/day/period` — **no temp map needed**:
```sql
insert into public.slot_bundles (plan_id, cohort, day, period)
select v_new_plan_id, sg.cohort, sg.day, sg.period
  from public.slot_bundles sg
 where sg.plan_id = p_source_plan_id;
```

**Mutation pattern:** placement mutations are **single-row Astro Actions**, not batch/RPC — `createPlacement` / `deletePlacement` (`defineDomainAction` → framework-free domain fns in `placements.ts`, registered in `src/actions/index.ts`, called via `placement-client.ts`). `insertPlacement` is idempotent on `placements_unique`. Per lessons.md, **all app-data mutations go through Astro Actions**. For Option (a) the bundle writes are **single-row** (insert/delete one `slot_bundles` row), so a new action pair — `unbundleSlot` (insert override) / `bundleSlot` (delete override) with Zod input `{ planId, cohort, day, period }`, domain fns in a new `api/slot-bundles.ts` — suffices; **no RPC required**. An RPC is only warranted if the *whole-slot placement move/remove* must be atomic (all-or-nothing); the existing precedent for atomicity is `replace_cohort_groupings` / `clone_plan` (both `SECURITY INVOKER`, called via `supabase.rpc`). The pragmatic default — matching the resolved "Option A" group-drop decision — is to keep the placement move/remove a **client-side batch** (`Promise.all` of single-row actions in one optimistic state update) and tolerate partial failure with a surfaced error.

## Code References

- `src/_pages/plan-detail/model/placement.ts:2-14` — `PlannerPlacement` / `LocalPlacement` (+ `pending`); `occupiesCell`.
- `src/_pages/plan-detail/model/placement-transitions.ts` — pure add/move/remove + **batch** (`eligibleMembers`, `addManyOptimistic`, `settleMany`) transitions; the template for bundle batch ops.
- `src/_pages/plan-detail/model/use-placements.ts:81-160` — optimistic orchestration; `persistAddGroup` (Option A fan-out), `persistMove` (POST-new→DELETE-old), `persistRemove`.
- `src/_pages/plan-detail/model/drag.ts:6-9` — `DragData` union; add a `kind:"bundle"` variant carrying `day`/`period`.
- `src/_pages/plan-detail/model/collisions.ts:7,46-60` — `cellKey`, `bucketByCell`, `deriveCellViolations` (per-cell, recompute-from-scratch).
- `src/_pages/plan-detail/model/constraints/{index,types,duplicate-course,teacher-conflict,student-conflict}.ts` — the per-cell rule registry; **no change needed**.
- `src/_pages/plan-detail/model/drop-hints.ts` — `DragHintContext.excludePlacementId` is singular; needs a multi-exclude variant for whole-slot drags.
- `src/_pages/plan-detail/model/grid.ts:10` — `GRID_BOUNDS` (app-side day/period validation).
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:52-71,93,139-201` — DndContext, `handleDrop` switch, the hook stack to extend with `useSlotBundles`.
- `src/_pages/plan-detail/ui/SlotCell.tsx:37-162` — cell droppable + per-chip draggable/remove; the locus of the slot header, action menu, grouped ring, and grouped-disabled chips.
- `src/_pages/plan-detail/ui/GroupingBox.tsx`, `ui/GroupDragOverlay.tsx` — the existing whole-group drag precedent to mirror (header `handleRef`; overlay needs a `bundle` branch).
- `src/shared/ui/dropdown-menu.tsx` — the menu primitive to reuse (no new primitive needed).
- `src/_pages/plan-detail/api/{placements,placement-actions,placement-client,persist}.ts`, `src/actions/index.ts` — single-row action pattern + the RPC-call pattern (`persist.ts` → `supabase.rpc`).
- `src/_pages/plan-detail/api/load.ts` — board load (dp1-only); must also load `slot_bundles` and seed `PlannerBoardProps`.
- `supabase/migrations/20260611180006_plans_as_domain_root.sql:91-103` — placements re-key + composite FK; cohort enum at `:28`.
- `supabase/migrations/20260611180100_clone_plan_fn.sql:36-63,108-113` — clone temp-map pattern + placement clone (mandatory edit site).
- `supabase/migrations/20260604141213_replace_cohort_groupings_fn.sql` — `SECURITY INVOKER` RPC precedent for atomic multi-row writes.
- `src/shared/api/database.types.ts:240-284` (placements), `:70-107` (course_groupings) — generated types to regenerate after the migration.

## Architecture Insights

- **The slot is implicit and that's load-bearing.** `(plan, cohort, day, period)` is the slot's identity across the unique key, collision bucketing, and rendering. A coordinate-keyed marker rides this convention with zero new coupling; a per-placement column fights it.
- **Identity is the course, not the group** (a stated principle of the prior group-dragging work). The marker-table model preserves it: placements remain ordinary, individually-addressable rows; "grouped" is a *property of the cell*, computed/persisted beside the placements, not stamped onto them.
- **Batch-as-one-state-update is the established optimistic idiom** (`addManyOptimistic` + `settleMany`). Slot-group move/remove should be new `*Slot*` transitions of the same shape, kept separate from the palette `addGroup` path.
- **Accept-and-flag is a locked PRD decision** — drops always land and flag; hints never block. A grouped move must not introduce blocking; it flags at the destination like any other drop.
- **Constraints stay pure and grouping-agnostic.** Keeping grouping entirely out of the constraint core is what preserves the <200 ms budget and the simple "recompute the whole board from `placements`" model.

## Historical Context (from prior changes)

- `context/changes/group-dragging/research.md:94` & `plan.md:44` — "no grouping identity on placement rows — a deliberate, resolved decision"; "placements stay grouping-agnostic." **Option (a) honors this**; Option (b) would reverse it.
- `context/changes/group-dragging/change.md:16` — group-drop persistence is "**Option A** — N parallel idempotent single inserts… No new RPC. Option B (atomic `create_placements` RPC) stays a documented follow-up." The same Option-A-vs-B trade-off recurs for slot-group move/remove atomicity.
- `context/changes/collision-info/` & `collision-free-slots/` — established the per-cell `Map<cellKey, …>` collision derivation and drop-hint preview the feature reuses; "accept-and-flag is a locked PRD decision; hints never block a drop" (`collision-free-slots/plan-brief.md:23`). The per-device cosmetic toggle there used `localStorage` — **explicitly not** the model for slot-groups, which must persist in Supabase.
- `context/foundation/roadmap.md:22,201` — "grouping is a one-shot computation over the catalog snapshot… validation is an online per-drop function over the current placement state"; "cloning deep-copies the entire scenario — catalog, placements, groupings." Confirms `course_groupings` is a separate, catalog-keyed concept and that clone must deep-copy any new per-plan state.
- The PRD/roadmap contain **no mention of locking, bundling, ungrouping, or moving placements as a unit** — this is genuinely new capability, not an extension of an existing seam.
- `context/foundation/lessons.md:19-23` — "All app-data mutations and compute → Astro Actions"; the thin `requireSession → requireSupabase → runDomain` orchestration the new actions must follow.

## Resolved Decisions

All open questions are resolved (2026-06-13). **Key simplification: a bundle move/remove never writes the `slot_bundles` table.** Under opt-out, that table holds only explicit *unbundle* overrides, and a slot is draggable-as-a-unit only when it is a bundle (≥2 occupants AND no override) — so a dragged source carries no override, emptying it cleans nothing, and the destination's bundled-ness is just *its* occupancy + *its* override, untouched. The table is written **only** by the explicit toggle: "Ungroup slot" inserts an override, "Group slot" deletes it. Bundle move and remove are therefore pure placement operations over the existing optimistic-batch patterns.

1. **Grouped-by-default (opt-out).** A `slot_bundles` row records an *unbundled exception*. `isBundled(cell) = occupants(cell).length >= 2 && !hasOverride(cell)`. Most multi-course slots are bundles with **no row**; only deliberately-ungrouped slots cost a row. A clone re-bundles everything by default except the source's explicit exceptions.
2. **Drop a bundle onto an occupied target → merge.** Accept-and-flag is locked, so the drop always lands. Same-course members already present are skipped via `eligibleMembers`; collisions flag at the destination. **The destination's existing state wins** — no marker write on move, so a target that was explicitly unbundled stays unbundled (its loose chips just gain the incoming courses) and a default target stays a default bundle. (A move never silently re-groups a slot the planner chose to ungroup.)
3. **Placement move/remove persistence → best-effort client batch.** One optimistic `setPlacements`, `Promise.all` of single-row `createPlacement`/`deletePlacement`, settle in one pass — mirroring the resolved Option-A group fan-out. Partial failure is tolerated and surfaced; the board recomputes from `placements` regardless. No atomic RPC unless partial-failure UX later proves confusing.
4. **Cohort scope → cohort-keyed table, dp1-only UI.** `slot_bundles` carries `cohort` (dp2-ready), but every read/write is scoped to `BOARD_COHORT` and only dp1 ships now. No per-cohort UI yet.
5. **Single-occupant & no GC.** `isBundled` already gates on `occupants >= 2`, so a slot dropping to one course is simply not a bundle. Overrides are **not** garbage-collected: an unbundle override is deliberately sticky across occupancy wobble ("stays unbundled until I regroup it"). Max 84 cells/cohort — cruft is negligible; overrides clone verbatim.
6. **Ungroup / remove-all flow.** Ungrouping re-enables per-chip drag + the per-chip "×" and flips the slot menu to "Group slot"; regrouping is the explicit toggle (deletes the override). **"Remove all" does NOT confirm** — it removes the bundle's placements directly, consistent with the per-chip "×" (which also doesn't confirm; there is no global undo, accepted). Re-adding a 2nd course to a default (no-override) slot re-bundles it automatically.

## Related Research

- `context/changes/group-dragging/research.md` — the load-bearing prior art for batch placement and the "no grouping identity on rows" decision.
- `context/changes/collision-info/research.md`, `context/changes/collision-free-slots/research.md` — per-cell collision derivation and drop-hint preview this feature reuses.
- `context/archive/2026-06-05-first-valid-drop-with-validation/{research,plan}.md` — origin of the per-cell reactive validation that meets the <200 ms budget.
