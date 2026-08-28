-- S-306 — "the proposal is a plan": the pending marker, and the delivery vocabulary.
--
-- Two schema facts this slice owes, in one migration because they are two halves of one
-- lifecycle: what a proposal plan IS before delivery, and what the job records afterwards.
--
-- ## `plans.pending_proposal`
--
-- The proposal clone has existed since S-301, created by `clone_plan` at dispatch. Until now
-- it had no reader between dispatch and delivery — but it was a fully editable, renameable,
-- deletable plan the whole time, and editing it destroys the apply target of a 20-minute
-- solve (the catalog moves, natural-key translation fails, the job dies terminal). PRD Open
-- Question 4 asked whether to stop cloning at dispatch; the answer (2026-08-28) is no —
-- the dispatch clone is the only T0-faithful copy of the DISPLAY catalog, which
-- `generation_jobs.snapshot` omits (no name/level/group_index) — so the window is closed with
-- a flag instead.
--
-- Lifecycle, and it is short:
--   * SET by enqueue (`startGeneration`), immediately after `clone_plan` returns. A clone that
--     cannot be flagged is deleted rather than left unflagged — the row must never exist
--     un-guarded.
--   * CLEARED by delivery (`generation-delivery.ts`), after the region-replace and BEFORE the
--     delivered-marker CAS. The marker still goes last, so a crash between the two re-enters
--     delivery on the next visit, re-applies (the region replace absorbs it) and re-clears.
--   * CLEARED by any terminal branch that leaves the clone ALIVE — today that is the
--     translation-mismatch branch, which detaches the clone rather than deleting it. A clone
--     that is swept (failed job, empty result, failing verdict) needs no clear: it is gone.
--   * NEVER set by `clone_plan` itself, nor by `shared/api/clone-plan.ts`. The hub's Clone
--     dialog uses the same function and must keep producing ordinary plans.
--
-- No index. The hub filters it on a page of at most a few hundred rows; every other read is by
-- primary key.
--
-- ## `generation_jobs.delivery`
--
-- The column has been reserved since 20260810200122 with its vocabulary left to S-306. S-306
-- declares it, and it has exactly ONE value: `'proposal'` — the verified board landed on the
-- proposal plan. `null` means undelivered.
--
-- It is one value deliberately. The column was reserved when delivery could also mean
-- auto-apply onto the source; that was retired 2026-08-28 (first re-grounding), and the
-- author-decided `merge` that briefly replaced it was retired the same day (second
-- re-grounding, PRD FR-307) — in the author's workflow merging into the source is exactly
-- equal to deleting the source and renaming the proposal, and both acts already exist. The
-- source plan is now never written to by delivery. If a later slice reintroduces a second
-- delivery target, widening this check is one line.
--
-- ## `notified_at` backfill
--
-- `notified_at` gets its first writer in this slice (S-306 Phase 4): an in-app view of a
-- DELIVERED proposal marks it announced, and the hub reads
-- `delivered_plan_id is not null and notified_at is null` to keep a "Ready — open" badge
-- durable across reloads until the author has opened the proposal once. Rows delivered BEFORE
-- this migration were never announced through a mechanism that could record it, so without a
-- backfill every historical delivery would light up as newly ready. Stamp them now.
--
-- S-310's emailer is the intended SECOND writer of the same column and must skip rows that
-- already carry a `notified_at`.
--
-- Grants/RLS: none needed. Both tables already carry the house grants and RLS policies, and
-- `anon` is revoked on both. `solver_job_writer`'s column-scoped grants (20260812141459,
-- 20260820075348) cover neither `delivery` nor `plans` — the solver has no business with
-- either, and this migration deliberately leaves that untouched.

alter table plans
  add column pending_proposal boolean not null default false;

comment on column plans.pending_proposal is
  'True while this plan is a generation proposal whose board has not landed yet: listed and openable read-only, refused by every edit path. Set by enqueue after clone_plan; cleared by delivery (or by a terminal branch that leaves the clone alive). See supabase/migrations/20260828093000_proposal_pending_and_delivery_vocabulary.sql.';

alter table generation_jobs
  add constraint generation_jobs_delivery_check
  check (delivery is null or delivery = 'proposal');

comment on column generation_jobs.delivery is
  'How the result reached the author. Vocabulary declared by S-306: null = undelivered, ''proposal'' = the verified board landed on the proposal plan. The source plan is never a delivery target.';

update generation_jobs
   set notified_at = now()
 where delivered_plan_id is not null
   and notified_at is null;
