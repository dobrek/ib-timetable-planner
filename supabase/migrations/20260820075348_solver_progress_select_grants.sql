-- Widen the solver role's column SELECT from three columns to five: `heartbeat_at` and
-- `stop_requested_at`.
--
-- WHY NOW, when S-303 reads NEITHER of them. S-303 only ever WRITES `heartbeat_at` (once per stage
-- event) and never touches `stop_requested_at` at all. The two columns are pre-paid here because the
-- alternative is two more migrations, each with its own policy re-create and its own edit to the same
-- exact-list pin in `solver-credential.integration.test.ts` — three round trips through the same six
-- lines for a grant that widens a read on a table the role already reaches. The cost of pre-paying is
-- exactly the reads it authorises, and both are diagnostics on a row this role already owns:
--
--   * `heartbeat_at`     — S-304's widened claim CAS needs it in a WHERE, to reclaim a row whose
--                          container died mid-solve (today the `status=eq.queued` filter makes such a
--                          row permanently unclaimable).
--   * `stop_requested_at` — S-305's stop polling reads it to decide whether to end a running solve.
--
-- UPDATE on `stop_requested_at` is DELIBERATELY NOT granted, and that asymmetry is the point: the
-- app writes the stop request and the solver only ever observes it. A solver that could clear its own
-- stop flag would be able to ignore Stop & keep, so the read stays one-way at the grant layer rather
-- than by convention.
--
-- Additive, so no revoke is needed: the table-level SELECT was already revoked by
-- `20260812141459_solver_select_column_scope.sql`, and column grants accumulate. The POLICY, however,
-- has the old count in its NAME, and that name is pinned from `pg_policies` — so it is re-created
-- rather than left to become a lie.

drop policy if exists "Solver reads any job row, three columns of it" on generation_jobs;

-- Same predicate as before. The row filter is still `true`; the narrowing is still entirely in the
-- grant below, which is what the name has always been there to point at.
create policy "Solver reads any job row, five columns of it" on generation_jobs
  for select to solver_job_writer using (true);

grant select (heartbeat_at, stop_requested_at) on public.generation_jobs to solver_job_writer;
