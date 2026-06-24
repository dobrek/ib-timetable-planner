-- move_bundle_members: move a set of placements from a source cell to a target cell
-- atomically. Powers single-course move, whole-bundle move, AND merge — closing the
-- current best-effort/no-rollback gap (today's whole-slot move is N parallel inserts +
-- N parallel deletes with no transaction).
--
-- The member set is pinned to COURSE IDs, not placement ids: placements_unique is
-- (plan_id, cohort, day, period, course_id), so (source cell + course id) identifies
-- each placement exactly, and the client holds course ids without round-tripping for
-- the real placement uuids. Returns the resulting placement rows at the target cell for
-- client reconciliation.
--
-- The body BRANCHES on whether the target cell is empty — two distinct mechanisms:
--   * Target empty + WHOLE-bundle move → relocate the source bundle ROW (identity
--     preserved: bundle_id is the durable S-07/S-08 handle). Target empty + partial
--     move → mint a fresh destination bundle (a single course leaving a multi-member
--     source always changes its membership).
--   * Target occupied → MERGE: movers join the destination bundle; a mover whose course
--     already sits at the target is dropped (never a duplicate-course collision); the
--     source bundle is deleted if the move emptied it (== 0 rule). Identity is NOT
--     preserved across a merge (source consumed) — noted for S-08 undo.
--
-- SECURITY INVOKER + set search_path = '' (every table public.-qualified).
create function move_bundle_members(
  p_plan_id uuid,
  p_cohort public.cohort,
  p_day smallint,
  p_period smallint,
  p_course_ids uuid[],
  p_target_day smallint,
  p_target_period smallint
) returns setof public.placements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source_bundle_id uuid;
  v_target_bundle_id uuid;
  v_source_total int;
  v_movers int;
begin
  -- The placed bundle at the source cell (its identity, for relocate-or-cleanup below).
  select id into v_source_bundle_id
    from public.bundles
   where plan_id = p_plan_id and cohort = p_cohort and day = p_day and period = p_period;

  -- The target bundle, iff the target cell is already occupied.
  select id into v_target_bundle_id
    from public.bundles
   where plan_id = p_plan_id and cohort = p_cohort and day = p_target_day and period = p_target_period;

  if v_target_bundle_id is null then
    -- TARGET EMPTY. Whole-bundle relocation preserves identity; a partial move mints anew.
    select count(*) into v_source_total
      from public.placements
     where plan_id = p_plan_id and cohort = p_cohort and day = p_day and period = p_period;
    select count(*) into v_movers
      from public.placements
     where plan_id = p_plan_id and cohort = p_cohort and day = p_day and period = p_period
       and course_id = any(p_course_ids);

    if v_movers = v_source_total then
      -- WHOLE-BUNDLE MOVE: relocate the source bundle row itself (id survives), then its
      -- placements. bundle_id is unchanged; the cell coords live on the bundle row.
      update public.bundles
         set day = p_target_day, period = p_target_period
       where id = v_source_bundle_id;
      update public.placements
         set day = p_target_day, period = p_target_period
       where plan_id = p_plan_id and cohort = p_cohort and day = p_day and period = p_period
         and course_id = any(p_course_ids);
    else
      -- PARTIAL MOVE into an empty cell: a fresh destination bundle for the movers; the
      -- source bundle stays put with its remaining members (membership > 0 by construction).
      insert into public.bundles (plan_id, cohort, status, day, period)
      values (p_plan_id, p_cohort, 'placed', p_target_day, p_target_period)
      returning id into v_target_bundle_id;
      update public.placements
         set bundle_id = v_target_bundle_id, day = p_target_day, period = p_target_period
       where plan_id = p_plan_id and cohort = p_cohort and day = p_day and period = p_period
         and course_id = any(p_course_ids);
    end if;
  else
    -- TARGET OCCUPIED — MERGE. Drop mergers (a mover whose course already sits at the
    -- target) so the reassign below can never collide on placements_unique; delete-then-
    -- update ordering means the update only touches the surviving (non-merger) movers.
    delete from public.placements src
     where src.plan_id = p_plan_id and src.cohort = p_cohort
       and src.day = p_day and src.period = p_period
       and src.course_id = any(p_course_ids)
       and exists (
         select 1 from public.placements dst
          where dst.plan_id = p_plan_id and dst.cohort = p_cohort
            and dst.day = p_target_day and dst.period = p_target_period
            and dst.course_id = src.course_id
       );

    update public.placements src
       set bundle_id = v_target_bundle_id, day = p_target_day, period = p_target_period
     where src.plan_id = p_plan_id and src.cohort = p_cohort
       and src.day = p_day and src.period = p_period
       and src.course_id = any(p_course_ids);

    -- Delete the source bundle iff the move emptied it (== 0 membership rule).
    delete from public.bundles
     where id = v_source_bundle_id
       and not exists (select 1 from public.placements where bundle_id = v_source_bundle_id);
  end if;

  return query
    select *
      from public.placements
     where plan_id = p_plan_id and cohort = p_cohort
       and day = p_target_day and period = p_target_period
       and course_id = any(p_course_ids);
end;
$$;
