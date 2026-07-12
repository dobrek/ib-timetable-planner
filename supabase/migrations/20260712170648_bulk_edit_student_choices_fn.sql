-- Atomic bulk edit of many students' course choices in one transaction.
--
-- The literal user story ("add TOK1 to every Math SL chooser, ensure none have
-- TOK2") is a fan-out of student_choices insert-if-absent + delete-if-present
-- across a selected student set. PostgREST has no client-side transaction, so a
-- supabase-js loop of inserts + deletes would leave a partial write on failure —
-- far worse at bulk blast radius than for a single student. This function does the
-- whole add-set + remove-set in one plpgsql transaction, so it is all-or-nothing.
--
-- Deliberately VALIDATION-FREE (mirrors replace_course_teachers, 20260620120001):
-- the TypeScript domain fn (bulkEditChoices) is the authoritative gate — it checks
-- every add-course and every selected student against plan + cohort before calling.
-- The composite FKs (plan_id, student_id) -> students(plan_id, id) and
-- (plan_id, course_id) -> courses(plan_id, id) backstop the plan pin *inside* the
-- transaction, so a crafted cross-plan id aborts the whole call rather than
-- partially applying. Do NOT add SECURITY DEFINER — that would bypass RLS.
--
-- Insert before delete (house convention, cf. update-student.ts): both run in the
-- same transaction here, so ordering is about consistency with the single-student
-- path, not a failure window.
--
-- p_student_ids / p_add_course_ids / p_remove_course_ids are JSON arrays of UUIDs.
create function bulk_edit_student_choices(
  p_plan_id uuid,
  p_student_ids jsonb,
  p_add_course_ids jsonb,
  p_remove_course_ids jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Add: cross join every selected student with every add-course, skipping rows
  -- that already exist (the UNIQUE (student_id, course_id) makes this idempotent).
  -- Explicit (val) column aliases keep the element name distinct from the table's
  -- own student_id/course_id columns — a bare alias would correlate to the outer
  -- row inside the delete subqueries below and silently match everything.
  insert into public.student_choices (plan_id, student_id, course_id)
  select p_plan_id, s.val::uuid, c.val::uuid
  from jsonb_array_elements_text(p_student_ids) as s(val)
  cross join jsonb_array_elements_text(coalesce(p_add_course_ids, '[]'::jsonb)) as c(val)
  on conflict (student_id, course_id) do nothing;

  -- Remove: delete only the listed (student, course) pairs, plan-pinned.
  delete from public.student_choices sc
   where sc.plan_id = p_plan_id
     and sc.student_id in (
       select s.val::uuid from jsonb_array_elements_text(p_student_ids) as s(val)
     )
     and sc.course_id in (
       select c.val::uuid from jsonb_array_elements_text(coalesce(p_remove_course_ids, '[]'::jsonb)) as c(val)
     );
end;
$$;
