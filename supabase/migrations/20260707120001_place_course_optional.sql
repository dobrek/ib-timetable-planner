-- place_course + unshelve_bundle, extended to carry the per-member optional flag.
--
-- place_course gains a trailing `p_is_optional boolean default false` so group-add,
-- duplicate, unshelve, and undo-replay can restore the flag. CREATE OR REPLACE cannot
-- add a parameter (it would mint a second overload), so the 6-parameter function is
-- DROPped and re-created. The default keeps every existing 6-arg caller resolving —
-- including unshelve_bundle's internal call until it is replaced below.
--
-- The idempotent `on conflict … do update` also sets is_optional = excluded.is_optional
-- so a replay converges on the requested state (same no-op-update RETURNING trick the
-- bundle_id assignment already uses).
--
-- unshelve_bundle (same signature — create or replace) now selects each parked member's
-- stored flag and passes it as the 7th argument, so the flag survives park/unpark.
--
-- Both stay SECURITY INVOKER + set search_path = '' (every table public.-qualified):
-- the `authenticated` RLS policies gate the writes. Do NOT switch to DEFINER.

drop function place_course(uuid, public.cohort, uuid, smallint, smallint, public.placement_week);

create function place_course(
  p_plan_id uuid,
  p_cohort public.cohort,
  p_course_id uuid,
  p_day smallint,
  p_period smallint,
  p_week public.placement_week default 'both',
  p_is_optional boolean default false
) returns public.placements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bundle_id uuid;
  v_placement public.placements;
begin
  -- Find-or-create the cell's placed bundle, capturing its id. `do update set status`
  -- is a deliberate no-op write whose only purpose is to make the conflicting row
  -- eligible for RETURNING — `do nothing` returns NO row, so the existing bundle's id
  -- could not be captured. The conflict target names the bundles_cell_unique partial
  -- index (columns + its `where day is not null` predicate).
  insert into public.bundles (plan_id, cohort, status, day, period)
  values (p_plan_id, p_cohort, 'placed', p_day, p_period)
  on conflict (plan_id, cohort, day, period) where day is not null
  do update set status = excluded.status
  returning id into v_bundle_id;

  -- Insert the placement with that bundle_id, idempotent on placements_unique. Same
  -- RETURNING trick: the bundle_id assignment is a no-op (the existing row sits at the
  -- same cell ⇒ same bundle) that yields the existing row; is_optional converges on the
  -- requested state so a replay restores the flag.
  --
  -- Asymmetry, on purpose: `week` is NOT converged on conflict (the sole week writer is
  -- update_placement_week; place_course must never clobber it on a re-place), while
  -- is_optional IS (undo-replay re-places through here and must restore the flag).
  -- Consequence: a caller that omits p_is_optional (default false) and hits an existing
  -- row RESETS a pending optional decision — always pass the flag explicitly when the
  -- row may already exist.
  insert into public.placements (plan_id, cohort, course_id, day, period, week, bundle_id, is_optional)
  values (p_plan_id, p_cohort, p_course_id, p_day, p_period, p_week, v_bundle_id, p_is_optional)
  on conflict (plan_id, cohort, day, period, course_id)
  do update set bundle_id = excluded.bundle_id, is_optional = excluded.is_optional
  returning * into v_placement;

  return v_placement;
end;
$$;

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
    select course_id, week, is_optional
      from public.shelf_bundle_courses
     where plan_id = p_plan_id and shelf_bundle_id = p_shelf_bundle_id
  loop
    return query
      select *
        from public.place_course(
          p_plan_id, v_cohort, v_course.course_id, p_target_day, p_target_period,
          v_course.week, v_course.is_optional);
  end loop;

  -- Drop the shelf header; shelf_bundle_courses cascade. Pinned by (plan_id, id).
  delete from public.shelf_bundles
   where plan_id = p_plan_id and id = p_shelf_bundle_id;
end;
$$;
