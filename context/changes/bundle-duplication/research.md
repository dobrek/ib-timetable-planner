---
date: 2026-06-25T19:09:42+0200
researcher: Dobromir Kropielnicki
git_commit: 2c8b05acbd5934fad1e9d972c0aaf5a59a718446
branch: main
repository: dobrek/ib-timetable-planner
topic: "Feasibility of a 'duplicate a placed bundle into the next conflict-free empty slot' feature"
tags: [research, codebase, plan-detail, bundles, placements, drop-hints, constraints]
status: complete
last_updated: 2026-06-25
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Resolved all 7 open questions into locked design decisions"
---

# Research: Duplicate a placed bundle into the next conflict-free empty slot

**Date**: 2026-06-25T19:09:42+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 2c8b05acbd5934fad1e9d972c0aaf5a59a718446
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Assess the feasibility of a feature to **duplicate a bundle**: clicking a button (or other element) on a bundle already placed on the grid takes all the courses in that bundle and places them into the **next empty slot**. What changes does this require from the model and UI perspective? Are there problems?

**Scope locked with the user before research:**
- **Source** = a **placed bundle on the board** (placements sharing a `bundle_id` at one cell), not a palette grouping. The button lives on the placed bundle.
- **Slot pick** = the **first conflict-free empty cell** (the whole bundle places there with no constraint violations) — explicitly weighed against the <200ms placement budget.

## Summary

**Verdict: highly feasible, low-risk, and mostly already solved by existing machinery. No server / DB / RPC / Action / Zod changes are required.** The work is a thin model helper plus a UI affordance, both modeled on the existing `moveBundle` / `removeBundle` whole-slot verbs. "Duplicate" is the missing third whole-slot verb.

Three findings make this easy:

1. **The persistence path already supports it.** Placing a course at an empty cell via the existing `placeCourse` fan-out auto-creates a brand-new, independent bundle (the `place_course` RPC find-or-creates a bundle keyed by `(plan_id, cohort, day, period)`). Re-placing a bundle's member-set at a fresh cell is exactly what `persistAddGroup` already does for a palette-grouping drop. (`use-placements.ts:126`, `place_course_fn.sql`)

2. **The conflict-free search is already computed.** The board already derives per-cell validity for any dragged member-set — including a whole bundle — via `deriveDropHints`, a pure, client-side, memoized function that returns a **sparse map** (absent cell = free). The grid is tiny (≤84 cells/cohort; default 50; no A/B axis multiplying cells), so scanning every empty cell costs **single-digit milliseconds — orders of magnitude under the 200ms budget**. (`drop-hints.ts:87`, `PlannerBoard.tsx:205-234`)

3. **The UI hook point already exists.** A placed multi-course bundle renders a header strip (`SlotCell.tsx:106-137`) that already hosts the group/ungroup toggle and the bulk-remove trash. A "duplicate" button is a sibling of the trash button, wired exactly like `onRemoveBundle`.

**The real design decisions (not blockers)** are: (a) faithfully reproducing the source bundle's per-member A/B week layout — re-resolving weeks at the target can assign A/B to different members, so the duplicate should carry the source weeks explicitly; (b) whether "conflict-free" tolerates the non-blocking `warn` (soft teacher-unavailability) and `opposite-week` hints; (c) **hours over-allocation** — duplicating intrinsically adds an hour per member, and nothing in the system blocks exceeding required hours (it is display-only), so a duplicate of an already-complete bundle will overshoot; (d) scoping the affordance to multi-course *grouped* bundles vs single placements / ungrouped (exploded) cells; (e) graceful behavior when **no** conflict-free empty slot exists.

Notably, the conflict-free-search design **neutralizes** the per-cell teacher/student/cross-cohort conflict risks by construction (it only lands where there are zero violations), so those become non-issues rather than problems to mitigate.

## Detailed Findings

### 1. Domain model — bundle vs grouping vs slot

- A **slot / cell** is `(day, period)`. The grid is `days × periods` **per cohort** (dp1/dp2). Week (A/B) is a per-*placement* attribute, **not** a third grid axis — bi-weekly courses share one cell on opposite weeks. Cell identity is `cellKey(day, period) = "${day}:${period}"` (`cell-key.ts:10`).
- A **bundle** is the set of placements at one cell sharing a `bundle_id` (server column `bundle_id NOT NULL`). Bundles already support whole-slot **move** (`moveBundle`) and **remove** (`removeBundle`) — `use-placements.ts:96-102`. A `PlannerPlacement` carries `bundleId?` (`placement.ts:4-19`).
- A **grouping** (`PlannerGrouping`, `grouping.ts:22-29`) is a palette hint — a deduped member-set you drag onto a cell. Dragging a grouping onto a cell runs `addGroup` → `persistAddGroup` (`use-placements.ts:74-154`). **This is the same fan-out a "duplicate" reuses, just targeted at a computed cell instead of a drop cell.**

### 2. UI hook points — where the "duplicate" button lives

- A placed multi-course bundle grows a **header strip** rendered only when `hasHeader = occupants.length >= 2` (`SlotCell.tsx:72, 106`). The header already contains:
  - the **group/ungroup toggle** (`SlotCell.tsx:108-120`), and
  - the **bulk-remove trash**, rendered only `{bundled && ...}` (`SlotCell.tsx:121-135`).
- **`bundled`** is derived as `isBundled(occupantCount, exploded) = occupantCount >= 2 && !exploded` (`exploded-cells.ts:33-35`, threaded at `PlannerGrid.tsx:146`). So the header/trash appear only for ≥2-occupant cells that are *not* explicitly ungrouped (exploded).
- **Best insertion point:** a new `Button` between the toggle and the trash in the header (`SlotCell.tsx:121`), using the same `variant="ghost" size="icon"` shadcn primitive, a lucide `Copy` icon, semantic theme tokens (`text-muted-foreground hover:bg-accent ...`), and the `stopDrag(...)` wrapper (`drag-inert.ts:10-18`) so the click does not start the whole-cell bundle drag.
- **Wiring** mirrors `onRemoveBundle`: add `onDuplicateBundle: (day, period) => void` to `SlotCell` props (`SlotCell.tsx:36`), thread it `PlannerBoard → PlannerGrid → SlotCell`, and back it with a new `usePlacements` method.
- The whole bundled cell is the drag surface with **no handle**, which auto-excludes interactive `<button>`s from drag activation (`useCellDnd`, `SlotCell.tsx:162-178`) — so a new button behaves like the existing ones for free.
- Reading the source bundle's contents already has a helper: `courseIdsAt(day, period)` (`use-placements.ts:104-105`), the same one `moveBundle`/`removeBundle` use.

### 3. Persistence path — no server changes needed

- Client orchestration `persistAddGroup` (`use-placements.ts:126-154`) fans out **one `placeCourse` per eligible member**, resolves a week per member, applies one optimistic batch (`addManyOptimistic`) and one `settleMany` reconcile; partial failures surface as a `groupFailure` banner.
- `placeCourse` (`placement-client.ts:6-17`) → `actions.placeCourse` → domain `placeCourse` (`placements.ts:77-88`) → `place_course` RPC.
- The **`place_course` RPC** (`supabase/migrations/20260624120004_place_course_fn.sql`, `SECURITY INVOKER`) find-or-creates the cell's bundle via upsert keyed on `(plan_id, cohort, day, period)`, then inserts the placement with that `bundle_id` (idempotent on `placements_unique`). **Placing a member-set at a NEW empty cell hits no conflict → a fresh `bundles` row with a new uuid is minted automatically.** Nothing copies or references the source `bundle_id`, so the duplicate is correctly independent. (`bundles` table: `20260624120000_bundles.sql`; partial unique index `bundles_cell_unique` enforces one placed bundle per cell.)
- The existing integration test `bundle-operations.integration.test.ts:117-130` already proves the exact behavior a duplicate relies on (placing a member-set at a fresh cell forms one new shared bundle; reuse on the same cell shares it).
- **Conclusion:** a duplicate is a client-only `duplicateBundle(srcDay, srcPeriod)` that reads `courseIdsAt(srcDay, srcPeriod)`, computes the target cell, and runs the `persistAddGroup` fan-out there. **No migration, RPC, Action, Zod schema, or `placement-client` change.**
- **Atomicity caveat:** like group-add today, this is N parallel `placeCourse` round-trips, not one transactional RPC. Partial failure yields a `groupFailure` banner. A dedicated `duplicate_bundle` RPC would only be warranted if all-or-nothing atomicity is a hard requirement — functional correctness does not need it.

### 4. The conflict-free next-empty-slot search — the crux, already solved

- **Grid geometry:** `days`/`periods` arrive on `PlannerBoardProps` (`drag.ts:22-23`), sourced from the plan's `slot_grid_preset` (`grid.ts:27`). Presets `5x6`/`5x8`/`5x10` (default `5x10` = 50 cells); hard bound `7×12 = 84 cells/cohort` (`grid-presets.ts`, `grid.ts:10`). **No week dimension multiplies cell count.**
- **Empty test:** a cell `(d,p)` is empty iff `!bucketByCell(placements, catalogById).has(cellKey(d,p))` (`collisions.ts:82`). O(1) per cell.
- **The reusable "what-if":** `deriveDropHints(context, placements, catalogById, availability, occupiedByTeacher)` (`drop-hints.ts:87`) returns a **sparse `Map<cellKey, DropHint>`** where an absent cell (during an active drag) is **free**. `DropHint = "partial" | "blocked" | "warn" | "opposite-week"`. It is pure, mutation-free, runs on the client island, and is already memoized on the board (`PlannerBoard.tsx:222-225`).
- **Building the context for a *copy* (key distinction):** `resolveDragHintContext`'s `bundle` branch (`drop-hints.ts:63-76`) builds `{ members, excludePlacementIds: <all source ids>, origin }` for a bundle *move*. A **duplicate** must instead build `{ members: <bundle's courses> }` with **no `excludePlacementIds` and no `origin`** — the source bundle stays on the board, and the copy is judged against the full current board. This is a one-line variant of the existing resolver.
- **The search:** call `deriveDropHints` once with that context, then scan cells in deterministic order (the grid renders period-outer, day-inner — `PlannerGrid.tsx:60-61`). The target is the first cell that is **empty** (`!buckets.has(key)`) **and** carries **no blocking hint** (per the chosen "conflict-free" definition — see §5).
- **Cost vs 200ms:** there is no runtime timer; the budget is met *structurally*. The constraint core runs synchronously, zero-network, over ≤84 cells with tiny per-cell occupant counts; `deriveDropHints` already does an equivalent full-grid pass on **every drag start** today, within budget. Worst case (all cells empty) is the *cheapest* case (no occupants to compare against). Estimated cost: **single-digit milliseconds**, far under 200ms.

### 5. Constraint / week / hours semantics & the real problems

**Constraint scope** (`constraints/index.ts:10-16` registry: `duplicateCourse, teacherConflict, studentConflict, teacherAvailability, crossCohortTeacher`):

| Constraint | Scope | Week-aware |
|---|---|---|
| `duplicate-course` (`duplicate-course.ts:8`) | **per-cell** | no |
| `teacher-conflict` (`teacher-conflict.ts:17-48`) | per-cell, pairwise | yes |
| `student-conflict` (`student-conflict.ts:10-27`) | per-cell, pairwise | yes |
| `teacher-availability` (`teacher-availability.ts:18-37`) | per-cell (board-only) | no |
| `cross-cohort-teacher` (`cross-cohort-teacher.ts:18-37`) | cell + sibling cohort | yes |

- **There is NO board-wide "a course may be placed only once" rule.** Uniqueness is strictly per-cell (`placements_unique = (plan_id, cohort, day, period, course_id)`). A course legitimately recurs across cells — that's its weekly hours. **So duplicating a bundle into another slot is a semantically valid domain operation, not an inherent violation.**
- Because the search lands only on a conflict-free cell, **teacher/student/cross-cohort conflicts at the target are avoided by construction** (Problems #3–#5 from the constraint-semantics pass become non-issues for this design).

**Problem A — week (A/B) faithfulness (the main correctness nuance).** `resolveDropWeek` (`placement-transitions.ts:19-25`) is cell-local: for bi-weekly members it assigns the first free week at the *target*. Even into an empty cell, re-resolving via `resolveDropWeek` / `oppositeWeekAssignment` (sorted-id alternation) can assign A/B to *different members* than the source bundle had. Agnostic (`both`) members are always fine. **To reproduce the source's exact A/B layout, the duplicate should carry the source per-member `week` explicitly** rather than re-resolve (a small new code path — e.g. a `weekByMember` map passed into the batch fan-out, analogous to `oppositeWeekAssignment`).

**Problem B — hours over-allocation (a semantic/UX decision).** `deriveHours` counts one placement row = one hour (`hours.ts:14-25`); over-allocation is **display-only, never blocked** (`hours.ts:11-12` "not completeness enforcement"; `HoursCounter.tsx`, `PlanSummaryBar.tsx`). Duplicating a bundle adds an hour per member, so duplicating an already-complete bundle pushes it over required hours. Nothing rejects this client- or server-side. **Decide:** allow silently, warn, or block when a member would exceed `required`. (This is the one thing that makes "duplicate" semantically loaded — it's most useful for multi-hour courses still under their requirement.)

**Problem C — "conflict-free" definition.** The hint map distinguishes non-blocking states: `warn` (soft teacher-unavailability — advisory) and `opposite-week` (a *positive* legal share). Decide whether the search treats "conflict-free" as **strictly free** (no hint entry at all) or **no hard block** (tolerate `warn` / `opposite-week`). The data already distinguishes these (`drop-hints.ts:14-17`).

**Problem D — affordance scope.** The header (and thus a header button) appears only for `bundled` cells (`occupants.length >= 2 && !exploded`). Decide: does "duplicate" apply to single-placement cells (no header today) and to ungrouped/exploded multi-course cells? If single placements need it, that requires a separate affordance on `PlacedChip` (`PlacedChip.tsx`).

**Problem E — no slot available.** If every empty cell is blocked (or the grid is full), the action must no-op gracefully with a message, not fail silently. Also gate on the source bundle having no `pending` rows (mirror the pending guards in `moveBundle`/`removeBundle`).

**Problem F — companion-state drift (low, self-healing).** Companion-course reconciliation (`reconcile-companion.ts`) fires on leading-course change, not on placement. An open companion dropdown could show stale options after a duplicate until re-render. UX brittleness, not data risk.

## Code References

- `src/_pages/plan-detail/model/use-placements.ts:74-154` — `addGroup`/`persistAddGroup` fan-out to reuse; `:96-105` — `moveBundle`/`removeBundle`/`courseIdsAt` templates for `duplicateBundle`.
- `src/_pages/plan-detail/model/drop-hints.ts:87` — `deriveDropHints` (the reusable conflict-free what-if); `:63-76` — bundle context resolver (adapt: drop exclude/origin for a copy); `:14-17` — hint precedence/semantics.
- `src/_pages/plan-detail/model/collisions.ts:82` — `bucketByCell` (empty-cell test); `:37` — `deriveCellViolations`.
- `src/_pages/plan-detail/model/cell-key.ts:10` — `cellKey`; `exploded-cells.ts:33-35` — `isBundled`.
- `src/_pages/plan-detail/model/placement-transitions.ts:19-33` — `resolveDropWeek` / `oppositeWeekAssignment` (week-faithfulness decision).
- `src/_pages/plan-detail/model/hours.ts:11-25` — hours derivation (over-allocation is display-only).
- `src/_pages/plan-detail/model/constraints/{index,duplicate-course,teacher-conflict,student-conflict,teacher-availability,cross-cohort-teacher}.ts` — constraint registry & scopes (all per-cell / cross-cohort; no board-wide uniqueness).
- `src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx:106-135` — bundle header; insertion point for the duplicate button (sibling of `:121-135` trash).
- `src/_pages/plan-detail/ui/slot-cell/drag-inert.ts:10-18` — `stopDrag` wrapper; `PlannerGrid.tsx:146` / `PlannerBoard.tsx:149-164` — handler threading.
- `src/_pages/plan-detail/api/placement-client.ts:6-17` — `placeCourse`; `api/placements.ts:77-88` — domain `placeCourse`.
- `supabase/migrations/20260624120000_bundles.sql`, `20260624120001_placements_bundle_id.sql`, `20260624120004_place_course_fn.sql` — bundle table, FK, find-or-create RPC (keyed by cell).
- `src/_pages/plan-detail/api/bundle-operations.integration.test.ts:117-130` — proves find-or-create at a fresh cell mints an independent bundle.
- `src/shared/lib/grid/grid.ts`, `src/shared/config/grid-presets.ts` — geometry (≤84 cells/cohort, no week axis).

## Architecture Insights

- **"Duplicate" is the missing third whole-slot verb** alongside `moveBundle`/`removeBundle`. It fits the existing orchestration pattern: a thin `usePlacements` method over pure transitions, dispatched from a header button. This matches the project's "orchestration over patching" preference — add it as a first-class verb, not an inline special case.
- **The drop-hint engine is a reusable validity oracle**, not just a drag-decoration. The same sparse-map "what-if" that paints cells during a drag answers "where can this member-set legally land?" for a click-driven search. Reusing it keeps a single source of truth for placement validity and inherits the <200ms guarantees.
- **Bundle identity is cell-derived server-side**, never client-tracked for writes — so a copy is automatically a distinct bundle with no special handling.
- **Hours are intentionally advisory** (finalize gate deferred), so any "block on overshoot" behavior for duplicate would be a *new* policy, not enforcement of an existing one.

## Historical Context (from prior changes)

- `context/archive/2026-06-23-first-class-bundle-operations/` — introduced the bundle as a first-class concept and the whole-slot move/remove verbs, the `place_course`/`move_bundle_members`/`remove_bundle_members` RPCs, and the find-or-create-by-cell semantics this feature builds on. Its research notes confirm "no timer/benchmark/perf test exists; only comments" for the <200ms budget (`research.md:78`) — the budget is structural, which is why the small-N synchronous search is safe.
- The `companion-course` change (recent commits) added the companion select/stale-reset flow referenced in Problem F.

## Related Research

- None prior for this change. Closest sibling: `context/archive/2026-06-23-first-class-bundle-operations/research.md`.

## Resolved Decisions

All seven open questions were resolved with the user on 2026-06-25. These are the locked assumptions the plan should build on. **Net effect: still no server / DB / RPC / Action / Zod changes — the feature stays entirely client-side.**

1. **Week faithfulness → copy source weeks exactly.** The duplicate reproduces each source member's `week` (`a`/`b`/`both`) verbatim, so the A/B lane layout is mirrored. Implementation: read each source placement's `week` and pass an explicit per-member week map into the batch fan-out — do **not** call `resolveDropWeek` for duplicated members. A small new path analogous to `oppositeWeekAssignment` but sourced from the existing rows. (Targeting a chosen empty cell means the copied weeks land cleanly.)

2. **Hours overshoot → allow, no special handling.** Duplicating may push a course over `required` hours; that is permitted, consistent with the advisory hours model. No new gate client- or server-side; `HoursCounter` already reflects the over-allocation.

3. **"Conflict-free" → two-tier (strictly free, else non-blocking).** The scan tracks (a) the first **strictly-free** empty cell (no hint entry at all) and (b) the first **non-blocking** empty cell (hint ∈ {`warn`, `opposite-week`}, never `blocked`/`partial`). Prefer (a); fall back to (b); only if neither exists is it "no slot." Reuse the sparse `deriveDropHints` map for the verdict.

4. **Scan order → column-major, anchored *after the source*, wrapping.** _(Refined during `/10x-plan`: the original "from day 1, period 1" framing was changed so a duplicate never jumps back to the start of the week.)_ Column-major direction (down the source's day, then the next day), but the scan **starts at the cell right after the source** and wraps around the grid, so the first qualifying empty cell *after* the bundle wins. The copy lands at the next free period below the source (then the next day); it only wraps to an earlier cell when every cell after the source is full. The grid renders row-major, but the search is column-major by intent — "next free period in this day, then the next day, starting below where I clicked."

5. **Affordance scope → single placements AND grouped bundles, via two distinct surfaces.**
   - **Grouped multi-course bundle** (`occupants.length >= 2 && bundled`): duplicate button in the existing bundle header, sibling of the trash (`SlotCell.tsx:121`).
   - **Single-occupant cell** (`occupants.length === 1`): a **separate UI element rendered by `SlotCell` beside/above the chip** — a hard constraint is **not** to extend `PlacedChip` (no new `PlacedChip` prop); the control is a sibling element in the cell, likely hover-revealed.
   - **Out of scope / planning detail:** ungrouped (exploded) multi-course cells as a *unit*. Each loose chip in an exploded cell is effectively a single placement; whether the per-chip sibling control also appears there (one per loose chip) is a minor UX detail to settle in `/10x-plan`.

6. **No-slot-available → reuse the existing error banner.** Compute on click; when nothing qualifies, surface a message (e.g. "No empty slot available to duplicate into") via the existing `setError` / `ErrorBanner` path. This fits the existing `PlacementError` `{ kind: "message" }` shape — no new error type.

7. **Atomicity → reuse the per-member fan-out.** One `placeCourse` per member (same as a grouping drop today); partial failures surface as the existing `groupFailure` banner. No transactional `duplicate_bundle` RPC, no migration.

### Implementation shape implied by the decisions

- **Model:** a new `usePlacements` verb, e.g. `duplicateBundle(day, period)` (and a single-placement entry that resolves to the same primitive), which: reads the source rows at `(day, period)` (`courseIdsAt` + their `week`s), builds a copy `DragHintContext` (`{ members }`, no `excludePlacementIds`/`origin`), runs `deriveDropHints` once, scans **column-major starting after the source (wrapping the grid)** with the **two-tier** rule for the target cell, then dispatches the **week-preserving** batch fan-out there; on no target, `setError({ kind: "message", … })`.
- **UI:** a `Copy`-icon button in the bundle header (sibling of trash) for grouped bundles, and a **separate sibling control in `SlotCell`** (not in `PlacedChip`) for single-occupant cells. Both wired through `PlannerBoard → PlannerGrid → SlotCell` like `onRemoveBundle`, using `stopDrag(...)`.
- **Server/DB:** none.
