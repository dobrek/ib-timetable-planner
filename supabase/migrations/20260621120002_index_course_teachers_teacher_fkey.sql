-- Index the course_teachers (plan_id, teacher_id) FK pair left uncovered by the
-- table's initial migration (20260620120000). Postgres does not auto-index FK
-- columns; without this, the teacher ON DELETE CASCADE traversal and the
-- delete-guard's reverse lookup (delete-teacher.ts — WHERE plan_id = ? AND
-- teacher_id = ?) seq-scan the plan's junction rows, and Supabase's
-- unindexed_foreign_keys advisor flags course_teachers_teacher_fkey. The sibling
-- (plan_id, course_id) FK is already covered by course_teachers_plan_course_idx.
-- Mirrors teacher_availability_plan_teacher_idx (20260613130000:30).
create index course_teachers_plan_teacher_idx on course_teachers (plan_id, teacher_id);
