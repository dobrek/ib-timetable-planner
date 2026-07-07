-- shelve_bundle, extended to copy each member's optional flag into its shelf twin —
-- parking a bundle must not silently reset a pending "optional" decision. Full body
-- copied from 20260626120001_shelve_bundle_fn.sql (create or replace, same signature)
-- with is_optional added to the step-2 membership copy's column list AND SELECT.
--
-- SECURITY INVOKER + set search_path = '' unchanged. Do NOT switch to DEFINER.
create or replace function shelve_bundle(
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

  -- 2. COPY membership (course + week + optional flag) off the placements at this cell —
  -- BEFORE deleting (membership lives only in placements; reverse the order and the
  -- parked bundle is an empty husk)
  insert into public.shelf_bundle_courses (plan_id, shelf_bundle_id, course_id, week, is_optional)
  select p_plan_id, v_shelf.id, pl.course_id, pl.week, pl.is_optional
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
