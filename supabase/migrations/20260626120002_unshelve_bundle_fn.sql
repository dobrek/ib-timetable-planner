-- unshelve_bundle: place a parked bundle's courses back at a target cell — atomically.
--
-- Loops the shelf courses through place_course (its find-or-create means onto-empty and
-- onto-occupied-merge are the SAME path — a fresh `bundles` id is minted naturally),
-- collects the resulting placement rows, then cascade-deletes the shelf header (its
-- shelf_bundle_courses drop via the on-delete-cascade composite FK). Returns the placed
-- rows so the client reconciles its optimistic temp ids by course_id.
--
-- Identity is deliberately NOT preserved across the park boundary (fresh bundle id) —
-- safe because S-08 undo is snapshot/command-based, never id-reference.
--
-- SECURITY INVOKER + set search_path = '' (every table public.-qualified). Do NOT switch
-- to DEFINER — place_course is itself security invoker and the RLS policies gate it.
create function unshelve_bundle(
  p_plan_id uuid,
  p_cohort public.cohort,
  p_shelf_bundle_id uuid,
  p_target_day smallint,
  p_target_period smallint
) returns setof public.placements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_course record;
begin
  for v_course in
    select course_id, week
      from public.shelf_bundle_courses
     where plan_id = p_plan_id and shelf_bundle_id = p_shelf_bundle_id
  loop
    return query
      select *
        from public.place_course(
          p_plan_id, p_cohort, v_course.course_id, p_target_day, p_target_period, v_course.week);
  end loop;

  -- Drop the shelf header; shelf_bundle_courses cascade. Pinned by (plan_id, id).
  delete from public.shelf_bundles
   where plan_id = p_plan_id and id = p_shelf_bundle_id;
end;
$$;
