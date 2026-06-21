-- replace_cohort_groupings, updated to persist the opposite_week marker from the JSON
-- payload into course_groupings. Body based on the LIVE definition in
-- 20260611180006_plans_as_domain_root.sql (signature p_cohort public.cohort, column
-- cohort) — NOT the superseded 20260604141213 version. Same atomic delete+reinsert
-- semantics, SECURITY INVOKER. The opposite_week column was added in 20260621130000.
-- coalesce defaults the marker to false for payloads that omit it (legacy / true-parallel).
create or replace function replace_cohort_groupings(
  p_plan_id uuid,
  p_cohort public.cohort,
  p_catalog_hash text,
  p_groupings jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  g jsonb;
  new_grouping_id uuid;
begin
  -- Members cascade via the course_grouping_members FK on delete.
  delete from public.course_groupings
   where plan_id = p_plan_id
     and cohort = p_cohort;

  for g in select * from jsonb_array_elements(coalesce(p_groupings, '[]'::jsonb))
  loop
    insert into public.course_groupings (plan_id, cohort, coverage_count, score, catalog_hash, opposite_week)
    values (
      p_plan_id,
      p_cohort,
      (g ->> 'coverage_count')::integer,
      (g ->> 'score')::numeric,
      p_catalog_hash,
      coalesce((g ->> 'opposite_week')::boolean, false)
    )
    returning id into new_grouping_id;

    insert into public.course_grouping_members (plan_id, grouping_id, course_id)
    select p_plan_id, new_grouping_id, member_id::uuid
    from jsonb_array_elements_text(g -> 'member_ids') as member_id;
  end loop;
end;
$$;
