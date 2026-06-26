-- shelve_courses: park an arbitrary course-set directly onto the shelf — the off-board
-- analogue of shelve_bundle, for parking a palette grouping that was never placed.
--
-- shelve_bundle reads the placements at a cell; a grouping in the palette has none, so this
-- takes the (course, week) set explicitly. Positionally zips the two parallel arrays into
-- shelf_bundle_courses. Returns the new shelf header for optimistic id reconciliation.
--
-- SECURITY INVOKER + set search_path = '' (every table public.-qualified): the authenticated
-- RLS policies on shelf_bundles/shelf_bundle_courses gate the writes. Do NOT switch to DEFINER.
create function shelve_courses(
  p_plan_id uuid,
  p_cohort public.cohort,
  p_course_ids uuid[],
  p_weeks public.placement_week[]
) returns public.shelf_bundles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_shelf public.shelf_bundles;
begin
  insert into public.shelf_bundles (plan_id, cohort)
  values (p_plan_id, p_cohort)
  returning * into v_shelf;

  insert into public.shelf_bundle_courses (plan_id, shelf_bundle_id, course_id, week)
  select p_plan_id, v_shelf.id, u.course_id, u.week
    from unnest(p_course_ids, p_weeks) as u(course_id, week);

  return v_shelf;
end;
$$;
