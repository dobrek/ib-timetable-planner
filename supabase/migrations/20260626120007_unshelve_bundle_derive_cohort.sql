-- Harden unshelve_bundle: place the parked bundle back into its OWN stored cohort, never the
-- caller-supplied one.
--
-- The original forwarded the caller's p_cohort straight to place_course, so a wrong cohort
-- argument would land a DP1 parked bundle on the DP2 board (and vice versa). Safe today — the
-- client always passes the active board cohort and the loader filters shelf rows by cohort —
-- but the S-06 two-cohort view puts both cohorts on screen at once, where the authoritative
-- scope must come from the row, not the request. Derive the cohort from the shelf_bundles row
-- and use it; p_cohort is retained only for signature stability (create-or-replace cannot drop
-- a parameter) and is no longer trusted.
--
-- create-or-replace only: identical signature, security invoker, set search_path = ''. Do NOT
-- switch to DEFINER — place_course is itself security invoker and the RLS policies gate it.
create or replace function unshelve_bundle(
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
  v_cohort public.cohort;
  v_course record;
begin
  -- authoritative cohort: the parked bundle's own, not the caller's
  select cohort into v_cohort
    from public.shelf_bundles
   where plan_id = p_plan_id and id = p_shelf_bundle_id;
  if not found then
    return;  -- no such parked bundle (already placed/discarded) — nothing to restore
  end if;

  for v_course in
    select course_id, week
      from public.shelf_bundle_courses
     where plan_id = p_plan_id and shelf_bundle_id = p_shelf_bundle_id
  loop
    return query
      select *
        from public.place_course(
          p_plan_id, v_cohort, v_course.course_id, p_target_day, p_target_period, v_course.week);
  end loop;

  -- Drop the shelf header; shelf_bundle_courses cascade. Pinned by (plan_id, id).
  delete from public.shelf_bundles
   where plan_id = p_plan_id and id = p_shelf_bundle_id;
end;
$$;
