---
date: 2026-06-27T12:08:57Z
researcher: Dobromir Kropielnicki
git_commit: 92dac50a25dc7a66562cde7266cbe24274663a81
branch: main
repository: ib-timetable-planner
topic: "Combined two-cohort view (S-06) — pre-implementation readiness, UI & domain-model decisions"
tags: [research, codebase, plan-detail, combined-view, drag-drop, cross-cohort, orchestration]
status: complete
last_updated: 2026-06-27
last_updated_by: Dobromir Kropielnicki
---

# Research: Combined two-cohort view (S-06) — readiness, decisions, challenges

**Date**: 2026-06-27T12:08:57Z
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 92dac50a25dc7a66562cde7266cbe24274663a81
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

For the combined two-cohort view (roadmap S-06): what challenges must we solve before implementation? Are there UI decisions or domain-model decisions that need to be made? Are we fully ready to implement?

## Summary

**We are architecturally ready to implement, but not ready to *start* — there are 6 decisions to lock first, of which exactly one genuinely requires the author/design (the layout/screen-fit question, PRD Open Q #2). The rest I recommend resolutions for below.**

The hard correctness machinery this slice depends on is already built and tested: the symmetric, week-aware cross-cohort teacher constraint (S-04), week-aware collision (S-03), co-teaching teacher sets (S-02), first-class bundle identity (S-05), and the per-cohort holding-container shelf (S-07). The pure constraint/transition core in `model/` is **cohort-agnostic and reusable as-is**. The combined view is therefore mostly *additive composition* — but two findings change the shape of the work versus our first-pass assessment:

1. **The cross-cohort occupancy index is consumed *live* but supplied from a *static* SSR snapshot today.** In a combined, simultaneously-editable view, editing DP1 must re-validate DP2 against DP1's *live* placements (and vice versa). This is the one genuine domain/architecture change in the slice: the index must become a value *derived from both live placement sets*, recomputed on mutation — which is only possible from a parent that observes both cohorts. This is *not* a performance problem; it is a state-ownership/correctness one.

2. **The "re-compute + staleness is S-06" code comment is stale.** That subsystem already shipped (`grouping-refresh-stale-version`). S-06 does **not** pull in palette re-compute work — it only renders the existing per-cohort palette subsystem twice (a composition/layout decision, not new logic).

Two pieces feared to be hard are confirmed cheap: the **week A/B toggle** is already compact enough for a narrow column (ship as-is), and the **<200ms budget is not at real risk** (the cross-cohort and availability constraints are board-only, outside the drag fast path; the index is built once).

A documented forward-compat trap governs the implementation: **do not make `SlotCell`/the drop path cohort-aware** — inject cohort at a per-column wrapper so the single-cohort board and the two-column render both keep working (`context/archive/2026-06-22-cohort-switching/research.md:147`).

## Decisions to make before planning

### Domain-model decisions

**D1 — Cross-cohort index: static snapshot → live derived value. (Recommend: yes, derive from both live placement sets via a plan-level owner.)**
Today `crossCohortOccupancy` ships as a static SSR prop ([load.ts:51-82](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/api/load.ts#L51-L82)), is built once via `useMemo` ([PlannerBoard.tsx:56](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/PlannerBoard.tsx#L56)), and is fed both into validation (`useCollisions` → `deriveCellViolations`) and into `usePlacements` for duplicate-target search ([use-placements.ts:187](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/model/use-placements.ts#L187)). In a combined view this must become live: each column's `occupiedByTeacher` index is derived from the *sibling column's live `placements`*, recomputed on every mutation. **This is the load-bearing change of the slice.** Recommendation: own both cohorts' placement state in one place and derive each column's index from the other; rebuild once per mutation (cheap — see Perf below).

**D2 — State orchestrator shape: single plan-level orchestrator, not two peer hooks. (Recommend: single orchestrator.)**
The pure transitions (`placement-transitions.ts`, `shelf-transitions.ts`) are entirely cohort-agnostic, so generalizing is cheap, not a rewrite — lift `cohort` from a scalar hook arg to a state key (`Record<Cohort, CohortPlacementState>`), routing `(cohort, op)` to the right slice. Two reasons this wins over two independent `usePlacements` instances: (a) D1's live cross-validation *forces* a both-seeing parent anyway — two independent hooks would each only know their own placements; (b) S-08 undo wants a single plan-level operation-log home (every mutating op already carries `cohort` in its RPC args). Matches the "orchestration over patching" preference. The smaller-diff alternative (two hooks) buys less now and pays it back at S-08.

**D3 — Cross-cohort move guard (FR-008): single DragDropProvider + cohort-scoped IDs + reject cross-column drops. (Recommend this over two providers.)**
A bundle must move only within its own cohort. Two isolated providers make cross-column dragging impossible-by-construction (cheap guard) but split the drag context and any future single undo stack across two trees. One provider with cohort-scoped droppable IDs/target-data and an explicit same-cohort check in the drop handler keeps the guard *and* a single undo home. (Server already enforces this defensively — `unshelve_bundle` derives cohort from the shelf row, the documented "S-06 safety net": [shelf.integration.test.ts:207-223](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/api/shelf.integration.test.ts#L207-L223).)

**D4 — Recommendation enumeration week-awareness: out of scope for S-06. (Recommend: leave as-is.)**
Grouping enumeration is already co-teaching-aware (teacher-*set* intersection) and partly week-aware (`enumerateOppositeWeekPairs` surfaces placeable A/B pairs). Deeper week-aware enumeration is attached to S-03 in the roadmap and the PRD treats the recommendation half as "unchanged in spirit" — it is **not** S-06 work. Confirm we leave it.

### UI decisions

**D5 — Layout / screen-fit (PRD Open Q #2, FR-007). ⚠️ GENUINELY NEEDS AUTHOR + DESIGN.**
Two full grids strain a laptop. Options: compact/narrower columns, horizontal scroll, density toggle, collapse-to-one-column. Recommendation to take into that conversation: side-by-side **compact** columns as the default assembly/review surface, with the existing full-width single-cohort boards preserved as the primary editing surface (the combined view is additive per the guardrail, not a replacement). This is the one decision I cannot make for you — it's a design judgement on a real screen.

**D6 — Shelf & palette composition in two columns. (Recommend: one shared cohort-tagged shelf drawer; per-column collapsible palettes.)**
- *Shelf:* already per-cohort at the data layer (`shelf_bundles.cohort`, RPC-enforced), so this is presentation-only. The S-07 archive leaned toward **one shared right-edge drawer with DP1/DP2-tagged cards** to preserve grid width ([2026-06-26-bundle-holding-container/research.md:42,109](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/context/archive/2026-06-26-bundle-holding-container/research.md#L42)); hard constraint from that archive: keep the shelf mounted inside the board island, not a top-level singleton.
- *Palette:* per-cohort by construction, so the combined view renders it twice (two palettes, possibly two empty/stale/recompute panels). Recommendation: per-column **collapsible** palettes (collapse already exists via `usePaletteDisclosure`), defaulted collapsed in the combined view to reclaim width. Folds into D5.

## Detailed Findings

### Board UI composition & drag-drop scoping (Task 1)

- `DragDropProvider` is mounted **inside** `PlannerBoard` ([PlannerBoard.tsx:207](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/PlannerBoard.tsx#L207)); the board takes a single `cohort` prop ([:49](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/PlannerBoard.tsx#L49)) and renders one `PlannerGrid` ([:242](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/PlannerBoard.tsx#L242)).
- **ID collisions under a shared provider:** cell droppable id is `cellKey(day,period)` = `"${day}:${period}"` with no cohort ([SlotCell.tsx:157](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx#L157), [cell-key.ts:10](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/model/cell-key.ts#L10)); whole-slot bundle draggable is `bundle:${day}:${period}` ([SlotCell.tsx:165](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx#L165)); shelf droppable is the literal `"shelf"` ([ShelfDrawer.tsx:46](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/shelf/ShelfDrawer.tsx#L46)). Two columns share day/period space → these collide. Chip/parked draggables use UUIDs and are safe.
- **Drag payloads carry no cohort:** `CourseDrag | PlacementDrag | GroupDrag | BundleDrag | ParkedDrag` ([drag.ts:9-15](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/model/drag.ts#L9-L15)) and `CellData` ([drag.ts:19](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/model/drag.ts#L19)) have no cohort field; cohort lives only in the hook closure. The single `handleDrop` ([PlannerBoard.tsx:113-151](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/PlannerBoard.tsx#L113-L151)) reads bare `{day,period}`.
- **Trap (must respect):** inject cohort at a per-column *wrapper* (id prefix + target-data augmentation), keeping `SlotCell` cohort-blind — `context/archive/2026-06-22-cohort-switching/research.md:147` warns that globally cohort-aware cells break the two-column render.

### State orchestration, data loading, route structure (Task 2)

- `usePlacements` is **one-instance-per-cohort**: flat `placements` / `parkedBundles` / `error` / `lastDuplicated` state, no internal cohort keying ([use-placements.ts:117-120](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/model/use-placements.ts#L117-L120)); `cohort` is threaded into every RPC but never into the pure logic.
- Pure transition modules are **cohort-free** (`grep cohort` returns nothing) — reusable verbatim; only the orchestration above them changes.
- Cohort selection is a `?cohort=` query param that **remounts** the board ([index.astro:12](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/pages/plans/%5Bid%5D/index.astro#L12), [CohortSwitcher.tsx:6-10](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/CohortSwitcher.tsx#L6)). A mode-flag would fight this init-once/remount model → favours a **new route** `/plans/[id]/combined`.
- `loadPlannerData` is **asymmetric** today: full editable set for the active cohort, only a flat read-only occupancy projection for the sibling (`projectSiblingOccupancy`, [load.ts:162-177](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/api/load.ts#L162-L177)). The combined loader must become symmetric (both editable) and avoid a redundant double-fetch of sibling occupancy.

### Recommendation re-compute / staleness + shelf (Task 3)

- **Stale comment:** [ComputeGroupingsEmptyState.tsx:13-17](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/ComputeGroupingsEmptyState.tsx#L13-L17) says "re-compute and staleness UI are S-06" — but that work shipped in `grouping-refresh-stale-version` (`GroupingStalePanel.tsx`, `api/staleness.ts`, `model/palette-view.ts`, wired at [PlannerBoard.tsx:193](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/PlannerBoard.tsx#L193)). Worth correcting the comment.
- Staleness is computed **per-cohort at load**, off the per-drop budget, hashing the live *catalog* (not placements) — so dragging never makes the palette stale; only editing the catalog does.
- Enumeration is co-teaching-aware (teacher-set intersection, [teacher-conflict.ts:46-47](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/model/constraints/teacher-conflict.ts#L46)) and partly week-aware via `enumerateOppositeWeekPairs`.
- Shelf is **per-cohort at the data layer** (`shelf_bundles.cohort`, loaded `.eq("cohort", cohort)` [load.ts:79](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/api/load.ts#L79)); combined-view shelf is a presentation choice only (D6).

### Validation / perf budget + week A/B UX (Task 4)

- **Fast path** (context-free `test`, inside <200ms): `duplicateCourse`, `teacherConflict`, `studentConflict`. **Board-only** (no `test`, committed-placements only): `teacherAvailability` ([teacher-availability.ts:8](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/model/constraints/teacher-availability.ts#L8)), `crossCohortTeacher` ([cross-cohort-teacher.ts:13](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/model/constraints/cross-cohort-teacher.ts#L13)). The drag path mirrors the board-only ones explicitly ([drop-hints.ts:104-106, 210-221](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/model/drop-hints.ts#L104-L106)).
- Cross-cohort index built **once** ([cross-cohort-index.ts:21-39](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/model/cross-cohort-index.ts#L21-L39)); a per-drag only re-derives the dragged member-set context. Per-drag cost is bounded by a single board's size — the combined view's real risk is the D1 *freshness* of the sibling index, not raw cost.
- **Week A/B toggle ships as-is:** `WeekToggle` is two `size="xs"` letter buttons (~40px), only shown on bi-weekly placements ([WeekToggle.tsx:4-52](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/slot-cell/WeekToggle.tsx#L4-L52), [PlacedChip.tsx:88-100](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/ui/slot-cell/PlacedChip.tsx#L88-L100)).
- **Open test gate:** the S-06 parity case is a placeholder — `it.todo("invalid — co-teaching + bi-weekly + cross-cohort interact without false-positive valid")` ([collision-parity.test.ts:395-397](https://github.com/dobrek/ib-timetable-planner/blob/92dac50a25dc7a66562cde7266cbe24274663a81/src/_pages/plan-detail/model/collision-parity.test.ts#L395-L397)). Must be implemented as part of this slice.

## Code References

- `src/_pages/plan-detail/api/load.ts:51-82,162-177` — asymmetric loader; `projectSiblingOccupancy` (static cross-cohort snapshot to make live/symmetric).
- `src/_pages/plan-detail/model/use-placements.ts:106-120,187` — per-cohort state; live consumption of the cross-cohort index.
- `src/_pages/plan-detail/model/placement-transitions.ts`, `shelf-transitions.ts` — cohort-agnostic pure core (reuse as-is).
- `src/_pages/plan-detail/model/cross-cohort-index.ts:21-39` — the index that goes static → live.
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:49,56,113-151,207,242` — island root, single provider, single drop handler.
- `src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx:157,165`, `model/cell-key.ts:10`, `ui/shelf/ShelfDrawer.tsx:46` — non-cohort-scoped dnd-kit IDs.
- `src/_pages/plan-detail/model/drag.ts:9-19` — drag payload types lacking cohort.
- `src/_pages/plan-detail/model/constraints/{teacher-availability,cross-cohort-teacher}.ts` — board-only constraints (out of fast path).
- `src/_pages/plan-detail/ui/slot-cell/WeekToggle.tsx` — compact week A/B toggle (ship as-is).
- `src/_pages/plan-detail/model/collision-parity.test.ts:395-397` — S-06 parity `it.todo`.
- `src/_pages/plan-detail/ui/ComputeGroupingsEmptyState.tsx:13-17` — stale "S-06" comment to correct.

## Architecture Insights

- **The pure core is already cohort-agnostic**, so the combined view is a thin generalization of orchestration (scalar `cohort` → state key), not a constraint-core rewrite. This is the single biggest reason the slice is low-risk on correctness.
- **The one real model change is ownership/freshness, not new rules**: turning the cross-cohort occupancy index from a static SSR snapshot into a value derived from both columns' live placements. Everything downstream (collision derivation, drop hints, duplicate-target search) already consumes that index; only its *source* changes.
- **Two providers vs one is really an undo decision in disguise.** Isolated providers are the cheaper cross-cohort guard but fracture the future S-08 op-log; one provider + cohort-scoped IDs keeps both the guard and a single undo home. Decide it now (D2/D3), as it sets where state and history live.
- **Forward-compat was pre-paid by earlier slices**: the shelf is row-stamped by cohort, `unshelve_bundle` ignores the caller's cohort, and a trap note steers cohort-awareness to a wrapper rather than `SlotCell`. The prior slices were built with this view in mind.

## Historical Context (from prior changes)

- `context/archive/2026-06-22-cohort-switching/research.md:91-148` — S-04 research; trap #4 (keep `SlotCell` cohort-blind to preserve the two-column render); frames S-06 as "rendering both" rather than remounting.
- `context/archive/2026-06-23-first-class-bundle-operations/plan.md:194` — S-05 note that bundle *merge* is not cleanly reversible (relevant to S-08 undo, and to why a single op-log owner matters).
- `context/archive/2026-06-26-bundle-holding-container/research.md:42,109,135-138` — S-07 shelf decisions: scope by `bundle.cohort` (never a global active cohort); mount inside the board island; UX leaning toward one shared cohort-tagged drawer.
- `grouping-refresh-stale-version` (committed, folder `context/changes/grouping-refresh-stale-version/` not yet archived) — shipped the re-compute + staleness subsystem the `ComputeGroupingsEmptyState` comment wrongly attributes to S-06.

## Related Research

- `context/foundation/roadmap.md:147-158` (S-06 slice) and `context/foundation/prd.md` FR-007, FR-008, US-01, Open Q #2.
- This change's identity file: `context/changes/combined-two-cohort-view/change.md`.

## Open Questions

1. **Layout / screen-fit (D5, PRD Open Q #2).** The only decision requiring author + design input. Default recommendation: compact side-by-side columns as an additive assembly/review surface; single-cohort boards remain the primary editing surface.
2. **Combined view: new route vs mode.** Research recommends a **new route** (`/plans/[id]/combined`); confirm in `/10x-plan`.
3. **Should the combined view be the place co-teaching/bi-weekly are *exercised* end-to-end (US-01)?** US-01 implies the demo scenario runs through the combined view; confirm the slice's acceptance test mirrors US-01 (and implements the `collision-parity` `it.todo`).
4. **Housekeeping (not blocking):** roadmap S-04 status drift (detail says `proposed`, code says done/archived) and the stale "S-06" comment in `ComputeGroupingsEmptyState.tsx`.
