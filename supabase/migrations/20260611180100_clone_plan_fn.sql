-- clone_plan: atomic deep copy of an entire plan — catalog, placements,
-- groupings — with UUID remap in topological order. The primary plan-creation
-- path (multi-variant-management, S-07).
--
-- SECURITY INVOKER (mirrors replace_cohort_groupings): the caller's RLS
-- policies gate every read and write. Do NOT switch to SECURITY DEFINER.
--
-- catalog_hash is copied as-is: the cloned courses get new UUIDs so the copied
-- hash reads as stale; the clonePlan domain function recomputes it JS-side to
-- keep a single hash implementation (see plan.md Critical Implementation
-- Details). The composite FKs from the re-baseline migration make any missed
-- remap fail loudly at insert time.
create function clone_plan(p_source_plan_id uuid, p_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new_plan_id uuid;
begin
  -- 1. plans row (new name, same grid preset). No row → source missing.
  insert into public.plans (name, slot_grid_preset)
  select p_name, slot_grid_preset
    from public.plans
   where id = p_source_plan_id
  returning id into v_new_plan_id;

  if v_new_plan_id is null then
    raise exception 'clone_plan: source plan % not found', p_source_plan_id;
  end if;

  -- ID maps for every parent table whose children must remap. Temp tables are
  -- transaction-scoped (on commit drop) and explicitly pg_temp-qualified since
  -- search_path is empty.
  create temp table _teacher_map (
    old_id uuid primary key,
    new_id uuid not null default gen_random_uuid()
  ) on commit drop;
  create temp table _course_map (
    old_id uuid primary key,
    new_id uuid not null default gen_random_uuid()
  ) on commit drop;
  create temp table _student_map (
    old_id uuid primary key,
    new_id uuid not null default gen_random_uuid()
  ) on commit drop;
  create temp table _grouping_map (
    old_id uuid primary key,
    new_id uuid not null default gen_random_uuid()
  ) on commit drop;

  insert into pg_temp._teacher_map (old_id)
  select id from public.teachers where plan_id = p_source_plan_id;

  insert into pg_temp._course_map (old_id)
  select id from public.courses where plan_id = p_source_plan_id;

  insert into pg_temp._student_map (old_id)
  select id from public.students where plan_id = p_source_plan_id;

  insert into pg_temp._grouping_map (old_id)
  select id from public.course_groupings where plan_id = p_source_plan_id;

  -- 2. teachers
  insert into public.teachers (id, plan_id, code, full_name)
  select m.new_id, v_new_plan_id, t.code, t.full_name
    from public.teachers t
    join pg_temp._teacher_map m on m.old_id = t.id;

  -- 3. courses (teacher_id is SET NULL semantics: preserve NULLs, remap
  -- non-NULLs within the new plan via the left join).
  insert into public.courses (id, plan_id, cohort, teacher_id, name, level, group_index, hours_per_week)
  select cm.new_id, v_new_plan_id, c.cohort, tm.new_id, c.name, c.level, c.group_index, c.hours_per_week
    from public.courses c
    join pg_temp._course_map cm on cm.old_id = c.id
    left join pg_temp._teacher_map tm on tm.old_id = c.teacher_id;

  -- 4. course_overlaps + course_merges
  insert into public.course_overlaps (plan_id, base_course_id, dependent_course_id)
  select v_new_plan_id, mb.new_id, md.new_id
    from public.course_overlaps o
    join pg_temp._course_map mb on mb.old_id = o.base_course_id
    join pg_temp._course_map md on md.old_id = o.dependent_course_id
   where o.plan_id = p_source_plan_id;

  insert into public.course_merges (plan_id, parent_course_id, child_course_id)
  select v_new_plan_id, mp.new_id, mc.new_id
    from public.course_merges cm
    join pg_temp._course_map mp on mp.old_id = cm.parent_course_id
    join pg_temp._course_map mc on mc.old_id = cm.child_course_id
   where cm.plan_id = p_source_plan_id;

  -- 5. students
  insert into public.students (id, plan_id, cohort, full_name)
  select m.new_id, v_new_plan_id, s.cohort, s.full_name
    from public.students s
    join pg_temp._student_map m on m.old_id = s.id;

  -- 6. student_choices
  insert into public.student_choices (plan_id, student_id, course_id)
  select v_new_plan_id, sm.new_id, cm.new_id
    from public.student_choices sc
    join pg_temp._student_map sm on sm.old_id = sc.student_id
    join pg_temp._course_map cm on cm.old_id = sc.course_id
   where sc.plan_id = p_source_plan_id;

  -- 7. placements
  insert into public.placements (plan_id, cohort, day, period, course_id)
  select v_new_plan_id, p.cohort, p.day, p.period, cm.new_id
    from public.placements p
    join pg_temp._course_map cm on cm.old_id = p.course_id
   where p.plan_id = p_source_plan_id;

  -- 8. course_groupings (catalog_hash copied as-is — see header comment)
  insert into public.course_groupings (id, plan_id, cohort, coverage_count, score, catalog_hash)
  select gm.new_id, v_new_plan_id, g.cohort, g.coverage_count, g.score, g.catalog_hash
    from public.course_groupings g
    join pg_temp._grouping_map gm on gm.old_id = g.id;

  -- 9. course_grouping_members
  insert into public.course_grouping_members (plan_id, grouping_id, course_id)
  select v_new_plan_id, gm.new_id, cm.new_id
    from public.course_grouping_members m
    join pg_temp._grouping_map gm on gm.old_id = m.grouping_id
    join pg_temp._course_map cm on cm.old_id = m.course_id
   where m.plan_id = p_source_plan_id;

  -- on commit drop handles rollback paths; drop eagerly so repeated calls in
  -- one transaction (e.g. test setup) don't collide on the temp names.
  drop table pg_temp._teacher_map;
  drop table pg_temp._course_map;
  drop table pg_temp._student_map;
  drop table pg_temp._grouping_map;

  return v_new_plan_id;
end;
$$;
