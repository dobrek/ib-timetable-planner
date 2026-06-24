-- place_course: insert one course-hour into a cell, creating the cell's bundle if
-- absent — one transaction, single round-trip, same latency profile as today's insert.
-- Replaces the Phase-1 client-side find-or-create bridge (insertPlacement) with an
-- atomic server-side one; Phase 3 repoints the persistence layer onto it.
--
-- Returns the inserted (or pre-existing) placement row so the client reconciles its
-- optimistic temp id. Idempotent on placements_unique: a duplicate course-hour returns
-- the existing row, never an error (preserves insertPlacement's contract).
--
-- SECURITY INVOKER + set search_path = '' (per replace_course_teachers): runs as the
-- caller, so the `authenticated` RLS policies on bundles + placements still gate the
-- write, and EVERY table reference is public.-qualified. Do NOT switch to DEFINER.
create function place_course(
  p_plan_id uuid,
  p_cohort public.cohort,
  p_course_id uuid,
  p_day smallint,
  p_period smallint,
  p_week public.placement_week default 'both'
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
  -- RETURNING trick: `do update set bundle_id = excluded.bundle_id` is a no-op (the
  -- existing row sits at the same cell ⇒ same bundle) that yields the existing row.
  insert into public.placements (plan_id, cohort, course_id, day, period, week, bundle_id)
  values (p_plan_id, p_cohort, p_course_id, p_day, p_period, p_week, v_bundle_id)
  on conflict (plan_id, cohort, day, period, course_id)
  do update set bundle_id = excluded.bundle_id
  returning * into v_placement;

  return v_placement;
end;
$$;
