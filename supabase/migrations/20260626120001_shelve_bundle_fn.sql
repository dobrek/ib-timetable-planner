-- shelve_bundle: lift a placed bundle off the board into the shelf — atomically.
--
-- Captures the placed bundle's course set + A/B weeks into shelf_bundle_courses, THEN
-- tears down the board representation (placements, then the now-empty bundles row via the
-- == 0 rule). Returns the new shelf header so the client reconciles its optimistic card.
--
-- ORDERING IS LOAD-BEARING (copy → delete placements → delete bundle): membership lives
-- only in placements, so copying BEFORE the delete is the only way to preserve the course
-- set. Reverse the order and the parked bundle is an empty husk.
--
-- An empty-source cell mints an empty shelf header with no courses; the model layer
-- guards against shelving an empty cell, so this is defensive only.
--
-- SECURITY INVOKER + set search_path = '' (every table public.-qualified): runs as the
-- caller, so the `authenticated` RLS policies on shelf_bundles/shelf_bundle_courses/
-- placements/bundles gate the write. Do NOT switch to DEFINER.
create function shelve_bundle(
  p_plan_id uuid,
  p_cohort public.cohort,
  p_day smallint,
  p_period smallint
) returns public.shelf_bundles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_shelf public.shelf_bundles;
begin
  -- 1. mint the shelf header
  insert into public.shelf_bundles (plan_id, cohort)
  values (p_plan_id, p_cohort)
  returning * into v_shelf;

  -- 2. COPY membership (course + week) off the placements at this cell — BEFORE deleting
  insert into public.shelf_bundle_courses (plan_id, shelf_bundle_id, course_id, week)
  select p_plan_id, v_shelf.id, pl.course_id, pl.week
    from public.placements pl
   where pl.plan_id = p_plan_id and pl.cohort = p_cohort and pl.day = p_day and pl.period = p_period;

  -- 3. tear down the board representation (placements, then the now-empty bundle row)
  delete from public.placements
   where plan_id = p_plan_id and cohort = p_cohort and day = p_day and period = p_period;
  delete from public.bundles
   where plan_id = p_plan_id and cohort = p_cohort and day = p_day and period = p_period;

  return v_shelf;
end;
$$;
