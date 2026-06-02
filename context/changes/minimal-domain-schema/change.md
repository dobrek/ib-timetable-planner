---
id: minimal-domain-schema
title: Minimal domain schema (Supabase tables + RLS + types for MVP)
roadmap_ref: F-02
prd_refs: [FR-002, FR-003, FR-003A, FR-004, FR-006, FR-008, FR-010, "NFR Work durability"]
status: implemented
created: 2026-06-01
updated: 2026-06-02
---

# Minimal domain schema

Create the Supabase Postgres schema powering the northstar (S-01) and the grouping
algorithm (F-03): 12 tables covering cohorts, courses (with inline teacher FK),
directional overlaps, merge groups, students, teachers, plans, variants, placements,
and grouping cache. RLS scoped to authenticated users (shared workspace). Generated
TypeScript types wired into the Supabase client. Dev seed from both `data/dp1/` and
`data/dp2/` reference fixtures (both cohorts populated).

## Decisions (settled during `/10x-plan`)

- **Table scope:** expanded from roadmap's original 7 to 12 tables — includes teachers,
  course overlaps, course merges because F-03's grouping algorithm needs them as input.
- **Teacher model:** each course has exactly one teacher → `teacher_id` FK on `courses`
  (nullable until S-03 assigns teachers). No separate `teacher_assignments` junction.
- **Cohort model:** separate `cohorts` table; courses and students FK to a cohort.
  Teachers are cohort-agnostic (shared across cohorts via their course assignments).
- **Course-cohort:** each course belongs to one cohort (FK, not M:N). Y1 and Y2 may
  have different course sections.
- **Overlap semantics:** directed student-enrollment rule, not a symmetric pair.
  "English A SL ← HL" means HL students must also attend SL. Column names:
  `base_course_id` (receives extra students) / `dependent_course_id`.
- **Merge semantics:** virtual combined teaching session. The merge parent is a course
  row with a composite level (e.g., `SL+HL`); one teacher teaches all children in the
  same slot simultaneously. Variable child count (2 or 3, per dp1 fixtures).
- **Placement cohort:** explicit `cohort_id` on placements for direct cross-cohort
  queries (S-09).
- **Hours per week:** on courses table (course property, not teacher-specific).
- **RLS:** all authenticated users share all data (single-school, handful of authors).
- **Groupings storage:** materialized `course_groupings` table + `course_grouping_members`
  junction — enables per-course filtering via standard FK joins.
- **Teacher availability:** deferred to S-03 (not needed for F-03's basic operation;
  dp2 fixtures don't include availability data).

See `plan.md` for the implementation contract and `plan-brief.md` for the two-page summary.
