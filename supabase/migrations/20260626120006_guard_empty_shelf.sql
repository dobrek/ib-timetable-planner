-- Guard shelve_bundle / shelve_courses against minting an orphan empty shelf header.
--
-- Both RPCs previously INSERTed the shelf_bundles header unconditionally, so an empty source
-- (a cell with no placements, or an empty course array) produced a parked bundle with zero
-- courses — a ghost card that inflates the "N parked" badge and can only be cleared via the
-- discard "×". The model layer already no-ops empty sources, but a rapid double "lift to shelf"
-- can race past that client guard (the useLatest one-render ref lag) and reach the unguarded
-- RPC. Guard at the source: when there is nothing to park, RAISE — the surrounding transaction
-- aborts, so no header row is ever minted, and the domain layer's `if (error)` path rolls the
-- optimistic update back. The non-empty path is byte-for-byte unchanged.
--
-- create-or-replace only: identical signatures, security invoker, set search_path = '' — see
-- 20260626120001_shelve_bundle_fn.sql and 20260626120005_shelve_courses_fn.sql. Do NOT switch
-- to DEFINER.

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
  -- guard: nothing placed at this cell → abort, mint no orphan husk
  if not exists (
    select 1 from public.placements
     where plan_id = p_plan_id and cohort = p_cohort and day = p_day and period = p_period
  ) then
    raise exception 'shelve_bundle: no placements at cell (day %, period %)', p_day, p_period;
  end if;

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

create or replace function shelve_courses(
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
  -- guard: empty course set → abort (the action's Zod input also enforces .min(1))
  if p_course_ids is null or array_length(p_course_ids, 1) is null then
    raise exception 'shelve_courses: empty course set';
  end if;

  insert into public.shelf_bundles (plan_id, cohort)
  values (p_plan_id, p_cohort)
  returning * into v_shelf;

  insert into public.shelf_bundle_courses (plan_id, shelf_bundle_id, course_id, week)
  select p_plan_id, v_shelf.id, u.course_id, u.week
    from unnest(p_course_ids, p_weeks) as u(course_id, week);

  return v_shelf;
end;
$$;
