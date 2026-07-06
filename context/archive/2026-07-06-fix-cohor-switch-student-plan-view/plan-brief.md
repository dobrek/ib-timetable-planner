# Fix Cohort Switch in Student Plan View — Plan Brief

> Full plan: `context/changes/fix-cohor-switch-student-plan-view/plan.md`
> Frame brief: `context/changes/fix-cohor-switch-student-plan-view/frame.md`

## What & Why

The student view's cohort tab gives no page-level feedback when toggled — it is a
subordinate filter for a (closed) student dropdown, dressed in the same segmented-control
idiom the editing board uses for a primary, navigating view-switch — so it reads as broken.
This is an interaction/feedback problem, **not** a data or state-wiring bug. We fix it by
giving the identical-looking control the same navigating contract the board's has.

## Starting Point

`StudentSwitcher.tsx` holds a client `useState<Cohort>` that only re-filters a closed
student dropdown; toggling it changes nothing visible. The data pipeline is correct and
working-as-designed (`archive/…/plan.md:61`: "state, not navigation"), and the loader
already returns both cohorts' students — so no backend work is needed.

## Desired End State

Clicking the other cohort's tab navigates straight to that cohort's first (name-ordered)
student — heading, grid, and course list all update in one step. The active tab (the current
student's cohort) is a plain non-navigating trigger; the dropdown lists that cohort with the
current student checked. When the other cohort is empty, its tab is disabled.

## Key Decisions Made

| Decision                    | Choice                                                                 | Why (1 sentence)                                                                                          | Source |
| --------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| Problem class               | Interaction/feedback fix, not a data/state-wiring bug                   | A student has exactly one cohort — there is no per-cohort schedule to "switch" the grid to                | Frame  |
| Fix direction               | Navigate on toggle — tab becomes anchors to the cohort's first student  | Identical idiom to the board now has an identical navigating contract; instant unambiguous page feedback  | Plan   |
| Empty other cohort          | Disable that tab                                                        | Keeps the stable dp1/dp2 layout and structurally cannot navigate to nothing — no "click does nothing" bug | Plan   |
| Client state                | Remove `useState`; derive cohort from SSR `current.cohort`              | Once the tab navigates, cohort is fully determined by the current student — kills the incoherent state    | Plan   |
| Dropdown scope              | Scope to `current.cohort` (current student always checked)              | The tab now handles cross-cohort; scoping keeps the list short and the current student in-list            | Plan   |
| Lead-student resolution     | Pure `lib/cohortLeads` helper + co-located unit test                    | First name-ordered student per cohort is pure/derivable — cheap Vitest coverage without a component test  | Plan   |

## Scope

**In scope:**
- Rework `StudentSwitcher.tsx` into navigating anchor tabs (active non-nav, inactive anchor-or-disabled).
- New pure `lib/cohort-leads.ts` helper + unit test.
- Rewrite the `student-plan-view` e2e spec to the new behavior + a disabled empty-cohort case.

**Out of scope:**
- Loader / API / schema changes; per-student cross-cohort data.
- The board's `CohortSwitcher`, the teacher switcher, the combobox fallback.
- "Remember last student per cohort" memory.

## Architecture / Approach

One presentational component changes shape to mirror `CohortSwitcher.tsx`: active segment =
plain `TabsTrigger`; inactive segment = `TabsTrigger asChild` wrapping an `<a>` to the other
cohort's lead student, or a disabled trigger when that cohort is empty. A pure
`cohortLeads(students)` helper resolves the lead student per cohort from the already-loaded,
name-ordered list. No new data flow.

## Phases at a Glance

| Phase                          | What it delivers                                              | Key risk                                                              |
| ------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Switcher rework             | Navigating cohort tabs + unit-tested `cohortLeads` helper     | `TabsTrigger` must forward both `asChild` and `disabled` correctly   |
| 2. E2E realignment + CI gate   | Rewritten spec (navigate-on-toggle + disabled empty cohort)   | Old spec asserts the opposite behavior — must be fully replaced       |

**Prerequisites:** Local Supabase running + `pnpm env:local` for the e2e phase.
**Estimated effort:** ~1 session across 2 phases (small, single-component change).

## Open Risks & Assumptions

- Assumes the `@/shared/ui` `TabsTrigger` forwards `disabled` (native Radix prop) — verify in
  Phase 1; the board already proves `asChild` works.
- "First student" is the loader's name-ordered first; acceptable per the frame (no per-cohort
  memory).

## Success Criteria (Summary)

- Clicking the other cohort's tab navigates the whole page to that cohort's first student.
- The active tab is inert; the dropdown shows the current cohort with the current student checked.
- A single-cohort plan shows the other tab disabled; the rewritten e2e spec and full CI gate pass.
