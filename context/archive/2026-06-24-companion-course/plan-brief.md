# Companion-course Filter — Plan Brief

> Full plan: `context/changes/companion-course/plan.md`
> Research: `context/changes/companion-course/research.md`

## What & Why

Add a second, cascading **companion course** select beneath the existing leading-course filter in the grouping palette. Today an author can narrow the palette to groupings containing one course; this lets them narrow further to groupings containing a *second* course too — useful when hunting for a grouping that pairs two specific courses. The companion list only shows courses that co-occur with the leading course, so every pick yields a non-empty result.

## Starting Point

The whole filter is one local hook (`useLeadingFilter`, `PlannerPalette.tsx:70-76`) with a single inline `.filter()` predicate and no `model/` function behind it. `leadingCourseOptions` already counts distinct member courses per grouping and is directly reusable. A grouping carries `memberIds: string[]`, so the data needed is already loaded — no schema, query, or load-path work.

## Desired End State

Below the leading select sits a "Companion course" select, disabled until a leading course is chosen. It lists, alphabetically, only the courses co-occurring with the leading course (each `Name (count)`), plus an "Any companion" item. Selecting one narrows the grouping list to groupings containing both courses. It resets to "Any companion" whenever the leading course changes or clears, and on cohort switch/reload. If a combination ever matches zero groupings, the pane shows a "no match" message with a one-click **Clear companion** button.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Cascading options | Companion lists only co-occurring courses, leading excluded | Every pick narrows to something non-empty | Research |
| State persistence | Ephemeral React state only | Same lifecycle as the leading filter; no URL/DB | Research |
| Companion sort | No toggle — fixed alphabetical | Simplest control surface; alphabetical is the natural lookup order | Plan |
| Empty state | Message + "Clear companion" action | Gives the user a direct exit from a dead-end, not a blank pane | Plan |
| Promoted chip | Companion narrows only — no second draggable chip | Matches feature intent; keeps `PromotedCourseChip` untouched | Plan |
| Model extraction | Extract filter + companion options + reset rule into pure `model/` fns | Idiomatic per *Orchestration over patching*; makes the tricky logic testable | Plan |
| Testing | Vitest unit + one RTL component test; no E2E | Pure client filter — unit/RTL cover all logic fast and flake-free | Plan |

## Scope

**In scope:** second cascading companion `<Select>`; pure `model/` functions (`filterGroupings`, `companionCourseOptions`, `reconcileCompanion`); reset-on-leading-change; defensive empty state; unit + RTL tests.

**Out of scope:** persistence (URL/DB/localStorage); a second promoted draggable chip; a companion sort toggle; label polish of composite `names`; any E2E spec; changes to `PlannerBoard`, `GroupingBox`, `PaletteCourseChip`, the load path, or the schema.

## Architecture / Approach

Model-first. Three pure functions go in `src/_pages/plan-detail/model/` and replace the inline `.filter()`. The palette hook (`useLeadingFilter` → `usePaletteFilter`) holds two `useState`s, computes companion options each render, reconciles a now-invalid companion to `null` via **adjust-state-during-render** (precedent `PlannerBoard.tsx:253`, not a `useEffect`), and applies the two-predicate filter. `GroupingFilter` gains a second `<Select>` (own `ANY_COMPANION` sentinel, alphabetical, disabled until a leading course is set). `PlannerPalette` gains a defensive empty-state pane. No new props on `PlannerBoard`; presentational components untouched.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Model layer | `filterGroupings`, `companionCourseOptions`, `reconcileCompanion` + unit tests | Companion options must derive from the leading-only subset and exclude the leading id |
| 2. UI wiring | Orchestrator hook, companion `<Select>`, empty state, RTL test | Stale companion must reset on leading change (adjust-state-during-render, not effect); blank pane on zero results |

**Prerequisites:** none — all data is already loaded; existing `leadingCourseOptions` + DS `Select` are reused.
**Estimated effort:** ~1–2 sessions across the two phases.

## Open Risks & Assumptions

- **Stale companion (HIGH):** a dangling companion after the leading course changes can silently filter to zero — mitigated by the `reconcileCompanion` reset rule applied during render.
- **Blank pane (HIGH):** the palette has no empty state today — mitigated by the defensive empty-state pane, even though cascading prevents zero by construction.
- **Wrong source list (MEDIUM):** companion options must come from the leading-filtered subset, not the full `groupings` or the both-filtered `visibleGroupings` — handled by computing options in the hook.
- RTL against a Radix `Select` requires opening the listbox via the trigger before selecting — minor test-authoring care.

## Success Criteria (Summary)

- Author can pick a leading course, then a co-occurring companion, and the palette narrows to groupings containing both.
- Changing/clearing the leading course (or switching cohort) always resets the companion — no silent mis-filtering.
- A zero-result combination shows a clear message + working "Clear companion", never a blank pane.
