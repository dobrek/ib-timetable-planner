# Students and Choices UI (S-04) — Plan Brief

> Full plan: `context/changes/students-and-choices-ui/plan.md`
> Research: `context/changes/students-and-choices-ui/research.md`

## What & Why

Build the students catalog (`/students`): CRUD for students and their course choices — FR-006's **primary path** for entering student data, and the prerequisite for CSV import (S-05) and grouping computation (S-06). The create/edit dialog manages name, cohort, and the full choice set in one explicit submit, honoring the PRD rule that student-choice data is never silently mutated.

## Starting Point

The schema (`students`, `student_choices`) and a placeholder `/students` route already exist; no migrations are needed. The `teachers` slice is a field-for-field CRUD template, the `courses` slice provides the cohort-tabs + URL-synced-filters composition, and — since the research doc was written — the shared `MultiSelect` was promoted to `src/shared/ui/`, resolving the research's main open question. The only genuinely new pieces are the form-bound choices editor and its whole-set server write.

## Desired End State

The author opens `/students`, sees students per cohort tab with their choices as badge chips, narrows by name or by chosen course, and creates/edits/deletes students — choices included — entirely in the form dialog. Changing a student's cohort visibly resets the in-form choice selection before anything persists. Filter state survives reload via the URL.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Choices editing model | In the student form, whole-set on submit | Mirrors MergeBuilderDialog's form-bound array field; one dialog, one action, choices enterable at create time | Plan |
| Cohort change with existing choices | Reset choices in-form, visibly | Nothing persists until submit, so the author reviews the cleared state explicitly — satisfies "never silently mutated" | Plan |
| Delete semantics | Hard delete; confirm shows choice count | Matches teachers precedent and schema cascade; PII actually leaves the DB; no migration | Plan |
| Filter scope | Full: cohort tabs + name search + course multi-select | All three are direct reuse; only authored logic is the pure `filterStudents` predicate | Research |
| Choice count constraint | None — empty set valid | Schema imposes none and the PRD states no load rule; authors enter students incrementally | Plan |
| Multi-select component | Consume shared `MultiSelect` | Already promoted to `shared/ui` after the research snapshot — no extraction needed | Research |
| Update atomicity | Diff-based: insert `toAdd` before deleting `toRemove` | workerd has no client transactions; failure can only leave a visible superset, never lost choices | Plan |
| Choice picker contents | Active cohort's courses, excluding merge-parent composites | Students choose real courses; composites are scheduling artifacts identified via `course_merges` | Plan |

## Scope

**In scope:** new `src/_pages/students/` slice (model/lib/api/ui), `/students` route wiring, choices editor + badges display, cohort tabs + name search + course filter (URL-synced), promotion of the atomic-write helper to `shared/lib`, unit + CRUD integration tests.

**Out of scope:** CSV import (S-05), schema changes / soft delete / audit trail, per-choice mutation actions, choice-count constraints, badge-label promotion to shared, ui-conventions changes, grouping/validator integration (S-06).

## Architecture / Approach

Mirror `teachers` 1:1 for flat CRUD (loader → `Result`, `defineDomainAction` table, `submitForm` flow), take tabs + URL codec from `courses`, and bind the shared `MultiSelect` as a `choiceCourseIds: string[]` form field exactly like `MergeBuilderDialog`. Server side: create uses compensating cleanup (insert student → insert choices → delete on failure, via the promoted `writeParentWithLinks`); update computes a pure add/remove diff; both paths independently verify every choice belongs to the submitted cohort before writing.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Flat CRUD + catalog shell | Working `/students` page: tabs, name search, table with read-only choice badges, name+cohort CRUD | Low — template mirroring |
| 2. Choices editor | Choices editable in the form; atomic create / diff update; cohort-change reset | Reset misfiring during form prefill; partial-write ordering |
| 3. Course filter + integration tests | Filter by chosen courses; CRUD integration coverage in the harness | Stale cross-tab filter selection (handled: tab switch clears it) |

**Prerequisites:** local Supabase stack running with seeded data (`pnpm exec supabase db reset`); F-01/F-02/S-02 already landed.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Update reconciliation is not transactional on workerd — a mid-flight failure leaves a visible superset of choices (accepted; surfaced via error toast, recoverable by re-editing).
- Assumes choice rows only ever reference same-cohort courses; the server guard enforces this going forward, and seeded data conforms.
- PII posture (hard delete, no audit) was decided for the current pre-production stage; revisit if real student data with retention requirements arrives.

## Success Criteria (Summary)

- Author can create, edit (incl. full choice set and cohort), and delete students entirely via `/students` — no SQL or CSV needed.
- Every mutation is an explicit, visible form action; no choice data changes without the author seeing it before submit.
- `pnpm test`, `pnpm test:integration`, `pnpm lint`, `pnpm steiger`, `pnpm build` all pass; CRUD integration coverage lives in the harness per lessons.md.
