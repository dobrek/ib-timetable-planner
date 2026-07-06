# Student Plan View — Plan Brief

> Full plan: `context/changes/student-plan-view/plan.md`
> Research: `context/changes/student-plan-view/research.md`

## What & Why

A read-only, **schedule-only** student perspective view at `/plans/[id]/students/[studentId]`: the student's single-cohort timetable grid, a course list with occurrence times and a Teachers roster, and a header switcher — mirroring the just-shipped teacher plan view. It gives plan authors the second per-person lens on a plan, and it is the "second consumer" the teacher-view architecture was explicitly built to await.

## Starting Point

The teacher plan view shipped as the first of a family of read-only perspective views; `entities/timetable` holds the pure read-side domain, and its docstrings pre-announce the student mirror. The data chain fully exists (`studentKeys` is already the overlap+merge-resolved roster per course), so no schema, auth, or Action work is needed. The shared grid/card UI currently lives inside the teacher slice — and two `_pages` slices cannot cross-import, which forces the `widgets/` layer into existence.

## Desired End State

Clicking a student's name in the students table opens their timetable: exactly their placed courses (merged sessions resolved, week A/B labels), cards showing teachers, hours, and times, and a switcher that toggles between cohorts and jumps to any sibling student via shareable URLs. The teacher view is refactored onto the new shared widget with zero behavior change, and the entity boundary ends the change accurately scoped (`lens.ts` back in `plan-detail`).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Feature scope | Schedule-only: no collision badges/dialog, no availability shading | Students have no availability table and per-student clash QA is out of scope — the view becomes a strict subset of the teacher view | Research |
| Switcher | Cohort dp1/dp2 toggle (client state) + single-cohort plain dropdown of anchors, browsing both cohorts | Scoping to one cohort (~26–35 names) makes the shipped dropdown idiom sufficient; the combobox stays a scale-only fallback | Research |
| Shared UI home | New `src/widgets/timetable-board/` layer (grid + course card only; switchers stay per-persona) | Pure domain belongs in `entities/`, composed UI in `widgets/`; the cohort asymmetry makes a shared switcher over-abstraction | Research |
| Teacher view | Refactored onto the shared widget in this change (no duplication) | FSD-correct, DRY, gives the widget two consumers immediately — the archived teacher plan pre-committed to this | Plan |
| `lens.ts` | Moved back to `_pages/plan-detail/model/` as the final phase | Board-only view-state with one consumer and zero collision coupling — doesn't earn entity residency | Plan |
| Student course card | Full mirror of the teacher card with the roster flipped to Teachers | Maximum reuse of the shared card; only the `people` slot varies per persona | Plan |
| Print | Preserve print-viability design rules; build no print feature | Free by construction in the extracted components; keeps the deferred print change viable for both personas | Plan |
| E2E | Full mirror of the teacher spec incl. the cohort-toggle re-scope | The toggle is the one genuinely new interaction — exactly what deserves browser coverage | Plan |

## Scope

**In scope:** `studentCourses` predicate + generalized `buildPerspectiveCourseItems` in `entities/timetable`; new `widgets/timetable-board` (ScheduleGrid + PerspectiveCourseList) with the teacher view refactored onto it; student slice (loader, page, switcher), route, students-table entry link; loader integration test + full e2e spec; stale steiger override removal; `lens.ts` move-back; layer-chain doc updates.

**Out of scope:** student collision/clash surface, student availability, searchable combobox switcher, shared switcher widget, print/PDF feature, schema/Action/auth changes, board behavior changes.

## Architecture / Approach

Persona logic stays out of the shared code: the entity builder takes only a membership predicate and returns items carrying raw `teacherKeys`/`studentKeys`; the widget grid makes teacher decorations (shading, badges, cohort tags) optional props; each page computes its own card roster. Layer chain becomes `app` → `_pages` → `widgets` → `entities` → `shared`. The student page is a strict subset: filter courses → placements → `groupCellOccupants` with an empty collisions map → grid.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Entity groundwork | `studentCourses` + `buildPerspectiveCourseItems` in the entity; stale steiger override gone | Builder generalization subtly changes teacher card data |
| 2. Widgets layer + TPV refactor | `widgets/timetable-board` shared grid/card; teacher view refactored, e2e unchanged | Touches shipped teacher UI; steiger one-consumer window needs a temporary scoped override |
| 3. Student slice + route + entry | Loader, page, switcher, route, students-table link; override removed | Merge-child occurrences require FULL cohort placements in the builder |
| 4. E2E + lens move-back | Student Playwright spec; `lens.ts` home in `plan-detail` | Wide-but-mechanical import churn in plan-detail |

**Prerequisites:** local Supabase stack + `pnpm env:local`; nothing else — all groundwork shipped with the teacher view.
**Estimated effort:** ~2–3 sessions across 4 phases; Phases 1–2 are the structural half, 3–4 the mirroring half.

## Open Risks & Assumptions

- The teacher e2e spec is assumed to be a sufficient regression gate for the Phase-2 refactor (it locks the grid/card role contract; visual regressions outside that contract are caught manually).
- The steiger `insignificant-slice` window between Phases 2 and 3 is bridged by a temporary scoped override — acceptable because both phases land in this one change.
- `students` per plan stays in the dozens per cohort; if a cohort ever reaches hundreds, the documented combobox fallback applies (no work now).

## Success Criteria (Summary)

- An author can open any student's timetable from the students table, trust it matches the board, and hop between students/cohorts via the switcher.
- The teacher view behaves exactly as before, now rendered by the shared widget.
- Full CI gate green including the new integration + e2e coverage; steiger clean with no leftover overrides.
