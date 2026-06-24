-- Backfill placements.bundle_id, then tighten the column to NOT NULL.
--
-- Step 1: create exactly one 'placed' bundle per non-empty (plan_id, cohort, day,
-- period) cell, carrying that cell's coordinates. `distinct` collapses a cell's many
-- placements to one bundle row; the bundles_cell_unique partial index would reject a
-- duplicate anyway.
-- Step 2: assign every placement its cell's bundle_id by joining on the full cell key.
-- Step 3: make bundle_id mandatory — every placement now belongs to exactly one bundle.
--
-- Legacy slot_bundles opt-out (ungroup) state is intentionally NOT preserved: ungroup
-- becomes presentation-only (no production data; see plan Migration Notes). Order
-- matters — this runs after the bundles table (20260624120000) and the bundle_id
-- column (20260624120001) exist. At db reset the seed has no placements, so steps 1-2
-- are no-ops and step 3 is trivially satisfied; the backfill exists for any populated DB.
insert into bundles (plan_id, cohort, day, period, status)
select distinct plan_id, cohort, day, period, 'placed'
  from placements;

update placements p
   set bundle_id = b.id
  from bundles b
 where b.plan_id = p.plan_id
   and b.cohort  = p.cohort
   and b.day     = p.day
   and b.period  = p.period;

alter table placements alter column bundle_id set not null;
