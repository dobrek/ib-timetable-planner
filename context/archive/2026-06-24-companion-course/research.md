---
date: 2026-06-24T22:33:10+0200
researcher: Dobromir Kropielnicki
git_commit: 9852655708dbb06ccdb5f5148de1087de35293a6
branch: main
repository: ib-timetable-planner
topic: "Feasibility of a companion-course filter (second cascading select) for the grouping palette"
tags: [research, codebase, plan-detail, grouping-filter, palette, ui]
status: complete
last_updated: 2026-06-24
last_updated_by: Dobromir Kropielnicki
---

# Research: Companion-course filter for the grouping palette

**Date**: 2026-06-24T22:33:10+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 9852655708dbb06ccdb5f5148de1087de35293a6
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

> Check the feasibility of extending the grouping filter with a **companion course**.
> When the leading course is selected we get a list of groups; the user wants to filter
> that list further against some course that is in the group — an additional select below
> the leading-course selector that narrows the list of groupings. **What kind of data, UI,
> and potential challenges could we face providing this feature?**

**Scope decisions** (confirmed before research):
- **Cascading options** — the companion dropdown lists only courses that co-occur with the
  leading course in the currently-matched groupings (every pick yields a non-empty result),
  excluding the leading course itself.
- **Ephemeral state** — React state only, same lifecycle as the leading filter (resets on
  reload / cohort switch). No URL or DB persistence.

## Summary

**The feature is feasible, low-risk, and small in surface.** It is a natural extension of a
filter that already exists and is deliberately self-contained.

- **Data**: zero schema or load-path changes. A grouping already carries everything needed —
  `memberIds: string[]` (`src/_pages/plan-detail/model/grouping.ts:22`). The companion filter is
  a second membership predicate (`memberIds` contains both courses), and the cascading option
  list is one extra pass over the leading-filtered subset, reusing the existing
  `leadingCourseOptions` counting logic.
- **UI**: a second `<Select>` dropped into `GroupingFilter.tsx` directly below the leading
  Select (between lines 84–85). All DS Select primitives are already exported and reusable, with
  `disabled` styling built in. State stays inside `PlannerPalette` — `PlannerBoard` and the
  presentational components (`GroupingBox`, `PaletteCourseChip`) are untouched.
- **Challenges**: two genuine ones, both about *state correctness*, not plumbing —
  **(1)** the companion selection must reset when the leading course changes/clears (a dangling
  companion silently mis-filters), and **(2)** the palette has no "no groupings match" empty
  state today, so any path to zero results renders a confusing blank pane. The cascading design
  prevents zero by construction, but the empty state is worth adding defensively. Everything else
  (performance, cohort switch) is already handled or trivial.

The codebase also points strongly at *where* this should live: the existing inline `.filter()`
in the palette is at the "repeated touches → refactor" threshold the repo's own lessons call out.
Adding the second predicate is the moment to extract a small, tested `model/` function rather than
inline a second condition.

## Detailed Findings

### 1. Data model — a grouping is already a deduped member set

`PlannerGrouping` (`src/_pages/plan-detail/model/grouping.ts:21-29`):

```ts
export type PlannerGrouping = {
  id: string;
  memberIds: string[];      // course UUIDs — deduped, DB-guaranteed
  coverageCount: number;
  score: number;
  oppositeWeek: boolean;
};
```

- `memberIds` is a plain `string[]` of course IDs. The membership test the leading filter uses
  is just `memberIds.includes(courseId)`. A companion filter adds a second `includes()` — no new
  data shape.
- **Dedup is guaranteed by the database**, not app code: the `course_grouping_members` composite
  PK `(grouping_id, course_id)` (`supabase/migrations/20260602185012_minimal_domain_schema.sql:144-147`).
  A later migration denormalizes a `plan_id` onto the members table but **never drops that PK**
  (`supabase/migrations/20260611180006_plans_as_domain_root.sql:115-123`), so the no-duplicates
  invariant the counting logic relies on still holds.
- **No per-grouping name** — display labels come from a separate `names: Record<string,string>`
  map, so a companion Select reuses the exact strings the leading Select already shows.

### 2. The leading filter is applied inline, by design

The whole filter is a small local hook at the bottom of the palette
(`src/_pages/plan-detail/ui/PlannerPalette.tsx:70-76`):

```ts
function useLeadingFilter(groupings: PlannerGrouping[]) {
  const [leadingCourseId, setLeadingCourseId] = useState<string | null>(null);
  const visibleGroupings = leadingCourseId
    ? groupings.filter((grouping) => grouping.memberIds.includes(leadingCourseId)) // :73
    : groupings;
  return { leadingCourseId, setLeadingCourseId, visibleGroupings };
}
```

- The predicate at `PlannerPalette.tsx:73` is the *entire* filtering logic — there is **no model
  function** for it. The module doc states this is intentional: "The filter is purely a rendering
  concern — nothing outside the palette reads it — so both the selection state and the membership
  filter live here" (`PlannerPalette.tsx:17-21`).
- `GroupingFilter`'s `value`/`onChange` are wired straight to `leadingCourseId`/`setLeadingCourseId`
  (`PlannerPalette.tsx:24,29`); `visibleGroupings` feeds the render loop (`PlannerPalette.tsx:33-35`).
- **Insertion point**: extend `useLeadingFilter` into a two-predicate hook (or add a sibling),
  chaining a second `includes()`:
  ```ts
  visibleGroupings = groupings.filter(g =>
    (!leadingCourseId   || g.memberIds.includes(leadingCourseId)) &&
    (!companionCourseId || g.memberIds.includes(companionCourseId)));
  ```

### 3. Load path & schema — nothing to change

`src/_pages/plan-detail/api/load.ts`:
- Query (`load.ts:52-56`): `course_groupings` selecting `id, coverage_count, score, opposite_week,
  course_grouping_members(course_id)`, filtered by `plan_id` + `cohort`.
- `memberIds` built at `load.ts:86`: `row.course_grouping_members.map((m) => m.course_id)`.
- `names` assembled at `load.ts:123` (`Object.fromEntries(catalog.names)`) from `loadCohortCourses`
  (`src/shared/api/load-cohort-courses.ts:87`).
- **Caveat**: `names` values are *composite tokens* rebuilt by `compositeName`
  (`load-cohort-courses.ts:166-171`), e.g. `name-level-group` — not polished display labels. The
  companion Select inherits whatever the leading Select shows (consistent, but not a human-friendly
  name).

A companion filter needs none of this changed — it consumes already-loaded `groupings` + `names`.

### 4. Cascading option list — reuse `leadingCourseOptions`, exclude the leading course

`leadingCourseOptions(groupings, names)` (`src/_pages/plan-detail/model/leading-course-options.ts:16-27`)
already does exactly the right counting — distinct member courses + the number of groupings each
appears in, via a single-pass `Map`. For the cascading companion list:

1. Filter `groupings` to those containing the leading course (the existing `visibleGroupings`).
2. Run `leadingCourseOptions` over that subset.
3. **Exclude the leading course id** from the result — it's in every grouping of that subset, so it
   would otherwise rank first with the highest count. *This is the one silent-bug trap.*

The sort helpers `sortByGroupCount` / `sortByName` (`leading-course-options.ts:34-38`) and the
`LeadingCourseOption` type (`{ id; name; groupCount }`, `:4`) are reusable **as-is**. The cleanest
shape is a thin sibling, e.g. `companionCourseOptions(groupings, names, leadingId)`, tested next to
`leading-course-options.test.ts`.

### 5. UI wiring — one mount point, shallow prop chain, DS-ready

```
PlannerBoard (palette-view switch; owns groupings/names/hours/stale)
  └─ PlannerPalette        ← only rendered in the "ready" branch (PlannerBoard.tsx:140)
       └─ GroupingFilter   ← the only mount (PlannerPalette.tsx:29)
```

- **State owner is `PlannerPalette`, not `PlannerBoard`** — adding a companion needs **no new props
  on `PlannerBoard`** and no change to `GroupingBox` / `PaletteCourseChip` (they never read the
  selection).
- `GroupingFilter.tsx` is a vertical `flex flex-col gap-1` stack
  (`GroupingFilter.tsx:45`): a header row (label + sort dropdown) then the leading `<Select>`
  (`:67-84`). A second Select slots in **between lines 84 and 85**, rendering directly below with
  consistent spacing — no layout work.
- **DS Select is fully reusable** (`src/shared/ui/select.tsx:149-160`, barrelled at
  `src/shared/ui/index.ts:72-81`). Two independent instances on one screen are fine (thin Radix
  wrappers, no singleton). `disabled` is built in — `SelectTrigger` spreads `...props` and already
  styles `disabled:opacity-50` (`select.tsx:32,35`) — so the companion can render `disabled` when
  no leading course is chosen, with zero new CSS.
- **Sentinel pattern**: the leading Select never uses a placeholder — it always has a value
  (`value ?? ALL`, where `ALL = "__all__"` at `GroupingFilter.tsx:29`) and renders an explicit
  "All groupings" item. The companion mirrors this with its own sentinel (e.g.
  `ANY_COMPANION = "__any__"`) and an "Any companion" cleared item.

## Architecture Insights

- **`model/` owns decisions; components render.** The repo encodes derived dispatch/guards in
  `model/` (e.g. `resolvePaletteView` in `palette-view.ts:15-25`) and keeps JSX dumb. The current
  inline `.filter()` in `useLeadingFilter` is a mild exception. Adding a second predicate is the
  "repeated touches = refactor cue" called out in MEMORY.md ("Orchestration over patching"). The
  idiomatic move: extract a pure `filterGroupings(groupings, leadingId, companionId)` and
  `companionCourseOptions(...)` into `model/`, unit-tested beside `leading-course-options.test.ts`.
- **Reset stale state during render, not in an effect.** There is a direct in-slice precedent:
  `useCollisionInspection` clears now-invalid state inline with the comment "Adjust-state-during-render
  (not an effect) so the close lands in the same render as the recompute"
  (`PlannerBoard.tsx:246-262`, esp. `:253`). The companion reset-on-leading-change should follow
  this, not a `useEffect`.
- **Filtering is a self-contained rendering concern.** Nothing outside the palette reads the
  selection (`PlannerPalette.tsx:17-21`), which is why the blast radius is so small.

## Potential Challenges (prioritized)

| # | Severity | Challenge | Evidence | Mitigation |
|---|----------|-----------|----------|------------|
| 1 | **HIGH** | **Stale companion after leading changes.** A dangling companion id is no longer in the recomputed cascading list (Radix shows a blank value) and can silently filter to zero. | Leading `onChange` resets nothing today (`GroupingFilter.tsx:69-71`, `PlannerPalette.tsx:70-76`). | Reset companion → `null` when leading changes/clears, via adjust-state-during-render (precedent `PlannerBoard.tsx:253`). Encode as a `model/` transition so it's Vitest-testable. |
| 2 | **HIGH** | **No "no groupings match" empty state.** `visibleGroupings.map(...)` renders nothing on an empty result — a blank pane, with the promoted chip still pinned, looks broken. | `PlannerPalette.tsx:33-35`; promoted chip at `:32,47-68`. | Cascading options prevent zero by construction, but add an explicit empty-state message defensively (covers race/stale paths). |
| 3 | MEDIUM | **Companion options must derive from the leading-filtered subset**, not the full `groupings`, and exclude the leading course. Easy to wire to the wrong list — `GroupingFilter` currently gets the *unsorted full* `groupings` while the hook gets the *sorted* list. | `GroupingFilter.tsx:41`, `PlannerPalette.tsx:23-24,29`. | New `companionCourseOptions(subset, names, leadingId)`; be explicit about which list it consumes. |
| 4 | LOW | **Performance** — not a concern. The filter is render-time `.filter()`/`Map`-counting, **not** on the <200ms drag-drop validation path (that's `useCollisions`/`deriveCellViolations`, `PlannerBoard.tsx:199-209`). One more linear pass over an in-memory, compute-capped palette. | `PlannerPalette.tsx:72-74`, `leading-course-options.ts:20-26`. | Optional: memoize option lists on `[groupings, leadingId]` (none is memoized today except `sortGroupingsForPalette`). |
| 5 | LOW | **Cohort switch** already resets filter state for free — switching cohorts is a full SSR remount via a plain `<a href>` (`CohortSwitcher.tsx:31`), which re-runs `loadPlannerData` (`src/pages/plans/[id]/index.astro:11-12`) and destroys the island. | `CohortSwitcher.tsx:6-11,31`. | None needed; add a test to lock it (mirror `e2e/specs/cohort-switching.spec.ts`). |
| 6 | LOW | **Sort toggle / label format** — does the companion want the same By-count/Alphabetical toggle? The sort helpers are generic and reusable, but there's **no shared helper** for the ``${name} (${count})`` label; `course-label.ts` produces a *different* badge format. | `GroupingFilter.tsx:40,80`; `src/shared/lib/course-label/course-label.ts:4-9`. | Decide UX (likely mirror the toggle); extract a tiny `${name} (${count})` formatter if you want to avoid duplicating the template. |
| 7 | UX | **Promoted single-course chip** is pinned for the leading course only (`PlannerPalette.tsx:32,47-68`). Decide whether a companion selection promotes a second chip (likely not — it narrows, it doesn't add a draggable). | `PlannerPalette.tsx:47-68`. | Product decision; default: companion narrows only, no second promoted chip. |

## Test Surface

**Established pattern**: Vitest unit tests on pure `model/` functions; RTL on stateful components;
integration against local Supabase; Playwright for SSR/cohort wiring.

- `model/leading-course-options.test.ts` — thorough unit coverage (counts, name fallback, empty
  input, both sorts, no-mutation). **This is the template** a `companionCourseOptions` test follows.
- `model/palette-view.test.ts` — `resolvePaletteView` cases; unaffected (filter lives only in the
  "ready" branch).
- `ui/GroupingStalePanel.test.tsx` — RTL idiom (mock collaborators, assert behavior).
- `e2e/specs/grouping-staleness.spec.ts`, `e2e/specs/cohort-switching.spec.ts`,
  `src/test/factories/compute-groupings-for.ts` — staleness/cohort + integration palette factory.

**Gap that matters**: there is **no** `GroupingFilter.test.tsx` or `PlannerPalette.test.tsx` — the
leading filter's interactive narrowing is currently untested at the component level. The companion
feature adds interactive logic on top of an untested base.

**Tests the feature should add**:
1. **Unit** — `companionCourseOptions`: co-occurring only, excludes the leading course, counts =
   groupings containing both, empty when leading matches nothing.
2. **Unit (model)** — the reset transition: "changing leading course clears a now-invalid companion".
3. **RTL** — `PlannerPalette`/`GroupingFilter` (fills the existing gap): select leading → companion
   narrows; change leading → companion resets to "Any"; empty result renders the message, not a
   blank pane.
4. **E2E** — likely *not* warranted (the leading filter has none; pure ephemeral client filter).

## Code References

Permalinks at commit `9852655`:

- [`src/_pages/plan-detail/model/grouping.ts#L21-L29`](https://github.com/dobrek/ib-timetable-planner/blob/9852655708dbb06ccdb5f5148de1087de35293a6/src/_pages/plan-detail/model/grouping.ts#L21-L29) — `PlannerGrouping` type (`memberIds: string[]`)
- [`src/_pages/plan-detail/ui/PlannerPalette.tsx#L70-L76`](https://github.com/dobrek/ib-timetable-planner/blob/9852655708dbb06ccdb5f5148de1087de35293a6/src/_pages/plan-detail/ui/PlannerPalette.tsx#L70-L76) — `useLeadingFilter`: state + inline membership predicate (the insertion point)
- [`src/_pages/plan-detail/ui/PlannerPalette.tsx#L17-L35`](https://github.com/dobrek/ib-timetable-planner/blob/9852655708dbb06ccdb5f5148de1087de35293a6/src/_pages/plan-detail/ui/PlannerPalette.tsx#L17-L35) — "filter is a rendering concern" doc + render loop + promoted chip
- [`src/_pages/plan-detail/ui/GroupingFilter.tsx#L39-L87`](https://github.com/dobrek/ib-timetable-planner/blob/9852655708dbb06ccdb5f5148de1087de35293a6/src/_pages/plan-detail/ui/GroupingFilter.tsx#L39-L87) — leading Select + sort dropdown + `ALL` sentinel (pattern to duplicate; new Select slots after L84)
- [`src/_pages/plan-detail/model/leading-course-options.ts#L16-L49`](https://github.com/dobrek/ib-timetable-planner/blob/9852655708dbb06ccdb5f5148de1087de35293a6/src/_pages/plan-detail/model/leading-course-options.ts#L16-L49) — reusable counting + sort helpers
- [`src/_pages/plan-detail/ui/PlannerBoard.tsx#L116-L141`](https://github.com/dobrek/ib-timetable-planner/blob/9852655708dbb06ccdb5f5148de1087de35293a6/src/_pages/plan-detail/ui/PlannerBoard.tsx#L116-L141) — palette-view switch (filter only in "ready" branch)
- [`src/_pages/plan-detail/ui/PlannerBoard.tsx#L246-L262`](https://github.com/dobrek/ib-timetable-planner/blob/9852655708dbb06ccdb5f5148de1087de35293a6/src/_pages/plan-detail/ui/PlannerBoard.tsx#L246-L262) — adjust-state-during-render precedent for the companion reset
- [`src/_pages/plan-detail/model/palette-view.ts#L15-L25`](https://github.com/dobrek/ib-timetable-planner/blob/9852655708dbb06ccdb5f5148de1087de35293a6/src/_pages/plan-detail/model/palette-view.ts#L15-L25) — model-owns-decisions example
- [`src/_pages/plan-detail/api/load.ts#L52-L87`](https://github.com/dobrek/ib-timetable-planner/blob/9852655708dbb06ccdb5f5148de1087de35293a6/src/_pages/plan-detail/api/load.ts#L52-L87) — grouping query + `memberIds` build
- [`src/shared/ui/select.tsx#L19-L43`](https://github.com/dobrek/ib-timetable-planner/blob/9852655708dbb06ccdb5f5148de1087de35293a6/src/shared/ui/select.tsx#L19-L43) — Select trigger (disabled styling + `...props` spread)
- [`src/_pages/plan-detail/ui/CohortSwitcher.tsx#L6-L31`](https://github.com/dobrek/ib-timetable-planner/blob/9852655708dbb06ccdb5f5148de1087de35293a6/src/_pages/plan-detail/ui/CohortSwitcher.tsx#L6-L31) — full-remount cohort switch (free state reset)
- [`supabase/migrations/20260602185012_minimal_domain_schema.sql#L131-L147`](https://github.com/dobrek/ib-timetable-planner/blob/9852655708dbb06ccdb5f5148de1087de35293a6/supabase/migrations/20260602185012_minimal_domain_schema.sql#L131-L147) — `course_groupings` + `course_grouping_members` composite PK
- `src/_pages/plan-detail/model/leading-course-options.test.ts` — unit-test template for `companionCourseOptions`

## Architecture / Implementation Sketch (non-binding)

A minimal, lesson-aligned shape for the eventual plan:

1. **`model/` (new, pure, tested)**:
   - `filterGroupings(groupings, leadingId, companionId)` → narrowed list (replaces the inline
     `.filter()`).
   - `companionCourseOptions(groupings, names, leadingId)` → cascading options (leading-filtered
     subset, leading course excluded), reusing `leadingCourseOptions` internals.
   - A reset rule: companion becomes `null` when it's not among the current companion options.
2. **`PlannerPalette`**: rename `useLeadingFilter` → `usePaletteFilter`, add one
   `useState<string|null>` for the companion, apply the reset during render, pass both ids +
   companion options down.
3. **`GroupingFilter`**: add a second `<Select>` below the leading one (own `ANY_COMPANION`
   sentinel; `disabled` when no leading course), plus optional empty-state messaging.
4. **Tests**: unit (options + reset), RTL (the currently-missing component test), cohort-reset lock.

## Historical Context (from prior changes)

- The palette-view dispatch (`empty`/`stale`/`ready`) and the model-owns-decisions seam came from
  `context/changes/grouping-refresh-stale-version/` (recent commits `0290aff`, `644e447`,
  `f90b9cd`, `9852655`). That work established `resolvePaletteView` and the pattern the companion
  filter should follow for any derived state.
- `context/foundation/lessons.md` — "Port the mechanism, not the legacy type shape" (keep identity
  as opaque tokens, display at the edges — `memberIds`/`names` already follow this) and the
  type-gate lesson (`pnpm check` is the only valid type gate; not `build`/`lint`).
- MEMORY.md — "Orchestration over patching": add behavior as a derived-state dispatch in `model/`,
  not another inline condition; repeated touches = refactor cue. Directly applies to the inline
  palette filter.

## Related Research

- None prior for this slice's filter. Closest is the `grouping-refresh-stale-version` change folder
  (palette-view orchestration), referenced above.

## Open Questions

1. **Companion sort toggle** — mirror the leading filter's By-count/Alphabetical toggle, or keep the
   companion simple (single default order)?
2. **Empty-state copy** — even though cascading prevents zero, what should the defensive "no
   groupings match" pane say, and should it offer a one-click "clear companion"?
3. **Promoted chip** — confirm the companion does *not* promote a second draggable single-course
   chip (default assumption: it only narrows).
4. **Label polish** — `names` are composite tokens (`name-level-group`), not human-friendly. Out of
   scope for this feature, but worth noting it surfaces identically in both selects.
