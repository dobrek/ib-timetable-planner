-- generation_jobs.solver_config: the row records the configuration that actually solved it.
--
-- AMENDMENT (2026-09-30) to `20260810200122_generation_jobs.sql:5-7`, which claimed the column set
-- there was forward-designed from all ten generation slices "so those slices ship behaviour, not
-- migrations". That held for S-301 -> S-307. S-308's calibration campaign needs a fact the design
-- never anticipated: WHICH budgets and worker count produced a row. Without it, attributing a run to
-- a campaign cell means reading the container's startup line from a log and trusting that the
-- container which solved was the one that printed it — exactly the stale-warm-container case the
-- campaign most needs to catch. The original file is applied and stays as written; this note is the
-- correction.
--
-- WHY A ROW COLUMN AND NOT THE WIRE. `result.diagnostics` and `stages[]` are owned by the frozen wire
-- contract (`contracts/generation-wire.schema.json`, `additionalProperties: false`), and the contract
-- rules a config echo out of scope (`contracts/README.md`). This column is outside `contracts/`:
-- `formatVersion`, the schema and the goldens are untouched. The shape is versioned inside the value
-- (`version: 1`) and read by one tolerant reader, `parseStoredSolverConfig`.
--
-- Nullable, no default: every row written before this migration, and every row a solver that
-- predates it writes, reads as legacy (null).
--
-- GRANTS: UPDATE only, to the solver's narrow role. No SELECT — the solver writes the record and
-- never reads it back; its PATCHes name a narrow `select=` that does not include this column, so the
-- RETURNING is checked against the columns it names, not this one (the same shape `stages` and
-- `checkpoint` have always had). The app reads it as `authenticated`, whose DML comes from the
-- schema-wide default privileges; `anon` stays revoked at the table level by the original migration.
-- Verified by the exact-list pin in `solver-credential.integration.test.ts`, not by this comment.

alter table public.generation_jobs
  add column solver_config jsonb;

comment on column public.generation_jobs.solver_config is
  'The effective configuration the solver ran under, written best-effort by the solver. Versioned inside the value; null on legacy rows.';

grant update (solver_config) on public.generation_jobs to solver_job_writer;
