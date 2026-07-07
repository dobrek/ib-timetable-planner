-- Optional subject in bundle — data foundation.
--
-- Adds the per-member "optional" flag to BOTH homes of member state: the board
-- representation (placements — membership lives only there, see
-- 20260626120001_shelve_bundle_fn.sql) and the shelf twin (shelf_bundle_courses —
-- a parked bundle has no placement rows to reconstruct from, so per-member state
-- is duplicated there, exactly like `week`).
--
-- Additive with a safe default so existing rows read as non-optional and the
-- deny-by-default grants are unaffected (additive columns inherit their table's
-- existing grants — no GRANT changes needed). Unique keys are unchanged.
--
-- The flag is render/review-only for validation: an optional member still
-- collides and blocks exactly like any placement.

alter table public.placements
  add column is_optional boolean not null default false;

alter table public.shelf_bundle_courses
  add column is_optional boolean not null default false;
