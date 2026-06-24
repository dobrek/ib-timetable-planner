-- remove_bundle_members: delete a set of placements from a cell and delete the cell's
-- bundle if the removal emptied it — atomically. Whole-bundle remove (M = all members,
-- e.g. the bulk trash) and single-course remove (M = one chip) are the SAME call,
-- differing only in p_course_ids.
--
-- Member set pinned to course ids, consistent with move_bundle_members: (cell + course
-- id) identifies each placement, so the client need not round-trip for placement uuids.
--
-- SECURITY INVOKER + set search_path = '' (every table public.-qualified). The == 0
-- cleanup is enforced inside this transaction (not a background sweep): a bundles row
-- exists exactly while its membership >= 1.
create function remove_bundle_members(
  p_plan_id uuid,
  p_cohort public.cohort,
  p_day smallint,
  p_period smallint,
  p_course_ids uuid[]
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bundle_id uuid;
begin
  -- The cell's bundle, captured before the delete so the == 0 check can target it.
  select id into v_bundle_id
    from public.bundles
   where plan_id = p_plan_id and cohort = p_cohort and day = p_day and period = p_period;

  delete from public.placements
   where plan_id = p_plan_id and cohort = p_cohort and day = p_day and period = p_period
     and course_id = any(p_course_ids);

  -- Delete the bundle iff the removal dropped its membership to 0 — never before.
  delete from public.bundles
   where id = v_bundle_id
     and not exists (select 1 from public.placements where bundle_id = v_bundle_id);
end;
$$;
