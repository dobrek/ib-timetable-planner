-- bundles: first-class grouping entity giving a placed cell PERSISTENT identity.
--
-- Today a "bundle" is derived — >=2 placements that share a (day, period) cell, with
-- the cell coordinate AS the identity. That cannot represent an off-board unit (S-07
-- parking), so a bundle gains its own row here. Every placement will reference exactly
-- one bundle (placements.bundle_id, added next migration, backfilled, then NOT NULL);
-- a cell with any courses IS a bundle (including a bundle of one).
--
-- Shaped for BOTH the placed (S-05) and future holding (S-07) cases in one table:
--   * status      — 'placed' now; 'holding' is the S-07 off-board state (additive then).
--   * day, period — NULLABLE (null while parked); range checks apply only when non-null.
-- The partial unique index pins exactly one PLACED bundle per cell at the DB layer —
-- this is what makes the find-or-create RPC (Phase 2) clean and race-free.
--
-- Mirrors the course_teachers child-table template: surrogate id PK, a (plan_id, id)
-- composite-FK target, plan FK cascade, RLS for authenticated, explicit anon revoke.
create table bundles (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references plans(id) on delete cascade,
  cohort     cohort not null,
  status     text not null default 'placed',
  day        smallint,
  period     smallint,
  created_at timestamptz not null default now(),
  constraint bundles_status_check  check (status in ('placed', 'holding')),
  constraint bundles_day_range     check (day is null or day between 1 and 7),
  constraint bundles_period_range  check (period is null or period between 1 and 12),
  -- The (plan_id, id) composite-FK target placements.bundle_id references, pinning a
  -- bundle to its plan so a cross-plan link is impossible (mirrors courses_plan_id_unique).
  constraint bundles_plan_id_unique unique (plan_id, id)
);

-- Exactly one PLACED bundle per cell. Partial (where day is not null) so parked
-- bundles — which carry null coords — are exempt and may coexist.
create unique index bundles_cell_unique
  on bundles (plan_id, cohort, day, period) where day is not null;

create index bundles_plan_idx on bundles (plan_id);

alter table bundles enable row level security;
create policy "Authenticated users have full access" on bundles
  for all to authenticated using (true) with check (true);

-- anon GRANT-layer exclusion (belt-and-suspenders). The alter-default-privileges
-- revoke for anon (20260617205628) carries this new table's anon DML away, but per
-- lessons.md "granting a role is not excluding the others", a non-grant is not an
-- exclusion — pin it explicitly in the same migration. (`authenticated` and
-- `service_role` DML is carried forward by their own alter-default-privileges grants.)
-- Proven by has_table_privilege query in manual verification, not by reading this policy.
revoke select, insert, update, delete on bundles from anon;
