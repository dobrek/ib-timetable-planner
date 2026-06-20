-- course_teachers: plan-scoped junction recording the SET of teachers co-teaching a
-- course. A course is co-taught by one-or-more equal teachers; each row links the
-- course to one teacher. This is the single source of a course's teacher set —
-- mirroring how studentKeys is built from student_choices — and replaces the legacy
-- scalar courses.teacher_id (dropped in a later phase, once every path reads the
-- junction).
--
-- Mirrors the teacher_availability plan-scoped child-table template: surrogate id PK,
-- a composite business-key unique, and composite FKs to BOTH parents — (plan_id,
-- course_id) → courses and (plan_id, teacher_id) → teachers — whose targets already
-- exist (courses_plan_id_unique, teachers_plan_id_unique). Both ends are pinned to the
-- same plan, so a cross-plan link is impossible and a missed remap during clone fails
-- loudly at insert. Both FKs cascade on delete: dropping a course or a teacher drops
-- its junction rows (the app-layer delete-guard prevents orphaning a course to zero
-- teachers).
create table course_teachers (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references plans(id) on delete cascade,
  course_id  uuid not null,
  teacher_id uuid not null,
  created_at timestamptz not null default now(),
  constraint course_teachers_unique unique (plan_id, course_id, teacher_id),
  constraint course_teachers_course_fkey
    foreign key (plan_id, course_id) references courses (plan_id, id) on delete cascade,
  constraint course_teachers_teacher_fkey
    foreign key (plan_id, teacher_id) references teachers (plan_id, id) on delete cascade
);

create index course_teachers_plan_idx on course_teachers (plan_id);
create index course_teachers_plan_course_idx on course_teachers (plan_id, course_id);

alter table course_teachers enable row level security;
create policy "Authenticated users have full access" on course_teachers
  for all to authenticated using (true) with check (true);

-- anon GRANT-layer exclusion (belt-and-suspenders). The alter-default-privileges
-- revoke for anon (20260617205628) SHOULD carry this new table's anon DML away, but
-- per lessons.md "granting a role is not excluding the others", a non-grant is not an
-- exclusion — Supabase has historically auto-granted anon at table creation.
-- course_teachers is the FIRST new public table created after that revoke, so the
-- default-privileges path is unexercised here; pin the exclusion explicitly in the
-- same transaction rather than trust it. (`authenticated` and `service_role` DML is
-- carried forward by their own alter-default-privileges grants.) Proven by
-- has_table_privilege query in manual verification, not by reading this policy.
revoke select, insert, update, delete on course_teachers from anon;
