-- S-301: narrow what the solver can READ from `generation_jobs` — by COLUMN, because by row is not
-- expressible, and this is the larger win anyway.
--
-- `20260810200931_solver_job_writer_role.sql` left a forward promise: "`using (true)` is EVERY job
-- row … S-301 introduces that binding and is where this predicate can narrow." Two things in that
-- sentence turn out to be wrong, and this migration replaces the promise with what was measured.
--
-- (1) A PER-DISPATCH row predicate is not expressible. The container authenticates as ONE shared
-- machine Auth user and the role claim is stamped per-USER from `app_metadata` by the Custom Access
-- Token Hook (`20260810200934`). The app holds no JWT signing secret (a deploy-plan decision of
-- record), so it cannot mint a token carrying a job id — and a job id the container asserted about
-- itself would be worthless as a predicate. S-301 does bind a dispatch to its row, at another layer:
-- the service digests the request body's snapshot and compares it against this row's `snapshot_hash`
-- before solving (`cpsat_service/runner.py`). That binds the WORK to the row; a grant governs REACH.
--
-- (2) A STATUS-WINDOW row predicate — `using (status in ('queued','running'))`, aligning SELECT with
-- the UPDATE policy — is not shippable either, and the reason is worth recording because it is not
-- obvious and it is not what a reading of the policy suggests. MEASURED against the live stack:
--
--     finish, return=representation   -> 403 42501 "new row violates row-level security policy"
--     finish, return=minimal          -> 403 42501   (so it is not the representation preference)
--     finish, return=minimal+count    -> 403 42501
--     same write, window widened to include 'succeeded' -> 200, row reaches 'succeeded'
--
-- PostgREST's UPDATE always carries a RETURNING, and Postgres applies SELECT policies to the NEW row,
-- not only `USING` to the old one. So a SELECT window would have to admit every state the solver may
-- declare (`succeeded`/`failed`/`stopped`/`interrupted`, per the UPDATE policy's WITH CHECK) plus
-- `queued`/`running` — all six, which is `using (true)` spelled at length. A row window would not
-- have narrowed anything; it would have produced a solver that can never record a result.
--
-- WHAT SHIPS INSTEAD, and why it is stronger. The service SELECTs exactly two columns —
-- `select=id,snapshot_hash` on the claim and `select=id` on the terminal write
-- (`cpsat_service/supabase.py`) — plus `status`, which its own `status=eq.queued` CAS filter
-- references. It never reads `snapshot`: F-302's dispatch carries the snapshot in the REQUEST BODY,
-- which also makes the old migration's "the solver needs the whole row, `snapshot` above all, to
-- solve at all" stale. So SELECT is scoped to those three columns, and everything else leaves the
-- role's reach ON EVERY ROW rather than only on terminal ones:
--
--     kept   id, status, snapshot_hash
--     lost   snapshot (~124 KB), policy, result, error, stages, checkpoint,
--            checkpoint_stage_index, stage_index, stage_name, plan_id, proposal_plan_id,
--            delivered_plan_id, delivery, created_at, started_at, finished_at, heartbeat_at,
--            updated_at — and a bare `select=*`, which is refused outright (measured 403)
--
-- Note what that costs an attacker holding the machine credential: no plan identity (`plan_id`,
-- `proposal_plan_id`), no solve inputs, no boards. Writing stays where `20260810200931` put it — the
-- column-scoped UPDATE grant — and the two lists are deliberately different: the solver WRITES
-- `result`/`stages`/`error` and may not read them back. Write-only is the correct posture for an
-- audit record it is the author of.
--
-- ROW-LEVEL narrowing is not abandoned, just correctly priced: it requires moving the terminal write
-- behind a `security definer` RPC so the SELECT policy stops governing it. That is a rewrite of
-- F-302's reviewed transport and belongs to its own slice, not to S-301.
--
-- TWO DROPS, because the live policy NAME has drifted from this series on at least one developer
-- machine: created as "Solver reads any job", found live as "Solver reads its jobs". Predicates were
-- identical, so nothing was ever exposed — but a bare `drop policy "Solver reads any job"` would
-- error there. `if exists` on both is what makes this migration apply to a database in either state,
-- and `solver-credential.integration.test.ts` now pins the policy name AND the readable column list
-- from the catalog, so the next drift of this class fails loudly instead of silently.
drop policy if exists "Solver reads any job" on generation_jobs;
drop policy if exists "Solver reads its jobs" on generation_jobs;

-- Named for the net posture, not for the policy alone: the row predicate is `true` and the narrowing
-- lives in the grant below, so the name has to send the reader there.
create policy "Solver reads any job row, three columns of it" on generation_jobs
  for select to solver_job_writer using (true);

-- The table-wide grant must GO before the column grants mean anything — a table-level SELECT
-- subsumes every column-level one, so granting columns beside it would narrow nothing at all.
revoke select on public.generation_jobs from solver_job_writer;
grant select (id, status, snapshot_hash) on public.generation_jobs to solver_job_writer;
