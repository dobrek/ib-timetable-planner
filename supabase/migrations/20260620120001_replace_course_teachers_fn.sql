-- Atomic replace of a course's teacher set (its course_teachers junction rows).
--
-- PostgREST has no client-side transaction, so a supabase-js delete followed by a
-- failed insert would leave the course with zero teachers and nothing to show for
-- it — exactly the partial-write hazard updateCourse must avoid. This function does
-- the delete + reinsert in one plpgsql transaction. createCourse uses
-- writeParentWithLinks (insert + compensating delete); updateCourse uses this RPC.
--
-- SECURITY INVOKER (the default — stated explicitly): runs with the caller's
-- privileges, so the `authenticated` RLS policy on course_teachers still gates the
-- write. Do NOT switch to SECURITY DEFINER — that would bypass RLS. Mirrors
-- replace_cohort_groupings (20260604141213 / re-keyed in 20260611180006).
--
-- p_teacher_ids is a JSON array of teacher UUIDs — the full replacement set.
create function replace_course_teachers(
  p_plan_id uuid,
  p_course_id uuid,
  p_teacher_ids jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.course_teachers
   where plan_id = p_plan_id
     and course_id = p_course_id;

  insert into public.course_teachers (plan_id, course_id, teacher_id)
  select p_plan_id, p_course_id, teacher_id::uuid
  from jsonb_array_elements_text(coalesce(p_teacher_ids, '[]'::jsonb)) as teacher_id;
end;
$$;
