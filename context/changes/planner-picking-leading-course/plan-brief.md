# Planner — Leading-course filter group-count sorting — Plan Brief

> Full plan: `context/changes/planner-picking-leading-course/plan.md`
> Research: `context/changes/planner-picking-leading-course/research.md`

## What & Why

Order the planner's leading-course `<Select>` by how many groupings each course appears in,
ascending, by default — so the most constrained courses (fewest options) surface first, which
is where a plan author should start. Add a toggle back to alphabetical, and show each course's
group count in its option label so the order is legible.

## Starting Point

`GroupingFilter.tsx` is a Radix `<Select>` whose options come from an inline helper that lists
distinct member courses sorted alphabetically. The palette passes raw `groupings` + `names`
into it and owns the selection. No per-course "group count" metric exists anywhere yet.

## Desired End State

The dropdown opens in group-count-ascending order with the count appended to every option in
brackets, e.g. `Mathematics HL (3)`; a small sort icon button beside the "Leading course"
label opens a two-option menu (group count /
alphabetical) with the active mode marked, and switching reorders live. Selecting a course
filters the palette exactly as today; "All groupings" still clears; order resets on reload.

## Key Decisions Made

| Decision               | Choice                                                        | Why (1 sentence)                                                              | Source   |
| ---------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------- |
| Keep the control       | Stay on Radix `<Select>` (no combobox/typeahead/clear button) | The combobox is Base-UI-based — a new primitive ecosystem, too much for this. | Research |
| Default order          | Group count ascending; alphabetical is the alternate          | Surfaces the most constrained courses first.                                  | Research |
| The metric             | Per-course cardinality over `groupings.memberIds`             | It is **not** `coverageCount` (students per grouping).                        | Research |
| Where sort logic lives | New pure `model/leading-course-options.ts` (+ test)           | Mirrors `sort-groupings.ts`; keeps `.tsx` JSX-only and logic testable.        | Research |
| Toggle affordance      | Icon-button `DropdownMenu` with a 2-item radio group          | Reuses the existing row-actions menu pattern; marks the selected mode.        | Plan     |
| Count label            | Inline `(n)` appended to the option text                     | Simplest — plain text label, no styling or Radix `ItemText` placement concerns. | Plan     |
| State ownership        | Ephemeral `useState` inside `GroupingFilter`                  | Self-contained; nothing else reads it; no persistence.                        | Plan     |

## Scope

**In scope:** new pure model file (+ test) for the metric and two comparators; `GroupingFilter`
edits (apply sort, render count labels, add the dropdown toggle, hold ephemeral sort state).

**Out of scope:** combobox/typeahead/clear button; any persistence; any backend
(`load.ts`/SQL/migration/island prop); the membership filter and the box sort; editing the
shared `select.tsx` primitive.

## Architecture / Approach

A pure `model/` file produces `{ id, name, groupCount }[]` (single-pass count over
`memberIds`) and exposes `sortByGroupCount` (default) and `sortByName`, each with an `id`
final tiebreaker for a total order. `GroupingFilter` consumes it, holds
`useState<"by-groups" | "alphabetic">`, appends the count as `(n)` to each option's text, and
adds an icon-button `DropdownMenu` radio toggle (mirroring `CourseTable`'s row-actions menu). Two
orderings now coexist in the palette and stay orthogonal: box order (students desc) and
dropdown order (group-count asc).

## Phases at a Glance

| Phase                                              | What it delivers                                            | Key risk                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1. Sort, count labels, toggle (single phase)      | Model file + test; sorted dropdown with counts and toggle  | Low — inline `(n)` text is trivial; the only real care is the deterministic total-order tiebreak. |

**Prerequisites:** none — all inputs (`groupings`, `names`) already reach the filter.
**Estimated effort:** ~1 session, one phase.

## Open Risks & Assumptions

- The count is plain `(n)` text, so it also appears in the collapsed trigger when a course is
  selected (e.g. `Mathematics HL (3)`) — intended.
- `compositeName` collisions are improbable; the `id` final tiebreaker guarantees determinism.

## Success Criteria (Summary)

- Dropdown defaults to group-count-ascending with a count on every option; selecting filters
  the palette as before.
- The toggle switches to alphabetical live, marks the active mode, and keeps counts visible;
  reload resets to group-count order.
- All automated gates pass: `pnpm test`, `pnpm lint`, `pnpm steiger`, `pnpm build`.
