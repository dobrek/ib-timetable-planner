-- F-401 deny drill. LOCAL STACK ONLY: never copy this into supabase/migrations.
--
-- Proves the role matrix can fail, and fails for the right reason. Over every public base table it
-- adds a restrictive policy that denies `authenticated` every row, which produces exactly the denial
-- shapes S-403's fail-closed policies will:
--
--   SELECT reads empty; UPDATE and DELETE affect 0 rows; INSERT raises 42501;
--   clone_plan raises its own "source plan … not found" (P0001).
--
-- Grants are left alone, so the catalog check stays green. `anon`, `service_role` and the solver
-- are untouched: no policy names them, and `solver_job_writer` is not a member of `authenticated`.
--
-- Apply:  docker exec -i supabase_db_ib-timetable-planner psql -U postgres -d postgres < deny-authenticated.sql
-- Run:    pnpm test:integration src/test/role-matrix.integration.test.ts
--         (expected: the 32 noRole cells red with "expected 'denied' to be 'allowed'"; everything else green)
-- Undo:   docker exec -i supabase_db_ib-timetable-planner psql -U postgres -d postgres < restore.sql
do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (false) with check (false)',
      'f401 drill: deny authenticated',
      t.relname
    );
  end loop;
end $$;
