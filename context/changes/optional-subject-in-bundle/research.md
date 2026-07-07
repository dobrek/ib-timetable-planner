---
date: 2026-07-07T10:29:37+02:00
researcher: Claude Code (Fable 5)
git_commit: fd97931d76b21921195b2e3a9b78c59229d3094f
branch: main
repository: ib-timetable-planner
topic: "Optional subject in bundle — feasibility, impact on UI, data model, and planning flow"
tags: [research, codebase, bundles, placements, plan-detail, timetable, hours-counter]
status: complete
last_updated: 2026-07-07
last_updated_by: Claude Code (Fable 5)
last_updated_note: "Resolved all open questions with the author — decisions recorded; chip actions consolidate into a per-chip overflow menu"
---

# Research: Optional subject in bundle — feasibility, UI, data model, planning flow

**Date**: 2026-07-07T10:29:37+02:00
**Researcher**: Claude Code (Fable 5)
**Git Commit**: `fd97931d76b21921195b2e3a9b78c59229d3094f`
**Branch**: `main`
**Repository**: `ib-timetable-planner`

## Research Question

Feasibility of adding a "mark subject as optional" action for a bundle member (as an alternative to removing it), and its impact on UI, data model, and the planning flow. Per `change.md`: the optional subject is a temporary choice (later truly removed or accepted), must be visually distinct within the bundle, and must still be counted in the summary counter.

## Summary

**The feature is highly feasible and almost entirely additive.** The architecture already has an exact structural precedent — the per-placement `week` flag — and the feature maps 1:1 onto it:

- **Data model**: the placement row *is* the bundle-member row (membership lives only in `placements`; there is no junction table). An additive `is_optional boolean not null default false` column on `placements` mirrors the `week` column added in `20260621130000_bi_weekly_week_columns.sql`. No seed/fixture impact (seed carries no placements).
- **Mutation path**: a toggle verb is structurally isomorphic to `setWeek` — pure optimistic transitions in `placement-transitions.ts`, a writer in `board-writes.ts`, a thin Astro Action doing a plain column update (`updatePlacementWeek` template at `src/_pages/plan-detail/api/placements.ts:134-143`).
- **Summary counter**: **zero changes needed** for the stated requirement. `deriveHours` counts placement rows (`src/entities/timetable/model/hours.ts:14-25`); an optional member keeps its row, so it stays counted as placed.
- **Constraint core**: **no changes needed** for the stated scope — an optional member remains a normal cell occupant and keeps participating in all conflict checks. (Whether it *should* still block is an open product question; the code supports either, but relaxing constraints is a much larger change.)
- **UI**: the `CellOccupant` view-model (`src/entities/timetable/model/collision/cell-occupants.ts:15-23`) is the single seam feeding both the editing chip (`PlacedChip`) and the read-only perspective chip (`ScheduleGrid`'s `Chip`) — one flag added there flows to both. Visual state must compose *below* the blocking/warning tones (collisions must never be masked) and use semantic tokens only; the dashed-border ghost grammar in `WeekLane.tsx:22-28` is an existing "not quite real" visual precedent.

**Three real hazards / decisions surfaced:**

1. **Undo/redo silently breaks for this flag as-is.** History diffs placements by the business key `courseId|day|period|week` — spelled in *two* places (`model/history/affected-slice.ts:37-38` and `model/history/reconcile.ts:30-31`). An optional-toggle changes none of those fields → undo would no-op; undo of a remove re-places via `place_course` *without* the flag. Making it undoable requires extending the key (in one unified home) and the re-place path.
2. **Shelf round-trip loses the flag** unless `shelf_bundle_courses` (+ `shelve_bundle`/`unshelve_bundle`/`place_course` functions) also carry it — parked bundles have no placement rows to reconstruct from.
3. **`clone_plan` must be replaced** — its placements INSERT uses an explicit column list (`20260630162149_clone_plan_carry_color.sql:147-148`); every prior placements-column addition shipped a paired clone-carry migration.

Notably, the affordance placement differs from remove: the per-chip remove "×" renders only when a cell is exploded/ungrouped (`PlacedChip.tsx:111`), but "mark optional *instead of removing*" is precisely the action you want available **while still bundled** — that's the UX point of the feature.

## Detailed Findings

### 1. Data model & persistence

**Bundles are first-class; membership is the placements row.**

- `placements`: one row per placed course-hour — `supabase/migrations/20260602185012_minimal_domain_schema.sql:116-128`, re-keyed onto plans with `placements_unique (plan_id, cohort, day, period, course_id)` in `20260611180006_plans_as_domain_root.sql:93-103`. All member-set RPCs identify members by `(cell, course_ids)`.
- `bundles`: explicit table since S-05 — `20260624120000_bundles.sql:17-36` (`status 'placed'|'holding'`, nullable coords, partial unique index on the cell). Every occupied cell IS a bundle, including bundles of one. Legacy derived `slot_bundles` dropped in `20260624120007_drop_slot_bundles.sql`.
- `placements.bundle_id NOT NULL` links them (composite FK, `20260624120001_placements_bundle_id.sql:12-16`, tightened in `20260624120002_backfill_bundle_id.sql:27`). Invariant stated in `20260626120001_shelve_bundle_fn.sql:7-8`: **"membership lives only in placements"** — no junction table. A bundle row exists exactly while membership ≥ 1 (`20260624120006_remove_bundle_members_fn.sql:31-38` deletes the bundle iff emptied).
- **Per-member state precedent**: `placements.week` — `20260621130000_bi_weekly_week_columns.sql:21-22`, added as `not null default 'both'`, with an in-migration note that additive columns inherit the table's grants. This is exactly the shape `is_optional` would take.
- Mutations (all via Astro Actions → SQL functions): `place_course` (`20260624120004`, find-or-create cell bundle + upsert placement), `move_bundle_members` (`20260624120005`, identity-preserving whole-bundle moves, mint/merge otherwise), `remove_bundle_members` (`20260624120006`), and direct column update for week (`api/placements.ts:134-143`). Zod inputs in `src/_pages/plan-detail/api/placements.ts:13-46`; actions registered via `src/actions/index.ts:7-15`.
- **Shelf twin representation**: `shelf_bundles` + `shelf_bundle_courses (course_id, week)` — `20260626120000_shelf_bundles.sql:22-44`. Per-member state is *duplicated* here because a parked bundle has no placements. `shelve_bundle` copies only `(course_id, week)` (`20260626120001:36-39`); `unshelve_bundle` re-places via `place_course` (`20260626120007:36-47`) whose signature has no optional param → **the flag resets on park/unpark unless extended**.
- Types flow to update: regen `src/shared/api/database.types.ts` (placements Row at :323-334), `PlacementRow` + `toPlannerPlacement` (`api/placements.ts:53-69`), `PlannerPlacement` (`src/entities/timetable/model/placement.ts:4-19`), select lists in `src/shared/api/load-placements.ts:11`.
- **Seed/fixtures: no impact.** `scripts/gen-seed.mjs` emits catalog only; "the seed carries no placements" (`20260624120001:4`). Integration factory `src/test/factories/place-course.ts` may optionally gain the flag.

### 2. UI — rendering, interactions, visual system

**Component tree (editing board):** `PlannerBoard` (`ui/PlannerBoard.tsx:56`) → `PlannerGrid` (`ui/grid/PlannerGrid.tsx:87`) → `SlotCell` (`ui/grid/slot-cell/SlotCell.tsx:64`) → `SlotHeader` (bundle-level verbs) + `PlacedChip` per member (`ui/grid/slot-cell/PlacedChip.tsx:38`; bi-weekly cells route through `WeekLane`).

- "Bundled" is a render predicate, not data: `isBundled(occupantCount, exploded)` = ≥2 occupants && not exploded (`model/exploded-cells.ts:33-35`).
- **Ungroup is ephemeral presentation only** — an in-session `Set<cellKey>` (`model/exploded-cells.ts:5`: "never persisted"), toggled from `SlotHeader.tsx:38-48`. This matters: the optional flag is a *durable* temporary choice, so it must live on the placement row (the `setWeek` template), **not** in the exploded-cells presentation state.
- **Member interactions today**: per-chip remove "×" (`PlacedChip.tsx:111-126`, `data-slot="remove-placement"`) renders **only when `!bundled`** — today's flow is ungroup → remove, exactly what the change note describes. Bundle-level verbs live in `SlotHeader.tsx:38-81` (ungroup/group, duplicate, shelve, remove-bundle). The existing per-member toggle precedent is `WeekToggle` (`PlacedChip.tsx:102-110`).
- **View-model seam**: chips render from `CellOccupant { placement, name, color, blocking, warning, unavailable }` built by `groupCellOccupants`/`toOccupant` (`entities/timetable/model/collision/cell-occupants.ts:15-61`). Adding `optional` here propagates to the board chip *and* the read-only perspective chip automatically.
- **Visual system**: chip tone is a strict single-class precedence — blocking (`border-destructive bg-destructive/10 text-destructive`) → warning → subject color → neutral (`chipToneClass`, `PlacedChip.tsx:142-157`; comment explains two `bg-*` utilities resolve non-deterministically). Non-tone axes compose separately: `pending` → `opacity-60`, dragging → `opacity-50`, lens ring/dim (`PlacedChip.tsx:69-75`). **An "optional" treatment should be a composable axis (e.g. dashed border + dimming + small badge) that never masks collision tones** — the dashed ghost grammar already exists at `WeekLane.tsx:22-28` (`border-dashed text-muted-foreground`). Semantic theme tokens only (lessons.md rule); badge variants available in `src/shared/ui/badge.tsx:7-27`.
- **Summary counter UI**: `PlanSummaryBar`/`HoursSummary` (`ui/chrome/PlanSummaryBar.tsx:72-120`, "N hours left to place · M over") + `CoursesLeftPopover.tsx:20-104`; data via `buildCoursesLeftSummary` (`ui/chrome/courses-left-summary.ts:37-45`) from `useHours`. Per-course `placed/required` counters also render on palette chips (`ui/palette/HoursCounter.tsx:14`).
- **Read-only views**: `src/widgets/timetable-board/ui/ScheduleGrid.tsx` `Chip` (:142-195) duplicates the tone ladder inline (:156-160) — the optional state must be mirrored there (a shared tone helper is a possible cleanup). Consumers: `StudentPlanPage.tsx:29,66-70`, `TeacherPlanPage.tsx:51,110-114`.
- **Other member-rendering surfaces to consider**: drag overlay (`ui/overlay/GroupDragOverlay.tsx:64-80`), shelf card (`ui/shelf/ParkedBundleCard.tsx`), `CoursesLeftPopover` rows, `PerspectiveCourseList`.

### 3. Planning flow — constraint core & summary counter

**Constraint core (`src/entities/timetable/`)** — members participate purely as cell occupants:

- `deriveCellViolations` buckets placements by cell and projects each to its `GroupingCourse` (`model/collision/collisions.ts:33-58, 86-108`); registry of five constraints (`collision/constraints/index.ts:10-16`): duplicate-course, teacher-conflict, student-conflict, teacher-availability, cross-cohort-teacher.
- The only per-placement attribute constraints currently see is `weekByCourseId` on `BoardContext` (`constraints/types.ts:30`, built at `collisions.ts:83-103`) — the exact template for an `optionalByCourseId` map **if** constraints ever need the flag.
- Severity: everything blocks except `teacher-unavailable`'s own block/warn split; an amber non-blocking warning tier already exists (`collisions.ts:14-16, 66-71, 122-123`).
- **Nothing here needs to change for the stated scope** — a flagged member still conflicts, still blocks drop hints, still counts. If product later wants optional members downgraded to warnings or excluded, that lands in `bucketByCell`/`BoardContext` + per-constraint relaxation — a much larger, semantics-heavy surface. Note the hint fast path (`violatesAny`, `constraints/index.ts:26-27`; `drop-hints.ts:161-207`) operates on `GroupingCourse` with no per-placement context — threading the flag there is a signature change.

**Summary counter (`src/entities/timetable/model/hours.ts`)**:

- `deriveHours` (:14-25): `placed` = count of placement rows per course ("one row = one hour"); `deriveUnplaced` (:31-34); `deriveOverplaced` (:42-45, guarded `required > 0`); `summarizeHours` (:54-60) pins the **per-course, clamped-at-zero, never-netted** invariant (decided in `courses-left-info`, shipped 2026-07-02).
- A **removed** member's row disappears → hours-left grows. An **optional** member keeps its row → still counted as placed. **The "still counted as an option" requirement is satisfied with zero counter changes.** `hours.ts` is the single seam if the semantics ever change (e.g. an "optional: N" breakdown line in the popover would be additive UI, not a counting change).

### 4. Editing orchestration — the `setWeek` template

Optimistic mutation flow: UI event → `ChipWiring`/`CellWiring` (`PlacedChip.tsx:17-30`, `PlannerGrid.tsx:32-51`, assembled in `buildColumn`, `PlannerBoard.tsx:157-182`) → `CohortActions` (`model/use-cohort-board-state.ts:256-269`) → `usePlacements` (`model/use-placements.ts:88-187`) → writer factories (`model/placement/board-writes.ts:80+`): snapshot → optimistic pure transition → transactional RPC → `recordEdit` → reconcile/rollback (`placement-transitions.ts:98-122, 186-210, 257-280`). Drops go through the derived-state dispatcher `resolveCombinedDrop`/`applyDropAction` (`model/cross-cohort/drop-router.ts:37-73`, `drop-dispatch.ts:33-79`); click verbs go through `CohortActions`.

**`setWeek` is the isomorphic template for `setOptional`**: `persistSetWeek` (`board-writes.ts:320-339`) + `setWeekOptimistic/Reconcile/Rollback` (`placement-transitions.ts:200-210`) + plain column update server-side (`api/placements.ts:134-143`) + `EditKind "setWeek"` (`model/history/history-label.ts:5-17`). A new verb copies this chain end to end.

**Undo/redo hazard (the one real integration trap)**: history diffs slices by business key `courseId|day|period|week`, spelled in **two places that must agree** — `placementBusinessKey` (`model/history/affected-slice.ts:37-38`) and `placementKey` (`model/history/reconcile.ts:30-31`, re-spelled despite affected-slice's "one home" comment). An optional-toggle changes none of those fields → `diffReconcile` produces an empty plan (undo no-ops); undoing a *remove* re-places via `place_course` (`reconcile.ts:9-22`) without the flag. Making optional undoable requires unifying + extending the key, `PlacementKey`, and the re-place input.

### 5. Performance

Perf guard: `model/collision/collisions.perf.test.ts:52-75` (two-cohort derivation + drag what-if, sub-ms measured, 50ms informational ceiling); PRD pins ≤200ms p95 (`context/foundation/prd.md:163`). A flag flip is a new placements array → memoized derivations recompute exactly as an add/remove does today (`model/use-board-derivations.ts:44-82`); a boolean per occupant or a `Map` lookup (the `weekByCourseId` pattern) is O(n) noise. **No budget risk.**

## Code References

- `supabase/migrations/20260624120000_bundles.sql:17-36` — first-class `bundles` table
- `supabase/migrations/20260621130000_bi_weekly_week_columns.sql:21-22` — `placements.week`: the per-member-flag precedent
- `supabase/migrations/20260624120006_remove_bundle_members_fn.sql:31-38` — remove members; bundle deleted iff emptied
- `supabase/migrations/20260626120001_shelve_bundle_fn.sql:36-39` — shelf copies only `(course_id, week)` — flag loss risk
- `supabase/migrations/20260630162149_clone_plan_carry_color.sql:147-148` — `clone_plan` explicit column list (must be replaced)
- `src/entities/timetable/model/placement.ts:4-19` — `PlannerPlacement`
- `src/entities/timetable/model/hours.ts:14-60` — hours counter derivations (never-netted invariant)
- `src/entities/timetable/model/collision/collisions.ts:33-108` — violation derivation; `weekByCourseId` build
- `src/entities/timetable/model/collision/constraints/types.ts:21-35` — `BoardContext`
- `src/entities/timetable/model/collision/cell-occupants.ts:15-61` — `CellOccupant` view-model (single UI seam)
- `src/_pages/plan-detail/api/placements.ts:53-69, 134-143` — row projection; `updatePlacementWeek` (server template)
- `src/_pages/plan-detail/model/placement/board-writes.ts:320-339` — `persistSetWeek` (writer template)
- `src/_pages/plan-detail/model/placement/placement-transitions.ts:200-210` — `setWeek` optimistic trio
- `src/_pages/plan-detail/model/history/affected-slice.ts:37-38` + `model/history/reconcile.ts:30-31` — duplicated business key (undo hazard)
- `src/_pages/plan-detail/model/exploded-cells.ts:5, 33-35` — ungroup is ephemeral presentation
- `src/_pages/plan-detail/ui/grid/slot-cell/PlacedChip.tsx:111-157` — remove gated on `!bundled`; single-tone precedence
- `src/_pages/plan-detail/ui/grid/slot-cell/SlotHeader.tsx:38-81` — bundle-level verb strip
- `src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx:72-120` + `ui/chrome/CoursesLeftPopover.tsx:20-104` — summary counter UI
- `src/widgets/timetable-board/ui/ScheduleGrid.tsx:142-195` — read-only chip (tone ladder duplicated)
- `src/_pages/plan-detail/model/placement/parked.ts:4` — `ParkedMember { courseId, week }` (shelf shape)
- `src/shared/api/load-placements.ts:11` — fixed select list to extend
- `src/entities/timetable/model/collision/collisions.perf.test.ts:52-75` — perf guard

## Architecture Insights

- **The placement row is the universal grain.** Bundle membership, per-member week state, hours counting, and constraint participation all key off placement rows. Any per-member state belongs there; `week` is the canonical worked example end to end (migration → types → transitions → writer → action → chip toggle → history label).
- **One view-model seam serves both worlds.** `CellOccupant` feeds the editing chip and the read-only perspective chip; flag once, render twice — but the tone ladder is duplicated between `PlacedChip` and `ScheduleGrid.Chip`, so a visual state addition touches both (or motivates extracting a shared helper).
- **Presentation state vs durable state is a deliberate boundary.** Ungroup was intentionally demoted to ephemeral in-session presentation (first-class-bundle-operations); the optional flag is explicitly durable ("temporary choice" ≠ session-scoped), so it must go the `setWeek` road, not the `toggleExploded` road.
- **Every placements-column addition has a mandatory tail**: regenerate `database.types.ts`, extend row projections/selects, replace `clone_plan`, and decide shelf survival. Prior changes treated the clone-carry migration as part of the definition of done.
- **Collision visibility is sacrosanct** — chip styling resolves to exactly one tone with blocking/warning always on top (`PlacedChip.tsx:136-157`); the optional visual must compose below, using semantic tokens only.
- Boolean vs enum: change.md frames optional as binary (optional ⇄ accepted, where accepted = today's normal state), so `boolean default false` suffices; the "nullable over sentinels / let types encode invariants" lesson argues against a three-state enum unless the accept flow becomes a distinct state.

## Historical Context (from prior changes)

- `context/archive/2026-06-23-first-class-bundle-operations/` (research.md:28-127, plan.md:1-32, 55-62, 242-247, 300-315) — the authoritative current bundle model: bundles as first-class rows, unified member-set primitive, **ungroup demoted to ephemeral presentation** (deliberate, user-visible reset-on-reload), `remove_bundle_members` as the single member-removal path. The bundle row was pre-shaped for S-07 parking.
- `context/archive/2026-07-01-courses-left-info/` (plan.md:1-57, research.md:144-157) — the summary counter models "work left" as **hours off the board, per-course, clamped at zero, never netted**; parked hours count as missing. This is the counter the optional member must keep feeding.
- `context/archive/2026-06-13-slot-as-a-group/research.md` (:40-78, 206-215) — origin of bundling: auto-group by default, per-chip remove disabled while grouped (survives today as the `!bundled` gate on the X button).
- `context/archive/2026-06-12-group-dragging/research.md:94` — the since-reversed "placements carry no grouping identity" decision (reversed by `bundle_id` in S-05).
- `context/archive/2026-06-26-bundle-holding-container/research.md` — the shelf: whole-bundle off-board parking, not validated while parked. Nearest existing "temporary" mechanism, but whole-bundle-grained — **no prior per-member optional/tentative concept exists anywhere in the history**.
- `context/archive/2026-06-25-bundle-duplication/plan-brief.md:8-16` — duplicate as a third whole-slot verb (would sweep optional members along today).
- `context/foundation/prd.md` FR-009 (:311-316), FR-010 (:317-324), bundle-semantics block (:417-430) — product framing for bundles/ungroup; ≤200ms p95 at :163.

## Related Research

- `context/archive/2026-06-23-first-class-bundle-operations/research.md` — bundle entity model
- `context/archive/2026-07-01-courses-left-info/research.md` — counter semantics
- `context/archive/2026-06-26-bundle-holding-container/research.md` — shelf/park mechanics
- `context/archive/2026-06-13-slot-as-a-group/research.md` — original grouping/ungroup UX decisions

## Open Questions

1. **Conflict semantics**: should an optional member still raise *blocking* violations (current behavior if it stays an ordinary placement), be downgraded to the existing amber warn tier, or be excluded from checks? Render-only flag = smallest change; constraint relaxation = large semantics-heavy surface (`BoardContext` + every constraint + hint fast path).
2. **Counter presentation**: "counted as an option" is satisfied by keeping the row counted as placed (zero change). Should the popover additionally surface an "optional: N" breakdown line?
3. **Undo/redo**: must optional-toggle be undoable? If yes, unify the duplicated business key (`affected-slice.ts:37` vs `reconcile.ts:30`) and extend it + the re-place path; if no, undo of a remove still silently drops the flag — acceptable?
4. **Whole-slot verbs**: do move/duplicate/shelve/remove-bundle include optional members? (Today they sweep all occupants.)
5. **Shelf survival**: should the flag survive park/unpark? Requires `shelf_bundle_courses` column + shelve/unshelve/`place_course` signature changes; otherwise it silently resets.
6. **Perspective views**: should students/teachers see an optional course normally, visually distinct, or hidden? (Loaders need the flag in their select either way if it renders distinctly.)
7. **Accept flow**: is "accept" simply clearing the flag on the chip (same toggle), or a distinct affordance with its own history label?
8. **Toggle availability**: confirm the optional toggle renders while bundled (unlike the remove "×", which requires ungrouping first) — this appears to be the core UX intent.

## Follow-up Research 2026-07-07T10:45+02:00 — undo/redo: register optional-toggle as a first-class edit

**Question**: should "mark subject optional" be registered as a new operation in the history system, undoable like the others? (Resolves open question 3.)

**Answer: yes — and it is cheaper than the hazard note above suggested**, because the history engine is **operation-agnostic snapshot-diffing**, not per-operation inverses:

- A history entry is only `{cohort, scope, target-slice, label}` (`model/history/history-entry.ts:35-40`). Undo reads the live slice at the scope (`sliceAt`, `affected-slice.ts:11-21`), diffs it against the target by placement business key (`diffReconcile`, `reconcile.ts:17-28`), and executes a minimal remove/place plan (`reconcile-exec.ts:41-61`). The `EditKind` union exists solely to render the tooltip label (`history-label.ts:5-52`).
- Therefore "registering the operation" = one new `EditKind` (suggest two: `markOptional` / `acceptOptional`, matching the `remove`/`removeBundle` flat-union style) + a `recordEdit` call in the new writer, mirroring `persistSetWeek` (`board-writes.ts:320-339`). No inverse function is written for any verb.

**The mandatory piece: `optional` must join the placement business key** (`courseId|day|period|week` today). Without it the diff sees before ≡ after → empty plan → a dead history entry that no-ops on undo — worse than not recording. Concretely:

1. Extend `PlacementKey` (`history-entry.ts:43`) and `placementBusinessKey` (`affected-slice.ts:37-38`).
2. **Unify the drifted duplicate first**: `reconcile.ts:30-31` privately re-spells the key even though `affected-slice.ts:33-35`'s comment claims it is "the one home" (`reconcile-apply.ts:3` does import the shared one). Extending the key is precisely when the copies would silently disagree.
3. Carry the flag through `sliceAt`'s `toPlannerPlacement` (`affected-slice.ts:23-30`) so before/forward snapshots capture it, and through `PlacementSpec` → `ReconcileDeps.place` (`reconcile-exec.ts:19`) → the `place_course` RPC so replay restores it. This also fixes the second half of the original hazard: undoing a *remove* of an optional member resurrects it *as optional*.

**Accepted design nuance (precedented, not new)**: the atomic-dispatch recognizers require different cells (`asPureRelocation` rejects same-cell, `reconcile-exec.ts:88`), so undoing a flag flip falls to the decomposed path — `removeMembers` + `place` at the same cell, recreating the row with a new id. A week-flip undo already works exactly this way, and id churn across replay is explicitly accepted (`history-entry.ts:42`). A future `same-cell attribute flip → single update RPC` recognizer would be an additive improvement benefiting `setWeek` too, but should not be coupled to this change.

**Free wins**: the accept action (clearing the flag) becomes undoable via the same mechanism; the optimistic reconcile side (`reconcile-apply.ts:23-24`) already keys on the shared `placementBusinessKey`, so it handles flag flips with no further work once the key is extended.

**Boundary**: shelf-card diffing (`ParkedMember = {courseId, week}`, `memberSetKey`, `affected-slice.ts:41-45`) needs touching only if the flag is decided to survive parking (open question 5) — separable from undoability.

**Decision recorded**: treat optional-toggle as a first-class recorded edit; extend + unify the business key; thread the flag through slice capture and the re-place path. Open question 3 is resolved (yes, undoable); questions 5 (shelf survival) and 7 (accept affordance/labeling) remain open but are now scoped.

## Follow-up 2026-07-07T11:05+02:00 — all remaining open questions decided (with the author)

All eight open questions are now resolved. Decisions, in the numbering of the Open Questions section:

1. **Conflict semantics → unchanged, still blocks.** Render-only flag; the constraint core (`entities/timetable/`) is untouched. An optional member conflicts exactly like any placement — truthful validation (it may be accepted later), smallest change, no <200ms risk.
2. **Counter → headline unchanged; popover gains an "Optional" section.** Optional counts as placed (zero change to `hours.ts`); `CoursesLeftPopover` adds a section listing courses with optional placements as a review checklist for pending decisions. Derivation is a simple filter over placements — additive UI, not a counting change.
3. **Undo/redo → first-class recorded edit** (decided in the previous follow-up: extend + unify the business key, thread the flag through slice capture and re-place).
4. **Whole-slot verbs → include optional members.** Move/duplicate/shelve/remove-bundle sweep all occupants as today; the flag rides along wherever the row is carried (duplicate + `clone_plan` must copy the column, same as `week`).
5. **Shelf survival → the flag survives park/unpark.** Consistent with `week`: column on `shelf_bundle_courses`, updated `shelve_bundle`/`unshelve_bundle`/`place_course`, `ParkedMember` gains the field (which also feeds `memberSetKey` — history card-diffing stays coherent).
6. **Perspective views → visually distinct.** Same optional treatment mirrored in the shared `ScheduleGrid` chip via the `CellOccupant` seam; view loaders add the flag to their select.
7. **Accept flow + affordance → per-chip overflow menu (author's design).** Rather than adding another inline button to the chip, per-member actions consolidate into a small "⋯" (dots) trigger opening a dropdown menu containing **Mark as optional / Accept** (contextual label) and **Remove** — the existing inline remove "×" *migrates into this menu*. Keeps the chip compact and creates one home for future member verbs. Precedent already in-repo: `src/shared/ui/dropdown-menu.tsx` exists and the catalog tables (`CourseTable`/`TeacherTable`/`StudentTable`) already use the row-actions "⋯" pattern. Two `EditKind`s (`markOptional` / `acceptOptional`) for history labels.
   - Assumption (not asked, default taken): the week A/B toggle stays inline as-is — it gates on week only and must remain adjustable while bundled (`PlacedChip.tsx:98-110`); moving it into a bundled-gated menu would regress that.
   - Implementation note: migrating remove into the menu retires the `data-slot="remove-placement"` inline button — e2e/tests targeting it must be realigned.
8. **Toggle availability → only when ungrouped**, gated exactly like remove today (`!bundled`). The flow stays: ungroup → decide per member (mark optional / accept / remove) via the menu. Consistent with the existing per-member interaction model; the bundled chip surface stays unchanged (name, collision badge, week toggle).

**Net scope confirmed by these decisions**: constraint core untouched; counter core untouched (popover UI only); the change is placements-column + `setOptional` verb (setWeek template) + history-key extension + shelf carry + overflow-menu UI refactor of per-chip actions + read-only chip mirroring.
