---
date: 2026-06-26T09:59:52+0200
researcher: Dobromir Kropielnicki
git_commit: 72c97cfdb18b82b77787a980661f4fd71d6f7264
branch: main
repository: dobrek/ib-timetable-planner
topic: "Feasibility of S-07 (bundle holding container): UX options, domain-model impact, and not blocking S-06 / S-08"
tags: [research, codebase, plan-detail, bundles, holding-container, dnd-kit, S-07, S-06, S-08]
status: complete
last_updated: 2026-06-26
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Revised domain model to a separate shelf-table design (shelf_bundles + shelf_bundle_courses; fresh ids; snapshot-based undo) after author discussion; plus the UX edge-drawer disclosure decision."
---

# Research: S-07 Bundle Holding Container — feasibility, UX options, domain impact, neighbour-slice safety

**Date**: 2026-06-26T09:59:52+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 72c97cfdb18b82b77787a980661f4fd71d6f7264
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Research the feasibility of implementing **S-07 (bundle holding container)** from the roadmap, especially:

1. **UX options** — what interaction-design options do we have for the holding container (lead lens, per scope decision).
2. **Domain-model impact** — how the change touches our schema / RPC / model.
3. **Don't block upcoming features** — how to implement S-07 so it doesn't block **S-08** (editing undo/redo) or **S-06** (combined two-cohort view).

**Scope decisions (confirmed with author):** lead with **UX / interaction design**; **server-side durability** in Supabase (not localStorage as source of truth) — realized, after the design discussion recorded in §B/§D, as a **dedicated shelf table**, *not* a `holding` state reusing the `bundles` row.

## Summary

**S-07 is feasible and largely de-risked — but it is _not_ "zero-schema additive," contrary to the headline promise carried over from the S-05 plan.** Two things are true at once:

- ✅ **The hard parts are done.** S-05 (`first-class-bundle-operations`) deliberately pre-shaped the `bundles` row for parking: it has a `status text` column with a `check (status in ('placed','holding'))`, **nullable `(day, period)`**, and a **partial unique index** `where day is not null` so multiple parked (null-coord) bundles coexist. The board is already fully **cohort-parameterized** (the `BOARD_COHORT="dp1"` hardcode the roadmap baseline cites is gone — S-04 removed it), and `bundles.cohort` is `not null` and immutable, so cohort-scoping a parked bundle is free. The UI is one island-wide `<DragDropProvider>` with a single `data.kind`-dispatched drop handler, so a shelf is **additive** to the drag wiring.
- 🔴 **One real gap blocks the naive design.** **Bundle membership lives _only_ in `placements`. There is no `bundle_members` table.** The `bundles` row stores identity + coords + status, never its course set — membership is reconstructed at RPC time from the placements co-located at the bundle's cell. So the obvious "park = flip status to `holding`, null the coords, delete the placements, keep the bundle row" mechanic **destroys the parked bundle's contents** — you'd resurrect an empty husk after refresh. `status='holding'` is representable in the schema but is **written nowhere** in code today; reaching it durably requires a place to keep membership once the placements are gone.

**Net feasibility verdict:** S-07 is a **medium slice**, not a trivial one. Its real delta is **a durable home for a parked bundle's course set, separate from `placements`**. After a design discussion with the author (recorded in §B/§D), the chosen model is a **dedicated, purpose-named shelf-table pair — `shelf_bundles` + `shelf_bundle_courses`** — that is the parked bundle's whole representation. Park **tears down** the board representation (placements + the now-empty `bundles` row) and **builds** a shelf one; place-back does the reverse by **reusing the existing `place_course` find-or-create** (minting a fresh `bundles` id — identity is deliberately *not* carried across the park boundary). Plus **two atomic `security invoker` RPCs** (`shelve_bundle` / `unshelve_bundle`), a **`load.ts` read**, a **`clone_plan` block**, and the **shelf UI**. None of it touches the constraint core, the <200 ms budget, or the S-05 board write path (`place_course` / `move_bundle_members` / `remove_bundle_members` stay untouched) — a parked bundle has no placements, so it doesn't participate in validation; drop-back re-validates for free via the existing accept-and-flag recompute.

**On UX (lead):** recommended interaction shape is a **bottom tray** under the grid + **a "lift to shelf" button on the bundle (plus optional drag-to-shelf)** + **drag-the-parked-card-back-onto-a-slot** + **a neutral, flag-free parked card reusing the `GroupingBox` shell**. This combination has the lowest layout risk and generalizes cleanly to the S-06 two-column view (one shared, cohort-tagged tray).

**On neighbours:** S-07 keeps **S-06** additive by scoping the shelf to `cohort` (never to a single global "active cohort"); it keeps **S-08** additive by making `shelve_bundle` / `unshelve_bundle` **single atomic RPCs** (one user action = one reversible undo entry). Undo is **snapshot/command-based**, so it does **not** need a stable bundle id across the park boundary — fresh ids are fine (see §G; this revises the S-05 archive's "stable id for undo" guidance as over-cautious for our case). No in-flight change collides.

## Detailed Findings

### A. What S-05 actually pre-built (domain readiness) — verified, not assumed

The `bundles` entity and its RPCs landed across migrations `20260624120000`–`20260624120007`. Verified against the real DDL/code (not the plan):

- **`bundles` table** (`supabase/migrations/20260624120000_bundles.sql:17-51`):
  - `status text not null default 'placed'` with `constraint bundles_status_check check (status in ('placed','holding'))` — **`'holding'` is an allowed value already.** (It's a `text`+CHECK, not a PG enum; generated type is `status: string`.)
  - `day smallint` / `period smallint` — **nullable**, range checks gated on `is null or …`. A parked bundle holds no slot.
  - `create unique index bundles_cell_unique on bundles (plan_id, cohort, day, period) where day is not null` — **exactly one _placed_ bundle per cell; parked (null-coord) bundles are exempt and can coexist.**
  - RLS on, `for all to authenticated`, explicit `revoke … from anon` (per the grant lesson).
- **`placements.bundle_id`** is `NOT NULL` with a plan-pinned composite FK `(plan_id, bundle_id) → bundles(plan_id, id) on delete cascade` (`20260624120001_placements_bundle_id.sql:12-18`, backfilled then tightened in `20260624120002`).
- **`placements.day` / `.period` are `smallint NOT NULL`** (`20260602185012_minimal_domain_schema.sql:120-121`) and part of `placements_unique` — **a placement can never be slot-less.** This is the fact that forces membership to live somewhere other than placements when parked.
- **RPCs** (all `security invoker`, transactional): `place_course` (find-or-create cell bundle via `on conflict … where day is not null`, then insert placement), `move_bundle_members` (empty-target relocates the row preserving `bundle_id`; occupied-target merges and **deletes the source bundle**; `==0` membership cleanup), `remove_bundle_members` (delete placements, delete bundle iff membership hits 0). See `20260624120004_place_course_fn.sql`, `20260624120005_move_bundle_members_fn.sql:17-126`, `20260624120006_remove_bundle_members_fn.sql:12-40`.
- **`clone_plan`** copies every `bundles` row verbatim (status/day/period, fresh UUIDs) — `20260624120003_clone_plan_with_bundles.sql:137-140`.

**Conclusion:** the placed↔holding _row_ transition is genuinely additive — the column, the value, the nullable coords, the partial index, RLS, and clone are all in place. **But the chosen S-07 model (§B) does _not_ use this row transition** — it adds a separate shelf table instead, so these S-05 columns end up as benign vestigial no-ops.

### B. 🔴 The one real gap — membership lives only in `placements` (THE finding)

A repo-wide search confirms: **there is no `bundle_members` (or `parked_*`) table.** The only membership child table is `course_grouping_members`, which is a **different concept** — precomputed _palette suggestions_ keyed by `catalog_hash`, not the placed-on-the-board unit. The `bundles` table carries **identity + coords + status only**. Both bundle RPCs identify "members" as *the placements at this cell whose `course_id = any(...)`* (`move_bundle_members_fn.sql:63-69`, `remove_bundle_members_fn.sql:31-33`). Membership is therefore **reconstructed from placements**, which exist only while the bundle is on-board.

Also confirmed: **`status='holding'` is written nowhere** — no migration, action, client, or model code ever sets `status='holding'` or nulls a live bundle's coords. The state is representable but unreachable. The DDL comment itself says holding is "the S-07 off-board state (additive then)" (`20260624120000_bundles.sql:10`) — i.e. the plan anticipated the row, but not the membership-storage consequence.

**Why this blocks the naive design:** the S-05 research's own justification for a persistent bundle id was "a parked bundle holds no slot, so there are no co-located placements to derive it from" (`context/archive/2026-06-23-first-class-bundle-operations/research.md:32`). That argument applies one level deeper than the plan acted on it: it justifies a persistent **identity**, but the parked unit also needs persistent **membership**, and the row provides only the former. So:

> **Park cannot be "delete the placements, keep the bundle row" — that throws away the course set. S-07 must capture membership in durable storage _before_ the placements are deleted, and read it back on load + place-back.**

**Resolved (2026-06-26, with author) — a dedicated shelf-table pair, _not_ a `holding` state on the `bundles` row.** Rather than reuse one `bundles` row across two states (the "freezer" idea: flip `status` to `holding`, keep the row, stash membership in a `bundle_members` junction), the cleaner model is **two separate entities**:

- **Placed bundle** = `bundles` + `placements` (exactly as S-05 built it — untouched).
- **Shelved bundle** = `shelf_bundles` (the parked unit / card identity) + `shelf_bundle_courses` (its `course_id` + `week`, preserving the A/B formation). Purpose-named after the PRD's "shelf" metaphor — `placement : board :: shelf_bundle_course : shelf`.

**Park** (`shelve_bundle`) tears down the board representation: copy the placed bundle's courses+weeks into `shelf_bundle_courses`, then delete the placements (the existing `==0` rule drops the now-empty `bundles` row). **Place-back** (`unshelve_bundle`) reverses it: place the shelf courses at the target via the existing `place_course` find-or-create (a fresh `bundles` id is minted naturally), then delete the `shelf_bundles` row (courses cascade).

Why this beats the freezer/`bundle_members` framing: (1) **two clean entities** instead of one row living a double life — no `status` gymnastics, no "membership represented two different ways within one entity"; (2) **place-back reuses `place_course`** rather than a bespoke relocate-the-row RPC; (3) the **merge-into-occupied identity wrinkle disappears** — with fresh ids there is no source identity to "consume," so place-back-onto-occupied is just an ordinary drop. The board write path stays frozen. **Identity is deliberately not preserved across the park boundary** — safe for S-08 because undo is snapshot-based (see §G).

Two rejected alternatives, recorded: **nullable-`placements` rework** (non-additive, broad blast radius — every query/RPC/index assumes placed coords) and the original **freezer `bundle_members` junction** (works, fully additive, but keeps the awkward single-row-two-states model and the merge-identity caveat). Consequence: the S-05 `bundles.status` + nullable-coord columns become **benign vestigial no-ops** under the shelf model — **leave them** (dropping them ripples into `place_course`'s `on conflict … where day is not null` and the partial index, i.e. touches the hot path for pure tidiness).

### C. UX / interaction design (lead lens) — concrete options

The board is one island, SSR-assembled and mounted `client:load`, owning the full content area (`src/pages/plans/[id]/index.astro:12,23`, `PlanDetailPage.astro:13-15`, `SidebarLayout.astro:125-129`). On-screen regions top→bottom (`PlannerBoard.tsx:143-182`): a slim `PlanSummaryBar` (plan name + DP1/DP2 `CohortSwitcher` + "N left to place"), then a **two-column body** `grid … lg:grid-cols-[18rem_1fr]` (`PlannerBoard.tsx:148`) — left = the palette `<aside>` (scrollable list of draggable grouping boxes), right = a flex column with a toolbar + the `overflow-auto` grid viewport.

The **palette is the closest existing analog to a shelf** (`PlannerPalette.tsx:39-59`): a `shrink-0` header over a `overflow-y-auto` list of `<GroupingBox>` items, each owning its own `useDraggable`. A parked-bundle shelf mirrors this almost 1:1.

**Drag wiring is extension-friendly.** One island-wide `<DragDropProvider plugins={PLUGINS} onDragStart=… onDragEnd={handleDrop}>` (`PlannerBoard.tsx:144`); `handleDrop` is a `switch (data.kind)` over a discriminated union `CourseDrag | PlacementDrag | GroupDrag | BundleDrag` (`PlannerBoard.tsx:97-119`, `model/drag.ts:8-16`). A whole bundle is *already* a single draggable — the bundled cell itself (`SlotCell.tsx:161-165`, `id: bundle:${cellKey}`, `data:{kind:"bundle",day,period}`), dropping via `case "bundle" → moveBundle(...)`. Cells are droppables carrying `{day,period}` (`SlotCell.tsx:154`). A drag preview already supports the `bundle` kind (`GroupDragOverlay.tsx:24-39`). (`@dnd-kit/react` + `@dnd-kit/dom` are both `0.5.0`; hooks register against the nearest provider, so adding a droppable/draggable needs **no provider restructuring** — confirmed against current @dnd-kit/react docs.)

So a shelf = **one new `useDroppable({id:"shelf"})` + parked cards as new `kind:"parked"` draggables + two new `switch` cases** (lift: target is the shelf; place-back: source is `parked`, target is a cell). The only structural touch to existing code is turning `handleDrop`'s unconditional `target.data as CellData` cast (`PlannerBoard.tsx:104`) into a discriminated check (target union becomes `CellData | ShelfData`).

**Option matrix** (effort is relative to existing wiring):

| Dimension | Options | Recommendation |
| --- | --- | --- |
| **(a) Where the shelf lives** | **A1 Right rail** (3rd grid col `[18rem_1fr_16rem]`, `PlannerBoard.tsx:148`) · **A2 Bottom tray** (`shrink-0` strip in the right-column flex, below the grid viewport, `PlannerBoard.tsx:155`) · **A3 Palette tab** (`Tabs` already in `shared/ui`: "Recommendations \| Parked (N)") | **A2 bottom tray.** Preserves grid width, reads as an "off-board parking lot," and in S-06 becomes **one shared tray spanning both columns** with DP1/DP2 tags. (A1 steals width that S-06's two grids need; A3 hides the shelf behind a tab and complicates a drop-to-park target.) |
| **(b) Lift gesture (board → shelf)** | **B1 Drag bundle onto the shelf droppable** (reuses the existing whole-cell bundle drag verbatim) · **B2 "Lift to shelf" button** in the cell's control strip (`SlotHeader`, beside the existing duplicate/trash; uses `stopDrag`) · **B3 Both** | **B3.** B2 is the discoverable, zero-dnd-change path; B1 adds power-user drag at the cost of the `handleDrop` target-union refactor. |
| **(c) Place-back gesture (shelf → slot)** | **C1 Drag the parked card onto a cell** (`case "parked": placeBack(parkId, cell)`, symmetric with `case "grouping"`) | **C1** — the only gesture matching "drag a parked bundle back onto a now-suitable slot." Validation fires naturally on drop via the existing collision recompute (satisfies "evaluated only on drop-back"). |
| **(d) Parked card + capacity** | **D1** reuse the `GroupingBox`/`OverlayCard` shell, **neutral tone, no collision flag, no A/B toggle, no `aria-invalid`** (a parked bundle isn't validated) + a "return/remove" control modeled on `PlacedChip`'s ghost `×` · **D2** multiple cards via a `space-y-2` (tray: `overflow-x-auto flex gap`) list, capacity = list length | **D1 + D2.** Reuse `GroupingBox.tsx:48-86` (header "N courses" + member rows) and `PaletteCourseChip` for the 1-course case. **Semantic tokens only** (lessons.md): stay on `bg-background`/`bg-secondary` neutrals — a parked card has no validity state to encode. Note: there is **no shadcn `Card`** in `shared/ui`; follow the inline `bg-background rounded-lg border` box pattern. |

**Decision (2026-06-26, with author) — anchor on _progressive disclosure_, not an always-visible container.** The board is already information-dense; a permanently-reserved shelf would make every other element harder to read. So the shelf is a **collapsible edge drawer** realized as a **collapsible 3rd grid column** (`PlannerBoard.tsx:148`, e.g. `lg:grid-cols-[18rem_1fr_auto]`):

- **Idle (footprint ≈ 0):** a `N parked` badge in `PlanSummaryBar` + a thin right-edge tab. The packed grid keeps its width, and the persistent badge doubles as the **durability cue** (a parked bundle is never invisible/lost).
- **Expanded (on demand / spring-loaded):** click the badge or **drag a bundle toward the edge** → the column opens to ~15rem and the grid reflows **once, on the explicit expand** (never mid-drag), so it stays **non-modal** and every cell remains a reachable drop target. The non-modal property is what makes **place-back** work — you drag a parked card *out of* the drawer *onto* a visible slot (a centered modal / full-board popover would hide the target, which is why those were rejected).
- **Gestures:** **lift** = the B2/B3 button on the bundle (+ optional drag-to-edge); **place-back** = C1 drag-the-parked-card-onto-a-slot; **parked card** = D1 neutral, flag-free `GroupingBox` shell. Auto-collapses after each park/place-back, with an optional **pin** for bulk rearranging.
- This is the **collapsed/transient form of matrix option A1** (chosen over the always-visible A2 tray and the recs-hiding A3 tab). It generalizes to **S-06 as one shared right-edge drawer with DP1/DP2-tagged cards**, so neither cohort grid loses width — the space-efficient choice pays off twice.

Secondary sub-decisions for `/10x-plan`: (a) **which edge** — right (recommended; symmetric with the left palette, natural shared drawer for S-06) vs bottom; (b) **expand behavior** — reflow-the-grid-narrower while open (recommended; guarantees reachability, the shift happens once on expand) vs overlay-a-narrow-strip (no reflow, but obscures the rightmost cells during place-back); (c) **auto-collapse + optional pin**.

### D. Domain-model impact — the precise additive delta

What S-07 must add (and, importantly, what it does **not** change):

| Layer | Delta | Additive? |
| --- | --- | --- |
| **Schema** | **Two new purpose-named tables** — `shelf_bundles` (`id, plan_id, cohort, created_at`) + `shelf_bundle_courses` (plan-pinned composite FKs to `shelf_bundles` and `courses`, plus `week public.placement_week`), mirroring the `course_teachers` composite-FK + anon-revoke template. `bundles`/`placements` unchanged; the S-05 `status`/nullable-coord columns left as vestigial no-ops. | Additive (two new tables). |
| **RPCs** | **`shelve_bundle(plan, cohort, day, period)`** — copy the placed bundle's `(course, week)` into `shelf_bundle_courses`, delete the placements (the `==0` rule drops the now-empty `bundles` row), return the new `shelf_bundles` row. **`unshelve_bundle(plan, cohort, shelf_bundle_id, target_day, target_period)`** — place the shelf courses at the target via existing `place_course` find-or-create (fresh `bundles` id), delete the `shelf_bundles` row (courses cascade), return the new placements for temp-id reconciliation. Onto-empty and onto-occupied are the **same** path. | Additive (two new `security invoker` RPCs; `place_course` / `move` / `remove` untouched). |
| **`load.ts`** | One more parallel query — `shelf_bundles` + `shelf_bundle_courses` filtered by `plan_id`+`cohort` — projected into a `parkedBundles` board prop. Today `load.ts` maps placements only (`load.ts:58-96`); names resolve via the existing same-cohort `names`/`catalog` map. | Additive read alongside the existing `stale` read (see §F). |
| **`clone_plan`** | Add a `shelf_bundles` + `shelf_bundle_courses` block (a `_shelf_bundle_map` remap mirroring `_grouping_map` / `course_grouping_members`); `week` copied as-is. | Additive. |
| **Constraint core / `<200 ms` budget** | **No change.** A shelved bundle has no placements → absent from `deriveCellViolations`; place-back recreates placements → existing accept-and-flag recompute re-validates for free. No new constraint, no `BoardContext` change. | Untouched. |
| **Model / UI** | A `shelveBundle` / `placeBack` verb pair in `use-placements.ts` (mirror `moveBundle`/`duplicateBundle`) + the optimistic transition triad; a shelf droppable + parked-card draggables + 2 `handleDrop` cases; a `ParkedBundleCard`. | Additive. |

### E. Durability — server `holding`-state (the chosen approach)

Because the parked bundle (and its `bundle_members`) live in Supabase, **refresh-durability is automatic**: a reload re-runs `load.ts`, which (per §D) fetches holding bundles + membership and re-renders the shelf — no client persistence, no `localStorage` hazard. This directly satisfies the **Secondary Success Criterion** ("a parked bundle survives a browser refresh", `prd.md:157`) and avoids the `localStorage` try/catch pitfalls the roadmap flagged (`roadmap.md:169`, lessons.md). It also means the cohort switch (a full SSR remount, `CohortSwitcher.tsx:7-10`) naturally re-renders the correct cohort's shelf. **Recommendation:** server `holding`-state is the source of truth; do not introduce `localStorage` as a parallel store. (If a per-device cosmetic like "tray expanded/collapsed" is ever wanted, _that_ may be guarded `localStorage` — but the parked set itself is server-owned.)

### F. Not blocking S-06 (combined two-cohort view)

The board is **already cohort-parameterized** — `?cohort=` query param → `loadPlannerData(supabase, id, cohort)` → `PlannerBoardProps.cohort` → into `usePlacements` and **every** write (`index.astro:11-12`, `model/drag.ts:19-24`, `PlannerBoard.tsx:63-66`, `api/placements.ts:13-41`). `bundles.cohort` is `not null` and immutable through every op. The cohort-switching archive explicitly named the trap to avoid: *"coupling validation to a single 'active cohort' → S-06 becomes a rewrite"* (`context/archive/2026-06-22-cohort-switching/research.md:142-148`); S-04 avoided it.

**To keep S-06 additive:**
- **Scope the shelf by `bundle.cohort`, never by a single global "active cohort."** A parked DP1 bundle is intrinsically DP1, so S-06's two columns each render their own cohort's parked bundles (one shared tray filtered by cohort tag, or per-column trays — both generalize).
- **`park_bundle` / `place_back_bundle` must take and enforce `cohort`** like every existing write, so place-back into the wrong column is impossible at the RPC layer — that *is* FR-008's cross-cohort guard, for free.
- **Mount the shelf inside the `PlannerBoard` island, not as a new top-level singleton**, so S-06 can mount two boards each with their own cohort-scoped shelf, following the existing remount state model. Don't add cross-board shared client state.
- **Add the shelf as a new `DragData`/target kind** rather than overloading the cell `CellData` — keeps the cell droppable cohort-agnostic (the S-06 prerequisite the archive flagged).

### G. Not blocking S-08 (editing undo/redo)

FR-013 (provisional, blocked on Open Q #1) must reverse: move, remove, replace, ungroup, single-course move, **park (shelve)**, **place-back (unshelve)**. The S-05 archive argued *"a stable bundle id is a durable handle … making undo materially simpler"* (`research.md:92`) — **this research revises that as over-cautious for our case:**

- **The board never uses the bundle uuid as its operational handle.** Even S-05's own RPCs key by *(cell + course-ids)*, not by bundle id (`move_bundle_members_fn.sql`, `remove_bundle_members_fn.sql`). The uuid is internal plumbing — no UI state or other row references it.
- **S-08 is naturally snapshot/command-based.** Each undo entry captures the before/after state of one operation (cell, courses, weeks) and replays the inverse — robust to id churn by construction; it never dereferences a bundle uuid. (An *id-reference* undo stack would need stable ids, but nothing pushes us there, and snapshot undo is simpler and more flexible for a board this small.)

So **fresh ids across the park boundary do not block S-08.** What still matters (transaction boundaries, not identity):

- **`shelve_bundle` and `unshelve_bundle` are each ONE atomic `security invoker` RPC** → one user action = one reversible undo entry with clean rollback (not a client-side multi-step delete-then-insert).
- The **merge-into-occupied caveat is gone** under the shelf model: place-back onto an occupied cell is an ordinary drop (courses join the destination bundle), fully reversible from the operation snapshot — no special-case identity loss to carry forward.

(S-08 scope — single vs multi-step, session vs durable — remains Open Q #1; this only ensures S-07 doesn't constrain it.)

## Code References

(Permalinks pinned to `72c97cf`.)

- [`supabase/migrations/20260624120000_bundles.sql:17-51`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/supabase/migrations/20260624120000_bundles.sql#L17-L51) — `bundles` DDL: `status` CHECK (`'placed'|'holding'`), nullable coords, partial unique index, RLS, anon-revoke.
- [`supabase/migrations/20260624120001_placements_bundle_id.sql:12-18`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/supabase/migrations/20260624120001_placements_bundle_id.sql#L12-L18) — `placements.bundle_id NOT NULL` + composite FK.
- [`supabase/migrations/20260602185012_minimal_domain_schema.sql:120-121`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/supabase/migrations/20260602185012_minimal_domain_schema.sql#L120-L121) — `placements.day/period smallint NOT NULL` (why parked members can't be slot-less placements).
- [`supabase/migrations/20260624120005_move_bundle_members_fn.sql:17-126`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/supabase/migrations/20260624120005_move_bundle_members_fn.sql#L17-L126) — move RPC: empty-target preserves `bundle_id`, occupied merges (source deleted — the S-08 caveat), `==0` cleanup; members = placements-at-cell-by-course-id (the membership-via-placements fact).
- [`supabase/migrations/20260624120006_remove_bundle_members_fn.sql:12-40`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/supabase/migrations/20260624120006_remove_bundle_members_fn.sql#L12-L40) — remove RPC + `==0` bundle delete.
- [`supabase/migrations/20260624120003_clone_plan_with_bundles.sql:137-140`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/supabase/migrations/20260624120003_clone_plan_with_bundles.sql#L137-L140) — clone copies bundle rows (membership clone is the §D gap).
- [`supabase/migrations/20260602185012_minimal_domain_schema.sql:142`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/supabase/migrations/20260602185012_minimal_domain_schema.sql#L142) — `course_grouping_members` (an unrelated palette-suggestion table; its composite-FK junction shape is the _pattern_ to mirror for `shelf_bundle_courses`). The modern composite-FK + anon-revoke template is `course_teachers` (`20260620120000_course_teachers.sql`).
- [`src/_pages/plan-detail/api/load.ts:58-96`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/src/_pages/plan-detail/api/load.ts#L58-L96) — loads placements only; no bundle rows, no membership for a placement-less bundle.
- [`src/_pages/plan-detail/ui/PlannerBoard.tsx:97-119`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/src/_pages/plan-detail/ui/PlannerBoard.tsx#L97-L119) — the `switch (data.kind)` drop dispatch (the extension seam) + the `target.data as CellData` cast to discriminate.
- [`src/_pages/plan-detail/ui/PlannerBoard.tsx:143-182`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/src/_pages/plan-detail/ui/PlannerBoard.tsx#L143-L182) — layout regions; `grid … lg:grid-cols-[18rem_1fr]` (`:148`) and the right-column flex (`:155`) are the shelf seams.
- [`src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx:153-170`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx#L153-L170) — whole-bundle drag source + cell droppable (the gesture S-07 reuses).
- [`src/_pages/plan-detail/model/drag.ts:8-24`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/src/_pages/plan-detail/model/drag.ts#L8-L24) — `DragData` union + `CellData` + `PlannerBoardProps.cohort`.
- [`src/_pages/plan-detail/ui/PlannerPalette.tsx:39-59`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/src/_pages/plan-detail/ui/PlannerPalette.tsx#L39-L59) — the scrollable draggable-list layout the shelf mirrors.
- [`src/_pages/plan-detail/ui/slot-cell/GroupingBox.tsx:31-86`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/src/_pages/plan-detail/ui/slot-cell/GroupingBox.tsx#L31-L86) — multi-member card shell to reuse for the parked card (neutral, flag-free).
- [`src/_pages/plan-detail/ui/GroupDragOverlay.tsx:24-39`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/src/_pages/plan-detail/ui/GroupDragOverlay.tsx#L24-L39) — drag preview; add a `parked` branch.
- [`src/_pages/plan-detail/model/use-placements.ts:131-180`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/src/_pages/plan-detail/model/use-placements.ts#L131-L180) — `moveBundle` / `duplicateBundle` verbs (park/placeBack mirror these).
- [`src/pages/plans/[id]/index.astro:11-12`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/src/pages/plans/%5Bid%5D/index.astro#L11-L12) + [`src/_pages/plan-detail/ui/CohortSwitcher.tsx:7-31`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/src/_pages/plan-detail/ui/CohortSwitcher.tsx#L7-L31) — cohort via query param + SSR-remount switch (the state-reset model the shelf must respect).
- [`src/_pages/plan-detail/model/placement.ts:11-18`](https://github.com/dobrek/ib-timetable-planner/blob/72c97cfdb18b82b77787a980661f4fd71d6f7264/src/_pages/plan-detail/model/placement.ts#L11-L18) — `PlannerPlacement.bundleId`, carried "for forward use (S-07 park / S-08 undo)".

## Architecture Insights

- **The bundle row is identity, not contents.** S-05 made bundle _identity_ first-class but left _membership_ derived from co-located placements — so an off-board unit has nothing to reconstruct from. S-07's real work is giving the parked unit its **own** state-appropriate representation (the shelf tables) rather than trying to keep the on-board row alive off-board. (Lesson: when an entity moves to a fundamentally different state, a separate representation can be cleaner than one row living a double life — see §B.)
- **Validation is decoupled from mutation** (pure, client-side, accept-and-flag, never gates), so new _operations_ never threaten the <200 ms budget — only new _constraints_ or larger data would, and S-07 adds neither. Parking _removes_ data from validation; place-back re-validates for free.
- **The drag layer is a discriminated-union dispatch**, so new interactions are additive `kind` cases, not refactors. The one shared touch-point is `handleDrop`'s target cast.
- **Cohort is a row-stamped, SSR-remount-scoped value.** Because `bundles.cohort` is immutable and on every write, "park stays in its cohort" is a data invariant, not UI logic — which is what makes the shelf generalize to S-06 without rework.
- **Relevant lessons (`context/foundation/lessons.md`):** *"Port the mechanism, not the legacy type shape"* (model `shelf_bundles`/`shelf_bundle_courses` on generated `Database` types, identity as opaque tokens); *"Granting a role is not excluding the others"* (explicit `revoke … from anon` on the new table); *"Guard `localStorage` with try/catch"* (now moot for the parked set itself, since durability is server-side); *"`astro check` is the mandatory type gate."*

## Historical Context (from prior changes)

- `context/archive/2026-06-23-first-class-bundle-operations/` (S-05) — pre-built the `bundles` row for parking; its research §5/§6 foresaw S-07/S-08 dependence on a persistent id, and its brief promised S-07 "purely additive." **This research corrects that promise** (membership store is missing). Templates here: `replace_course_teachers`-style RPC, additive-first/destructive-drop-last, `clone_plan` `_*_map` double-remap.
- `context/archive/2026-06-22-cohort-switching/` (S-04) — removed the `dp1` hardcode, established `?cohort=` + eager-load-both + sibling occupancy; named the "single active cohort → S-06 rewrite" trap S-07 must not reintroduce.
- `context/archive/2026-06-25-bundle-duplication/` — added a **client-only** `duplicateBundle` (reuses `place_course` fan-out + the drop-hint oracle); **no** change to the bundle write-path RPCs, `bundles` table, or `load.ts`. Confirms the additive pattern S-07 follows; the `use-placements.ts`/`PlannerBoard.tsx` park/placeBack verbs sit beside it.
- `context/foundation/test-plan.md` — Risk #7 (bundle/parked durability) is already recognised; board/drag E2E for bundles partly deferred.

## Related Research

- `context/archive/2026-06-23-first-class-bundle-operations/research.md` — the direct prerequisite analysis; read its §5/§6 alongside §B above.
- No prior research artifact exists under `context/changes/bundle-holding-container/` before this one.

## Open Questions / Decisions for `/10x-frame` and `/10x-plan`

1. **Membership store shape — RESOLVED (2026-06-26): a dedicated shelf-table pair** (`shelf_bundles` + `shelf_bundle_courses`), *not* a `holding` state on the `bundles` row (the "freezer" `bundle_members` junction) and *not* a nullable-`placements` rework. Park tears down / place-back rebuilds; place-back reuses `place_course`; fresh ids (see §B, §D, §G). Remaining sub-decision for `/10x-plan`: the shelf members table name (`shelf_bundle_courses` vs `shelf_bundle_members`) and whether to keep it a two-table header+members split vs a single table with embedded members. — Owner: dev (model agreed).
2. **Place-back into an occupied cell — clarified.** Under the shelf model this is an ordinary merge-drop (courses join the destination bundle) with **no identity wrinkle** and is fully snapshot-reversible, so it can be allowed by default. Remaining product call: whether the UX should still *encourage* dropping onto an empty cell for a clearer mental model. — Owner: user/design.
3. **Shelf placement — RESOLVED (2026-06-26): collapsible edge drawer (progressive disclosure).** Collapsed to a toolbar `N parked` badge + right-edge tab (≈0 footprint); expands to a ~15rem 3rd grid column on demand / spring-loaded; non-modal; auto-collapsing with an optional pin. Generalizes to S-06 as one shared, DP1/DP2-tagged edge drawer. Remaining sub-decisions for `/10x-plan`: (a) which edge (right recommended); (b) reflow-while-open (recommended) vs overlay-narrow-strip; (c) auto-collapse + optional pin. — Owner: dev (UX shape agreed).
4. **Lift affordance** — button-only (zero dnd change), drag-only, or both (recommended). — Owner: user/design.
5. **Empty parked bundle / "return all" semantics** — does removing the last member of a parked bundle delete it (mirror the `==0` rule)? Is there a "clear shelf" / "place all back" bulk action? — Owner: user/dev.
6. **S-08 reach-ahead** — pin two things now: `shelve_bundle`/`unshelve_bundle` are single atomic RPCs, and S-08 undo is snapshot/command-based (not id-reference). Together these keep undo additive **without** requiring a stable bundle id across the park boundary. — Owner: dev (cheap to honour now).
