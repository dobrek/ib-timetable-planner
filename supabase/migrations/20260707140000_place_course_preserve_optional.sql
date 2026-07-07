-- place_course: stop converging is_optional on conflict — preserve the existing row's flag.
--
-- 20260707120001 made the idempotent `on conflict … do update` also set
-- is_optional = excluded.is_optional ("a replay converges on the requested state") and documented
-- the resulting trap in a comment ("a caller that omits p_is_optional … RESETS a pending optional
-- decision — always pass the flag explicitly"). The trap was live, not hypothetical: on the
-- unshelve merge path (a parked card containing a course already placed at the target cell),
-- unshelve_bundle calls place_course with the SHELF twin's stored flag, and the conflict update
-- overwrote the board row's pending optional decision with it. The client compounds the loss —
-- persistPlaceBack filters the already-present member out of its reconcile entries, so the
-- overwritten row never reached the UI (stale "optional" cue until reload).
--
-- The conflict update is now the same pure no-op it was before 20260707120001: the bundle_id
-- reassignment only, kept solely for the RETURNING trick. `week` and `is_optional` are both
-- single-writer columns (update_placement_week / update_placement_optional); place_course applies
-- p_week / p_is_optional to FRESH inserts only and never clobbers either on a re-place. Undo does
-- not rely on conflict-convergence: a reconcile plan removes before it places, so a re-placed row
-- is always a fresh insert and the values clause restores the flag.
--
-- Re-created from the latest live definition (20260707120001), per lessons.md. Same signature —
-- CREATE OR REPLACE, no drop. Stays SECURITY INVOKER + set search_path = '' (every table
-- public.-qualified): the `authenticated` RLS policies gate the writes. Do NOT switch to DEFINER.

create or replace function place_course(
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

  -- Insert the placement with that bundle_id, idempotent on placements_unique. The bundle_id
  -- assignment is a pure no-op (the existing row sits at the same cell ⇒ same bundle) whose
  -- only purpose is to make the conflicting row eligible for RETURNING.
  --
  -- Neither `week` nor `is_optional` is converged on conflict: both are single-writer columns
  -- (update_placement_week / update_placement_optional are the sole writers), and p_week /
  -- p_is_optional apply to fresh inserts only. A re-place onto an existing row — notably
  -- unshelve_bundle's merge path, where a parked twin lands on a cell already holding the
  -- course — must never clobber the board row's pending optional decision (or its week).
  insert into public.placements (plan_id, cohort, course_id, day, period, week, bundle_id, is_optional)
  values (p_plan_id, p_cohort, p_course_id, p_day, p_period, p_week, v_bundle_id, p_is_optional)
  on conflict (plan_id, cohort, day, period, course_id)
  do update set bundle_id = excluded.bundle_id
  returning * into v_placement;

  return v_placement;
end;
$$;
