---
date: 2026-06-14T00:00:00+02:00
researcher: Dobromir Kropielnicki
git_commit: 4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c
branch: main
repository: dobrek/ib-timetable-planner
topic: "Order the leading-course filter dropdown by per-course grouping count (default, ascending) with an alphabetic toggle, and show the group count in every option label. The Select stays — the combobox idea was dropped."
tags: [research, codebase, plan-detail, planner-palette, grouping-filter, select, sort-toggle, group-count]
status: complete
last_updated: 2026-06-14
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Dropped the combobox/typeahead/clear-button direction; trimmed those sections to a short decision record. Scope is now: group-count sort + alphabetic toggle + count labels on the existing Select."
---

# Research: Leading-course filter — group-count sorting with count labels

**Date**: 2026-06-14T00:00:00+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

The leading-course picker in the planner palette is a Radix `<Select>`. The original ask
also included a typeahead combobox + dedicated clear button; **those were dropped** (see
[Decision record](#decision-record-combobox-direction-dropped)). The remaining feature:

1. Order the dropdown by the **number of groupings each course appears in** — **ascending**
   (fewest-options courses first, since those are the constrained starting points), as the
   **default**.
2. Provide a **toggle** back to the existing **alphabetic** order.
3. **Show the group count in every option label** so the order is legible.

What UI, model, and data changes are needed?

## Locked scope decisions

- **Keep the `<Select>`.** No combobox, no typeahead. The dropdown stays a Radix Select.
- **Clearing stays as the existing "All groupings" option** — no separate clear button is
  needed (the original clear-button ask only made sense alongside a combobox).
- **Default order = group-count ascending.** Alphabetic is the *alternate*, via the toggle.
- **Counts are always shown in the labels**, in both sort modes.
- **Sort-order state is session-only (ephemeral) React state.** No `localStorage`; the
  `drag-hint-mode` machinery is *not* used here (it is referenced only as the toggle-UI
  precedent, not as a persistence model).

## Summary

This is a **client-only, display-layer change inside one slice** (`plan-detail`). No
Supabase, `load.ts`, SQL, migration, action, or island-prop changes — every input is
already in the filter's hands.

- **The "number of groups per course" metric does not exist yet, but is trivially derivable
  client-side.** It is the cardinality of `groupings` whose `memberIds` contain a course id —
  computed from data already passed to `GroupingFilter`. It is **not** `coverageCount` (that
  is *students per grouping*; see [§2](#2-the-data-model--per-course-group-count)).
- **The model work is one small pure file** in `model/` (mirroring `sort-groupings.ts`):
  build `{ id, name, groupCount }[]` and expose two comparators (group-count asc; name asc).
  The current inline alphabetic helper (`GroupingFilter.tsx:48-54`) moves there.
- **The UI work is contained to `GroupingFilter.tsx`**: apply the chosen sort, render the
  `groupCount` in each `SelectItem`, and add a small sort toggle.
- **The toggle is ephemeral React state** holding `"by-groups" | "alphabetic"` (default
  `"by-groups"`). The toggle *control* should mirror the existing segmented
  `DragHintModeToggle` ([`DragHintModeToggle.tsx:18-34`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/DragHintModeToggle.tsx#L18-L34))
  for look, but **without** its `localStorage`/`useSyncExternalStore` plumbing.

Roughly: one new model file (+ test), and edits to `GroupingFilter.tsx` (sort + count
labels + toggle), with the ephemeral sort state held in or beside the filter.

## Detailed Findings

### 1. Current state — the Select-based leading-course filter

`GroupingFilter` is a thin Radix `<Select>` wrapper:

- It renders a `Select` with a `"__all__"` sentinel option for the cleared state (Radix
  Select reserves `""` for the placeholder)
  ([`GroupingFilter.tsx:11-12`, `26-43`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/GroupingFilter.tsx#L11-L43)).
  Choosing "All groupings" → `onChange(null)` is the existing clear path; it stays.
- The option list is the **distinct set of course ids that appear in at least one
  grouping**, mapped to `{ id, name }` and sorted **alphabetically** by name
  ([`leadingCourseOptions`, `GroupingFilter.tsx:48-54`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/GroupingFilter.tsx#L48-L54)).
  This is a local arrow function in the `.tsx` — it predates the one-pure-fn-per-file
  `model/` convention and is the natural thing to lift into `model/`.
- The selection drives a pure membership filter in the palette: `visibleGroupings =
  groupings.filter(g => g.memberIds.includes(leadingCourseId))`
  ([`PlannerPalette.tsx:37-43`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/PlannerPalette.tsx#L37-L43)).
  This change does **not** touch the filter — only the dropdown's order and labels.
- The palette intentionally passes the **raw** `groupings` (not the box-sorted
  `sortedGroupings`) to `GroupingFilter`
  ([`PlannerPalette.tsx:20-26`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/PlannerPalette.tsx#L20-L26)),
  so the dropdown order is independent of the box order — our new dropdown sort is orthogonal
  to the just-shipped box sort.

The just-completed `planner-palette-group-sorting` change **explicitly excluded** this
dropdown: *"No change to the `GroupingFilter` leading-course dropdown ordering — out of
scope"* (`context/changes/planner-palette-group-sorting/plan.md:70-71`). This change is the
deliberate follow-up to that carve-out.

### 2. The data model — per-course "group count"

**Provenance (all already at the filter, zero new threading).** `groupings` and `names`
flow load → island → palette → filter untouched:

- `groupings: PlannerGrouping[]` — selected in
  [`load.ts:49-53`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/api/load.ts#L49-L53),
  projected with `memberIds: row.course_grouping_members.map(m => m.course_id)`
  ([`load.ts:70-75`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/api/load.ts#L70-L75)),
  returned as a prop ([`load.ts:103`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/api/load.ts#L103)),
  passed `PlannerBoard` → `PlannerPalette` → `GroupingFilter`.
- `names: Record<string,string>` — built in
  [`load-cohort-courses.ts:75`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/shared/api/load-cohort-courses.ts#L75)
  (`compositeName`, L143-148), serialized via `Object.fromEntries`
  ([`load.ts:104`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/api/load.ts#L104)).

**The metric.** "Number of groupings a course appears in" =

```
groupCount(courseId) = groupings.filter(g => g.memberIds.includes(courseId)).length
```

`memberIds` is on every `PlannerGrouping` ([`grouping.ts:20-25`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/model/grouping.ts#L20-L25))
and the very same `memberIds.includes(...)` predicate already powers the palette filter
(`PlannerPalette.tsx:40`) and the option id-set (`GroupingFilter.tsx:52`). So the count is a
pure reduction over data already in props. **No precomputed per-course count exists
anywhere** (grep for `groupCount`/`group_count` is empty).

> **`groupCount` ≠ `coverageCount`.** `coverageCount` is *students per grouping* (a field on
> each grouping — [`grouping.ts:23`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/model/grouping.ts#L23),
> computed at `score.ts:12`) and is the *primary key of the box sort*
> ([`sort-groupings.ts:14`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/model/sort-groupings.ts#L13-L17)).
> This feature needs a **per-course cardinality over the `groupings` array** — a different
> axis. Do not conflate them.

**No backend change of any kind.** Confirmed across all vectors: `load.ts` already projects
`memberIds` and passes `groupings`; no SQL `ORDER BY`, migration, column, or new island prop
is involved. The count and the label are derived per render on the client.

### 3. Sort logic — where it lives and the comparators

Mirror `sort-groupings.ts` exactly (public fn first, private comparator below, `toSorted`
non-mutation, co-located `*.test.ts`). New file **`model/leading-course-options.ts`**:

```ts
export type LeadingCourseOption = { id: string; name: string; groupCount: number };

// distinct member courses → { id, name, groupCount }; unsorted (caller orders).
// count in a single pass over memberIds (Map), not filter().length per id.
export const leadingCourseOptions = (
  groupings: PlannerGrouping[],
  names: Record<string, string>,
): LeadingCourseOption[] => { /* … */ };

export const sortByGroupCount = (o: LeadingCourseOption[]) => o.toSorted(compareByGroupCount); // DEFAULT
export const sortByName      = (o: LeadingCourseOption[]) => o.toSorted(compareByName);

// group-count ASC, then name (the old alphabetic order) as a stable tiebreaker:
const compareByGroupCount = (a, b) =>
  a.groupCount !== b.groupCount ? a.groupCount - b.groupCount : a.name.localeCompare(b.name);
const compareByName = (a, b) => a.name.localeCompare(b.name);
```

Notes for the plan:
- **Default = `sortByGroupCount` (ascending).** Fewest-group courses float to the top — the
  intended "start with the constrained courses" behavior.
- **Total-order safety**: `compositeName` collisions are unlikely but not provably
  impossible; add `id` as the final tiebreaker (`name.localeCompare || id.localeCompare`)
  to guarantee a deterministic order, exactly as `sort-groupings.ts:16` uses `id`.
- **Counts always shown** (locked decision): the option type always carries `groupCount`
  and the label always renders it, regardless of sort mode — the comparator choice only
  reorders; it never changes what's displayed.

### 4. UI — count labels in the Select + the sort toggle

**Count in the label.** Each `SelectItem` keeps the course name and adds the count. Render
it as a right-aligned muted span inside the item — `ml-auto tabular-nums text-muted-foreground`
— mirroring the box header's counter pattern
([`GroupingBox.tsx:92-103`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/GroupingBox.tsx#L92-L103)),
rather than baking `"(3)"` into the text. (Confirm exact format at plan time — see Open
Questions.) The Select's `value` stays the course `id` exactly as today; nothing about
selection changes.

**Sort toggle.** Two discrete modes ⇒ a two-segment control. The in-slice precedent is the
segmented `DragHintModeToggle` (Radix `Tabs`/`TabsList`/`TabsTrigger` + lucide icons +
`text-muted-foreground` label, [`DragHintModeToggle.tsx:1, 16-34`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/DragHintModeToggle.tsx#L1-L34)).
Mirror its **look** (e.g. an `ArrowDownAZ` segment and a `Hash`/count segment) but **not**
its persistence.

> **Reuse the toggle UI, not the storage layer.** `DragHintModeToggle` is driven by a
> `localStorage` helper (`drag-hint-mode.ts`) through `useSyncExternalStore`
> ([`PlannerBoard.tsx:219-226`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/PlannerBoard.tsx#L219-L226)).
> Per the locked decision, the sort order is **session-only**, so it is plain
> `useState<"by-groups" | "alphabetic">("by-groups")` — no helper, no `localStorage`, no
> `useSyncExternalStore`, and therefore none of the `localStorage`-guarding lesson applies.

### 5. State ownership & theming

- **State ownership.** `PlannerPalette` already owns the filter selection (`leadingCourseId`
  via `useLeadingFilter`, [`PlannerPalette.tsx:37-43`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/PlannerPalette.tsx#L37-L43)).
  Two clean options: (a) keep the new `sortOrder` `useState` *inside* `GroupingFilter`
  (self-contained; nothing else reads it) — minimal surface; or (b) lift it into
  `PlannerPalette` beside `leadingCourseId` for symmetry. Recommend **(a)** unless the
  toggle is rendered outside the filter component.
- **Theming.** Use semantic tokens only (`text-muted-foreground`, `tabular-nums`, …) per the
  *semantic-theme-tokens* lesson. The `Select` and `Tabs` primitives are already token-clean;
  no new primitive is added, so no detokenize pass is needed.

## Code References

- [`src/_pages/plan-detail/ui/GroupingFilter.tsx:11-54`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/GroupingFilter.tsx#L11-L54) — the Select; `"__all__"` sentinel (clear path stays); inline alphabetic `leadingCourseOptions` (move to `model/`); `SelectItem` is the count-label render point.
- [`src/_pages/plan-detail/ui/PlannerPalette.tsx:19-43`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/PlannerPalette.tsx#L19-L43) — passes raw `groupings`+`names` to the filter; owns `leadingCourseId`; membership filter via `memberIds.includes`.
- [`src/_pages/plan-detail/model/grouping.ts:20-25`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/model/grouping.ts#L20-L25) — `PlannerGrouping` (`memberIds`, `coverageCount`).
- [`src/_pages/plan-detail/model/sort-groupings.ts:10-17`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/model/sort-groupings.ts#L10-L17) — style/comparator template for the new `model/leading-course-options.ts`.
- [`src/_pages/plan-detail/api/load.ts:49-53,70-75,103-104`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/api/load.ts#L49-L75) — `memberIds` projection; `groupings`/`names` props. No change needed.
- [`src/_pages/plan-detail/ui/GroupingBox.tsx:92-103`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/GroupingBox.tsx#L92-L103) — right-aligned `tabular-nums` counter pattern to mirror for the label count.
- [`src/_pages/plan-detail/ui/DragHintModeToggle.tsx:1-34`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/ui/DragHintModeToggle.tsx#L1-L34) — segmented toggle UI to mirror (look only, ephemeral).
- [`src/_pages/plan-detail/lib/drag-hint-mode.ts`](https://github.com/dobrek/ib-timetable-planner/blob/4ff77038e4a88bd7ee37b71cfb018b4c8fe2567c/src/_pages/plan-detail/lib/drag-hint-mode.ts#L1-L53) — persistence pattern **explicitly not used** here.

## Architecture Insights

- **Display-only over already-loaded data.** Like the box-sort change before it, this is a
  client/render concern; the slice's "filter/sort are purely a rendering concern" stance
  (`PlannerPalette.tsx:14-18`) holds. Resist any pull toward persisting an order or
  recomputing counts server-side.
- **Two orthogonal orderings now exist in the palette**: the *box* order (students desc,
  shipped) and the *dropdown* order (group-count asc, this change). They are independent by
  design — the palette passes raw `groupings` to the filter.
- **Identity vs. display** (lessons.md *"port the mechanism…"*): keep the course **id** as
  the opaque selection token (the Select `value`) and the **name**/count as edge display
  concerns in the label.

## Historical Context (from prior changes)

- `context/changes/planner-palette-group-sorting/plan.md:64-73` — the immediately-prior
  change sorted the *grouping boxes* and **explicitly deferred** the dropdown ordering; this
  change is its planned continuation.
- `context/changes/planner-palette-group-sorting/research.md` — establishes that palette
  ordering is a pure client display concern over data already in scope (`coverageCount`,
  `memberIds`), and the `model/` pure-fn + co-located-test convention this change reuses.
- `context/foundation/lessons.md` — *"semantic theme tokens"*, *"guard `localStorage`…"*
  (N/A here since state is ephemeral), and *"port the mechanism, not the legacy type shape"*
  (keep id as identity, name/count at the edges).

## Related Research

- `context/changes/planner-palette-group-sorting/research.md` — palette ordering, grouping
  data model, `coverageCount` semantics.
- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md` — original
  palette / grouping-card render decisions (per prior research's citations).

## Open Questions

1. **Final tiebreaker:** `name.localeCompare` then `id` for a provable total order, given
   `compositeName` collisions are improbable but not impossible. (Recommendation: include
   `id`.)
2. **Toggle placement & affordance:** segmented `Tabs` (mirrors `DragHintModeToggle`) vs. a
   single icon button; and whether it sits inline beside the Select or on its own row in the
   palette header. (Recommendation: segmented `Tabs`, above/beside the Select.)
3. **Count rendering:** right-aligned muted `tabular-nums` span (recommended) vs. inline
   `"Name (3)"`. Confirm wording/format of the count.

## Decision record: combobox direction dropped

The original ask included replacing the `<Select>` with a **typeahead combobox** plus a
**clear button**. After investigating, that direction was **dropped** — the Select stays.

**Why.** shadcn's first-class `Combobox` (the one exposing the `showClear` clear-button
prop) is **built on Base UI**, not on the repo's existing Radix + cmdk stack. Verified
against the shadcn registry on GitHub (`shadcn-ui/ui`, `apps/v4/…`): every style's
`combobox.json` — `new-york-v4`, `radix-*`, **and** `base-*` — is identical and pulls
`"dependencies": ["@base-ui/react"]` + `"registryDependencies": ["button", "input-group"]`,
with source `import { Combobox as ComboboxPrimitive } from "@base-ui/react"`. The "radix"
label is the *style/theme* family, not the primitive — Radix UI has never shipped a combobox
primitive. (On the docs page, the `@base-ui/react` dependency is listed under the
Installation **Manual** tab and the frontmatter `links.doc: https://base-ui.com/…`; the
default **Command** tab and the `@/components/ui/combobox` usage import hide it.)

Adopting it would mean introducing a new primitive ecosystem (`@base-ui/react`) plus a
second vendored component (`input-group`), reconciling the `@/components/ui` vs
`src/shared/ui` alias, and a detokenize pass — too much for this feature. Hand-composing a
combobox from the installed Popover + cmdk `Command` (mirroring `MultiSelect`) was the
alternative, but with typeahead no longer wanted, the simplest correct choice is to **keep
the Select** and clear via its existing "All groupings" option.

> **Note:** this is *not* a sign the repo is on a legacy shadcn. shadcn is a CLI that vendors
> component source — there is no version to be behind on. The repo's setup is current
> (new-york style, unified `radix-ui@^1.5.0` import convention). The combobox is simply one
> of the few components shadcn now builds on Base UI because Radix lacks the primitive.

If a searchable combobox is ever wanted again, treat adopting shadcn's Base-UI `Combobox`
(or standardizing on Base UI) as its own deliberate change, after which this filter would
trivially reuse it.
