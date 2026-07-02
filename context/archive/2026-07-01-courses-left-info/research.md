---
date: 2026-07-01T23:11:51+0200
researcher: Dobromir Kropielnicki
git_commit: 24c53058a94cdbfe0b1b6e53d738a119a74ce36e
branch: main
repository: ib-timetable-planner
topic: "Extend the board top-bar 'courses left' indicator to show which courses still need placing"
tags: [research, codebase, plan-detail, board-header, hours, unplaced-courses, popover]
status: complete
last_updated: 2026-07-02
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Resolved scope decisions (Popover, no interactivity, per-course + subtotal, exclude parked from list AND counter); added over-placed sibling case in a combined two-section popover"
---

# Research: Extend the board top-bar "courses left" indicator to show *which* courses still need placing

**Date**: 2026-07-01T23:11:51+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 24c53058a94cdbfe0b1b6e53d738a119a74ce36e
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

The Planner board top bar shows how many courses are left to place. It's useful, but we want to extend it with information on **which** courses still need to be placed on the board. Check feasibility — UI options and model feasibility.

**Scope selected** (via clarifying questions): surface the detail in a **Popover** anchored on the counter; **static list** (no board interaction) for this iteration. All scope decisions are resolved — see [Decisions (resolved)](#decisions-resolved-2026-07-02).

## Summary

**Verdict: highly feasible, low cost, mostly assembly of existing pieces.** The exact data ("which courses still need hours") is already computed on every render as the by-product of the counter you see today. Adding the list is a one-line filter in the model plus a Popover in the top bar — no new constraint logic, no schema change, no performance concern against the <200 ms drag budget.

Two things worth correcting/knowing up front:

1. **The counter counts *courses*, not *hours*.** The top-bar text is literally "**N courses left to place**" ([`PlanSummaryBar.tsx:51-60`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx#L51-L60)), where `incompleteCount` = number of catalog courses whose *placed hours < required hours* ([`hours.ts:32-38`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/hours.ts#L32-L38)). There is **no aggregate "hours missing" total anywhere** in the code today — the only hours figure is the per-course `placed/required` shown on palette chips ([`HoursCounter.tsx:14-28`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/palette/HoursCounter.tsx#L14-L28)). Good news: the natural per-item row *is* that same `placed/required` shape, and an aggregate "X hours remaining" is a trivial add if you want it (see Open Questions).

2. **The natural granularity is per-course, not per-grouping.** Requirements live per course-hour (`course.hours`); groupings are only palette hint boxes and nothing *requires* a grouping to be placed ([feasibility §1](#2-model-feasibility--the-diff-already-exists)). So "which courses are left" is a per-course list, each with its `placed/required` deficit.

The recommended shape: make the existing "N courses left to place" text a **Popover trigger**; the popover lists the unplaced courses grouped by cohort (DP1/DP2), each row a subject-color chip with the course name and its `placed/required` counter — reusing the palette's existing `MemberRow`/`HoursCounter` render patterns.

## Detailed Findings

### 1. What the counter shows today (and how the number is built)

Data flow, end to end:

`useState<LocalPlacement[]>` ([`use-placements.ts:105`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/use-placements.ts#L105)) → `deriveHours(placements, catalog)` ([`hours.ts:14-25`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/hours.ts#L14-L25)) → `countIncompleteCourses(stats)` ([`hours.ts:32-38`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/hours.ts#L32-L38)) → memoized in `useHours` ([`use-board-derivations.ts:68-72`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/use-board-derivations.ts#L68-L72)) → per-cohort `incompleteCount` on `toCohortState` ([`use-cohort-board-state.ts:226`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/use-cohort-board-state.ts#L226)) → **summed across cohorts** ([`PlannerBoard.tsx:179-183`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/PlannerBoard.tsx#L179-L183)) → prop into `PlanSummaryBar` ([`PlannerBoard.tsx:194`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/PlannerBoard.tsx#L194)) → rendered text ([`PlanSummaryBar.tsx:51-60`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx#L51-L60)).

`deriveHours` returns `Map<courseId, { placed, required }>`; `required = course.hours`, `placed` = count of placement rows for that course (one row = one placed course-hour). Semantics baked in and tested: 0-hour merge-children (`required 0`) are complete from the start; over-placed courses count as complete ([`hours.test.ts`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/hours.test.ts)). The whole thing is **advisory/display-only — completeness is never enforced** ([`hours.ts:10-12`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/hours.ts#L10-L12)).

State is island-local `useState` + `useMemo` — no Redux/Zustand/Context. The catalog (requirements) enters as `props.catalog` from the server loader ([`api/load.ts`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/api/load.ts)).

### 2. Model feasibility — the diff already exists

The set you want is `deriveHours`'s output filtered for `placed < required`:

```ts
[...hours].filter(([, { placed, required }]) => placed < required)   // → courseIds still needing hours
```

- **Identity tokens line up with zero mapping.** Required side = `course.id` (catalog); placed side = `placement.courseId`; both are the same opaque course-id token, and `deriveHours` already keys the diff on it (and defensively drops placements whose course isn't in the catalog — [`hours.ts:20-23`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/hours.ts#L20-L23)). This matches the project lesson *"identity as opaque tokens, display at the edges"* exactly.
- **Display fields are cheap and edge-resolved.** Name + subject color come from `resolveCourseDisplay(courseDisplay, courseId)` → `{ name, color: SubjectColor | null }` ([`course-display.ts:12-13`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/course-display.ts#L12-L13); shape at [`catalog-hash/types.ts:10-16`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/shared/lib/catalog-hash/types.ts#L10-L16)). Note there is **no subject *string*** — subject is encoded as the `color` token, rendered via `subjectChipClass(color)` ([`subject-colors.ts:42`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/shared/config/subject-colors.ts#L42)).
- **Granularity is per-course.** `GroupingCourse.hours` is the requirement ([`catalog-hash/types.ts:18-25`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/shared/lib/catalog-hash/types.ts#L18-L25)). `PlannerGrouping` is only a "deduped member-set" palette hint ([`grouping.ts:22-29`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/grouping/grouping.ts#L22-L29)) — nothing requires a grouping to be placed. A course may be placed solo or via any grouping, and recurs across cells as its weekly hours (there is **no "place once" rule**).
- **Per-cohort.** The `hours` map is per-cohort state; combine both cohorts the way `PlannerBoard.tsx:179` already does (`states = combined ? [dp1, dp2] : [resolveState(focus)]`).
- **Performance: negligible.** One extra linear pass over an in-memory `Map` of tens of entries — a `filter`, not a re-validation; it never touches placements/collision indices again. For scale context, the heavy per-drag work asserts <50 ms with "real cost sub-millisecond" ([`collisions.perf.test.ts:70-71`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/collision/collisions.perf.test.ts#L70-L71)).

**Natural home for the derivation:** add a memoized `deriveUnplaced` alongside `incompleteCount` in `useHours` ([`use-board-derivations.ts:68-72`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/use-board-derivations.ts#L68-L72)), returning identity+hours only (`{ courseId, placed, required }[]`), and resolve names at the UI edge. Per the *"declarative pipelines over accumulator loops"* lesson, write it as `filter().map()`, not a `let`-loop, and co-locate a test in `hours.test.ts`.

### 3. UI options (and why Popover fits)

Primitives inventory (note: **no `src/components/ui/` — everything is under `src/shared/ui/`**):

| Option | Primitive status | Fit | Notes |
|---|---|---|---|
| **Popover on the counter** *(chosen)* | `Popover` **exists & in use** ([`shared/ui/popover.tsx`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/shared/ui/popover.tsx)) | ★ best | Keeps the slim top bar compact; click "N left" to reveal the list. Direct precedents below. |
| HoverCard / Tooltip | **missing** (native `title=""` only) | poor | Hover-only is bad for touch and for scanning a multi-row list; would require adding a primitive. Popover strictly dominates. |
| Inline expandable chips in the bar | n/a | poor | The header is a slim ~37px flex row; inlining chips clutters it and fights the plan-name/cohort-switch/undo cluster. |
| Side/edge panel ("unplaced tray") | bespoke `CollapsibleEdgePanel` / `ShelfDrawer` exist | overkill now | The right pattern *if* the list becomes long or interactive later (mirrors the parked shelf). Heavier than a static read needs. |

**Precedents that make Popover the low-risk choice:**
- The **parked "N parked" badge** in this very row is already a click-to-open affordance ([`PlanSummaryBar.tsx:38-50`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx#L38-L50)) — the closest existing analogue.
- `plan-board-zoom` just added a **gear → Popover** in this same top bar, with the explicit accepted trade-off that a hidden control costs one extra click ([`plan-board-zoom/research.md:339-343`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/context/archive/2026-07-01-plan-board-zoom/research.md#L339-L343)).
- `grouping-refresh-stale-version` enumerated the three canonical placements for a board-level signal (Badge-in-bar / full-width banner / palette badge) and named the "N courses left" pattern as the reference ([`grouping-refresh-stale-version/research.md:154-157`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/context/archive/2026-06-24-grouping-refresh-stale-version/research.md#L154-L157)).

### 4. Recommended design (Popover + static list)

**Trigger.** Turn the existing count text into a `PopoverTrigger asChild` button; add a small affordance cue (e.g. dotted underline or a chevron) so it reads as interactive. Disable/plain-render it when `incompleteCount === 0` (the "All course hours placed" state has nothing to show).

**Content.** A `PopoverContent` (token-driven — `bg-popover text-popover-foreground`) containing:
- `PopoverHeader`/`PopoverTitle`: e.g. "Courses left to place".
- Grouped by cohort (**DP1 / DP2**) since the data is per-cohort — show both groups in combined mode, only the focused cohort in focus mode (reuse the same `states` array from [`PlannerBoard.tsx:179`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/PlannerBoard.tsx#L179)).
- Each row mirrors the palette `MemberRow` ([`GroupingBox.tsx:84-95`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/palette/GroupingBox.tsx#L84-L95)): a `subjectChipClass(color)` chip with the truncated course name + a `HoursCounter` showing `placed/required` (deficit = `required − placed`).
- Wrap the list in a `max-h-[…] overflow-y-auto` div (no `ScrollArea` primitive exists; the palette uses the same plain-overflow pattern — [`PaletteBody.tsx:56`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/palette/PaletteBody.tsx#L56)).

**Wiring (thin, keeps components presentational).**
1. `hours.ts`: add `deriveUnplaced(stats): { courseId, placed, required }[]` (declarative `filter().map()`) + co-located test.
2. `useHours`: return `{ hours, incompleteCount, unplaced }`; thread `unplaced` through `useCohortDerivations` → `toCohortState`.
3. `PlannerBoard`: it already holds `courseDisplay`; build a display-resolved, cohort-tagged structure from the same `states` array and pass it to `PlanSummaryBar` (add one prop). Resolution stays at the UI edge via `resolveCourseDisplay`.
4. `PlanSummaryBar`: wrap the counter in the Popover; render the grouped list. Stays a presentational component.

**Effort:** small. No migration, no action/API change, no constraint-core edit. All new styling uses existing semantic tokens (`bg-popover`, `text-muted-foreground`, `subject-*` chips) per the *"semantic theme tokens, never hardcoded colors"* lesson.

### 5. Interactivity (deferred, but cheaply feasible later)

Out of scope for this static iteration, but noted so the design doesn't paint us into a corner: the "click an unplaced course → highlight its legal slots" behaviour is **already supported** by existing model machinery. `deriveDropHints({ members }, …)` ([`drop-hints.ts:91-132`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/drop-hints.ts#L91-L132)) computes valid-slot maps for any member-set headlessly (proven by `findDuplicateTarget` at [`duplicate-target.ts:35-57`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/placement/duplicate-target.ts#L35-L57)). Caveat: any such hook must live downstream of the `useCombinedBoardState` live-index assembly so it feeds the same cross-cohort `freshIndex` ([`use-cohort-board-state.ts:18-41`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/use-cohort-board-state.ts#L18-L41)), or cross-cohort clashes won't show.

## Code References

- [`src/_pages/plan-detail/model/hours.ts:14-38`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/hours.ts#L14-L38) — `deriveHours` (the diff) + `countIncompleteCourses`; the unplaced list is a filter over `deriveHours`.
- [`src/_pages/plan-detail/model/use-board-derivations.ts:68-72`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/use-board-derivations.ts#L68-L72) — `useHours`; add memoized `deriveUnplaced` here.
- [`src/_pages/plan-detail/model/use-cohort-board-state.ts:191,221-227`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/use-cohort-board-state.ts#L221-L227) — per-cohort `hours`/`incompleteCount` on `toCohortState`.
- [`src/_pages/plan-detail/ui/PlannerBoard.tsx:179-194`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/PlannerBoard.tsx#L179-L194) — cohort selection + cross-cohort sum + `PlanSummaryBar` props; owns `courseDisplay`.
- [`src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx:37-62`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx#L37-L62) — the top-bar cluster; parked-badge-as-button precedent (`:38-50`) and the counter span (`:51-60`).
- [`src/_pages/plan-detail/ui/palette/HoursCounter.tsx:14-28`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/palette/HoursCounter.tsx#L14-L28) — reusable `placed/required` counter (mutes when complete).
- [`src/_pages/plan-detail/ui/palette/GroupingBox.tsx:84-95`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/palette/GroupingBox.tsx#L84-L95) — `MemberRow` (chip + name + HoursCounter) render pattern to mirror.
- [`src/_pages/plan-detail/model/course-display.ts:12-13`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/course-display.ts#L12-L13) — `resolveCourseDisplay` edge resolver (name + color).
- [`src/shared/lib/catalog-hash/types.ts:10-25`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/shared/lib/catalog-hash/types.ts#L10-L25) — `CourseDisplay` (edge) + `GroupingCourse` (requirements, `hours`).
- [`src/shared/ui/popover.tsx`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/shared/ui/popover.tsx) — the Popover primitive (+ `PopoverHeader/Title/Description` parts).
- [`src/shared/config/subject-colors.ts:42`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/shared/config/subject-colors.ts#L42) — `subjectChipClass(color)` token-driven chip styling.
- [`src/_pages/plan-detail/model/drop-hints.ts:91-132`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/drop-hints.ts#L91-L132) + [`placement/duplicate-target.ts:35-57`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/placement/duplicate-target.ts#L35-L57) — reusable valid-slot machinery for a *future* interactive highlight.

## Architecture Insights

- **The list is a projection of an existing derivation, not new domain state.** Keep it that way: derive in `model/` (identity + hours), resolve display in `ui/`. This honors the *"port the mechanism, identity as opaque tokens, display at the edges"* lesson and avoids a parallel domain.
- **Per-cohort by construction.** Every hours derivation is cohort-scoped; the top bar sums for the count but the list must preserve the cohort split. `PlannerBoard.tsx:179` is the single place that already resolves "which cohorts are active" — reuse it, don't re-derive.
- **Advisory, not a gate.** The counter (and therefore the list) is display-only; there is no finalize/completeness enforcement. The list should read as guidance ("here's what's left"), not a blocking checklist.
- **Token discipline.** Popover surface and chips must use `bg-popover`/`text-popover-foreground`/`subject-*` tokens; the "never hardcode palette colors" rule is actively enforced across the codebase.

## Historical Context (from prior changes)

- [`context/archive/2026-07-01-plan-board-zoom/research.md:339-343`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/context/archive/2026-07-01-plan-board-zoom/research.md#L339-L343) — most recent top-bar work; established the **gear → Popover** pattern in this exact bar and accepted the "one extra click to reveal a hidden control" trade-off.
- [`context/archive/2026-06-24-grouping-refresh-stale-version/research.md:154-157`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/context/archive/2026-06-24-grouping-refresh-stale-version/research.md#L154-L157) — canonical menu of placements for a board-level signal (Badge-in-bar / banner / palette badge), naming the "N courses left" pattern as the reference.
- [`context/archive/2026-06-26-bundle-holding-container/research.md:201`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/context/archive/2026-06-26-bundle-holding-container/research.md#L201) — the "badge → expand into a panel of the underlying items" model (parked shelf); the fallback pattern if a static popover proves too small.
- [`context/archive/2026-06-11-multi-variant-management/research.md:226-231`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/context/archive/2026-06-11-multi-variant-management/research.md#L226-L231) — reuses `deriveHours`/`countIncompleteCourses` as the "complete" metric on the plans list; confirms this derivation is the project's canonical completeness signal.
- [`context/archive/2026-06-12-unify-navigation/plan.md:187,210`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/context/archive/2026-06-12-unify-navigation/plan.md#L187) — history of the summary bar: plan name + "N courses left to place" collapsed into one slim row; props are `{ planName, incompleteCount }` with `data-slot="plan-summary"`/`data-incomplete` test hooks (a new `unplaced` prop extends this).
- **PRD does not mandate the counter UI** ([`context/foundation/prd.md:133,197`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/context/foundation/prd.md#L133)) — "complete, collision-free timetable across both cohorts" is the goal; the top-bar counter is an implementation choice, so there's freedom to extend/redesign it.

## Related Research

- `context/archive/2026-07-01-plan-board-zoom/research.md` — top-bar Popover precedent.
- `context/archive/2026-06-24-grouping-refresh-stale-version/research.md` — board-level signal placement options.
- `context/archive/2026-06-26-bundle-holding-container/research.md` — badge-to-panel progressive-disclosure pattern.

## Decisions (resolved 2026-07-02)

1. **Surface — Popover.** Anchor a `Popover` on the existing "N courses left to place" counter text (make it a `PopoverTrigger asChild`). No side panel, no hover-card (neither `HoverCard` nor `Tooltip` primitives exist anyway).
2. **Interactivity — none.** Static list only; no click-to-highlight. The valid-slot machinery (`deriveDropHints`) stays available for a future iteration (see §5) but is out of scope here.
3. **Hours detail — per-course rows + header subtotal.** Each row shows the course name (subject-color chip) + `placed/required` via the existing `HoursCounter` pattern. The popover header carries an aggregate subtotal, e.g. **"6 courses · 11 hours left"**, where hours-left = `Σ(required − placed)` over the listed courses. (Corrects the "hours missing" premise: today's number is a *course* count; this adds the hours figure the user actually wanted.)
4. **Parked — excluded from the list *and* the counter.** Parked courses are dropped from the popover list; and, for trigger/content consistency, the top-bar counter is redefined from "incomplete" to **"incomplete AND not parked"**. The sibling "N parked" badge covers the parked set, so the two badges partition the incomplete courses. **Implication:** the counter derivation (`countIncompleteCourses` and/or its call site in `useHours`) must become parked-aware — this is a small change to *existing* behavior, not purely additive.
5. **Over-placed courses — surfaced in the *same* popover as a second section.** A course with `placed > required` is currently treated as "complete" and shown nowhere ([`hours.ts` over-allocation is display-only](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/model/hours.ts#L10-L12); `hours.test.ts` confirms over-placed counts as complete). It's a likely mistake worth flagging. The counter's popover gets **two sections**: **Missing** (under-placed, not parked) and **Over-placed** (`placed > required`, `excess = placed − required`), each grouped by cohort with `placed/required` rows and a subtotal — Missing: "N courses · M h left"; Over-placed: "N courses · M h over". Over-placed is **board-only** (parking lowers `placed`, so it can never over-place) and needs **no counter change of its own**. Derivation is the mirror filter — a `deriveOverplaced` on the same `hours` map, same near-zero cost as `deriveUnplaced`. Style the section header with `warning` tokens (`--color-warning`). Buckets now partition: *courses left* (under & not parked) · *parked* · *over-placed* · done (exactly placed).

## Remaining detail for planning

- **Parked-course semantics when a course is split.** A course can have some hours on the board and some (or membership) in a parked bundle. Define precisely when it counts as "parked" for exclusion. Candidate rule: exclude a course only when its *entire remaining deficit* is attributable to parked bundles (it needs no further board work); if it still needs board placement, keep it in "courses left". The plan must pin and test this. Inputs available: the `parkedBundles` prop (`LocalParkedBundle` members) → parked courseIds; cross-check against `deriveHours` deficits.
- **Sort order** — default: largest deficit first within each cohort (Missing by deficit, Over-placed by excess); alternative: alphabetical. Decide in plan.
- **Zero/empty + trigger affordance (revised for over-placed).** The trigger is non-interactive ("All course hours placed") **only when both** missing = 0 **and** over-placed = 0. When missing = 0 but over-placed > 0, the trigger stays interactive so the Over-placed section is reachable, with a `warning`-token cue and copy like "All hours placed · 2 over-placed". When missing > 0, keep the primary "N courses left to place" label (plus a warning cue when over-placed > 0). Popover title stays neutral ("Course placement"). Plan pins the exact copy.
- **Focus vs combined parity** — the popover follows the counter's rule: focused cohort only in focus mode, both DP1/DP2 (grouped) in combined mode. Reuse the `states` array at [`PlannerBoard.tsx:179`](https://github.com/dobrek/ib-timetable-planner/blob/24c53058a94cdbfe0b1b6e53d738a119a74ce36e/src/_pages/plan-detail/ui/PlannerBoard.tsx#L179).
