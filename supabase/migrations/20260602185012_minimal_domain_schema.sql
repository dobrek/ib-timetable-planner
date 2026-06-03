-- Minimal Domain Schema: 12 tables for IB timetable planner
-- moddatetime extension for updated_at triggers (avoids function_search_path_mutable advisor warning)
create extension if not exists moddatetime with schema extensions;

-- 1. cohorts
create table cohorts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger cohorts_updated_at
  before update on cohorts
  for each row execute function extensions.moddatetime(updated_at);

-- 2. teachers (before courses — courses.teacher_id FKs here)
create table teachers (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  full_name  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger teachers_updated_at
  before update on teachers
  for each row execute function extensions.moddatetime(updated_at);

-- 3. courses
create table courses (
  id             uuid primary key default gen_random_uuid(),
  cohort_id      uuid not null references cohorts(id) on delete cascade,
  teacher_id     uuid references teachers(id) on delete set null,
  name           text not null,
  level          text not null,
  group_index    smallint not null default 0,
  hours_per_week smallint not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint courses_unique unique (cohort_id, name, level, group_index),
  -- 0 is valid: merge-child courses taught only within the merged parent session
  -- carry no standalone hours. Negative hours remain disallowed.
  constraint courses_hours_nonneg check (hours_per_week >= 0)
);
create index courses_cohort_idx on courses (cohort_id);
create index courses_teacher_idx on courses (teacher_id);
create trigger courses_updated_at
  before update on courses
  for each row execute function extensions.moddatetime(updated_at);

-- 4. course_overlaps (directed: dependent_course_id students also attend base_course_id)
create table course_overlaps (
  id                   uuid primary key default gen_random_uuid(),
  base_course_id       uuid not null references courses(id) on delete cascade,
  dependent_course_id  uuid not null references courses(id) on delete cascade,
  created_at           timestamptz not null default now(),
  constraint course_overlaps_unique unique (base_course_id, dependent_course_id)
);

-- 5. course_merges (parent groups children — virtual combined teaching session)
create table course_merges (
  id               uuid primary key default gen_random_uuid(),
  parent_course_id uuid not null references courses(id) on delete cascade,
  child_course_id  uuid not null references courses(id) on delete cascade,
  created_at       timestamptz not null default now(),
  constraint course_merges_unique unique (parent_course_id, child_course_id)
);

-- 6. students
create table students (
  id         uuid primary key default gen_random_uuid(),
  cohort_id  uuid not null references cohorts(id) on delete cascade,
  full_name  text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger students_updated_at
  before update on students
  for each row execute function extensions.moddatetime(updated_at);

-- 7. student_choices
create table student_choices (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  course_id  uuid not null references courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint student_choices_unique unique (student_id, course_id)
);
create index student_choices_course_idx on student_choices (course_id);

-- 8. plans
create table plans (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slot_grid_preset text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger plans_updated_at
  before update on plans
  for each row execute function extensions.moddatetime(updated_at);

-- 9. plan_variants
create table plan_variants (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references plans(id) on delete cascade,
  name       text not null,
  is_final   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plan_variants_updated_at
  before update on plan_variants
  for each row execute function extensions.moddatetime(updated_at);

-- 10. placements
create table placements (
  id         uuid primary key default gen_random_uuid(),
  variant_id uuid not null references plan_variants(id) on delete cascade,
  cohort_id  uuid not null references cohorts(id) on delete cascade,
  day        smallint not null,
  period     smallint not null,
  course_id  uuid not null references courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint placements_unique unique (variant_id, cohort_id, day, period, course_id),
  constraint placements_day_range check (day between 1 and 7),
  constraint placements_period_range check (period between 1 and 12)
);
create index placements_variant_cohort_idx on placements (variant_id, cohort_id);

-- 11. course_groupings
create table course_groupings (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references plans(id) on delete cascade,
  cohort_id      uuid not null references cohorts(id) on delete cascade,
  coverage_count integer not null,
  score          numeric not null,
  created_at     timestamptz not null default now()
);
create index course_groupings_plan_cohort_idx on course_groupings (plan_id, cohort_id);

-- 12. course_grouping_members
create table course_grouping_members (
  grouping_id uuid not null references course_groupings(id) on delete cascade,
  course_id   uuid not null references courses(id) on delete cascade,
  primary key (grouping_id, course_id)
);
create index course_grouping_members_course_idx on course_grouping_members (course_id);

-- RLS: enable on all tables, grant full access to authenticated role
alter table cohorts enable row level security;
alter table teachers enable row level security;
alter table courses enable row level security;
alter table course_overlaps enable row level security;
alter table course_merges enable row level security;
alter table students enable row level security;
alter table student_choices enable row level security;
alter table plans enable row level security;
alter table plan_variants enable row level security;
alter table placements enable row level security;
alter table course_groupings enable row level security;
alter table course_grouping_members enable row level security;

create policy "Authenticated users have full access" on cohorts for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on teachers for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on courses for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on course_overlaps for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on course_merges for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on students for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on student_choices for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on plans for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on plan_variants for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on placements for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on course_groupings for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on course_grouping_members for all to authenticated using (true) with check (true);
