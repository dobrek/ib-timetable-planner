-- teacher_availability: plan-scoped, cohort-independent marker table for a teacher's
-- per-(day, period) availability. Each row records one constrained cell with a storage
-- severity — 'strong' (cannot teach) or 'soft' (prefers not to). Absence of a row means
-- the cell is available.
--
-- Mirrors the slot_bundles plan-scoped child-table template MINUS the cohort column:
-- availability reflects a teacher's real-world schedule on the plan's shared timetable
-- grid, so it is stored once per teacher and applies to whatever cohort the board renders.
-- The teacher link is a composite FK to teachers (plan_id, id) — its target already exists
-- (teachers_plan_id_unique) — so a missed remap during clone fails loudly. No updated_at:
-- cells are replace-by-coordinate, not edited.
create type availability_severity as enum ('strong', 'soft');

create table teacher_availability (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references plans(id) on delete cascade,
  teacher_id uuid not null,
  day        smallint not null,
  period     smallint not null,
  severity   availability_severity not null,
  created_at timestamptz not null default now(),
  constraint teacher_availability_unique unique (plan_id, teacher_id, day, period),
  constraint teacher_availability_teacher_fkey
    foreign key (plan_id, teacher_id) references teachers (plan_id, id) on delete cascade,
  constraint teacher_availability_day_range    check (day between 1 and 7),
  constraint teacher_availability_period_range check (period between 1 and 12)
);

create index teacher_availability_plan_idx on teacher_availability (plan_id);
create index teacher_availability_plan_teacher_idx on teacher_availability (plan_id, teacher_id);

alter table teacher_availability enable row level security;
create policy "Authenticated users have full access" on teacher_availability
  for all to authenticated using (true) with check (true);
