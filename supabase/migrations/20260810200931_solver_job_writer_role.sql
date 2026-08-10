-- solver_job_writer: the narrow Postgres role the CP-SAT container's token resolves to.
--
-- GRANTS / RLS: both, and they are the whole point of the file.
--
-- Why a new role at all. `alter default privileges` gives BOTH `authenticated` and
-- `service_role` DML on every current and future public table, and every table carries
-- `for all to authenticated using (true)`. So any credential resolving to either role
-- reaches the entire database — students, teachers, every plan — which directly
-- contradicts the locked posture that the solver sees UUIDs only. That posture is
-- currently a property of the CODE that happens to build the snapshot; this role makes it
-- a property of the DATABASE.
--
-- How the container reaches it: a machine Auth user whose access token carries
-- `role: solver_job_writer`, rewritten at mint time by the Custom Access Token Hook in the
-- next migration. The container therefore holds only SUPABASE_URL, the PUBLISHABLE key and
-- a password — no secret key, no JWT signing secret — which preserves the deploy-plan
-- decision of record that the secret key is never pushed. PostgREST switches to the role
-- named in the claim, which is why `authenticator` must be granted membership below.
--
-- What is deliberately NOT granted, each for a reason:
--   * INSERT — the Worker enqueues jobs; the solver only ever advances one that exists.
--   * DELETE — a job row is the audit record of a run; the solver must not be able to
--     erase evidence of what it did.
--   * anything on any other table — reachability is the first lock, RLS the second.
--   * BYPASSRLS — a custom role has no such attribute, and it must stay that way; the
--     policies below are load-bearing, not decorative.
--   * `alter default privileges` — future tables must be UNREACHABLE to this role by
--     default. A new table should require a deliberate grant, not inherit one.
--
-- Verified by live spike before this landed: a `nologin` custom role works as a PostgREST
-- role-claim target on the Data API; RLS applies to it normally (both `using` and
-- `with check` are enforced); an unknown role claim fails closed with 401; and these
-- policies compose beside the existing `to authenticated` policy without interference.

create role solver_job_writer nologin;

-- PostgREST authenticates as `authenticator` and then `set role`s to the claim's role;
-- without this membership the switch fails and the request 401s.
grant solver_job_writer to authenticator;

grant usage on schema public to solver_job_writer;
grant select, update on public.generation_jobs to solver_job_writer;

-- Both policies name their role explicitly. A role-less `create policy` applies to PUBLIC,
-- which on a security-critical migration should never be left to inference.
create policy "Solver reads its jobs" on generation_jobs
  for select to solver_job_writer using (true);

-- The solver may only move a job that is still live, and only into a state it is entitled
-- to declare. `stopped` is in the WITH CHECK because S-305's stop path is acknowledged by
-- the solver itself; `queued` is absent because nothing may re-queue a job it has started.
create policy "Solver updates non-terminal jobs" on generation_jobs
  for update to solver_job_writer
  using (status in ('queued', 'running'))
  with check (status in ('running', 'succeeded', 'failed', 'stopped', 'interrupted'));
