# Planner — Leading-course filter group-count sorting Implementation Plan

## Overview

Order the leading-course `<Select>` in the planner palette by the **number of groupings each
course appears in**, ascending, as the **default** — so the most constrained courses (fewest
options) surface first. Add a small icon-button dropdown **toggle** back to the existing
alphabetic order, and **show each course's group count in its option label** in both modes.

This is a client-only, display-layer change confined to the `plan-detail` slice. No Supabase,
`load.ts`, SQL, migration, action, or island-prop changes — every input (`groupings`,
`names`) is already in the filter's hands.

## Current State Analysis

- **`GroupingFilter.tsx`** is a thin Radix `<Select>` wrapper. Its option list is built by an
  **inline alphabetic helper** `leadingCourseOptions` (`GroupingFilter.tsx:48-54`): distinct
  member-course ids → `{ id, name }`, sorted by `name.localeCompare`. This local arrow
  function predates the one-pure-fn-per-file `model/` convention.
- **`PlannerPalette.tsx:26`** passes the **raw** `groupings` (not the box-sorted
  `sortedGroupings`) plus `names` to the filter, and owns the `leadingCourseId` selection via
  `useLeadingFilter`. The dropdown order is therefore independent of the box order.
- **The "groups per course" metric does not exist yet** (grep for `groupCount`/`group_count`
  is empty) but is trivially derivable: the cardinality of `groupings` whose `memberIds`
  contain a course id. It is **not** `coverageCount` (that is *students per grouping* and is
  the box-sort key — `grouping.ts:23`, `sort-groupings.ts:14`).
- **`sort-groupings.ts`** is the exact template to mirror: public fn first → `toSorted`
  (non-mutating) → private comparator with an `id` final tiebreaker → co-located
  `*.test.ts` (`sort-groupings.test.ts` already exercises primary/secondary/tertiary keys).
- **`DragHintModeToggle.tsx`** is the in-slice toggle precedent, but it is driven by
  `localStorage` via `useSyncExternalStore`. This change is **session-only** ephemeral state,
  so that persistence machinery is deliberately **not** reused.
- **`@/shared/ui` already exports `DropdownMenu*`** (incl. `DropdownMenuRadioGroup` /
  `DropdownMenuRadioItem`), already used as a row-actions menu in `CourseTable.tsx:122-161`
  (`<Button variant="ghost" size="icon">` + lucide icon trigger → `DropdownMenuContent
  align="end"`). This is the affordance to reuse for the sort toggle.
- **`GroupingBox.tsx:95-106`** is the count-label precedent: a right-aligned
  `ml-auto shrink-0 tabular-nums text-muted-foreground` span.

## Desired End State

Opening the leading-course dropdown shows courses ordered by group count ascending by default,
each option labelled with its group count in brackets, e.g. `Mathematics HL (3)`. A small sort
icon button beside the "Leading course" label opens a two-option menu (group count / alphabetical)
with the active mode marked; switching reorders the options live. Selecting a course still
filters the palette exactly as today, and "All groupings" still clears. State resets on
reload (session-only). `pnpm test`, `pnpm lint`, `pnpm steiger`, and `pnpm build` stay clean.

### Key Discoveries:

- Metric: `groupCount(courseId) = groupings.filter(g => g.memberIds.includes(courseId)).length`
  — a pure reduction over data already in props (`grouping.ts:20-25`).
- The count is baked into the option **text** as `(n)`, so it is part of Radix `ItemText` and
  naturally also shows in the collapsed trigger when a course is selected (e.g.
  `Mathematics HL (3)`) — consistent and intended; no separate styling/placement needed.
- Box order (students desc, shipped) and dropdown order (group-count asc, this change) are
  **two orthogonal orderings** — the palette passes raw `groupings` to the filter by design.

## What We're NOT Doing

- **No combobox / typeahead / dedicated clear button.** The `<Select>` stays; clearing
  remains the existing "All groupings" option (see research Decision record).
- **No persistence.** Sort order is ephemeral React state — no `localStorage`,
  no `useSyncExternalStore`, no `drag-hint-mode`-style helper.
- **No backend touch.** No `load.ts`, SQL `ORDER BY`, migration, column, or island prop.
- **No change to the membership filter** (`PlannerPalette` `useLeadingFilter`) or to the box
  sort (`sort-groupings.ts`). Only the dropdown's order and labels change.
- **No edit to the shared `select.tsx` primitive** — the count label is handled within the
  filter (every other Select in the app must stay unaffected).

## Implementation Approach

One pure model file carries the data + comparators; the UI component consumes it, holds the
ephemeral sort mode, renders the count, and adds the toggle. Splitting the metric/sort into
`model/` keeps it Vitest-testable in isolation and follows the established slice convention;
the `.tsx` stays JSX-only.

## Critical Implementation Details

- **Total-order safety.** `compositeName` collisions are improbable but not impossible; the
  group-count comparator must fall through `groupCount asc → name.localeCompare → id` so the
  order is deterministic across reloads, exactly as `sort-groupings.ts:16` uses `id`.

## Phase 1: Group-count sort, count labels, and sort toggle

### Overview

Add the pure model file (+ test), then wire `GroupingFilter` to use it: default group-count
ordering, count labels on every option, and an icon-button dropdown toggle to alphabetic.

### Changes Required:

#### 1. New model file: group-count options + comparators

**File**: `src/_pages/plan-detail/model/leading-course-options.ts`

**Intent**: Provide the distinct leading-course options enriched with their group count, plus
the two orderings the UI toggles between. Mirrors `sort-groupings.ts` in shape and style
(public fn first, `toSorted`, private comparators below). Lifts the order logic out of the
`.tsx` per the `model/` convention.

**Contract**:
- `export type LeadingCourseOption = { id: string; name: string; groupCount: number }`.
- `leadingCourseOptions(groupings: PlannerGrouping[], names: Record<string,string>): LeadingCourseOption[]`
  — distinct member courses, each with `name: names[id] ?? id` and its group count, computed
  in a **single pass** over `memberIds` (accumulate counts in a `Map`, not
  `filter().length` per id). Returned **unsorted** (caller orders).
- `sortByGroupCount(options): LeadingCourseOption[]` — **default**; `toSorted` by group count
  ascending, then `name.localeCompare`, then `id` (total order).
- `sortByName(options): LeadingCourseOption[]` — `toSorted` by `name.localeCompare`, then
  `id`.
- Pure, non-mutating; private comparators below the public exports.

#### 2. New model test

**File**: `src/_pages/plan-detail/model/leading-course-options.test.ts`

**Intent**: Lock the metric and both orderings. Mirror `sort-groupings.test.ts` structure
(a small `grouping(...)` factory, `describe`/`it` per ordering key).

**Contract**: Cover — (a) `leadingCourseOptions` produces one entry per distinct member course
with the correct `groupCount` and resolves `name` from `names` (falling back to `id` when
missing); (b) `sortByGroupCount` orders ascending by count; (c) ties broken by name then id;
(d) `sortByName` orders alphabetically with id tiebreak; (e) neither comparator mutates input.

#### 3. Wire `GroupingFilter` to the model: sort state, count labels, toggle

**File**: `src/_pages/plan-detail/ui/GroupingFilter.tsx`

**Intent**: Replace the inline alphabetic helper with the model fns; hold the ephemeral sort
mode; render the group count in each option; add the sort-mode toggle. The `Select` value
stays the course `id` and the "All groupings" clear path is untouched.

**Contract**:
- Remove the local `leadingCourseOptions` arrow (`GroupingFilter.tsx:48-54`); import from
  `../model/leading-course-options`.
- `const [sortOrder, setSortOrder] = useState<"by-groups" | "alphabetic">("by-groups")` —
  ephemeral, owned **inside** `GroupingFilter` (no new props; nothing else reads it).
- Build `const options = sortOrder === "by-groups" ? sortByGroupCount(base) : sortByName(base)`
  where `base = leadingCourseOptions(groupings, names)`.
- Each `SelectItem` renders the option text with the group count appended in brackets, e.g.
  `` `${name} (${groupCount})` ``. No separate span or styling — the count is part of the
  label text, so it also appears in the trigger when selected (intended).
- Sort toggle: an icon-button `DropdownMenu` mirroring `CourseTable.tsx:122-161` — trigger
  `<Button variant="ghost" size="icon" aria-label="Sort order">` with a lucide sort icon
  (e.g. `ArrowDownUp`); `DropdownMenuContent align="end"` containing a
  `DropdownMenuRadioGroup value={sortOrder} onValueChange={...}` with two
  `DropdownMenuRadioItem`s ("By group count" / "Alphabetical") so the active mode is marked.
  Place the trigger on the "Leading course" label row (label left, button `ml-auto`), keeping
  the `Select` full-width below.
- The "All groupings" sentinel `SelectItem` (no count) stays first; selection/clear behavior
  unchanged.

### Success Criteria:

#### Automated Verification:

- [ ] Unit tests pass: `pnpm test`
- [ ] Type checking + lint pass: `pnpm lint`
- [ ] FSD structure check passes: `pnpm steiger`
- [ ] Production build is clean: `pnpm build`

#### Manual Verification:

- [ ] Opening the dropdown shows courses ordered by group count ascending by default, each
      with its count; the selected course filters the palette exactly as before.
- [ ] The sort toggle switches to alphabetical order live and marks the active mode; counts
      remain visible in both modes; reloading resets to group-count order (session-only).
- [ ] "All groupings" still clears the filter; the selected course (with its count) shows in
      the trigger; layout holds with long course names and with a single-course / empty list.

**Implementation Note**: After this phase and all automated verification passes, pause for
manual confirmation that the manual testing was successful. Checkbox state for these items
lives in the `## Progress` section below.

---

## Testing Strategy

### Unit Tests:

- `leading-course-options.test.ts` — the metric (group count per distinct course, name
  resolution + id fallback), both comparators (ordering + tiebreaks), and non-mutation.

### Manual Testing Steps:

1. Open a plan with overlapping groupings; open the leading-course dropdown — verify
   ascending group-count order and a count on every option.
2. Toggle to alphabetical — verify reordering, that the active mode is marked, and counts
   still show.
3. Select a course — verify the palette filters as before and the trigger shows the choice.
4. Clear via "All groupings"; reload — verify the order resets to group-count.
5. Edge: a plan where every course appears in exactly one grouping (all counts equal) —
   verify a stable, name-then-id order; and a plan with very long course names — verify the
   count stays legible.

## Performance Considerations

Per-render reduction over `groupings`/`memberIds` already in props; sizes are small and this
matches existing palette render patterns. Memoization is unnecessary unless profiling shows a
hotspot.

## References

- Research: `context/changes/planner-picking-leading-course/research.md`
- Template to mirror: `src/_pages/plan-detail/model/sort-groupings.ts` (+ `.test.ts`)
- Toggle affordance: `src/_pages/plan-detail/ui/CourseTable.tsx:122-161` (row-actions menu)
- Prior change carve-out: `context/changes/planner-palette-group-sorting/plan.md:64-73`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Group-count sort, count labels, and sort toggle

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test` — c14fe51
- [x] 1.2 Type checking + lint pass: `pnpm lint` — c14fe51
- [x] 1.3 FSD structure check passes: `pnpm steiger` — c14fe51
- [x] 1.4 Production build is clean: `pnpm build` — c14fe51

#### Manual

- [x] 1.5 Default order is group-count ascending with counts; selection filters the palette as before — c14fe51
- [x] 1.6 Toggle switches to alphabetical live, marks active mode, keeps counts; reload resets to group-count — c14fe51
- [x] 1.7 "All groupings" clears; trigger shows the selected course; layout holds for long names and single/empty lists — c14fe51
