-- placements.bundle_id: link each placement to its bundle. Added NULLABLE in this
-- additive step; backfilled and tightened to NOT NULL in the next migration (house
-- additive-first discipline — never add a NOT NULL column to a populated table in one
-- shot). The seed carries no placements, so at db reset this column is empty anyway.
--
-- Composite FK (plan_id, bundle_id) -> bundles(plan_id, id) pins a placement and its
-- bundle to the same plan: a cross-plan link is impossible, and a missed remap during
-- clone fails loudly at insert (mirrors placements_course_fkey / course_teachers_*_fkey).
-- While bundle_id is null the FK is MATCH SIMPLE — unchecked — so the nullable step is
-- safe; once NOT NULL lands every row is validated. Cascade so dropping a bundle drops
-- its placements (the == 0 cleanup rule deletes empty bundles explicitly, before this).
alter table placements add column bundle_id uuid;

alter table placements
  add constraint placements_bundle_fkey
    foreign key (plan_id, bundle_id) references bundles (plan_id, id) on delete cascade;

create index placements_bundle_idx on placements (plan_id, bundle_id);
