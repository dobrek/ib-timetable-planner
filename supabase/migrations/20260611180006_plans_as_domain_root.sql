-- Plans as domain root: destructive re-baseline (multi-variant-management, S-07).
--
-- The catalog (teachers, courses, students, choices, dependencies) becomes
-- plan-owned; `plan_variants` and `cohorts` are dropped (cohort becomes a native
-- enum); composite FKs make cross-plan references impossible at the DB level and
-- make the clone RPC fail loudly on any missed UUID remap.
--
-- Destructive by design: no production data exists (see plan.md Migration Notes).

-- Clear all domain rows first — the new NOT NULL plan_id columns and re-keyed
-- constraints cannot be backfilled meaningfully, and the seed repopulates dev.
truncate table
  course_grouping_members,
  course_groupings,
  placements,
  student_choices,
  course_merges,
  course_overlaps,
  students,
  courses,
  teachers,
  plan_variants,
  plans,
  cohorts
cascade;

-- Native enum so `supabase gen types` emits the union through all row types.
create type cohort as enum ('dp1', 'dp2');

-- 1. teachers: plan-owned; code unique per plan (global unique blocked cloning).
alter table teachers
  add column plan_id uuid not null references plans(id) on delete cascade;
alter table teachers drop constraint teachers_code_key;
alter table teachers add constraint teachers_plan_code_unique unique (plan_id, code);

-- 2. courses: plan-owned; cohort FK column → enum value column; uniques re-keyed
-- so clones cannot collide; (plan_id, id) unique is the composite-FK target.
alter table courses
  add column plan_id uuid not null references plans(id) on delete cascade;
alter table courses drop column cohort_id; -- drops courses_unique + courses_cohort_idx
alter table courses add column cohort cohort not null;
alter table courses add constraint courses_unique unique (plan_id, cohort, name, level, group_index);
alter table courses add constraint courses_plan_id_unique unique (plan_id, id);

-- 3. students: plan-owned; cohort enum; composite-FK target.
alter table students
  add column plan_id uuid not null references plans(id) on delete cascade;
alter table students drop column cohort_id; -- drops students_cohort_idx
alter table students add column cohort cohort not null;
alter table students add constraint students_plan_id_unique unique (plan_id, id);
create index students_plan_cohort_idx on students (plan_id, cohort);

-- 4. student_choices: denormalized plan_id; composite FKs pin both ends to the
-- same plan.
alter table student_choices add column plan_id uuid not null;
alter table student_choices drop constraint student_choices_student_id_fkey;
alter table student_choices drop constraint student_choices_course_id_fkey;
alter table student_choices
  add constraint student_choices_student_fkey
    foreign key (plan_id, student_id) references students (plan_id, id) on delete cascade;
alter table student_choices
  add constraint student_choices_course_fkey
    foreign key (plan_id, course_id) references courses (plan_id, id) on delete cascade;
drop index student_choices_course_idx;
create index student_choices_plan_course_idx on student_choices (plan_id, course_id);

-- 5. course_overlaps: denormalized plan_id; composite FKs.
alter table course_overlaps add column plan_id uuid not null;
alter table course_overlaps drop constraint course_overlaps_base_course_id_fkey;
alter table course_overlaps drop constraint course_overlaps_dependent_course_id_fkey;
alter table course_overlaps
  add constraint course_overlaps_base_fkey
    foreign key (plan_id, base_course_id) references courses (plan_id, id) on delete cascade;
alter table course_overlaps
  add constraint course_overlaps_dependent_fkey
    foreign key (plan_id, dependent_course_id) references courses (plan_id, id) on delete cascade;
create index course_overlaps_plan_idx on course_overlaps (plan_id);

-- 6. course_merges: denormalized plan_id; composite FKs.
alter table course_merges add column plan_id uuid not null;
alter table course_merges drop constraint course_merges_parent_course_id_fkey;
alter table course_merges drop constraint course_merges_child_course_id_fkey;
alter table course_merges
  add constraint course_merges_parent_fkey
    foreign key (plan_id, parent_course_id) references courses (plan_id, id) on delete cascade;
alter table course_merges
  add constraint course_merges_child_fkey
    foreign key (plan_id, child_course_id) references courses (plan_id, id) on delete cascade;
create index course_merges_plan_idx on course_merges (plan_id);

-- 7. placements: re-keyed from plan_variants to plans; cohort enum; composite
-- course FK.
alter table placements drop column variant_id; -- drops placements_unique + placements_variant_cohort_idx
alter table placements drop column cohort_id;  -- drops placements_cohort_idx
alter table placements
  add column plan_id uuid not null references plans(id) on delete cascade;
alter table placements add column cohort cohort not null;
alter table placements
  add constraint placements_unique unique (plan_id, cohort, day, period, course_id);
alter table placements drop constraint placements_course_id_fkey;
alter table placements
  add constraint placements_course_fkey
    foreign key (plan_id, course_id) references courses (plan_id, id) on delete cascade;

-- 8. course_groupings: already plan-keyed; cohort FK column → enum; composite-FK
-- target for members.
alter table course_groupings drop column cohort_id; -- drops plan_cohort, cohort, plan_cohort_hash indexes
alter table course_groupings add column cohort cohort not null;
alter table course_groupings add constraint course_groupings_plan_id_unique unique (plan_id, id);
create index course_groupings_plan_cohort_hash_idx
  on course_groupings (plan_id, cohort, catalog_hash);

-- 9. course_grouping_members: denormalized plan_id; composite FKs through both
-- the grouping and the course.
alter table course_grouping_members add column plan_id uuid not null;
alter table course_grouping_members drop constraint course_grouping_members_grouping_id_fkey;
alter table course_grouping_members drop constraint course_grouping_members_course_id_fkey;
alter table course_grouping_members
  add constraint course_grouping_members_grouping_fkey
    foreign key (plan_id, grouping_id) references course_groupings (plan_id, id) on delete cascade;
alter table course_grouping_members
  add constraint course_grouping_members_course_fkey
    foreign key (plan_id, course_id) references courses (plan_id, id) on delete cascade;

-- 10. Dead tables: placements no longer references plan_variants; nothing
-- references cohorts (all cohort_id columns dropped above).
drop table plan_variants;
drop table cohorts;

-- 11. replace_cohort_groupings: cohort param becomes the enum; members carry the
-- denormalized plan_id. Same atomic delete+reinsert semantics, SECURITY INVOKER.
drop function replace_cohort_groupings(uuid, uuid, text, jsonb);
create function replace_cohort_groupings(
  p_plan_id uuid,
  p_cohort public.cohort,
  p_catalog_hash text,
  p_groupings jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  g jsonb;
  new_grouping_id uuid;
begin
  -- Members cascade via the course_grouping_members FK on delete.
  delete from public.course_groupings
   where plan_id = p_plan_id
     and cohort = p_cohort;

  for g in select * from jsonb_array_elements(coalesce(p_groupings, '[]'::jsonb))
  loop
    insert into public.course_groupings (plan_id, cohort, coverage_count, score, catalog_hash)
    values (
      p_plan_id,
      p_cohort,
      (g ->> 'coverage_count')::integer,
      (g ->> 'score')::numeric,
      p_catalog_hash
    )
    returning id into new_grouping_id;

    insert into public.course_grouping_members (plan_id, grouping_id, course_id)
    select p_plan_id, new_grouping_id, member_id::uuid
    from jsonb_array_elements_text(g -> 'member_ids') as member_id;
  end loop;
end;
$$;
