-- delete_shelf_bundle: discard a parked bundle outright (the parked card's "×"), without
-- placing it back. Backs the single-card discard affordance — NOT the out-of-scope
-- "clear shelf" bulk action.
--
-- One statement: deleting the header cascades its shelf_bundle_courses via their
-- on-delete-cascade composite FK. Identity is pinned by (plan_id, shelf_bundle_id), so no
-- cohort arg is needed — nothing else references a shelf id, and the `authenticated` RLS
-- policy gates the delete.
--
-- SECURITY INVOKER + set search_path = '' (every table public.-qualified). Do NOT switch
-- to DEFINER.
create function delete_shelf_bundle(
  p_plan_id uuid,
  p_shelf_bundle_id uuid
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.shelf_bundles
   where plan_id = p_plan_id and id = p_shelf_bundle_id;
end;
$$;
