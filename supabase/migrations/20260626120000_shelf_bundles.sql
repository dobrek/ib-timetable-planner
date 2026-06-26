-- shelf_bundles + shelf_bundle_courses: the parked unit's OWN representation (S-07).
--
-- A placed bundle is `bundles` + the `placements` co-located at its cell; its course set
-- is reconstructed from those placements at RPC time. A PARKED bundle holds no slot, so
-- it has no placements to reconstruct from — it needs durable storage of its own. These
-- two tables are that storage:
--   * shelf_bundles        — the parked card's identity (plan + cohort, no day/period).
--   * shelf_bundle_courses — its course set + A/B week (the off-board formation).
--
-- Deliberately a SEPARATE representation, not a `holding` state reusing the `bundles`
-- row: park tears down the board representation and builds a shelf one; place-back does
-- the reverse via place_course (a fresh `bundles` id is minted naturally). The S-05
-- `bundles.status`/nullable-coord columns stay as benign vestigial no-ops.
--
-- Mirrors the course_teachers plan-scoped child-table template: surrogate id PK, a
-- plan-pinned composite-FK unique target (plan_id, id), composite FKs to BOTH parents
-- pinned to the same plan (a cross-plan link is impossible; a missed remap during clone
-- fails loudly at insert), and an explicit anon GRANT-layer revoke on top of RLS. No
-- `grant` statements — the schema-wide alter-default-privileges (20260617171048 /
-- 20260618203532) carry `authenticated`/`service_role` DML forward automatically.

create table shelf_bundles (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references plans(id) on delete cascade,
  cohort     cohort not null,
  created_at timestamptz not null default now(),
  -- composite-FK target for shelf_bundle_courses.(plan_id, shelf_bundle_id); pins both
  -- ends of the junction to the same plan, exactly like courses_plan_id_unique.
  constraint shelf_bundles_plan_id_unique unique (plan_id, id)
);

create table shelf_bundle_courses (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references plans(id) on delete cascade,
  shelf_bundle_id uuid not null,
  course_id       uuid not null,
  week            public.placement_week not null default 'both',
  created_at      timestamptz not null default now(),
  constraint shelf_bundle_courses_unique unique (plan_id, shelf_bundle_id, course_id),
  constraint shelf_bundle_courses_shelf_bundle_fkey
    foreign key (plan_id, shelf_bundle_id) references shelf_bundles (plan_id, id) on delete cascade,
  constraint shelf_bundle_courses_course_fkey
    foreign key (plan_id, course_id) references courses (plan_id, id) on delete cascade
);

create index shelf_bundles_plan_idx on shelf_bundles (plan_id);
create index shelf_bundle_courses_plan_idx on shelf_bundle_courses (plan_id);
create index shelf_bundle_courses_plan_bundle_idx on shelf_bundle_courses (plan_id, shelf_bundle_id);

alter table shelf_bundles enable row level security;
create policy "Authenticated users have full access" on shelf_bundles
  for all to authenticated using (true) with check (true);

alter table shelf_bundle_courses enable row level security;
create policy "Authenticated users have full access" on shelf_bundle_courses
  for all to authenticated using (true) with check (true);

-- anon GRANT-layer exclusion (belt-and-suspenders). Per lessons.md "granting a role is
-- not excluding the others", the alter-default-privileges revoke for anon SHOULD carry
-- these new tables' anon DML away, but a non-grant is not an exclusion — pin it
-- explicitly. Proven by has_table_privilege in manual verification, not by reading this.
revoke select, insert, update, delete on shelf_bundles from anon;
revoke select, insert, update, delete on shelf_bundle_courses from anon;
