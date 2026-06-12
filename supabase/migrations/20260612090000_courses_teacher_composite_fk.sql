-- Close the composite-FK gap for courses.teacher_id (impl-review F1).
--
-- 20260611180006 re-keyed every cross-table link to (plan_id, id) composite
-- FKs except courses.teacher_id, which kept its original plain FK to
-- teachers(id). That allowed a course to reference a teacher from another
-- plan — a link clone_plan would then silently NULL via its LEFT JOIN remap.
-- Re-keying makes cross-plan teacher links impossible at the DB level and a
-- missed clone remap fail loudly.

alter table teachers add constraint teachers_plan_id_unique unique (plan_id, id);

alter table courses drop constraint courses_teacher_id_fkey;
alter table courses
  add constraint courses_teacher_fkey
    foreign key (plan_id, teacher_id) references teachers (plan_id, id)
    on delete set null (teacher_id);

-- Plan-scoped replacement for the old single-column FK index.
drop index courses_teacher_idx;
create index courses_plan_teacher_idx on courses (plan_id, teacher_id);
