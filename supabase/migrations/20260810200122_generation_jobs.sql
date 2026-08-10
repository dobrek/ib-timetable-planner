-- generation_jobs: the durable record of one automatic-generation run.
--
-- The CP-SAT migration splits generation across three processes — the Worker enqueues, a
-- container solves, the author polls — so the run needs an identity that outlives every
-- request. This is that identity, and it is the ONLY table the whole slice family
-- (S-301 -> S-310) needs: the column set below is forward-designed from all ten, so those
-- slices ship behaviour, not migrations.
--
-- GRANTS / RLS: yes to both (see the bottom of this file). RLS is enabled with the house
-- single policy; `anon` is revoked at the GRANT layer for ALL EIGHT privileges, not just
-- the usual four (see the revoke block's comment — this table's exclusion claim is meant
-- to be literally true).
--
-- FIRST `jsonb` TABLE COLUMN IN THIS SCHEMA. Until now `jsonb` appeared only as RPC
-- parameters and plpgsql locals. Five columns use it here (`policy`, `snapshot`, `result`,
-- `stages`, `checkpoint`) because their shapes are owned by the frozen wire contract in
-- `contracts/generation-wire.schema.json`, not by this schema — modelling them as columns
-- would fork the contract into SQL and guarantee drift.
--
-- ** NARROW POLL PROJECTION IS A CORRECTNESS-ADJACENT REQUIREMENT. ** `snapshot` is the
-- ~100-124 KB solve input and `result`/`checkpoint` are ~35 KB each. Postgres TOASTs jsonb
-- over ~2 KB out of line, so a narrow `select id,status,stage_index,stage_name,updated_at`
-- never touches them — but PostgREST's `.select()` with NO arguments returns every column,
-- which would drag ~124 KB across the wire on every 5-10 s poll. Pollers MUST project
-- explicitly. This is a rule S-303 inherits from here, not a discovery it gets to make.
--
-- Two deliberate deviations from house convention, called out because both are visible in
-- the DDL and would otherwise read as mistakes:
--
--   1. `moddatetime` is RE-ADOPTED. No table created since 2026-06-13 carries an
--      `updated_at` trigger — `teacher_availability`'s header explains why ("cells are
--      replace-by-coordinate, not edited"). A job row is the opposite: it is mutated
--      throughout its lifetime (status, stage, heartbeat, checkpoint), and the poll UI
--      reads recency. So the trigger comes back, on purpose.
--
--   2. `proposal_plan_id` and `delivered_plan_id` are `on delete set null`, where 41 of 43
--      FKs in this schema cascade. S-306 deletes the working clone on auto-apply; a
--      cascading FK would take the job row with it and erase the record of every
--      successful generation. The job must outlive the plans it produced. `plan_id` DOES
--      cascade — it is the source plan, and the test harness's teardown relies on every
--      domain table cascading from `plans.id`.
--
-- `status` is `text` + check rather than an enum, with the FULL vocabulary declared today
-- (`stopped` is S-305's, `interrupted` is S-304's). The four existing enums are closed
-- domain vocabularies; a job status is an evolving operational one. Widening a check is one
-- line; Postgres enum values cannot be removed or reordered. Declaring all six now costs
-- nothing and means S-304/S-305 need no migration at all.
--
-- `snapshot_hash` is the hex SHA-256 of the CANONICAL serialization of `snapshot`
-- (`contracts/README.md` -> Canonical JSON form), computed over the SOURCE plan at T0.
-- FR-307's drift question is "did the source change while we solved?", i.e. a same-plan,
-- over-time comparison — so `clone_plan`'s UUID re-minting never enters it. It digests the
-- snapshot rather than the catalog because the snapshot IS the solve's input set by
-- definition, board included: a catalog-only hash would miss the author moving a placement
-- mid-solve, after which auto-apply would silently overwrite their edit.

create table generation_jobs (
  id                     uuid primary key default gen_random_uuid(),
  -- The SOURCE plan. Cascades — teardown and plan deletion must take its jobs with them.
  plan_id                uuid not null references plans(id) on delete cascade,
  -- The working clone S-301 solves into. Set-null on purpose (see header deviation 2).
  proposal_plan_id       uuid references plans(id) on delete set null,
  status                 text not null default 'queued',
  -- The generation policy (budget, mode, target) the run was launched with — FR-302/S-307.
  policy                 jsonb not null,
  -- The exact GeneratorSnapshot solved against. Stored, not re-derived: FR-313 runs the
  -- oracle server-side at delivery and `verifyGeneration` is only meaningful against the
  -- snapshot the result was produced from.
  snapshot               jsonb not null,
  snapshot_hash          text not null,
  -- The GenerationResult (contracts/generation-wire.schema.json#/$defs/GenerationResult).
  result                 jsonb,
  error                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  started_at             timestamptz,
  finished_at            timestamptz,
  -- Renewed by the running solver; S-304 reads it to tell "still working" from "container
  -- went away mid-solve" (Cloudflare Containers may sleep a job out from under us).
  heartbeat_at           timestamptz,
  stop_requested_at      timestamptz,
  notified_at            timestamptz,
  -- Ladder progress. `stages` is an ARRAY of the contract's camelCase StageReport, variable
  -- length and possibly sparse (repair mode emits tiers 1 and 4 only) — never a fixed
  -- 10-tuple. `checkpoint` holds ONE board, the latest complete stage's, overwritten each
  -- time: retaining all ten would cost ~350 KB per job for no product value.
  stage_index            smallint,
  stage_name             text,
  stages                 jsonb not null default '[]'::jsonb,
  checkpoint             jsonb,
  checkpoint_stage_index smallint,
  -- How the result reached the author (S-306's drift-decided delivery) and which plan
  -- carries it. The delivery vocabulary is S-306's to declare; it lands as a check then.
  delivery               text,
  delivered_plan_id      uuid references plans(id) on delete set null,
  constraint generation_jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed', 'stopped', 'interrupted'))
);

-- FR-308: at most one active job per plan. Partial, so a plan may accumulate any number of
-- terminal jobs — the history — while only one may be queued or running. Enforced here
-- rather than in application code because two Workers can race the same enqueue.
create unique index generation_jobs_active_per_plan
  on generation_jobs (plan_id) where status in ('queued', 'running');

-- FK index discipline (the `unindexed_foreign_keys` advisor is treated as a gate here).
-- `plan_id` needs its own non-partial index: the partial unique above covers only active rows.
create index generation_jobs_plan_idx           on generation_jobs (plan_id);
create index generation_jobs_proposal_plan_idx  on generation_jobs (proposal_plan_id);
create index generation_jobs_delivered_plan_idx on generation_jobs (delivered_plan_id);

create trigger generation_jobs_updated_at
  before update on generation_jobs
  for each row execute function extensions.moddatetime(updated_at);

alter table generation_jobs enable row level security;
create policy "Authenticated users have full access" on generation_jobs
  for all to authenticated using (true) with check (true);

-- anon GRANT-layer exclusion. The first line is the house four-verb revoke every table
-- since 20260617205628 carries. The second is NOT house convention and is the point:
-- Supabase's auto-grant leaves `anon` holding TRUNCATE / REFERENCES / TRIGGER / MAINTAIN
-- on every new public table, and the repo's revokes have only ever named the four DML
-- verbs. So the usual comment ("anon is excluded") has been true of DML and quietly false
-- of the rest. lessons.md is specifically about comments that overstate the grant-layer
-- posture, so this table revokes all eight and the claim above is literally true.
-- Proven by has_table_privilege in generation-jobs.integration.test.ts, not by this comment.
revoke select, insert, update, delete on generation_jobs from anon;
revoke truncate, references, trigger, maintain on generation_jobs from anon;
