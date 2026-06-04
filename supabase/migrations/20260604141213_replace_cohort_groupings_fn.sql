-- Atomic replace of a cohort's materialized groupings.
--
-- PostgREST has no client-side transaction, so a supabase-js delete followed by
-- a failed insert would wipe the cohort's groupings with nothing to show for it.
-- This function does the delete + insert in one plpgsql transaction.
--
-- SECURITY INVOKER (the default — stated explicitly): the function runs with the
-- caller's privileges, so the existing `authenticated` RLS policies on
-- course_groupings / course_grouping_members still gate the write. Do NOT switch
-- to SECURITY DEFINER — that would bypass RLS.
--
-- p_groupings is a JSON array of:
--   { "coverage_count": int, "score": numeric, "member_ids": [uuid, ...] }
-- member_ids are course.id values (the core's memberIds are course ids at runtime).
create function replace_cohort_groupings(
  p_plan_id uuid,
  p_cohort_id uuid,
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
     and cohort_id = p_cohort_id;

  for g in select * from jsonb_array_elements(coalesce(p_groupings, '[]'::jsonb))
  loop
    insert into public.course_groupings (plan_id, cohort_id, coverage_count, score, catalog_hash)
    values (
      p_plan_id,
      p_cohort_id,
      (g ->> 'coverage_count')::integer,
      (g ->> 'score')::numeric,
      p_catalog_hash
    )
    returning id into new_grouping_id;

    insert into public.course_grouping_members (grouping_id, course_id)
    select new_grouping_id, member_id::uuid
    from jsonb_array_elements_text(g -> 'member_ids') as member_id;
  end loop;
end;
$$;
