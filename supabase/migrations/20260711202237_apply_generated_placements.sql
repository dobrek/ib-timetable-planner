-- apply_generated_placements: atomic region replace serving the generator's forward apply,
-- undo, and redo. "Make these cells contain exactly these placements": p_cells lists the
-- affected (cohort, day, period) cells; p_placements the rows the region must end with —
-- every placement's cell MUST be listed in p_cells (raises otherwise; the whole call is one
-- transaction, so nothing partial ever lands).
--
-- Convergent, not blind delete+reinsert: rows already at their target (cohort, cell, course)
-- are UPDATEd to the payload's week / is_optional instead of deleted and re-inserted, so a
-- pinned pre-existing row keeps its id (the client's optimistic store and the single-writer
-- verbs address rows by id — churning ids of untouched pins would strand them). Rows absent
-- from the payload are deleted; missing rows are inserted under their cell's bundle
-- (find-or-create copied from the LATEST LIVE place_course definition, 20260707140000 — per
-- lessons.md, never from an original migration); bundles left empty (undo-shaped calls) are
-- dropped, preserving the server-enforced "== 0 members ⇒ no bundle" rule. Plan-scoped so one
-- call can carry both cohorts (forward apply); equally valid for a single-cohort subset (the
-- undo/redo reconcile path). Returns the region's full final row set for client settlement by
-- business key.
--
-- SECURITY INVOKER + set search_path = '' (every table public.-qualified): the
-- `authenticated` RLS policies gate the writes, same as place_course. Do NOT switch to DEFINER.

create function apply_generated_placements(
  p_plan_id uuid,
  p_cells jsonb,
  p_placements jsonb
) returns setof public.placements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p jsonb;
  v_bundle_id uuid;
begin
  -- 0. Guard: every placement's cell must be listed in p_cells.
  for p in select * from jsonb_array_elements(coalesce(p_placements, '[]'::jsonb))
  loop
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(p_cells, '[]'::jsonb)) as c
      where c ->> 'cohort' = p ->> 'cohort'
        and (c ->> 'day')::smallint = (p ->> 'day')::smallint
        and (c ->> 'period')::smallint = (p ->> 'period')::smallint
    ) then
      raise exception 'apply_generated_placements: placement (% % %:%) not covered by p_cells',
        p ->> 'cohort', p ->> 'course_id', p ->> 'day', p ->> 'period';
    end if;
  end loop;

  -- 1. Delete rows in the listed cells that the target set no longer contains.
  delete from public.placements pl
  where pl.plan_id = p_plan_id
    and exists (
      select 1
      from jsonb_array_elements(coalesce(p_cells, '[]'::jsonb)) as c
      where (c ->> 'cohort')::public.cohort = pl.cohort
        and (c ->> 'day')::smallint = pl.day
        and (c ->> 'period')::smallint = pl.period
    )
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_placements, '[]'::jsonb)) as t
      where (t ->> 'cohort')::public.cohort = pl.cohort
        and (t ->> 'course_id')::uuid = pl.course_id
        and (t ->> 'day')::smallint = pl.day
        and (t ->> 'period')::smallint = pl.period
    );

  -- 2. Converge or insert each target row. The bundle find-or-create mirrors the latest live
  --    place_course: `do update set status` is a deliberate no-op write whose only purpose is
  --    to make the conflicting row eligible for RETURNING (`do nothing` returns NO row).
  for p in select * from jsonb_array_elements(coalesce(p_placements, '[]'::jsonb))
  loop
    insert into public.bundles (plan_id, cohort, status, day, period)
    values (
      p_plan_id,
      (p ->> 'cohort')::public.cohort,
      'placed',
      (p ->> 'day')::smallint,
      (p ->> 'period')::smallint
    )
    on conflict (plan_id, cohort, day, period) where day is not null
    do update set status = excluded.status
    returning id into v_bundle_id;

    -- Unlike place_course, week / is_optional ARE converged here: the payload is an undo/redo
    -- target (or a verified generation region) and is authoritative for the region's state.
    insert into public.placements (plan_id, cohort, course_id, day, period, week, bundle_id, is_optional)
    values (
      p_plan_id,
      (p ->> 'cohort')::public.cohort,
      (p ->> 'course_id')::uuid,
      (p ->> 'day')::smallint,
      (p ->> 'period')::smallint,
      coalesce((p ->> 'week')::public.placement_week, 'both'),
      v_bundle_id,
      coalesce((p ->> 'is_optional')::boolean, false)
    )
    on conflict (plan_id, cohort, day, period, course_id)
    do update set
      bundle_id = excluded.bundle_id,
      week = excluded.week,
      is_optional = excluded.is_optional;
  end loop;

  -- 3. Drop placed bundles in the listed cells that ended the call with no members.
  delete from public.bundles b
  where b.plan_id = p_plan_id
    and b.day is not null
    and exists (
      select 1
      from jsonb_array_elements(coalesce(p_cells, '[]'::jsonb)) as c
      where (c ->> 'cohort')::public.cohort = b.cohort
        and (c ->> 'day')::smallint = b.day
        and (c ->> 'period')::smallint = b.period
    )
    and not exists (select 1 from public.placements pl where pl.bundle_id = b.id);

  -- 4. Return the region's final row set for client settlement (business-key matching).
  return query
  select pl.*
  from public.placements pl
  where pl.plan_id = p_plan_id
    and exists (
      select 1
      from jsonb_array_elements(coalesce(p_cells, '[]'::jsonb)) as c
      where (c ->> 'cohort')::public.cohort = pl.cohort
        and (c ->> 'day')::smallint = pl.day
        and (c ->> 'period')::smallint = pl.period
    );
end;
$$;
