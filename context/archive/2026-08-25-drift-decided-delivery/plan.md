# The Proposal Is a Plan (S-306) — Implementation Plan

## Overview

S-306 ships **author-decided delivery in its simplest honest form: the proposal is a plan.** On
Generate the app still clones the source as `Proposal — <name>`, but the clone is now **pending** —
listed on the hub with the live job badge, openable read-only with progress, and refused by every
edit path — until a deliverable result exists. The delivering visit (to the proposal itself, or to the
source) verifies → translates → applies onto the proposal and flips it to an ordinary plan. The source
plan is **never written to**. There is no merge, no drift gate, and no decision panel: rename and
delete are the acts, and both already exist. The hub badge on the proposal row is a durable row
state (pending → ready) and the poll fires a toast on the transition — the channel-agnostic
notification event S-310 extends. The E2E lane finally gets a solver, and Generate gets browser
coverage.

This is the third re-grounding of FR-307 and it is a **simplification, not a reversal**: for the
author's stated workflow (leave the source alone during a solve) "merge into the source" was exactly
equal to "delete the source, rename the proposal", and in the rare drifted case merge was gated
anyway. Everything the merge path needed — the T1 re-hash, the TOCTOU guard, the `is_optional` blind
spot, three actions and a CHECK vocabulary — leaves with it.

## Current State Analysis

From the frame (`frame.md`) and research (`research.md`), plus direct reading during planning:

- **The delivery chain is built, idempotent and crash-safe**
  (`src/_pages/plan-detail/api/generation-delivery.ts:162-219`): reclaim CAS → deliverability gate →
  heavy payload read → server-side oracle → `courseId` translation → region-replace → delivered
  marker CAS (last). Interrupted-with-checkpoint already delivers through the same path. Nothing in it
  needs to change *mechanically*; what changes is **what keys it** (today: the source plan's latest
  job) and **what it flips** (today: nothing on `plans`).
- **The clone exists from the first second and has no reader until delivery.** `startGeneration`
  clones (`generation-job.ts:124-135`) before inserting the job; the hub omits `proposal_plan_id` from
  its projection (`plans-list/api/generation-status.ts:29`), the solver cannot read the column, and
  the strip shows the clone only once `job.delivered` (`GenerationStatusStrip.tsx:51`). Meanwhile it is
  a visible, editable, deletable plan that can destroy a 20-minute solve.
- **Status lives on the wrong row.** Every surface — the strip, the hub badge, the poll's discovery
  read — is keyed by `plan_id` (the source). The hub's "Finished — open plan" deliberately links to
  the source because delivery only happens there (`plan-indicators.ts:91-95`).
- **`plans` has no notion of a proposal.** Five columns since 2026-06-02
  (`20260602185012_minimal_domain_schema.sql:91-97`). The by-id surfaces all read the row through
  either `loadPlanSummary` (`shared/api/load-plan-summary.ts:21-30` — the three catalog routes) or an
  inline select (`plan-detail/api/load.ts:58`, both person-view loaders, `load-plan-analysis.ts:134`).
- **The hub is the only place plans are enumerated** (`plans-list/api/loader.ts:42`). Every other
  read is by id. The complete by-id surface is: `plans/[id]/index.astro`, `courses.astro`,
  `students.astro`, `teachers.astro`, `students/[studentId].astro`, `teachers/[teacherId].astro`,
  `compare.astro`, and the `renamePlan` / `deletePlan` / `clonePlan` actions.
- **Notification has no durable form.** `notified_at` has no writer and no reader
  (`20260810200122_generation_jobs.sql:82`); the hub's terminal memory is in-RAM only
  (`job-progress-store.ts` rule 4) and `delivery` is untyped `text` with the vocabulary "S-306's to
  declare".
- **The E2E lane has no solver** (`ci.yml` e2e job; comment at the top of the job says so), but the
  integration job carries the complete recipe: `astral-sh/setup-uv@v9.0.0` pinned to `0.12.3`,
  `scripts/provision-solver-user.mjs`, uvicorn in the background with a `/health` poll, and
  `SOLVER_URL` exported to `$GITHUB_ENV`.
- **Dead code kept for this slice**: `liveState`, `stageGenerated`, `settleGenerated`, `failGenerated`
  in `plan-detail/model/use-placements.ts:76-89, :198-225` ("Currently has NO caller … kept for a
  future client-side apply (S-306)"). The `applyGeneratedPlacements` **action** is not dead: undo/redo
  binds it (`placement-client.ts:54-58`).

### Key Discoveries:

- `deliverable()` (`generation-delivery.ts:132-134`) does not admit `stopped`; the strip already has a
  placeholder branch for it (`GenerationStatusStrip.tsx:99-109`). Admitting `stopped`-with-checkpoint
  is one predicate change and pre-pays S-305.
- `translateCourseIds` failure is already handled by **detaching** the clone rather than deleting it
  (`generation-delivery.ts:199-211`) — under a pending guard that branch becomes nearly unreachable
  (the catalog cannot be edited while pending) but must still clear `pending_proposal`, or the plan
  is stranded read-only forever.
- The poll store's `merge` keeps a terminal indicator only in RAM (`job-progress-store.ts:157-158`);
  once the hub loader also reads terminal-undelivered jobs, that memory becomes a *cache* of a row
  state rather than the only record of it.
- `clonePlan` (`shared/api/clone-plan.ts`) is the right place to **not** add pending: it has two
  consumers (the hub's Clone dialog must never produce a pending plan). The enqueue path sets the flag
  after cloning, in `generation-job.ts`.
- A pending page has **no board**, so the FR-312 argument against polling on the plan page
  ("polling can never contend with dragging there") does not apply to it — it may poll, and it may
  deliver, because it is the one page whose entire content *is* this job.
- `snapshot_hash` keeps exactly one live reader after this change: the solver's snapshot **binding**
  check (`services/solver/src/cpsat_service/runner.py:209-228`). It is not a drift column any more and
  its docblocks must say so.

## Desired End State

An author presses Generate on plan P. The hub immediately lists `Proposal — P` with a live
"Generating — stage k of 10" badge; P itself shows a one-line advisory ("Generating a proposal from
the 14:02 state — open proposal · watch in Plans") and its Generate button is disabled. Opening the
proposal shows its name and progress, not a board; its catalog routes say "still generating"; rename,
delete and clone refuse it. When the job completes, the proposal page (if open) delivers the board and
reloads into it; the hub badge reads "Ready — open" and, if the hub is open, a toast says so. The
proposal is now an ordinary plan: the author opens it, compares it with P on the existing comparison
page if they like, renames it, keeps it, or deletes it — or deletes P. P was never written to. A failed
or empty solve sweeps the clone as today and P's strip reports the failure until the next Generate.

Verified by: `pnpm check`, `pnpm test`, `pnpm test:integration` (with the solver up), `pnpm test:e2e`
(the new `generation.spec.ts`), and the manual walk in each phase.

## What We're NOT Doing

- **No merge into the source, and no drift gate.** Retired by explicit author decision (2026-08-28,
  second round). The T1 re-hash, the `assembleSource` extraction, an expected-hash RPC argument, the
  `is_optional` wire widening, and a decision panel on the comparison page are all out.
- **No drift advisory either.** A "the source has changed since" line would cost a full
  `loadCombinedPlannerData` (~18 round trips) per proposal visit for a sentence nobody acts on.
- **No dominance** — S-307's, by the frame.
- **No clock and no session-free identity** — S-310's; the walk-away trigger is not owed here.
- **No retention policy for proposals** — the author keeps them and cleans up by hand (their stated
  preference); Delete is the act.
- **No changes to `apply_generated_placements`, `clone_plan`, or the wire contract.** No `formatVersion`
  bump.
- **No guard on individual board-mutation actions** (`placeCourse`, `moveBundleMembers`, …). They are
  unreachable without a rendered board; the pending page renders none. Documented, not enforced.
- **No new comparison-page UI.** Proposal vs source comparison is the existing hub-driven flow.
- **No `stopped` producer** — S-305's. This slice only makes a `stopped`-with-checkpoint row
  deliverable.

## Implementation Approach

Keep the tested pipeline and move three things around it: **a marker** (`plans.pending_proposal`,
set by enqueue, cleared by delivery), **the key** (delivery reachable by `proposal_plan_id` as well as
by `plan_id`, through one shared settle core), and **the surfaces** (status on the proposal row;
the source keeps only FR-308's advisory and failure reporting). The notification event is a row
transition the hub reads durably; the toast is a by-product of the poll. The foundation docs are
re-grounded **first**, in their own phase and commit, so every later phase implements text that is
already current — the convention the project has used for every prior re-grounding.

Ordering within the code phases follows the dependency: the marker and vocabulary (Phase 2) before
anything reads them (Phases 3–4); the E2E lane last, because it drives the finished flow.

## Critical Implementation Details

- **Flag-clear ordering in `deliver()`.** Clear `plans.pending_proposal` **after** the region-replace
  and **before** `markDelivered`'s CAS. A crash between the two leaves `delivered_plan_id` null, so
  the next visit re-enters `deliver()`, re-applies (the region replace absorbs it) and re-clears —
  the existing "marker goes last" argument (`generation-delivery.ts:153-156`) extends unchanged.
  Every **terminal-without-delivery** branch (empty result, failed verdict, translation mismatch with
  `detachClone`) must also clear the flag on any clone it leaves alive, or the plan is stranded
  read-only.
- **The hub's two-tab discovery has a hole this shape opens.** A job started on a plan page creates
  a proposal row the already-open hub has never loaded. The indicator therefore carries **both**
  `planId` and `proposalPlanId`; the cell renders it on the proposal row when that row is on the page,
  else on the source row. The discovery read must match on `plan_id` (the id the hub knows) — not
  only `proposal_plan_id`.
- **The pending page polls and delivers; the hub still never delivers.** Keep
  `readGenerationJobStatuses` a pure read. The pending island calls `checkPlan` (which delivers)
  on its timer, and on a delivered response does a full navigation to the same URL so the board
  renders through the normal SSR path — no client-side board bootstrap.
- **`clonePlan` in `shared/api` stays unaware of pending.** The hub's Clone dialog uses it and must
  keep producing ordinary plans. The enqueue path sets the flag with a separate `update` immediately
  after the clone returns.
- **Delete of a pending plan.** Refuse while the job is *active* (`queued`/`running` and not stale)
  or *deliverable-but-undelivered* (open it to deliver first); allow on a failed, swept-shape or
  stale job, and when no job references the clone, so a failed or wedged proposal can always be
  removed by hand. The
  refusal is a `CONFLICT` `DomainError` with a message naming the proposal, mapped like every other
  `defineDomainAction` error.

---

## Phase 1: Foundation re-ground — "the proposal is a plan"

### Overview

Record the second re-grounding of 2026-08-28 before any code, in the same style as the first: what
expired, why, and what replaces it. After this phase every FR the later phases implement reads as
current text.

### Changes Required:

#### 1. PRD

**File**: `context/foundation/prd.md`

**Intent**: Retire merge and the drift gate; state the proposal-is-a-plan model as the delivery
rule; close Open Question 4.

**Contract**: Amend — PSC #4 (author is notified; the proposal becomes a plan; rename/delete are the
acts); the persona line ("adopt deliberately" → "keep, rename or delete"); US-301 (drop "merge it
deliberately"); US-303 (retitle to *"A proposal becomes a plan the moment it is delivered"*:
Given a job completes / When the author opens the proposal / Then the verified board is on it, it is
an ordinary plan, and the source is untouched); FR-306 (review surface stays the comparison page,
reached from the hub, no route-in from the job needed); FR-307 (rewrite under a second re-grounding
note, preserving both prior blocks; state the *equivalence argument* — merge ≡ delete-source +
rename-proposal in the no-edit case; gated and rare otherwise); FR-308 (the source shows the advisory
while active and the failure after a failed run; the proposal carries all other status); FR-309
(unchanged; note the event is the `delivered_plan_id`/`notified_at` row transition); Business Logic
delivery rule; the shaping-resolutions closer; **Open Question 4 → resolved** ("clone at dispatch,
pending until delivered"). Do not touch FR-313 (already correct).

#### 2. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Rename and rewrite the S-306 entry; fix the rows that describe it.

**Contract**: S-306 → *"The proposal is a plan"* (Outcome, Unknowns — (1) resolved, (2) resolved as a
durable row transition; Risk — the pending guard is the new hazard: a missed by-id surface lets an
in-flight clone be edited); at-a-glance row; Stream D sentence; next-actions row (issue #103 needs
its title/body updated — note it, do not do it here). Keep the earlier re-grounding block and add the
second beneath it.

#### 3. README

**File**: `README.md`

**Intent**: Truth-up the two places that describe delivery.

**Contract**: The hosted-solve campaign bullet ("applies placements on delivery" → onto the proposal
plan, never the source); the Known-gaps "Generate has no E2E coverage" line (mark as closed by S-306
once Phase 5 lands — leave a `<!-- S-306 Phase 5 -->` marker so the implementer flips it then).

#### 4. Change record

**File**: `context/changes/drift-decided-delivery/change.md`

**Intent**: Record the decision and its lineage.

**Contract**: A `## Decisions` section: 2026-08-28 — proposal-is-a-plan chosen over (a) merge/keep/
discard with a drift gate (the frame's landing) and (b) completion-time materialisation; the
equivalence argument; the one thing it costs (no fold-in path for the edited-during-solve case).

### Success Criteria:

#### Automated Verification:

- `pnpm exec prettier --check context/foundation/prd.md context/foundation/roadmap.md README.md` passes

#### Manual Verification:

- Reading PRD FR-307 top to bottom shows three dated blocks in order (Socrates → 08-28 first
  re-ground → 08-28 second re-ground) and the current rule is unambiguous
- Open Question 4 reads as resolved with the chosen mechanism
- No remaining prose in `prd.md`/`roadmap.md`/`README.md` says a result is merged or auto-applied to
  the source (grep `merge`, `auto-apply`, `adopt`)

**Implementation Note**: Commit this phase alone (`docs(foundation): re-ground S-306 to proposal-is-a-plan`) before touching code.

---

## Phase 2: Schema + pending lifecycle

### Overview

Add the marker and the delivery vocabulary; make enqueue set the flag and every terminal path clear
or sweep it; widen deliverability to `stopped`-with-checkpoint; delete the dead client-apply
primitives. No surface changes yet — after this phase the app behaves as before except that a
proposal row is flagged while pending.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_proposal_pending_and_delivery_vocabulary.sql`

**Intent**: One migration for both schema facts this slice owes.

**Contract**:
- `alter table plans add column pending_proposal boolean not null default false;` with a header
  explaining the lifecycle (set by enqueue after `clone_plan`, cleared by delivery or by the terminal
  branch that leaves the clone alive; a swept clone needs no clear). No index (the hub filters on a
  ≤200-row page; the flag is read by id everywhere else).
- `alter table generation_jobs add constraint generation_jobs_delivery_check check (delivery is null or delivery = 'proposal');`
  — one value, deliberately: the vocabulary is `null` (undelivered) | `'proposal'` (the board landed on
  the proposal plan). Note in the header that the auto-apply/merge values the column was reserved for
  were retired 2026-08-28 and that widening the check is one line if a later slice needs it.
- Backfill in the same migration: `update generation_jobs set notified_at = now() where delivered_plan_id is not null and notified_at is null;`
  — pre-existing deliveries must not be badged "Ready" by Phase 4's delivered-and-not-notified branch.
- No grant changes: `plans` and `generation_jobs` already carry the house grants/RLS; `anon` stays
  revoked. `solver_job_writer`'s column-scoped grants do not include `delivery` or `plans` — leave
  them.
- Regenerate `src/shared/api/database.types.ts` with
  `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts` after
  `pnpm exec supabase db reset` (there is no package.json script for it; never `wrangler types`).

#### 2. Enqueue sets the flag

**File**: `src/_pages/plan-detail/api/generation-job.ts`

**Intent**: The clone becomes pending the moment it exists; every error path that deletes the clone is
unchanged.

**Contract**: After `createProposalPlan` returns, `update plans set pending_proposal = true where id = <clone>`
via the client; a failure there is a thrown `DomainError` **after** deleting the clone (the row must
never exist unflagged). Update the docblock's S-306 sentence (it still says "S-306's auto-apply").

#### 3. Delivery clears the flag and writes the vocabulary

**File**: `src/_pages/plan-detail/api/generation-delivery.ts`

**Intent**: Every path that leaves a clone alive leaves it un-pending; the delivered marker records
`delivery = 'proposal'`; `stopped`-with-checkpoint is deliverable.

**Contract**:
- `deliverable(row)` := `delivered_plan_id is null && (status === 'succeeded' || ((status === 'interrupted' || status === 'stopped') && checkpoint_stage_index !== null))`.
  `sweepable(row)` gains `stopped` without a checkpoint symmetrically. `payloadColumn` returns
  `checkpoint` for both.
- New private `clearPending(supabase, proposalPlanId)` (update `plans` set `pending_proposal=false`),
  called: after `applyToProposal` and before `markDelivered`; and in the translation-mismatch branch
  (`detachClone: true`) after `failJob`.
- `markDelivered` writes `{ delivered_plan_id, delivery: 'proposal' }` in the same CAS update.
- Docblock: replace the paragraph starting "**The trigger is a visit, and the plan says so out loud.**"
  — the trigger is a visit *to either plan*, the proposal's own page delivers itself (Phase 3), and
  the "S-306 adds drift-decided delivery" sentence goes.
- **plan-detail's** `STATUS_COLUMNS` (`generation-delivery.ts:89`) gains `delivery` (scalar; cheap) so
  `toView` can expose it if the strip wants it. (plans-list has its own `STATUS_COLUMNS` in
  `generation-status.ts:29` — Phase 4's edit; the two are different constants.)

#### 4. Delete the dead client-apply primitives

**File**: `src/_pages/plan-detail/model/use-placements.ts` (and its test, and `rpcs.ts` if any type
references remain)

**Intent**: `liveState`, `stageGenerated`, `settleGenerated`, `failGenerated` were kept across three
slices "for a future client-side apply (S-306)". S-306 has no client-side apply.

**Contract**: Remove the four members from the `UsePlacements` return type and body; keep
`applyReconcile` and everything undo/redo uses. `pnpm check` and `pnpm lint` find any straggler.
Leave `placementActions.applyGeneratedPlacements` (live via undo/redo — say so in its docblock, which
still cites S-306).

#### 5. Integration tests

**Files**: `src/_pages/plan-detail/api/generation-enqueue.integration.test.ts`,
`src/_pages/plan-detail/api/generation-delivery.integration.test.ts`

**Intent**: Pin the lifecycle.

**Contract**: Enqueue — "clones the plan **as pending**" (assert `plans.pending_proposal = true` on
the clone; and `false` on a plan cloned through `clonePlan` directly). Delivery — the happy path
asserts `pending_proposal = false` and `delivery = 'proposal'` after delivery; a new case delivers a
`stopped`-with-checkpoint row; the translation-mismatch case (edit the clone's course name by
service-role, since the guard is not on the DB) asserts the detached clone ends `pending_proposal = false`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `pnpm exec supabase db reset`
- Types regenerate without diff noise beyond the new column: `git diff --stat src/shared/api/database.types.ts`
- Type check passes: `pnpm check`
- Lint + FSD pass: `pnpm lint && pnpm steiger`
- Unit suite passes: `pnpm test`
- Integration suite passes with the solver up: `SOLVER_URL=http://127.0.0.1:8000 pnpm test:integration`

#### Manual Verification:

- After Generate on a local plan, Studio shows the clone with `pending_proposal = true`; after visiting
  the source once the job succeeds, `false` and `delivery = 'proposal'`

**Implementation Note**: After this phase the pending flag is set but **nothing enforces it** yet;
that is Phase 3. Pause for the manual check before proceeding.

---

## Phase 3: Proposal-keyed delivery, the pending page, and the guards

### Overview

Make the proposal the place where the job is seen and delivered: a proposal-keyed check, a pending
page that polls and delivers, refusal on every other by-id surface and on the three plan actions,
and the strip split between source (advisory + failure) and proposal (provenance + label).

### Changes Required:

#### 1. Pending in the shared plan summary

**File**: `src/shared/api/load-plan-summary.ts`

**Intent**: One read gives every catalog route the flag.

**Contract**: `PlanSummary` gains `pending_proposal: boolean`; the select adds the column. Add
`isPendingProposal(plan: PlanSummary): boolean` beside it. The three catalog routes already call this.

#### 2. Proposal-keyed check

**File**: `src/_pages/plan-detail/api/generation-delivery.ts` (+ `generation-actions.ts`,
`generation-client.ts`, `api/index.ts`)

**Intent**: The same settle core, reachable from the proposal's id.

**Contract**: Extract the body after `latestJob` into `settle(supabase, sourcePlanId, row)` (reclaim →
deliver | sweep | label). Replace `checkGeneration({planId})` with **one dual-keyed
`checkPlan({planId})`** that runs on *every* plan visit (there is no "today's path" any more): it reads
the latest job `where plan_id = id OR proposal_plan_id = id` (PostgREST `.or(…)`, both columns
indexed — `generation_jobs_plan_idx`, `generation_jobs_proposal_plan_idx`), tags the view with
`role: "source"` when the row's `plan_id` matches, `"proposal"` when `proposal_plan_id` matches, calls
`settle` with the row's `plan_id`, and returns `GenerationJobView | null`. **Precedence when a plan is
both** (a Generate was later pressed *on* a delivered proposal): a row where the plan is the source
and the job is active or undelivered wins; otherwise the newest row referencing the plan as a
proposal; otherwise the newest source row. Pin this with an integration case. `GenerationJobView`
gains `sourcePlanId` and `sourcePlanName` (one extra `plans` read of `id, name` — only on the
proposal role; the strip needs the name for provenance). Expose as the `checkPlan` action and a
client wrapper; delete `checkGeneration` (callers: `plans/[id]/index.astro`, `use-generation-job.ts`
default `check`, `generation-client.ts`, the action barrel).

#### 3. The pending page

**Files**: `src/pages/plans/[id]/index.astro`, new `src/_pages/plan-detail/ui/PendingProposalPage.tsx`,
new `src/_pages/plan-detail/model/generation/use-pending-proposal.ts`

**Intent**: A pending proposal renders progress instead of a board, keeps itself current, and delivers
itself.

**Contract**:
- Route: read the plans row first (`loadPlanSummary`), then run `checkPlan` server-side **on every
  visit** (it replaces today's post-board `checkGeneration` call — move it *before* the board load, it
  is one narrow read until a row is deliverable). Then re-read `pending_proposal` (the check may just
  have cleared it): if still pending, render `<PendingProposalPage job={…} planName={…} client:load />`
  inside `SidebarLayout` and skip `loadCombinedPlannerData` entirely; otherwise load the board and pass
  the same `GenerationJobView` (role-tagged) to `PlanDetailPage` — the delivering visit therefore
  renders the board *and* the proposal strip from one check, and every later visit of the proposal
  gets its provenance strip and (Phase 4) its `notified_at` write from the same call.
- Island: shows name, "Generating — stage k of 10 · <tier>" (reuse `tierLabel`/`LADDER_TIER_COUNT`),
  started time via `useHydrated`, a Refresh button, "Watch progress in Plans" link, and the source
  link. On a **failed / interrupted-without-checkpoint** job: the error, and "This proposal will be
  removed" is **wrong** — the sweep already removed it during `checkPlan`, so the route must
  handle a `null` plan after the check (render `PlanScopedError`).
- Hook: `useSyncExternalStore`-shaped ticker (the `job-progress-store.ts` pattern, slice-local and
  minimal) calling the `checkPlan` client every 5 s while `isActiveJobStatus`, pausing on hidden
  tab; when a tick returns `delivered: true`, `window.location.assign(window.location.href)`.
  Rationale in the docblock: no board here, so FR-312's structural argument permits polling; and
  delivery from this page is delivery *to* this page.

#### 4. Guards on the other by-id surfaces

**Files**: `src/pages/plans/[id]/courses.astro`, `students.astro`, `teachers.astro`,
`students/[studentId].astro`, `teachers/[teacherId].astro`, `src/pages/plans/compare.astro`; new
`src/app/layouts/PendingProposalNotice.astro`

**Intent**: A pending proposal has no catalog or views to show; say so and link to its page.

**Contract**: Each route, after resolving the plan, renders `PendingProposalNotice` (plan name + "This
proposal is still being generated" + link to `/plans/<id>`) when `pending_proposal`. Person-view
loaders (`student-plan-view/api/loader.ts`, `teacher-plan-view/api/loader.ts`) add the column to their
inline `plans` select and return a new `{ kind: "pending" }` error variant the route maps to the
notice. `compare.astro`: `load-plan-analysis.ts` selects the column and **throws** for a pending plan
so it lands in `missingPlanIds` — the page already names those ("could not be loaded"); adjust that
copy to "could not be loaded or is still being generated".

#### 5. Guards on the plan actions

**Files**: `src/_pages/plans-list/api/rename-plan.ts`, `delete-plan.ts`, `src/shared/api/clone-plan.ts`
(or the plans-list action wrapper), `src/_pages/plans-list/api/actions.ts`

**Intent**: No edit path can touch a pending proposal.

**Contract**: A shared `assertNotPending(supabase, planId, { allowTerminal })` in `plans-list/api`
(reads `plans.pending_proposal`; when `allowTerminal`, also reads the referencing job's
`status`/`heartbeat_at`/`created_at` and permits if `!isActiveJobStatus || isStaleActiveJob`). Rename
and clone: refuse whenever pending. Delete: refuse while active-and-not-stale **and while the job is
deliverable-but-undelivered** (`succeeded`, or `interrupted`/`stopped` with a checkpoint, and
`delivered_plan_id is null`) — `proposal_plan_id` is `on delete set null`, and `deliver()` on a null
proposal marks the job `failed` ("the proposal plan no longer exists", `generation-delivery.ts:162-168`),
so a deliberate delete would surface as a red failure on the source strip and a `toast.error` on the
hub. The refusal message says "open the proposal to deliver it first" — that is the badge's own
wording. Allowed: `failed`, interrupted/stopped without a checkpoint (both swept anyway), and stale
active jobs. Share the deliverable predicate rather than re-deriving it (export `deliverable` from
`generation-delivery.ts` or lift it to `entities/timetable/model/generation/`). **No referencing
job counts as terminal** — a pending clone whose job row is gone (see the source guard below) must
always be deletable by hand. Refusal = `DomainError("CONFLICT", …)`. The Delete dialog surfaces the
message through its existing error path.

**The source is guarded too.** `generation_jobs.plan_id` is `on delete cascade`
(`20260810200122_generation_jobs.sql:60`): deleting the source mid-solve deletes the job row, strands
the clone pending with nothing to deliver, and pulls the row out from under a running solver. So
`deletePlan` also refuses (same `CONFLICT`, message naming the proposal) when the plan is the `plan_id`
of an active-and-not-stale job — a sibling `assertNoActiveJob(supabase, planId)` beside
`assertNotPending`, one indexed read (`generation_jobs_plan_idx`). A *stale* active job does not
block: reclaim already treats it as dead. Add "delete of the source refused while its job is active"
to the `plan-actions.integration.test.ts` cases.

#### 6. The strip, split

**Files**: `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx` (+ test),
`src/_pages/plan-detail/model/generation/use-generation-job.ts`,
`src/_pages/plan-detail/model/use-cohort-board-state.ts`

**Intent**: The source shows only what is the source's to show; the proposal shows provenance.

**Contract**:
- `GenerationJobView` gains `role: "source" | "proposal"` set by the check that produced it.
- Source (`role: "source"`): active → "Generating a proposal from the <time> state — open proposal ·
  Watch progress in Plans · you can leave the page" (the proposal link is `job.proposalPlanId`, now
  always present while active); failed / interrupted-without-checkpoint → today's copy; **delivered
  or otherwise terminal → render nothing**.
- Proposal (`role: "proposal"`, delivered): "Generated from <source name> at <time>" (link to
  `sourcePlanId`) + the clean label / interrupted-stage summary exactly as today's delivered branch.
- `GenerateButton` disables while the tracked job is active. It has no prop of its own — it reads
  `disabledReason` off `generation: GenerationControls`; the union `GenerationDisabledReason =
  "violations" | "complete" | null` lives in `use-cohort-board-state.ts:140` and is derived at
  `:120-124` from board state. Add `"generating"`, derive it there from
  `generation.state.status === "tracking" && isActiveJobStatus(state.job.status)` (it takes
  precedence over the board-derived reasons), and add the matching label in `GenerateButton.tsx` —
  so the `CONFLICT` the server would return is never the first thing the author sees.
- Tests: rewrite the strip suite per role; add "source renders nothing once delivered" and
  "proposal names its source".

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Lint + FSD pass: `pnpm lint && pnpm steiger`
- Unit suite passes (strip, pending hook, notice): `pnpm test`
- Integration suite passes: `SOLVER_URL=http://127.0.0.1:8000 pnpm test:integration` — including a new
  `checkPlan` cases in `generation-delivery.integration.test.ts` (delivers by proposal id, clears
  pending, source untouched) and a `plan-actions.integration.test.ts` case per guard (rename/clone
  refused while pending; delete refused while active and while deliverable-undelivered, allowed after the job is failed)
- Production build stays clean: `pnpm build`

#### Manual Verification:

- Generate on a local plan; open the proposal from the hub: progress renders, no board; open its
  Courses tab: the notice; try Rename from the hub: refused with a readable message
- Leave the proposal page open until the solve finishes: it reloads into the board on its own; the
  strip names the source and the clean label; the source page shows nothing
- Kill the solver mid-run (or `SOLVER_URL` to a dead port before Generate): source strip reports the
  failure; the proposal is gone from the hub

**Implementation Note**: Pause for manual confirmation — this is the phase where the guard surface
is proven complete.

---

## Phase 4: The hub as the notification surface

### Overview

Move the badge to the proposal row, make "ready" a durable row state, fire a toast on the
transition, and give `notified_at` its first writer.

### Changes Required:

#### 1. Indicator carries both ids and is keyed by the proposal

**Files**: `src/_pages/plans-list/model/plan-indicators.ts` (+ test),
`src/_pages/plans-list/api/generation-status.ts` (+ test), `src/_pages/plans-list/api/loader.ts`,
`src/_pages/plans-list/model/schemas.ts`, `src/_pages/plans-list/ui/PlansHub.tsx`,
`src/_pages/plans-list/ui/PlanIndicatorsCell.tsx`

**Intent**: The badge lives on the row it is about, survives reloads once ready, and still shows up
on the source row when the proposal row is not on the page.

**Contract**:
- **plans-list's** `STATUS_COLUMNS` (`generation-status.ts:29`) += `proposal_plan_id, delivered_plan_id`. `GenerationJobStatusRow` and
  `GenerationIndicator` gain `proposalPlanId: string | null` and `delivered: boolean`.
- `describeGenerationIndicator`: active → as today, `href` = the proposal (it is openable now);
  `succeeded`/`interrupted`/`stopped` with `delivered` → `{ tone: "done", label: "Ready — open", href: proposal }`;
  terminal-undelivered → `{ tone: "done", label: "Finished — open to deliver", href: proposal }`;
  `failed` → href the **source** (that is where the failure strip is). Update the test that pins
  "points a finished job at the SOURCE plan".
- Loader: `loader.ts:83-95` today duplicates `discoverActive`'s query inline. Extract one shared
  builder in `generation-status.ts` (e.g. `surfacedJobsFor(supabase, planIds)`) that both the loader
  and `discoverActive` call, so the filter is written once. That filter becomes `status in (queued, running) OR (delivered_plan_id is null AND status in (succeeded, interrupted, stopped))`
  … **plus** delivered-and-not-yet-notified rows (`delivered_plan_id is not null and notified_at is null`)
  so a ready proposal keeps its badge until the author has opened it. Attach each indicator to
  `proposalPlanId` when that row is on the page, else to `planId`.
- Discovery (`discoverActive`) matches `plan_id in (planIds)` **or** `proposal_plan_id in (planIds)`
  (PostgREST `.or(…)`); `readGenerationJobStatusesInput` unchanged.
- `PlansHub.indicatorsFor`: prefer an indicator whose `proposalPlanId === row.id`; fall back to
  `planId === row.id` only when no row on the page has that proposal id.
- The store's field-equality (`sameIndicators`) compares `delivered` too.

#### 2. Toast on transition

**Files**: `src/_pages/plans-list/model/use-generation-indicators.ts`, `src/_pages/plans-list/ui/PlansHub.tsx`

**Intent**: An open hub announces completion.

**Contract**: A `useEffect` in `PlansHub` that diffs the previous snapshot (kept in a ref) against the
current one and calls `toast.success("Proposal ready", { description: <name>, action: { label: "Open", onClick: navigate } })`
for each indicator that went active → terminal (`failed` → `toast.error` with the source link).
`toast()` is not `setState`, so the effect is compliant with `react-hooks/set-state-in-effect`;
say so in a comment. `Toaster` is already mounted.

#### 3. `notified_at` first writer

**File**: `src/_pages/plan-detail/api/generation-delivery.ts`

**Intent**: The event is "delivered and not yet announced"; an in-app view of the delivered proposal
counts as announced.

**Contract**: In `checkPlan`, when the view has `role: "proposal"`, the job is delivered and `notified_at is null`, write
`notified_at = now()` (plain update, not a CAS — a second writer overwriting with a later instant is
harmless). Document in the migration header of Phase 2 and in the docblock that S-310's emailer will
be the other writer and should skip rows already notified.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Lint + FSD pass: `pnpm lint && pnpm steiger`
- Unit suite passes (indicators, store, hub toast via the mocked fetcher): `pnpm test`
- Integration suite passes: `pnpm test:integration` — `generation-status.integration.test.ts` gains
  "attaches a ready proposal to the proposal row after reload" and "discovers by source id"

#### Manual Verification:

- Two tabs: hub open, Generate from the plan page — the hub shows the badge on the source row within
  5 s, on the proposal row after a reload; on completion the toast fires and "Ready — open" links to
  the proposal; after opening it once, a hub reload shows no badge

---

## Phase 5: E2E lane + Generate spec

### Overview

Give the e2e CI job a solver and prove the whole author flow in a browser.

### Changes Required:

#### 1. CI e2e job

**File**: `.github/workflows/ci.yml`

**Intent**: Boot the native solver exactly as the integration job does, and hand its URL to workerd.

**Contract**: After the Supabase stack: provision the machine user (same masked-password step),
`astral-sh/setup-uv@v9.0.0` with `version: "0.12.3"` and `working-directory: services/solver`,
`uv sync --locked`, the same background-uvicorn + `/health` poll step (`SOLVER_MAX_CONCURRENT_JOBS: "1"`
is enough — one spec dispatches), then extend the `.dev.vars` write with `SOLVER_URL=http://127.0.0.1:8000`
**before** `pnpm test:e2e` (the build snapshots it — the `.dev.vars` lesson). Add the
`if: failure()` solver-log step. Update the job's top comment ("no spec presses Generate" is now false).

#### 2. The spec

**Files**: new `e2e/specs/generation.spec.ts`; `e2e/support/planner.ts` (only if a helper is needed by
a second spec — otherwise keep it local)

**Intent**: Generate → pending proposal → ready → board, through the UI.

**Contract**: Create a plan, one teacher, **one course per cohort** (DP1 and DP2, 1 h/week each) and one
student per cohort with that choice — mirroring the shape of the ~2 s fixture in
`src/test/generation-proposal.integration.test.ts:51-72`, since a one-cohort plan is an untested
solver input for the full chain — all via existing `support/` helpers (`createPlan`, `createTeacher`,
`createCourse`, `createStudent`); open the plan; press Generate; assert the source strip's advisory
and that the Generate button is disabled; go to `/plans`; assert the `Proposal — <name>` row exists
with a `role="status"` badge; click it; assert the pending page (heading + "Generating"); wait for the
board (`expect(cell(...)).toBeVisible()` with the course chip placed — the fixture solves in ~2 s, the
page reloads itself; use a generous `toBeVisible({ timeout })`, never `waitForTimeout`); assert the
strip names the source; assert the source plan's board is unchanged (its cell is still empty).
Teardown: delete both plans via `deletePlan`. Guard-side negative: while pending, `Rename` on the
proposal row shows the refusal message (only if it can be made deterministic — otherwise leave to the
integration test).

#### 3. Local parity

**File**: `README.md` (the E2E note under CI, and the Known-gaps line marked in Phase 1)

**Intent**: Running `pnpm test:e2e` locally with Generate coverage needs `mise run solver:dev` up and
`SOLVER_URL` in `.envs/local.vars` (it already is); say so.

### Success Criteria:

#### Automated Verification:

- The e2e job is green on the PR (`gh run watch`)
- Locally, with Supabase + `mise run solver:dev` up: `pnpm test:e2e e2e/specs/generation.spec.ts`
- `shellcheck` is unaffected (no new scripts); `mise run solver:check` still passes

#### Manual Verification:

- The e2e job's duration stays within ~1 min of today's ~426 s (uv sync is cached; the solve is ~2 s)

---

## Testing Strategy

### Unit Tests:

- `plan-indicators.test.ts`: ready/undelivered/failed hrefs, proposal-vs-source keying, `delivered`
  in equality
- `job-progress-store.test.ts`: `delivered` participates in `sameIndicators`
- `GenerationStatusStrip.test.tsx`: per-role rendering, source renders nothing when delivered
- `use-pending-proposal.test.ts`: ticks while active, stops on terminal, triggers navigation on
  delivered
- `load-plan-summary` / `isPendingProposal`: trivial guard

### Integration Tests:

- Enqueue flags the clone; `clonePlan` does not
- Delivery by source id and by proposal id both clear the flag, write `delivery='proposal'`, leave the
  source board untouched, and are idempotent across the two entry points (both called concurrently
  deliver once)
- `stopped`-with-checkpoint delivers; without a checkpoint sweeps
- Translation mismatch leaves a detached, **non-pending** clone
- Plan-action guards: rename/clone refused while pending; delete refused while active or
  deliverable-undelivered, allowed after failure and when no job references the clone; delete of the SOURCE refused while its job is active
- Hub status: ready proposal read after "reload"; discovery by source id
- The existing `generation-proposal.integration.test.ts` (full chain) keeps passing with the pending
  assertions added

### Manual Testing Steps:

1. `pnpm env:local`, Supabase up, `mise run solver:dev`, `pnpm build && pnpm preview`
2. Generate on a seeded plan; watch the hub badge on the proposal row; open it during the solve
3. Let it finish with the proposal page open — it becomes the board; check the strip; check the source
   is unchanged
4. Reload the hub: "Ready — open" persists until the proposal is opened once
5. Rename/clone/delete the pending proposal from the hub: refused; delete after a forced failure: allowed
6. Compare source vs delivered proposal on `/plans/compare`: no drift banner (clone fingerprints equal)

## Performance Considerations

- The hub gains one OR-branch on its existing single query; no per-plan cost.
- The pending page polls at 5 s **only while the job is active and the tab is visible**, and each
  tick is the narrow `STATUS_COLUMNS` read until the row is deliverable — then one delivery.
- No T1 re-hash anywhere: the ~18-round-trip `loadCombinedPlannerData` is not added to any visit.

## Migration Notes

- Additive only: a `not null default false` column and a CHECK that admits existing nulls. Existing
  delivered jobs keep `delivery = null` (they pre-date the vocabulary) — the hub loader's
  "delivered-and-not-notified" branch would badge them once; acceptable, or backfill
  `update generation_jobs set notified_at = now() where delivered_plan_id is not null` in the same
  migration (recommended — one line, no ambiguity).
- Any clone that is orphaned *today* (undelivered job, clone alive) stays `pending_proposal = false`
  and behaves as before.

## References

- Frame: `context/changes/drift-decided-delivery/frame.md`
- Research: `context/changes/drift-decided-delivery/research.md`
- Delivery pipeline: `src/_pages/plan-detail/api/generation-delivery.ts:105-219`
- Enqueue: `src/_pages/plan-detail/api/generation-job.ts:59-135`
- Hub indicators: `src/_pages/plans-list/model/plan-indicators.ts`, `api/generation-status.ts`, `api/loader.ts:75-89`
- Poll store: `src/_pages/plans-list/model/job-progress-store.ts`
- Plan-scoped routes: `src/pages/plans/[id]/**`, `src/pages/plans/compare.astro`
- CI solver recipe: `.github/workflows/ci.yml` (integration job, "Start the solver service")
- Prior decisions: `context/archive/2026-08-12-first-verified-proposal/change.md` (id-space, lazy-clone rejection),
  `context/archive/2026-08-14-clean-up-bench-generation/change.md` (kept-for-S-306 primitives)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundation re-ground — "the proposal is a plan"

#### Automated

- [x] 1.1 `pnpm exec prettier --check context/foundation/prd.md context/foundation/roadmap.md README.md` passes — 33f67a1

#### Manual

- [x] 1.2 FR-307 shows three dated blocks in order and the current rule is unambiguous — 33f67a1
- [x] 1.3 Open Question 4 reads as resolved with the chosen mechanism — 33f67a1
- [x] 1.4 No remaining prose says a result is merged or auto-applied to the source — 33f67a1

### Phase 2: Schema + pending lifecycle

#### Automated

- [x] 2.1 Migration applies cleanly: `pnpm exec supabase db reset` — 171bdc5
- [x] 2.2 Types regenerate without diff noise beyond the new column — 171bdc5
- [x] 2.3 Type check passes: `pnpm check` — 171bdc5
- [x] 2.4 Lint + FSD pass: `pnpm lint && pnpm steiger` — 171bdc5
- [x] 2.5 Unit suite passes: `pnpm test` — 171bdc5
- [x] 2.6 Integration suite passes with the solver up — 171bdc5

#### Manual

- [x] 2.7 Studio shows the clone pending after Generate and un-pending with `delivery = 'proposal'` after delivery — 171bdc5

### Phase 3: Proposal-keyed delivery, the pending page, and the guards

#### Automated

- [x] 3.1 Type check passes: `pnpm check` — 6f406fa
- [x] 3.2 Lint + FSD pass: `pnpm lint && pnpm steiger` — 6f406fa
- [x] 3.3 Unit suite passes (strip, pending hook, notice): `pnpm test` — 6f406fa
- [x] 3.4 Integration suite passes, including `checkPlan` (both keys + precedence) and the plan-action guard cases — 6f406fa
- [x] 3.5 Production build stays clean: `pnpm build` — 6f406fa

#### Manual

- [x] 3.6 Pending proposal: progress page, catalog notice, rename refused — 6f406fa
- [x] 3.7 Proposal page delivers itself on completion; strip names the source; source shows nothing — 6f406fa
- [x] 3.8 Failed solve: source strip reports it; proposal gone from the hub — 6f406fa

### Phase 4: The hub as the notification surface

#### Automated

- [x] 4.1 Type check passes: `pnpm check` — 4112ec3
- [x] 4.2 Lint + FSD pass: `pnpm lint && pnpm steiger` — 4112ec3
- [x] 4.3 Unit suite passes (indicators, store, hub toast): `pnpm test` — 4112ec3
- [x] 4.4 Integration suite passes, including ready-after-reload and discovery-by-source-id — 4112ec3

#### Manual

- [x] 4.5 Two-tab flow: badge on source then proposal row; toast on completion; badge clears after first open — 4112ec3

### Phase 5: E2E lane + Generate spec

#### Automated

- [x] 5.1 The e2e job is green on the PR
- [x] 5.2 `pnpm test:e2e e2e/specs/generation.spec.ts` passes locally with the solver up — 67a28fe
- [x] 5.3 `mise run solver:check` still passes — 67a28fe

#### Manual

- [x] 5.4 e2e job duration stays within ~1 min of today's
