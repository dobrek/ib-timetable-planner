# Fix Cohort Switch in Student Plan View — Implementation Plan

## Overview

In the student plan view (`/plans/[id]/students/[studentId]`), the cohort tab looks
identical to the editing board's `CohortSwitcher` — a segmented control that navigates
and re-renders the whole board — but is actually a silent client-`useState` filter for a
**closed** student dropdown. Toggling it produces no page-level feedback, so it reads as
broken (frame brief, HIGH confidence: an interaction/feedback problem, **not** a data or
state-wiring bug).

This plan converts the cohort tab into a **navigating anchor pair** that mirrors the
board's `CohortSwitcher` contract: the active tab is the current student's cohort (a plain
non-navigating trigger), and the inactive tab is an anchor to the first name-ordered
student of the other cohort. Same visual idiom → same navigating contract. Where the other
cohort has no students, its tab renders disabled rather than linking nowhere.

## Current State Analysis

- **The data pipeline is correct and working-as-designed.** `loadStudentPlanView`
  (`src/_pages/student-plan-view/api/loader.ts:58-111`) scopes catalog, placements, and
  course info to `student.cohort`; the toggle was never meant to reload page data
  (`context/archive/2026-07-06-student-plan-view/plan.md:61`: "state, not navigation").
- **The switcher is a single presentational component.** `StudentSwitcher.tsx:30-75` holds
  a local `useState<Cohort>` initialized to `current.cohort`; toggling only re-filters the
  dropdown list (`scoped = students.filter(...)`, line 32) and navigation happens on picking
  a student via a plain anchor (lines 62-68).
- **A student belongs to exactly one cohort** (`StudentSummary.cohort: Cohort`, a single
  value — `loader.ts:23`). There is no "this student in the other cohort" schedule; the only
  meaningful outcome of switching cohort is jumping to a **different** student.
- **The board sets the mental model.** `CohortSwitcher.tsx:16-43` renders the same shared
  `Tabs` control where each inactive segment is an `<a>` (via `TabsTrigger asChild`) that
  navigates and remounts the board. The student switcher borrows the idiom but not the
  contract.
- **The loader already returns everything needed.** `data.students` is the plan's full,
  name-ordered student list across **both** cohorts (`loader.ts:35,82,129-136`, capped at
  500) — enough to resolve each cohort's lead student and to detect an empty cohort. No
  loader change is required.
- **The e2e spec encodes the old behavior.** `e2e/specs/student-plan-view.spec.ts:60-73`
  toggles the tab, then *manually* opens the dropdown to observe any change, and asserts the
  URL did **not** change — this is exactly the friction being removed, and must be rewritten.

## Desired End State

Opening a student view and clicking the other cohort's tab navigates straight to that
cohort's first student — the heading, grid, and course list all update in one step, with no
intermediate dropdown dance. The active tab (the current student's cohort) is a plain,
non-navigating trigger; the dropdown lists that cohort's students with the current student
checked. On a plan whose other cohort is empty, that tab is visibly disabled and does
nothing. Verify by: `pnpm test` (new `cohortLeads` unit test), `pnpm check`/`lint`/`steiger`,
the rewritten `student-plan-view` e2e spec, and a manual click-through.

### Key Discoveries:

- `CohortSwitcher.tsx:29-39` is the exact structural template: active segment → plain
  `TabsTrigger`; inactive segment → `TabsTrigger asChild` wrapping an `<a href>`.
- `StudentSwitcher.tsx:31` — the `useState<Cohort>` becomes derivable from `current.cohort`
  once the tab navigates; removing it eliminates the incoherent "showing student X, filtered
  to cohort Y, nothing checked" intermediate state.
- `data.students` is name-ordered (`loader.ts:132 order("full_name")`) so "first student of
  a cohort" is just the first match in that list — no re-sort needed, mirroring how the
  dropdown already trusts loader order.
- `COHORTS` (`src/shared/config/cohorts.ts`) is the fixed two-value `dp1`/`dp2` set the tabs
  iterate — display order `dp1 < dp2`.

## What We're NOT Doing

- **No loader / API / schema changes** — the data pipeline is correct and already returns
  both cohorts' students.
- **No per-student cross-cohort schedule** — a student has exactly one cohort; there is no
  data to "switch" the grid to.
- **No change to the editing board's `CohortSwitcher`** or its `?focus=` navigation.
- **No change to the teacher switcher** (`TeacherSwitcher.tsx` — it has no cohort dimension).
- **No searchable combobox** — the cohort-scoped plain dropdown stays; the combobox remains a
  documented scale-only fallback.
- **No "remember the last student per cohort"** — toggling lands on the cohort's first
  name-ordered student (frame-endorsed); per-cohort memory is out of scope.

## Implementation Approach

Two small, independently committable phases. Phase 1 reworks the one presentational
component and adds a pure, unit-tested helper for lead-student resolution. Phase 2 realigns
the e2e spec (which currently asserts the old no-navigation behavior) and runs the full CI
gate. The switcher is restructured to match `CohortSwitcher`'s active-trigger / inactive-
anchor shape, with a disabled state added for the empty-cohort case — a shape the board does
not need but this two-cohort/one-student domain does.

## Critical Implementation Details

- **The current student is always in `current.cohort`,** so deriving the active tab and the
  dropdown scope from `current.cohort` (dropping the `useState`) is always coherent — the
  current student is guaranteed present in the scoped list and check-marked.
- **"First student of a cohort" relies on the loader's `order("full_name")`.** The helper
  preserves input order and returns the first match per cohort; it does not re-sort. This
  matches how the dropdown already renders in loader order.
- **`TabsTrigger` must support both `asChild` (anchor) and `disabled`.** The board already
  uses `asChild` on the shared control; `disabled` is a native Radix Tabs trigger prop —
  confirm the `@/shared/ui` wrapper forwards it (it should via prop spread). The empty-cohort
  tab is disabled, not an anchor, so it structurally cannot navigate to nothing.

## Phase 1: Switcher rework — navigating cohort tabs + lead-student helper

### Overview

Replace the client-state cohort filter with navigating anchors that mirror `CohortSwitcher`,
scope the dropdown to the current cohort, and back the "lead student per cohort" resolution
with a pure, unit-tested helper.

### Changes Required:

#### 1. Lead-student helper (new `lib/` segment)

**File**: `src/_pages/student-plan-view/lib/cohort-leads.ts` (+ barrel
`src/_pages/student-plan-view/lib/index.ts`)

**Intent**: Provide a pure function that resolves, for each cohort, the student the cohort
tab should link to — the first in the name-ordered list, or `undefined` when the cohort has
no students (→ the tab is disabled).

**Contract**: `cohortLeads(students: StudentSummary[]): Record<Cohort, StudentSummary | undefined>`.
Preserves input order (no re-sort); returns the first student matching each `COHORTS` value.
`lib/index.ts` re-exports it as a pure barrel (one concept-named file per export).

#### 2. Lead-student helper unit test

**File**: `src/_pages/student-plan-view/lib/cohort-leads.test.ts`

**Intent**: Lock the helper's contract: first-by-input-order per cohort, `undefined` for an
empty cohort, both cohorts populated, and a single-cohort list.

**Contract**: Vitest `*.test.ts` co-located with the helper; asserts the returned record's
`dp1`/`dp2` entries for name-ordered fixtures.

#### 3. Rewrite the switcher

**File**: `src/_pages/student-plan-view/ui/StudentSwitcher.tsx`

**Intent**: Turn the cohort tab into a navigating anchor pair and remove the client state.
The active tab (== `current.cohort`) is a plain non-navigating `TabsTrigger`; each inactive
tab is either an anchor to `cohortLeads(students)[cohort]`'s stable URL or, when that lead is
`undefined`, a disabled trigger. Scope the dropdown to `current.cohort` so the current
student is always listed and checked. Refresh the component docstring to describe the
navigate-on-toggle contract and the disabled empty-cohort case.

**Contract**: `Tabs value={current.cohort}` (derived, no `useState`/`onValueChange`).
Inactive-with-lead segment mirrors `CohortSwitcher.tsx:35-37`
(`<TabsTrigger asChild><a href={/plans/${planId}/students/${lead.id}}>…</a></TabsTrigger>`);
inactive-without-lead segment is `<TabsTrigger disabled>` (with `aria-disabled`). Dropdown
list = `students.filter((s) => s.cohort === current.cohort)`; the anchor-per-student and
current-student check-mark behavior is unchanged.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `pnpm check`
- [ ] Linting passes: `pnpm lint`
- [ ] FSD structure check passes: `pnpm steiger`
- [ ] Unit suite (incl. new `cohortLeads` test) passes: `pnpm test`

#### Manual Verification:

- [ ] Clicking the inactive cohort tab navigates to that cohort's first student — heading, grid, and course list all update in one step.
- [ ] The active tab is non-navigating; the dropdown lists the current cohort with the current student check-marked.
- [ ] On a plan whose other cohort is empty, that tab renders disabled and does nothing when clicked.

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to Phase 2. Phase blocks use plain bullets — the `- [ ]` checkboxes live in
the `## Progress` section at the bottom of the plan.

---

## Phase 2: E2E realignment + CI gate

### Overview

Rewrite the `student-plan-view` e2e spec so it asserts the new navigate-on-toggle behavior
(replacing the old "re-scope without navigating" assertions) and covers the disabled empty-
cohort tab, then run the full local CI gate.

### Changes Required:

#### 1. Rewrite the cohort-toggle assertions

**File**: `e2e/specs/student-plan-view.spec.ts`

**Intent**: Replace the manual toggle-then-open-dropdown flow (lines 60-73) with a single
tab click that navigates directly to the other cohort's student, and update the file header
(lines 6-12) and test name (line 22) that describe the old "re-scope without navigating"
interaction. Keep the `createStudentWithoutChoices` helper (still needed to author the
cross-cohort student).

**Contract**: Clicking `getByRole("tab", { name: "DP2" })` triggers `page.waitForURL(...)`
to the dp2 student's URL, then asserts the `Emp timetable` grid and the "This student has no
courses in this plan." message. The prior `expect(page.url()).toBe(urlBeforeToggle)` and the
separate dropdown-driven navigation block are removed (the tab now performs that navigation).

#### 2. Cover the disabled empty-cohort tab

**File**: `e2e/specs/student-plan-view.spec.ts`

**Intent**: Add a focused test that authors a plan with students in only one cohort and
asserts the other cohort's tab is disabled (present, non-navigating), so a single-cohort
plan can never reproduce the "click does nothing" affordance.

**Contract**: A `chromium`-project test that creates a one-cohort plan, opens a student's
view, and asserts `getByRole("tab", { name: "DP2" })` is disabled (e.g. `toBeDisabled()` /
`aria-disabled`) and clicking it does not change the URL. Teardown by `deletePlan`.

### Success Criteria:

#### Automated Verification:

- [ ] `student-plan-view` e2e spec passes: `pnpm test:e2e`
- [ ] Full local CI gate green (install → astro sync → lint → steiger → audit → test → build): `/verify`

#### Manual Verification:

- [ ] Watching the e2e run (or a headed pass) confirms the tab click navigates the whole page, not a dropdown re-scope.
- [ ] No lingering references to the old "re-scopes the dropdown WITHOUT navigating" behavior remain in the spec or component docstrings.

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before considering the change complete.

---

## Testing Strategy

### Unit Tests:

- `cohortLeads`: first-by-input-order per cohort; `undefined` for an empty cohort; both
  cohorts populated; single-cohort input.

### Integration Tests:

- None required — the loader is unchanged, and its `student-plan-view.integration.test.ts`
  coverage still holds.

### Manual Testing Steps:

1. Open a plan with students in both cohorts, view a dp1 student, and click the DP2 tab —
   confirm the page navigates to the first dp2 student (heading/grid/list all change).
2. Confirm the active tab does nothing on click and the dropdown lists only the current
   cohort with the current student checked.
3. Open a plan with students in only one cohort — confirm the other tab is disabled.

## Performance Considerations

Negligible. `cohortLeads` is an O(n) pass over the already-loaded, capped (≤500) student
list at render time; no new fetches, no added SSR work.

## Migration Notes

None — no schema, data, or API changes. Pure client-behavior change to one component plus a
new pure helper.

## References

- Frame brief: `context/changes/fix-cohor-switch-student-plan-view/frame.md`
- Switcher: `src/_pages/student-plan-view/ui/StudentSwitcher.tsx:30-75`
- Loader: `src/_pages/student-plan-view/api/loader.ts:58-136`
- Board idiom to mirror: `src/_pages/plan-detail/ui/chrome/CohortSwitcher.tsx:16-43`
- Cohort config: `src/shared/config/cohorts.ts`
- E2E spec to rewrite: `e2e/specs/student-plan-view.spec.ts:22,60-101`
- Prior design intent: `context/archive/2026-07-06-student-plan-view/plan.md:61`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Switcher rework — navigating cohort tabs + lead-student helper

#### Automated

- [x] 1.1 Type checking passes: `pnpm check` — 9251b44
- [x] 1.2 Linting passes: `pnpm lint` — 9251b44
- [x] 1.3 FSD structure check passes: `pnpm steiger` — 9251b44
- [x] 1.4 Unit suite (incl. new `cohortLeads` test) passes: `pnpm test` — 9251b44

#### Manual

- [x] 1.5 Inactive cohort tab navigates to that cohort's first student — heading, grid, course list update in one step — 9251b44
- [x] 1.6 Active tab is non-navigating; dropdown lists the current cohort with the current student check-marked — 9251b44
- [x] 1.7 On a plan whose other cohort is empty, that tab renders disabled and does nothing when clicked — 9251b44

### Phase 2: E2E realignment + CI gate

#### Automated

- [x] 2.1 `student-plan-view` e2e spec passes: `pnpm test:e2e` — f49a849
- [x] 2.2 Full local CI gate green: `/verify` — f49a849

#### Manual

- [x] 2.3 E2E run confirms the tab click navigates the whole page, not a dropdown re-scope — f49a849
- [x] 2.4 No lingering references to the old "re-scopes the dropdown WITHOUT navigating" behavior remain — f49a849
