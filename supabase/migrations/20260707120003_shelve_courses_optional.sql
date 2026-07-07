-- shelve_courses, extended with a third parallel array carrying each member's optional
-- flag — the direct park-a-course-set path (parkMembers) must preserve the flag too.
--
-- CREATE OR REPLACE cannot add a parameter (it would mint a second overload), so the
-- 4-parameter function is DROPped and re-created. `p_optionals boolean[] default null`
-- is load-bearing: with a default, the pre-existing 4-arg RPC call keeps resolving
-- (no PGRST202) and generated types mark the arg optional — the client starts passing
-- the array explicitly only when the flag threading lands. A null/short array coalesces
-- per element to false via WITH ORDINALITY.
--
-- SECURITY INVOKER + set search_path = '' unchanged (every table public.-qualified):
-- the authenticated RLS policies gate the writes. Do NOT switch to DEFINER.

drop function shelve_courses(uuid, public.cohort, uuid[], public.placement_week[]);

create function shelve_courses(
  p_plan_id uuid,
  p_cohort public.cohort,
  p_course_ids uuid[],
  p_weeks public.placement_week[],
  p_optionals boolean[] default null
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

  insert into public.shelf_bundle_courses (plan_id, shelf_bundle_id, course_id, week, is_optional)
  select p_plan_id, v_shelf.id, u.course_id, u.week, coalesce(p_optionals[u.i], false)
    from unnest(p_course_ids, p_weeks) with ordinality as u(course_id, week, i);

  return v_shelf;
end;
$$;
