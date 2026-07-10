---
change_id: batch-xlsx-export
title: Batch xlsx export
status: archived
created: 2026-07-10
updated: 2026-07-10
archived_at: 2026-07-10T12:54:09Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- 2026-07-10 — research complete (`research.md`): batch export is pure client-side (loop existing builders → `.toBlob()` → `fflate.zipSync` level 0 → one zip download); the Worker/30s limit is not involved. Measured ~85 ms for 1 combined plan + 40 teacher workbooks (~217 KB zip).
- 2026-07-10 — author decisions: batch lives in the board `ExportMenu` ("Download all (zip)"); skip zero-course teachers; export live board state (incl. unsaved edits); flat zip `<plan-slug>.zip` with `<plan-slug>-combined.xlsx` + `<plan-slug>-<teacher-code>.xlsx`, collisions deduped numerically.
- 2026-07-10 — plan-detail loader must gain three reads: teacher codes (`fetchPlanTeachers` pattern), `loadCourseMerges`, and course levels; `entities/timetable` builders stay untouched.
