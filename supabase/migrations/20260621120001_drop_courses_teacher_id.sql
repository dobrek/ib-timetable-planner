-- Retire the legacy scalar teacher link. The course_teachers junction is now the single
-- source of a course's teacher set: every read (board load, courses page, teachers page),
-- write (createCourse/updateCourse/createMerge), and clone path sources teachers from the
-- junction (clone_plan was updated in 20260621120000 to stop copying this column).
--
-- This DROP deviates from the additive-migration guideline; acceptable pre-prod (no
-- production data — see README §Rollback; precedent: the destructive re-baseline
-- 20260611180006). Dropping the column also drops its dependent FK + index, but they are
-- dropped explicitly first for clarity.
alter table courses drop constraint courses_teacher_fkey;
drop index courses_plan_teacher_idx;
alter table courses drop column teacher_id;
