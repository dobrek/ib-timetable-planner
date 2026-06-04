-- course_groupings.catalog_hash: stable SHA-256 over the catalog snapshot that
-- produced the grouping rows. Drives S-06's "out of date" detection — a stored
-- hash that differs from the live catalog's hash means the groupings are stale.
-- Nullable: pre-existing rows (if any) carry no hash and read as stale.
alter table course_groupings
  add column catalog_hash text;

-- Lookup path for the staleness helper: latest rows for a (plan, cohort) and
-- their stored hash.
create index course_groupings_plan_cohort_hash_idx
  on course_groupings (plan_id, cohort_id, catalog_hash);
