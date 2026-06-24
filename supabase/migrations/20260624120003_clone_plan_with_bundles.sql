-- clone_plan, updated to carry first-class bundles through clone. Full body copied
-- from 20260621130001_clone_plan_with_week.sql (create or replace), with these changes:
--   * add a _bundle_map (old_id -> fresh new_id) temp table, mirroring _grouping_map
--   * insert remapped bundles BEFORE section 7 — each placement's composite FK
--     (plan_id, bundle_id) -> bundles(plan_id, id) requires the bundle row to exist
--     first (unlike course_grouping_members, inserted late in section 9)
--   * section 7 (placements) — DOUBLE-remap course_id (_course_map) + bundle_id
--     (_bundle_map), INNER JOIN both so a missed remap fails loudly
--   * DELETE the old section-7b slot_bundles clone block (slot_bundles is retired)
-- Keeps SECURITY INVOKER and the same signature. Must land after bundles + bundle_id
-- exist (20260624120000..2) so the create-or-replace body references real columns.
create or replace function clone_plan(p_source_plan_id uuid, p_name text)
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
  create temp table _bundle_map (
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

  insert into pg_temp._bundle_map (old_id)
  select id from public.bundles where plan_id = p_source_plan_id;

  -- 2. teachers
  insert into public.teachers (id, plan_id, code, full_name)
  select m.new_id, v_new_plan_id, t.code, t.full_name
    from public.teachers t
    join pg_temp._teacher_map m on m.old_id = t.id;

  -- 2b. teacher_availability: remap teacher_id via _teacher_map; coordinate copied as-is.
  -- Teacher-keyed (not cell-keyed), so it joins the map exactly like courses do. The
  -- composite FK makes a missed remap fail loudly at insert. id omitted → fresh UUID.
  insert into public.teacher_availability (plan_id, teacher_id, day, period, severity)
  select v_new_plan_id, tm.new_id, a.day, a.period, a.severity
    from public.teacher_availability a
    join pg_temp._teacher_map tm on tm.old_id = a.teacher_id
   where a.plan_id = p_source_plan_id;

  -- 3. courses (teachers live in course_teachers, copied in 4b — no teacher_id column).
  -- week_mode carried through so a cloned plan preserves bi-weekly eligibility.
  insert into public.courses (id, plan_id, cohort, name, level, group_index, hours_per_week, week_mode)
  select cm.new_id, v_new_plan_id, c.cohort, c.name, c.level, c.group_index, c.hours_per_week, c.week_mode
    from public.courses c
    join pg_temp._course_map cm on cm.old_id = c.id;

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

  -- 4b. course_teachers: DOUBLE-remap course_id + teacher_id (copy of the
  -- course_grouping_members block). INNER JOIN both maps so a stale/foreign UUID
  -- fails loudly at insert via the composite FKs — the junction is the single source
  -- of a course's teacher set, so a silent drop here would lose co-teachers on clone.
  insert into public.course_teachers (plan_id, course_id, teacher_id)
  select v_new_plan_id, cm.new_id, tm.new_id
    from public.course_teachers ct
    join pg_temp._course_map  cm on cm.old_id = ct.course_id
    join pg_temp._teacher_map tm on tm.old_id = ct.teacher_id
   where ct.plan_id = p_source_plan_id;

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

  -- 6b. bundles — remapped to fresh UUIDs (cohort/status/day/period copied as-is).
  -- MUST precede section 7: each cloned placement's composite FK (plan_id, bundle_id)
  -- -> bundles(plan_id, id) requires the bundle row to exist first. Cell-keyed coords
  -- carry over verbatim; identity (the UUID) is freshly minted per the clone discipline.
  insert into public.bundles (id, plan_id, cohort, status, day, period)
  select bm.new_id, v_new_plan_id, b.cohort, b.status, b.day, b.period
    from public.bundles b
    join pg_temp._bundle_map bm on bm.old_id = b.id;

  -- 7. placements — DOUBLE-remap course_id (_course_map) + bundle_id (_bundle_map).
  -- INNER JOIN both so a stale/foreign UUID fails loudly via the composite FKs.
  -- week carried through so a cloned plan preserves A/B assignments.
  insert into public.placements (plan_id, cohort, day, period, course_id, week, bundle_id)
  select v_new_plan_id, p.cohort, p.day, p.period, cm.new_id, p.week, bm.new_id
    from public.placements p
    join pg_temp._course_map cm on cm.old_id = p.course_id
    join pg_temp._bundle_map bm on bm.old_id = p.bundle_id
   where p.plan_id = p_source_plan_id;

  -- 8. course_groupings (catalog_hash copied as-is — see header comment).
  -- opposite_week carried through so a cloned plan preserves the A/B-pair marker.
  insert into public.course_groupings (id, plan_id, cohort, coverage_count, score, catalog_hash, opposite_week)
  select gm.new_id, v_new_plan_id, g.cohort, g.coverage_count, g.score, g.catalog_hash, g.opposite_week
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
  drop table pg_temp._bundle_map;

  return v_new_plan_id;
end;
$$;
