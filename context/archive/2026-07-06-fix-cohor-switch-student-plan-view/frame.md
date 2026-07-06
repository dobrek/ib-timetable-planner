# Frame Brief: Cohort switch has no visible effect in the student plan view

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

In the student plan view (`/plans/[id]/students/[studentId]`), selecting a
plan for a student and then clicking the cohort tab marks the new cohort as
active in the switcher, but **nothing else on the page changes** — the grid and
course list "remain as they were." There is no visible action.

## Initial Framing (preserved)

- **User's stated cause or approach**: Implied — switching cohort *should*
  refresh/replace the displayed data, and it is broken ("data remains as it was").
- **User's proposed direction**: Implied — make the cohort switch update the page.
- **Pre-dispatch narrowing**: Expectation = "Not sure — just felt broken" (no
  concrete data expectation). Dropdown state when toggling = **Closed**. Scope =
  **student plan view only**.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Data / loader layer** — the SSR fetch is broken, so the page never receives
   the switched-cohort data.
2. **State wiring** — the cohort `useState` is *meant* to flow into the page but
   the wire is missing/broken.  ← initial framing
3. **Interaction / feedback design** — the toggle is a subordinate two-step
   filter (toggle → open dropdown → pick a student) dressed as a primary view
   control; toggling with the dropdown closed yields no page-level feedback.
4. **Domain model** — a cohort is not a viewable unit; a student belongs to
   *exactly one* cohort, so "show this student in the other cohort" has no data.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. Loader / data fetch broken** | `[studentId].astro:13-16` → `loadStudentPlanView` is a per-student-URL SSR load; the cohort toggle never calls it. The fetch works and is correctly scoped to `student.cohort` (`loader.ts:83-87`). No fetch is even *attempted* on toggle — correctly. | **NONE** |
| **2. State wiring missing (initial framing)** | `StudentSwitcher.tsx:31-32`: `useState<Cohort>` is local and feeds only `scoped = students.filter(...)`. It was never wired to page data — and that is intentional: *"Cohort toggle is state, not navigation… re-scopes the dropdown list only"* (`archive/2026-07-06-student-plan-view/plan.md:61`). No wire is broken; none was designed. | **NONE (as bug) / STRONG (as intent)** |
| **3. Interaction / feedback gap** | Prominent header `Tabs` (`StudentSwitcher.tsx:36-49`) visually identical to the board's **navigating** `CohortSwitcher` (`plan-detail/ui/chrome/CohortSwitcher.tsx:12,21` — each segment is an `<a href=?focus=>` that switches the whole board). In the student view the identical control does nothing to the page and only re-scopes a **closed** dropdown → the sole feedback is the tab highlight. | **STRONG** |
| **4. Domain: cohort not viewable alone** | `StudentSummary.cohort: Cohort` is a single value; `loader.ts:83-87` scopes catalog/placements/course-info to `student.cohort`. There is no "this student's other-cohort schedule." The only meaningful outcome of switching cohort is *jumping to a different student*. | **STRONG (root)** |

## Narrowing Signals

- **Dropdown was closed** when toggling → the one thing that *does* change (the
  re-scoped student list) was hidden, so the user saw only the tab highlight.
  Decisive: this is exactly the no-feedback path.
- **"Not sure what I expected — just felt broken"** → rules OUT a concrete
  data/regression expectation; rules IN the affordance/feedback framing.
- **Scope = student plan view only** → narrow; the teacher view has no cohort
  toggle at all (`TeacherSwitcher.tsx` is a bare dropdown of anchors).
- **`plan.md:61`** documents the toggle as deliberate "state, not navigation" →
  rules OUT "a regression lost the wiring."

## Cross-System Convention

The segmented `Tabs` control means **two opposite things** in this app:

- **Editing board** (`plan-detail/ui/chrome/CohortSwitcher.tsx`): each segment is
  an anchor to `?focus=dp1|dp2|combined` that **navigates and re-renders the whole
  board immediately** — a primary view-switch with instant feedback.
- **Student view** (`StudentSwitcher.tsx`): the identical-looking segmented
  control is pure client `useState` with **no navigation and no page effect** —
  a filter for a (closed) dropdown.

Same visual idiom, opposite contract. A user carrying the board's mental model
toggles it and sees nothing happen → reads as broken. The leading hypothesis
(feedback gap) matches this convention mismatch exactly.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the student view's cohort tab gives
> no page-level feedback when toggled — it is a subordinate filter for a (closed)
> student dropdown, dressed in the same segmented-control idiom the editing board
> uses for a primary, navigating view-switch — so it reads as broken. This is an
> interaction/feedback problem, **not** a data or state-wiring bug.

The data pipeline is correct and the "no page change" is working-as-designed
(`plan.md:61`). What is wrong is that a prominent control produces no perceptible
feedback in the common case (dropdown closed), and its visual language over-promises
a view-switch that is domain-impossible for a single student (a student has exactly
one cohort). Addressing this means making the toggle's effect *visible* and/or its
role *legible* — not making the schedule "switch cohorts," which has no data behind it.

## Confidence

- **HIGH** — strong direct code evidence (switcher, loader, route, board switcher)
  + documented design intent (`plan.md:61`) + decisive narrowing signal (dropdown
  closed, "just felt broken") + a clean cross-system convention mismatch.

## What Changes for /10x-plan

The plan should target the **affordance/feedback of the cohort toggle** — making
its effect visible and its role unambiguous — **not** wire cohort state into the
page data (there is no per-cohort schedule for a single student to render).
Candidate directions for /10x-plan to choose among: give the toggle immediate
feedback (auto-open or auto-scope the dropdown on switch), let it jump to the
switched cohort's first student, restyle/relabel it as a filter rather than a
view-switch, or fold the cohort dimension into the dropdown itself.

## References

- Source files: `src/_pages/student-plan-view/ui/StudentSwitcher.tsx:30-73`,
  `src/_pages/student-plan-view/api/loader.ts:58-111`,
  `src/pages/plans/[id]/students/[studentId].astro:13-16`,
  `src/_pages/plan-detail/ui/chrome/CohortSwitcher.tsx:12-36`,
  `src/_pages/teacher-plan-view/ui/TeacherSwitcher.tsx`
- Prior decision: `context/archive/2026-07-06-student-plan-view/plan.md:31,61`,
  `context/archive/2026-07-06-student-plan-view/plan-brief.md:23`
- Investigation: direct reads (evidence conclusive; no parallel hypothesis
  agents dispatched — guardrail #6, no padding)
