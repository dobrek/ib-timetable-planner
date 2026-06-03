-- Index the foreign-key columns left uncovered by the initial schema migration.
-- Postgres does not auto-index FK columns; without these, reverse lookups and
-- ON DELETE CASCADE traversals seq-scan, and Supabase's unindexed_foreign_keys
-- advisor flags them. (FK columns that lead a UNIQUE/PK constraint are already
-- covered and are intentionally omitted here.)
create index students_cohort_idx on students (cohort_id);
create index plan_variants_plan_idx on plan_variants (plan_id);
create index course_overlaps_dependent_idx on course_overlaps (dependent_course_id);
create index course_merges_child_idx on course_merges (child_course_id);
create index placements_course_idx on placements (course_id);
create index placements_cohort_idx on placements (cohort_id);
create index course_groupings_cohort_idx on course_groupings (cohort_id);
