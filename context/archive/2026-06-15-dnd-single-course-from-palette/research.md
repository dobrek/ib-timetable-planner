---
date: 2026-06-15T10:37:37+0200
researcher: Dobromir Kropielnicki
git_commit: 7670ab4cabcaa00c198774a84432635100521117
branch: main
repository: dobrek/ib-timetable-planner
topic: "Disambiguate palette drag: group-as-a-whole vs single course from the palette"
tags: [research, codebase, plan-detail, palette, drag-and-drop, dnd-kit, leading-course-filter]
status: complete
last_updated: 2026-06-15
last_updated_by: Dobromir Kropielnicki
---

# Research: Disambiguate palette drag (group-as-a-whole vs single course)

**Date**: 2026-06-15T10:37:37+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 7670ab4cabcaa00c198774a84432635100521117
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

The palette currently lets a user drag a course onto the board in two ways: (1) drag the
whole group, or (2) pick one course within a group box and drag it individually. This works
but is confusing. Can we make the palette UI *implicitly* show the available options — e.g.
track a group only as a group (no extracting a member from the box), and instead surface an
individual course as its own draggable item somewhere (perhaps the first element of the list)?
Compare the options and how each fits the current UI, data, and model — then recommend one.

## Summary

**The change is UI-only.** Single-course placement and whole-group placement are two variants
of one discriminated drag payload that already flow through one drop handler; nothing in the
data model, write paths, Astro Actions, DB schema, or the <200 ms validation core needs to
change. The redesign is purely about *where and how* the palette presents the two gestures.

Three load-bearing facts shape the answer:

1. **The confusion is visual, not behavioral.** dnd-kit binds the group drag to the header
   element only (it is a `handleRef`), and each course row is its own independent draggable —
   so a pointer-down on a row drags exactly that course and never mis-fires the group. The
   problem is that the header and every row render the *same* `GripVertical` grip + `cursor-grab`
   with no signal of scope. The box shows N+1 identical grab handles that all look and behave
   alike. (`GroupingBox.tsx:46,93`; dnd-kit binding proof in [Architecture Insights](#architecture-insights).)

2. **"The course is the unit; the group is a hint + bulk-drop convenience"** is the project's
   foundational placement principle, resolved with the author on 2026-06-05. A group drop just
   fans its members into a cell as N ordinary per-course placements; from then on every chip is
   an individual course. The redesign should *preserve* this — keep `CourseDrag → addCourse`
   and `GroupDrag → addGroup` intact — and only restyle the palette.

3. **Individual courses are not first-class rows**, but the universe of them is already computed.
   `leadingCourseOptions(groupings, names)` enumerates every distinct member course with its
   group count (it backs the leading-course filter), and `props.catalog` (`GroupingCourse[]`) is
   the full grouping-independent course list, already loaded into the board. `addCourse` places
   any course regardless of grouping membership, so a "singles" affordance needs no new data.

**Recommendation — Option A (recommended): make group boxes whole-only and let the existing
leading-course filter promote the selected course to a draggable chip pinned at the top of the
palette list.** It matches the user's "first element of the list" mental model exactly, reuses
the recently-shipped filter and `leadingCourseOptions`, reuses the existing `CourseDrag → addCourse`
path with zero model change, and reduces every group box to a single unambiguous gesture. The
two real trade-offs (a single is draggable only while a course is selected in the filter; the
filter takes on a second role) are addressable and are weighed against the alternatives below.

## Detailed Findings

### 1. The current dual-drag mechanism (what exactly exists)

`PlannerPalette` (`PlannerPalette.tsx:19-43`) renders a leading-course `GroupingFilter` over a
scrollable list of `GroupingBox`es. Each `GroupingBox` (`GroupingBox.tsx:23-65`) carries **two
drag affordances**:

- **Whole group** — the box is `useDraggable<GroupDrag>` with the *header* as `handleRef`
  (`GroupingBox.tsx:27-30,39`). Payload `{ kind: "grouping", groupingId }`. On drop,
  `dropGroup` → `addGroup(memberIds, cell)` fans one placement per member into the cell
  (`PlannerBoard.tsx:92-93,102-105`; `use-placements.ts:57`).
- **Single course** — each member row (`PaletteCourse`, `GroupingBox.tsx:67-108`) is its own
  `useDraggable<CourseDrag>`, id `palette:${groupingId}:${courseId}`, payload
  `{ kind: "course", courseId }` (`GroupingBox.tsx:78-81`). On drop, `addCourse(courseId, cell)`
  (`PlannerBoard.tsx:86-88`; `use-placements.ts:53`).

The drag payloads are a discriminated union `DragData = CourseDrag | PlacementDrag | GroupDrag |
BundleDrag` (`drag.ts:8-13`). The palette's `PaletteCourse` rows are the **only** producer of
`CourseDrag` anywhere in the app — grid chips use `PlacementDrag`, not `CourseDrag`
(`SlotCell.tsx:207-211`). So removing per-row palette drag removes the only `CourseDrag` source,
but the kind-keyed *consumers* (`addCourse`, the `"course"` drop case, the `"course"` hint case)
stay valid and become the reusable substrate for any new singles surface.

### 2. Why it reads as ambiguous (and why it is not a bug)

Both affordances render an identical `GripVertical` icon and `cursor-grab`/`active:cursor-grabbing`,
with hover-accent treatment:

- Header (whole group): grip at `GroupingBox.tsx:46`, cursor at `:42-43`, label `"{N} courses"` at `:47`.
- Each row (single course): grip at `GroupingBox.tsx:93`, cursor at `:88-89`, label = course name at `:94`.

A single box therefore presents a vertical stack of visually identical grab handles — one on the
header, one on every row — with nothing communicating that one means "drag the whole group" and
the others mean "drag just this course." That is the entire source of the reported confusion.

Mechanically the two are unambiguous: dnd-kit's PointerSensor binds its `pointerdown` listener to
`source.handle ?? source.element` per draggable, so the group's listener sits on the header only
and each row's listener sits on its own `<li>`. A pointer-down on a row activates exactly that
row's `CourseDrag`. (Detail and source reference in [Architecture Insights](#architecture-insights).)
This was a flagged risk during implementation (dnd-kit 0.4 is pre-1.0) and was verified by manual
checkpoint — see [Historical Context](#historical-context-from-prior-changes).

### 3. The foundational placement model — preserve it

From the original drop-with-validation research (2026-06-05), resolved with the author:

> "The course is the unit of placement and movement. Group is just a hint; we always move a
> course. Dropping a grouping is a **bulk-drop convenience** that fans its courses into a cell
> as individual course placements; from then on every course is dragged individually."
> — `context/archive/2026-06-05-first-valid-drop-with-validation/research.md:38,143`

Group dragging (`addGroup`) was an explicitly *deferred* convenience, picked up later as a third
variant of the same `DragData` union — "both modes coexist naturally; this is the union's whole
purpose" (`context/archive/2026-06-12-group-dragging/research.md:32-33,113`). `addGroup` is
literally an optimized batch of N `addCourse`-equivalent inserts that lands in one `setPlacements`
(`use-placements.ts:57,95-117`); both paths end at the same single-row `insertPlacement`
(`placements.ts:39-69`).

**Implication:** the redesign must keep both `CourseDrag → addCourse` and `GroupDrag → addGroup`
working. We are changing *presentation*, not the placement model. A useful corollary: a **singleton
grouping** (a course that conflicts with every other course → a 1-member set; produced by
`enumerate.ts:38-49`, tested at `enumerate.test.ts:54-59`) already appears as a group box with one
course, and a whole-box drag of it places exactly that single course. Many "place one course" needs
are therefore already covered by 1-member group boxes; the explicit singles surface is specifically
for **extracting a course that is bundled with others.**

### 4. Do individual courses exist as data? (feasibility of a "singles" item)

No standalone "individual course" rows exist. `course_groupings` + `course_grouping_members` are
computed at runtime (never seeded; `seed.sql` has zero grouping inserts) and a `PlannerGrouping` is
`{ id, memberIds, coverageCount, score }` (`grouping.ts:20-25`, loaded at `load.ts:48-75`). Individual
courses are derivable two ways, both already in memory on the board:

- **`leadingCourseOptions(groupings, names)`** (`leading-course-options.ts:16-27`) — one entry per
  *distinct member course that appears in ≥1 grouping*, as `{ id, name, groupCount }`. This is the
  exact universe the leading-course filter dropdown already lists.
- **`props.catalog` (`GroupingCourse[]`)** — the full, grouping-*independent* per-plan-cohort course
  list (`{ id, teacherKey, studentKeys, hours }`), assembled in `shared/api/load-cohort-courses.ts`
  and already passed to the board (`PlannerBoard.tsx:35`). It is the superset: it includes courses
  that are in *no* grouping. It is currently **not** passed to `PlannerPalette`.

`addCourse(courseId, cell)` is fully independent of groupings — a placement only FKs `course_id →
courses(id)`, with no tie to any grouping row (`placements.ts:10-16`; schema FK at
`20260602185012_minimal_domain_schema.sql:122`). So a synthesized "single course" draggable (a
`courseId` with no grouping row) places correctly today. Per-course stats are available without a
grouping row: hours via the existing `hours` map (already a palette prop, keyed by `courseId`),
and student count via `course.studentKeys.length` from `catalog`. (`score` is a set-fit metric,
meaningless for a single and not displayed anyway.)

**Singles-universe decision for the plan:** use `leadingCourseOptions` (courses that appear in a
grouping — matches "extract from a group") *or* `catalog` (every plan course, including ungrouped).
For the user's "extract a member you can see in a box" intent, `leadingCourseOptions` is the natural
fit and requires no new prop.

### 5. The leading-course filter as a candidate singles surface

The filter (`GroupingFilter.tsx:39-87`) is a Radix `<Select>` over `leadingCourseOptions`, with an
icon-button sort toggle (group-count asc default, alphabetic alternative). Selecting a course sets
palette-local `leadingCourseId` (`PlannerPalette.tsx:37-43`); the list then shows only groupings whose
`memberIds` include it. The selection is *purely a rendering concern* today — nothing outside the
palette reads it.

Because the dropdown already enumerates exactly the individual-course universe (id + name + count),
it is a ready-made host for a singles affordance:

- **Promote-on-select (the "first element" idea):** when `leadingCourseId` is set, render that course
  as a single draggable chip pinned at the top of the palette list, above the filtered group boxes.
  Reuses the id/name from `leadingCourseOptions` and the `CourseDrag → addCourse` path verbatim;
  needs only a small palette-level draggable component (extract/lift today's `PaletteCourse`) and a
  distinct draggable id (e.g. `single:${courseId}`, since rows are no longer draggable there is no
  collision).

**Naming/semantic note for the plan:** "leading course" (a pivot for *narrowing* the group list)
and "individual course" (a *placeable unit*) are the same `courseId` riding the same `CourseDrag`,
but the words encode different roles. If one control serves both, pick one vocabulary or make the
dual role explicit in the label, so "Leading course" doesn't under-describe the drag role.

## Options Matrix

All options first make **group boxes whole-only** (remove the per-row `PaletteCourse` draggable so
each box has exactly one gesture). Sub-decision common to all: keep the header as the drag handle, or
make the whole box draggable (cleaner — "the box *is* the group, grab it anywhere"). They differ in
**where individual courses become draggable.** All are UI-only.

| | **A — Filter-promoted chip** *(recommended)* | **B — Dedicated singles section** | **C — In-box explicit extract** | **D — Visual disambiguation only** |
|---|---|---|---|---|
| Singles surface | Selected leading course pinned as a draggable chip at top of list | Separate always-present list of individual courses | Rows stay in box, display-only, with an explicit "drag out" affordance per row | Keep nesting; just differentiate header grip vs row grips |
| Matches "first element of the list" | ✅ exactly | partial (own section) | ❌ (stays in box) | ❌ |
| "Group tracked only as a group" | ✅ | ✅ | ⚠️ (rows still in box, but not a group gesture) | ❌ (rows still drag) |
| New data needed | none (`leadingCourseOptions`) | none (`leadingCourseOptions` or `catalog`) | none | none |
| Model / write-path / DB change | none | none | none | none |
| Discoverability of singles | medium (must select a course first) | high (always visible) | high (in context) | high (same as today) |
| Palette clutter | low | higher (every course listed twice) | low | none |
| Reuses recent filter work | ✅ strongly | partially (as data source) | ❌ | ❌ |
| Net new UI surface | small | medium | small–medium | smallest |

Reusable substrate shared by A/B/C/D: `addCourse` (`use-placements.ts:53`), the `"course"` drop case
(`PlannerBoard.tsx:86`), and the `"course"` hint case (`drop-hints.ts:47`) already exist and stay valid;
a single course never yields a `"partial"` hint, so it is the cheapest hint path. `GroupDragOverlay`
correctly ignores `"course"` (default source-element feedback), and the global
`Feedback.configure({ dropAnimation: null })` (`PlannerBoard.tsx:259-261`) already covers
copy-from-palette drags — so a promoted chip needs no overlay treatment.

## Recommendation

**Option A — whole-only group boxes + filter-promoted single chip.** Reasoning:

- **Matches the user's mental model** ("place the individual course as the first element of the list").
- **Smallest coherent change that fully removes the ambiguity**: each group box drops to one gesture
  (the stacked-identical-grips problem disappears), and the single lives in a clearly different place
  with its own chip.
- **Maximum reuse**: the leading-course filter (shipped 2026-06-14) already lists every individual
  course with name + count; the `CourseDrag → addCourse` path and the drag-hint/overlay handling are
  untouched. No `model/`, action, write-path, or DB change; no <200 ms-budget or steiger risk.
- **Coherent narrative**: selecting course X means "I'm focused on X" → drag X solo from the top, and
  see the groups that contain X below it. The filtered list stays relevant rather than fighting the
  drag intent.

Decisions to settle in `/10x-plan`:
1. **Header-handle vs whole-box draggable** for the group box (recommend whole-box for clarity).
2. **Singles universe**: `leadingCourseOptions` (courses in groupings) vs `catalog` (all plan courses).
3. **Cleared-filter behavior**: with no course selected there is no promoted single (1 extra click to
   stage one). Decide whether that is acceptable or whether a lightweight always-present entry point is
   also wanted — which is exactly the pivot to **Option B** if discoverability outranks palette
   cleanliness.

Fall back to **Option B** (dedicated singles section) if singles must be draggable without first
interacting with the filter; fall back to **Option C/D** if the appetite is only to disambiguate the
current nesting without relocating singles. Option D alone does *not* satisfy "track a group only as a
group," so it is a partial fix.

## Architecture Insights

- **dnd-kit handle binding (the proof the dual drag is unambiguous).** The PointerSensor binds its
  `pointerdown` listener to `source.handle ?? source.element` per draggable
  (`node_modules/@dnd-kit/dom/index.js:1966-1977`). The group draggable's listener is on the header
  (its `handleRef`) only; each row's listener is on its own `<li>`. A secondary guard sets
  `event.sensor` and bails if already captured (`index.js:1984,2000,2152-2154`), so even overlapping
  listeners can't double-activate. Confirms: the redesign fixes a *visual* problem, not a race.
- **One discriminated union, two presentations.** `DragData` keeps single-course and whole-group as
  peer variants flowing through one `handleDrop`. The redesign changes only which DOM produces a
  `CourseDrag`; the union and all model branching stay intact and reusable.
- **Overlay/feedback asymmetry is intentional.** Group/bundle drags get a synthesized `OverlayCard`
  clone (they have no single source element) while course/placement drags keep default source-element
  feedback (`GroupDragOverlay.tsx:13-22,59-62`). A promoted single chip is a clean single element →
  no overlay needed; `isOverlayKind` already returns false for `"course"`.
- **Two orthogonal orderings already coexist** in the palette: group boxes sort by students desc →
  course count desc → id (`sort-groupings.ts:10-17`), while the filter dropdown sorts by group-count
  asc / alphabetic (`leading-course-options.ts:34-49`). A promoted single chip introduces a *third*
  surface — keep its ordering question explicit.
- **FSD/perf clean for all options.** Edits stay within `_pages/plan-detail/ui/*` importing the slice's
  own `model/*` and `@/shared/ui` — downward only, no steiger risk. Placement still flows through the
  same single-row insert; rendering extra palette items is render cost, not validation cost. Pure
  client-side derivation over already-loaded props — no Workers-runtime concern.

## Historical Context (from prior changes)

- **Course-is-the-unit principle** — `context/archive/2026-06-05-first-valid-drop-with-validation/research.md:38,143`:
  "The course is the unit of placement and movement. Group is just a hint… dropping a grouping is a
  bulk-drop convenience that fans its courses into a cell as individual course placements."
- **Single-course-only was the original scope; group bulk-drop was deferred** —
  `…2026-06-05…/plan.md:40` ("Whole-group bulk-drop … out of scope"), then picked up in
  `context/archive/2026-06-12-group-dragging/` as a third union variant
  (`research.md:29,32-33,113`). `addGroup` arrived as a batched optimization over an interim
  per-member `addCourse` loop, to keep one `setPlacements` per drop (`…group-dragging…/plan.md:50-55,86`).
- **The "clean drag target" motivation already surfaced** — when collapse/expand was removed from
  `GroupingBox`, the rationale was "freeing the header of the toggle click makes the whole header a
  clean, unambiguous drag target" (`…group-dragging…/plan.md:5,14-22`). No record of *user* confusion
  about the two drag modes; the dual affordance was a deliberate design, not an accident.
- **Nested-draggable pointer mis-capture was a flagged pre-1.0 risk, verified manually** —
  `…2026-06-05…/research.md:138` and `…group-dragging…/plan.md:99-103` ("No pointer mis-capture
  between header and row draggables … drag each in turn … including drag-cancel"). Consistent with the
  code-level proof above.
- **The leading-course filter is recent and adjacent** — `planner-palette-group-sorting` (PR #32) sorted
  the group boxes and *explicitly deferred* the dropdown ordering (`plan.md:70-71`);
  `planner-picking-leading-course` (PR #33, `status: implemented`) then ordered the dropdown by
  group-count asc and added the alphabetic toggle + count labels. Neither change discusses single-course
  *dragging*; a searchable combobox + clear button were dropped as out of scope
  (`planner-picking-leading-course/research.md:263-293`). No prior change records single-course palette
  UX as deferred work — this change folder (`dnd-single-course-from-palette`) is its first home.

## Related Research

- `context/changes/planner-picking-leading-course/research.md` — leading-course filter design + rationale.
- `context/changes/planner-palette-group-sorting/research.md` — palette group-box ordering (predecessor).
- `context/archive/2026-06-12-group-dragging/research.md` — whole-group drag as a union variant.
- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md` — the course-is-the-unit principle.

## Code References

- [`PlannerPalette.tsx:19-43`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/ui/PlannerPalette.tsx#L19-L43) — palette container; `useLeadingFilter` holds `leadingCourseId`.
- [`GroupingBox.tsx:27-65`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/ui/GroupingBox.tsx#L27-L65) — whole-group draggable (header handle), grip at L46.
- [`GroupingBox.tsx:67-108`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/ui/GroupingBox.tsx#L67-L108) — `PaletteCourse`: the per-row `CourseDrag` (only `CourseDrag` producer), grip at L93.
- [`GroupingFilter.tsx:39-87`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/ui/GroupingFilter.tsx#L39-L87) — leading-course `<Select>` + sort toggle.
- [`leading-course-options.ts:16-49`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/model/leading-course-options.ts#L16-L49) — distinct-course universe `{ id, name, groupCount }` + comparators.
- [`drag.ts:8-13`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/model/drag.ts#L8-L13) — `DragData` discriminated union.
- [`PlannerBoard.tsx:85-105`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/ui/PlannerBoard.tsx#L85-L105) — `handleDrop` switch; `"course" → addCourse`, `"grouping" → dropGroup`.
- [`PlannerBoard.tsx:259-261`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/ui/PlannerBoard.tsx#L259-L261) — global `Feedback` drop-animation override (copy-from-palette).
- [`use-placements.ts:53-117`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/model/use-placements.ts#L53-L117) — `addCourse` / `addGroup` write paths.
- [`drop-hints.ts:44-81`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/model/drop-hints.ts#L44-L81) — `resolveDragHintContext`; `"course"` resolves a single member.
- [`GroupDragOverlay.tsx:20-62`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/ui/GroupDragOverlay.tsx#L20-L62) — overlay clone; `isOverlayKind` excludes `"course"`.
- [`SlotCell.tsx:207-211`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/ui/SlotCell.tsx#L207-L211) — grid chips use `PlacementDrag` (not `CourseDrag`).
- [`load.ts:48-75`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/api/load.ts#L48-L75) — grouping load → `PlannerGrouping`.
- [`enumerate.ts:38-49`](https://github.com/dobrek/ib-timetable-planner/blob/7670ab4cabcaa00c198774a84432635100521117/src/_pages/plan-detail/model/enumerate.ts#L38-L49) — singleton (seed-only) groupings can occur.

## Open Questions

1. **Cleared-filter behavior (Option A):** is "no draggable single until a course is selected"
   acceptable, or do we also want an always-present entry point (→ Option B)?
2. **Singles universe:** `leadingCourseOptions` (courses in ≥1 grouping) vs `catalog` (all plan
   courses, incl. ungrouped). Does the user ever need to place a course that is in no grouping?
3. **Group box gesture:** header-handle (current) vs whole-box draggable after removing rows.
4. **Discoverability/affordance:** if singles are filter-gated, how do we signal the capability before
   a course is selected (helper text, label change, an empty-state hint)?
5. **Singleton group boxes:** a 1-member group box already drags a single course — do we visually
   distinguish it from multi-member boxes, or rely on the promoted-chip path for all singles?
6. **Promoted-chip ordering/position:** confirm "first element / top of list" and how it coexists with
   the two existing orderings (group-box sort, dropdown sort).
