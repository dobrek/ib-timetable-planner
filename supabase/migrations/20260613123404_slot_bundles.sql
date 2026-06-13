-- slot_bundles: coordinate-keyed marker table for the slot-as-a-group feature.
--
-- INVERTED SEMANTICS (opt-out / grouped-by-default): a slot with >=2 occupants
-- is a bundle by default. A slot_bundles ROW records the explicit *unbundled
-- exception* for that cell — its presence means "this cell is UNbundled".
-- `isBundled(cell) = occupants(cell).length >= 2 && !hasOverride(cell)`.
--
-- Mirrors the placements table shape: plan FK (cascade), cohort enum, day/period
-- checks, RLS, per-cell uniqueness. No `grouped` boolean — row presence is the
-- marker. Cohort is carried for dp2 readiness; every read/write is dp1-scoped now.
create table slot_bundles (
  id      uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  cohort  cohort not null,
  day     smallint not null,
  period  smallint not null,
  created_at timestamptz not null default now(),
  constraint slot_bundles_unique unique (plan_id, cohort, day, period),
  constraint slot_bundles_day_range    check (day between 1 and 7),
  constraint slot_bundles_period_range check (period between 1 and 12)
);

create index slot_bundles_plan_idx on slot_bundles (plan_id);

alter table slot_bundles enable row level security;
create policy "Authenticated users have full access" on slot_bundles for all to authenticated using (true) with check (true);
