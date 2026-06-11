# Review fix follow-ups — students-and-choices-ui

Queued from `reviews/impl-review.md` triage (2026-06-11). Items here are accepted fixes that belong outside this change's PR.

## F4 — Guard cohort changes in updateCourse (courses slice)

- **Finding**: The choice-cohort invariant is enforced only at student-write time (`assertChoicesInCohort`). `src/_pages/courses/api/update-course.ts` can still move a course to another cohort while students have it chosen, silently invalidating the invariant for every such student. Load-bearing now that students exist; S-06 grouping consumes this data next.
- **Fix**: In `updateCourse`, when the submitted `cohortId` differs from the stored one, reject with `DomainError("BAD_REQUEST", …)` if any `student_choices` rows reference the course (one `select student_id from student_choices where course_id = … limit 1`). Mirror `assertChoicesInCohort`'s shape; add a fake-Supabase unit test alongside `merge-actions.test.ts`.
- **Why follow-up**: Courses-slice change, out of this PR's scope. Accepted residual: app-side only (direct DB writes bypass it); tiny TOCTOU window — both noted as accepted-risk in the review.
