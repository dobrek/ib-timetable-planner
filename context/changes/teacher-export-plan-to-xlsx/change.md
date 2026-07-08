---
change_id: teacher-export-plan-to-xlsx
title: Teacher export plan to xlsx
status: implementing
created: 2026-07-08
updated: 2026-07-08
archived_at: null
---

## Notes

Sits at the intersection of two shipped changes — `2026-07-07-export-to-xlsx` (the xlsx machinery) and `2026-07-05-teacher-plan-view` (the read-only per-teacher page). Feasibility + reuse map in `research.md`. Highly feasible: no new data loading, no schema, no new dependency (`write-excel-file@^4.1.1` already installed), no Cloudflare change.

## Scope Decisions 2026-07-08 (resolved with the author)

Authoritative input to `/10x-plan`; these resolve `research.md` §Open Questions.

1. **Transform reach → persona-agnostic, teacher wired now.** Build the workbook assembler in `entities/timetable/model/export/` (library-free, returns `TimetableSheet` descriptors) so it serves both the teacher and the sibling `student-plan-view`; wire only the teacher's Export button this change. Student export is a ~1-file follow-up. Keep `write-excel-file` bound only at the leaf (`/browser` in the island; `/universal` reserved for a future Worker) — satisfies the "don't block server-side batch" constraint by construction.
2. **Grid worksheet → one merged grid, cohort-tagged.** Mirror the on-screen teacher grid (both cohorts merged onto one day×period grid); each course line carries a `(DP1)`/`(DP2)` tag. Implement as a small generalization of `buildTimetableSheet` (optional cohort suffix on `occupantLabel`), not a fork.
3. **Per-course worksheet → rich header + roster.** Each sheet: a header block (course name, cohort/level, hours placed/required, co-teachers, occurrence times) then the assigned-students list. All inputs already in `PerspectiveCourseItem` (`buildPerspectiveCourseItems`), merge-children resolved to their own rosters.
4. **Grid style → clean.** Subject fills, week/optional tags, break bands, frozen headers — but NO collision or availability marks (mirrors the shipped board-export convention; file reads clean regardless of validation state).
5. **Per-course tab names → always `Name · DPx`.** Tab = sanitized course name + cohort suffix (`Mathematics HL · DP1`), so cohorts are always disambiguated. Mandatory caller-side sheet-name hygiene regardless: strip Excel-illegal chars `[ ] / \ : * ?`, truncate to ≤31 chars, and de-duplicate (the library throws on illegal/overlong names and does NOT check uniqueness). Grid sheet gets a fixed safe name (e.g. `Timetable`).
6. **No summary sheet.** Workbook = grid sheet + one sheet per course. The grid is the overview; a teacher has only a handful of courses.
7. **Filename → `<plan-slug>-<teacher-code>.xlsx`** (e.g. `ib-2027-draft-kk.xlsx`), mirroring `exportFileName`'s slugging with the teacher code appended.
8. **Entry point → a single Export icon button** beside `TeacherSwitcher` in the page header (`TeacherPlanPage.tsx` header row). One export target, so no dropdown (unlike the board's 3-view menu). Model on `ExportMenu`'s trigger (lucide `Download`, ghost, `aria-label`) with a `sonner` toast on failure.

### Not doing

- No student-view Export button (transform is ready for it; wiring is a follow-up).
- No server-side / Worker export route yet (the transform stays reusable for it — Open Q #6 of the prior xlsx research).
- No reuse of `_pages/plan-detail/lib/export-workbook.ts` / `export-file-name.ts` / `ExportMenu.tsx` — page-slice-trapped and cohort-shaped; the teacher path writes its own thin glue on the entity transforms.
- No schema, no new loader/query, no new dependency.
