# Generation Deletion Integrity Implementation Plan

## Overview

Two independent fixes to plan-deletion aftermath, both misreports of `generation_jobs` state:

- **D2**: deleting a **delivered proposal** must not flip its `succeeded` job to `failed` and show the
  source plan a red "Generation failed" for a solve that worked.
- **The stranded orphan**: deleting a **source** whose job is stale-`running` must not leave the clone
  `pending_proposal = true` forever, rendered as "still being generated" with nothing that will ever
  generate it.

Diagnosis, reproduction, and fix direction are settled in `research.md` (verified against HEAD
`ff609de` during planning). No migration is needed: the `delivery` column — written atomically with
`delivered_plan_id` by `markDelivered` and immune to the `ON DELETE SET NULL` FK — is the durable
"was delivered" fact both fixes lean on.

## Current State Analysis

From `research.md` plus planning-time verification:

- `delivered_plan_id` conflates a fact ("did it deliver?") with a link ("where?"). The FK's
  `SET NULL` erases both, so `isDeliverableJob` (`src/entities/timetable/model/generation/job-delivery.ts:35-40`)
  becomes true again for a delivered-then-deleted job, and the next source visit re-enters `deliver()`,
  hits the null-proposal branch (`src/_pages/plan-detail/api/generation-delivery.ts:268-273`) and calls
  `failJob`. Reproduced on the local stack 2026-08-31.
- **Verified beyond the research**: the corrupted row also **blocks deleting the source** today —
  `assertNoActiveJob` (`src/_pages/plans-list/api/pending-guards.ts:74-77`) finds it via
  `jobs.find(isDeliverableJob)` and refuses with *"open the proposal to deliver it first"* — a proposal
  that no longer exists. The `delivery` fix resolves this for free, but `GuardJobRow` and its select
  must gain the column.
- **Verified during plan review**: the hub's badge surface is a FIFTH consumer, and it reads the raw
  columns, not the predicate. `surfacedJobsFor` (`src/_pages/plans-list/api/generation-status.ts:88-91`)
  surfaces "terminal but undelivered" rows via `and(delivered_plan_id.is.null,status.in.(succeeded,interrupted,stopped))`,
  and `toGenerationIndicator` derives `delivered` from `delivered_plan_id !== null` — so the
  delivered-then-deleted row would badge the SOURCE "Finished — open to deliver" forever (its
  `proposal_plan_id` is nulled too, so the href falls back to the source). Today the false `failed`
  flip is what hides that row from this filter; Phase 1 removes the flip and would expose it, trading
  one permanent misreport for another unless the surface learns the `delivery` fact (change 6).
- **Verified**: `isDeliverableJob` is broader than "succeeded" — it also admits halted-with-checkpoint
  rows. The `delivery === null` conjunct covers both arms; a delivered-then-deleted `interrupted` job
  is neither deliverable nor sweepable after the fix, and both roles render correctly (see UX spec below).
- The flipping visit's view carries `error: null` (the row is spread as read, before `failJob` wrote),
  so the strip's first render is a bare "Generation failed." with no reason.
- The orphan: `plan_id` cascades, so deleting a source past `HEARTBEAT_GRACE_MS` takes the job row,
  and the clone's `pending_proposal` is never cleared. `proposalIsReleasable`
  (`pending-guards.ts:106-114`) made the orphan *deletable* but not *usable*.
- **Verified**: the route (`src/pages/plans/[id]/index.astro`) conflates two nulls — `checkPlan`
  returning null cleanly ("no job row by either key") and the `.catch` coercing a thrown check to null.
  The orphan release must only fire on the first.
- **Verified**: the enqueue path (`src/_pages/plan-detail/api/generation-job.ts`) flags the clone
  pending one round-trip **before** inserting the job row, so "pending + no job row" is also a
  transient mid-enqueue state — and, if the process dies in that window, yet another cause of a
  permanent orphan. A creation-age grace closes the race and the lazy release heals that cause too.

## Desired End State

- Deleting a delivered proposal leaves its job row untouched: `status='succeeded'`,
  `delivery='proposal'`, `delivered_plan_id=null`. The source plan's strip shows **nothing** (the
  documented delivered behavior), the source remains deletable, and in an A→B→C chain, B keeps its
  "Generated from A" provenance strip after C is deleted.
- A pending proposal that no job references becomes an ordinary plan on its next visit: the route
  clears `pending_proposal` (silently, per decision) and renders the board it holds.
- The `deliver()` null-proposal branch (still reachable for genuinely undelivered jobs whose clone
  vanished out-of-band) reports its reason on the same visit that fails the job.

Verify: new integration cases green in `pnpm test:integration`, plus the manual walkthrough below.

### Key Discoveries:

- `delivery` is already in `STATUS_COLUMNS` and `StatusRow` (`generation-delivery.ts:117,125`) — the
  delivery-side fix changes no query shape.
- `stalenessCutoff(nowMs)` (`src/entities/timetable/model/generation/job-staleness.ts:57`, exported
  via the entity barrel) is a ready-made helper for the release's age guard, and reusing
  `HEARTBEAT_GRACE_MS` keeps "old enough to be dead" defined once.
- The source strip already renders `null` for a non-active, non-failed, non-halted-empty job
  (`GenerationStatusStrip.tsx` final return), so D2's post-fix source view (succeeded, undelivered
  shape) needs no strip change.
- `plans.created_at` exists (`20260602185012_minimal_domain_schema.sql:95`), so the release can be one
  guarded UPDATE with no extra reads.

## What We're NOT Doing

- **No migration.** `delivery` stays as-is; a rename to `delivered_at` was considered and declined.
- **No `DeletePlanDialog` proposal count.** Considered (research open question 4) and declined —
  deletion stays the sanctioned low-friction cleanup act.
- **No notice on orphan release.** Silent, per decision — no job row exists to hang a notice on, and
  the clone's `Proposal — <source>` name carries the residue.
- **No eager clear at delete time.** The lazy visit-time release covers that cause and every other one.
- **No E2E.** Integration asserts both defects far cheaper; E2E's critical path is ~444 s.
- **Not touching** the source-deletion-loses-provenance behavior for delivered proposals — dismissed
  as correct in research §4; do not re-raise.

## Implementation Approach

Phase 1 makes the shared predicates consult the durable `delivery` fact, which defuses D2 at every
consumer at once (settle, both hub guards, pickJob — and, with one shape-aware edit, the hub's
badge surface) — exactly the single-source-of-truth argument
`job-delivery.ts`'s own docstring makes. Phase 2 adds a narrow, race-safe release for the orphan and
untangles the route's two nulls so it knows when releasing is safe. The phases share no files and are
independently shippable.

## Critical Implementation Details

### Timing & lifecycle

The orphan release must never match a plan mid-enqueue: `markPending` runs one round-trip before
`insertJob` (`generation-job.ts:141-155`), so "pending + no job row" is transiently true during every
Generate. The release is therefore one guarded UPDATE — `pending_proposal = true` **and**
`created_at < stalenessCutoff(Date.now())` — never an unconditional clear. A genuine orphan is always
old enough (its source's deletion required a job stale past the same grace); a mid-enqueue clone is
seconds old and never matches.

### State sequencing

In the route, the release must run **before** the existing `settled` re-read
(`index.astro`, the `isPendingProposal(summary)` re-read), so the same visit that heals the orphan
renders its board. The release is best-effort (caught and logged) like the check itself — a failed
release renders today's pending panel, never a 500.

### User experience spec

After D2's fix, the delivered-then-deleted job renders as: **source role** — nothing (falls to the
strip's final `return null`, matching the documented "once it delivers, the source says nothing");
**proposal role** — unreachable (the proposal is deleted). Do not add a strip state for it. The view's
`delivered` derivation (`delivered_plan_id !== null`) stays as-is: changing it would re-trigger
`markNotified` paths for a plan that no longer exists.

## Phase 1: D2 — the `delivery` discriminator

### Overview

Teach the delivery predicates that a job which has delivered once can never be deliverable again,
regardless of what foreign keys later null. Kills the false-failure flip, unblocks source deletion,
and preserves provenance precedence.

### Changes Required:

#### 1. The shared predicate

**File**: `src/entities/timetable/model/generation/job-delivery.ts`

**Intent**: `isDeliverableJob` must require that the job has never delivered. Add
`delivery: string | null` to `DeliverableJobRow` and conjoin `row.delivery === null` into
`isDeliverableJob`. `isSweepableJob` is unchanged (a delivered job is never `failed`/halted-empty by
this path). Update the file's docstring: its stated failure mode ("a deliberate delete of a ready
proposal…") now extends to the delivered case, which the old text explicitly scoped out.

**Contract**: `DeliverableJobRow` gains `delivery: string | null`; `isDeliverableJob` returns false
whenever `delivery !== null`. Both existing consumers pass rows that already carry the column after
change 3 below.

#### 2. Predicate unit tests

**File**: `src/entities/timetable/model/generation/job-delivery.test.ts` (new)

**Intent**: The predicates have no co-located unit tests today. Cover: succeeded+undelivered is
deliverable; halted+checkpoint+undelivered is deliverable; `delivery='proposal'` with
`delivered_plan_id=null` is NOT deliverable (the D2 row shape, for both succeeded and interrupted
statuses) and NOT sweepable; failed / halted-empty sweepable arms unchanged.

**Contract**: plain Vitest unit suite beside the implementation, per repo convention.

#### 3. Hub guards read the column

**File**: `src/_pages/plans-list/api/pending-guards.ts`

**Intent**: `GuardJobRow` gains `delivery: string | null` and `jobsWhere`'s select string gains
`delivery`, so `assertNoActiveJob` and `proposalIsReleasable` evaluate the fixed predicate correctly.
No logic change beyond the shape.

**Contract**: the select in `jobsWhere` and the `GuardJobRow` type — one column added to each.

#### 4. `pickJob` precedence

**File**: `src/_pages/plan-detail/api/generation-delivery.ts`

**Intent**: A delivered-then-deleted job must not outrank the provenance job. In `pickJob`, the
source-job-wins test becomes "active, or genuinely undelivered": conjoin `asSource.delivery === null`
with the existing `asSource.delivered_plan_id === null`. Extend the precedence docblock's rule 1 to
say why (`delivered_plan_id` can be re-nulled by the FK; `delivery` is the durable fact).

**Contract**: `pickJob` only — `StatusRow` already carries `delivery`.

#### 5. The null-proposal branch reports its reason

**File**: `src/_pages/plan-detail/api/generation-delivery.ts`

**Intent**: The branch stays reachable for genuinely undelivered jobs whose clone vanished
out-of-band, and its first-visit view must not render a bare "Generation failed." Hoist the reason
string to a const used by both the `failJob` call and the returned view's spread
(`{ ...row, status: "failed", error: reason }`).

**Contract**: the returned `GenerationJobView.error` is non-null on the same visit that fails the job.

#### 6. The hub badge surface reads the `delivery` fact

**Files**: `src/_pages/plans-list/api/generation-status.ts`, `src/_pages/plans-list/model/plan-indicators.ts`

**Intent**: Without this, Phase 1 trades one permanent misreport for another (see Current State
Analysis). Two edits, one per read path. Server side: `STATUS_COLUMNS` (the hub's own, in
`generation-status.ts`) gains `delivery`, and `surfacedJobsFor`'s second arm gains `delivery.is.null`
— a delivered-then-deleted row is not "waiting for a visit to land it". Mapping edge:
`GenerationJobStatusRow` gains `delivery: string | null`, and `toGenerationIndicator` returns null
for rows with `delivery !== null && delivered_plan_id === null` — the same "drop rather than cast"
house rule the unrecognized-status branch already applies. The mapping-edge guard is what heals
`refreshKnown`, which is unfiltered by design: an already-open hub tab tracking the jobId stops
badging on its next tick, no reload needed. Do NOT drop on `delivery` alone — a delivered-but-
unnotified row (`delivered_plan_id` set) is legitimate "Ready — open" material.

**Contract**: `GenerationJobStatusRow` gains `delivery: string | null`; `toGenerationIndicator`
returns null for the delivered-then-deleted shape; `surfacedJobsFor` never returns it.

#### 7. Integration coverage

**Files**: `src/_pages/plan-detail/api/generation-delivery.integration.test.ts`,
`src/_pages/plans-list/api/plan-actions.integration.test.ts`

**Intent**: Pin the fixed behavior where the defect was reproduced:

- delivery suite: deleting a delivered proposal then visiting the source leaves the row
  `succeeded`/`delivery='proposal'` (no flip), the view is source-role and non-failed, and a second
  visit reports the same (stickiness of the *fix*);
- delivery suite (beside the existing "BOTH" precedence pair at `:371`/`:409`): A→B→C — B's delivered
  proposal C is deleted; a visit to B still resolves the provenance job (proposal role, "generated
  from A");
- delivery suite: an undelivered job whose clone is deleted out-of-band fails with `error` populated
  on the same visit's view;
- plan-actions suite (beside the source-deletion trio at `:270-296`): deleting the SOURCE is ALLOWED
  after its delivered proposal was deleted;
- generation-status suite (`generation-status.integration.test.ts`): a delivered-then-deleted row is
  NOT surfaced by `surfacedJobsFor`; a delivered-but-unnotified row still is;
- `plan-indicators.test.ts`: the delivered-then-deleted shape maps to null (no badge); a
  delivered-unnotified row still maps with `delivered: true`.

**Contract**: fixtures follow the suites' existing builder/teardown patterns; terminal rows written
the way the existing delivered-row cases write them.

### Success Criteria:

#### Automated Verification:

- Unit suite passes: `pnpm test`
- New + existing integration cases pass: `pnpm test:integration` (local Supabase running)
- Types, lint, structure clean: `pnpm check`, `pnpm lint`, `pnpm steiger`
- Build stays clean: `pnpm build`

#### Manual Verification:

- On the local stack (`pnpm build && pnpm preview`, solver up): generate from a plan, deliver the
  proposal (visit it), delete the proposal from the hub — the source plan shows **no** generation
  strip and **no** failure, on first visit and after refresh.
- The source plan can then be deleted without the "open the proposal to deliver it first" refusal.
- The plans hub shows NO badge for the source after the delivered proposal is deleted — including in a
  hub tab that was already open when the deletion happened (next poll tick clears it).

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding to Phase 2. Checkbox state lives in `## Progress` below.

---

## Phase 2: Orphan release — lazy, on visit

### Overview

A pending proposal that no job references becomes an ordinary plan on its next visit — finishing the
thought `proposalIsReleasable` started: an orphan must be recoverable without SQL, not merely
disposable.

### Changes Required:

#### 1. The release function

**File**: `src/_pages/plan-detail/api/release-orphan-proposal.ts` (new), exported from
`src/_pages/plan-detail/api/index.ts`

**Intent**: One guarded UPDATE that un-pends a plan only when it is both still pending and old enough
that "no job row" cannot mean mid-enqueue. Loud on database error (mirrors `clearPending`'s
rationale: the failure mode is a stranded plan, not litter); the *route* decides to soften it.
Docstring must state the precondition (caller has established no job references the plan) and why the
age guard exists (the `markPending`→`insertJob` window, and process death inside it — which this
release also heals, after the grace).

**Contract**:

```ts
// update plans set pending_proposal = false
//   where id = ? and pending_proposal = true and created_at < stalenessCutoff(Date.now())
releaseOrphanProposal(supabase, planId): Promise<void>
```

The `created_at` predicate is the race guard — do not weaken it to an unconditional clear.

#### 2. The route distinguishes its two nulls and releases

**File**: `src/pages/plans/[id]/index.astro`

**Intent**: Track whether `checkPlan` threw (a `checkFailed` flag set in the existing `.catch`).
When the summary arrived pending, the check returned null **cleanly**, call
`releaseOrphanProposal` — best-effort, caught and logged like the check itself — **before** the
existing `settled` re-read, so the same visit renders the board. No markup changes: the re-read
observes the cleared flag, `pending` goes false, and the ordinary board path runs.

**Contract**: the release fires only on `summary` pending ∧ `generationJob === null` ∧ `!checkFailed`;
a thrown release degrades to today's pending panel, never a 500.

#### 3. Integration coverage

**File**: `src/_pages/plan-detail/api/release-orphan-proposal.integration.test.ts` (new)

**Intent**: Pin the release semantics: clears a pending plan whose `created_at` is backdated past the
grace; does NOT clear a freshly created pending plan (the enqueue race); and the end-to-end orphan
path — source + pending clone + stale-`running` job, `deletePlan(source)` goes through (implied by
`assertNoActiveJob`'s stale bypass, but unpinned until now — the existing stale-deletion case at
`plan-actions.integration.test.ts:259` covers the PROPOSAL side only), job row is gone, release
un-pends the clone.

**Contract**: builds state via `src/test/factories/` and cleans up via `teardown`, like its siblings;
backdates `created_at` with a direct update on the plan row.

### Success Criteria:

#### Automated Verification:

- New integration suite passes: `pnpm test:integration` (local Supabase running)
- Types, lint, structure clean: `pnpm check`, `pnpm lint`, `pnpm steiger`
- Build stays clean: `pnpm build`

#### Manual Verification:

- On the local stack: generate from a plan, kill the solver mid-solve, backdate the job's
  `heartbeat_at` past 5 minutes (SQL), delete the source plan, then open the proposal — after the
  grace it renders as an ordinary board (the source's pins), not the "still being generated" panel.
- A freshly generated pending proposal still renders the progress page (release did not fire early).

---

## Testing Strategy

### Unit Tests:

- `job-delivery.test.ts`: the predicate truth table, including the D2 row shape for both `succeeded`
  and `interrupted` statuses.
- `plan-indicators.test.ts`: the delivered-then-deleted shape yields no indicator; delivered-unnotified
  still does.

### Integration Tests:

- Delivery suite: no-flip on delivered-proposal deletion; A→B→C provenance survival; error populated
  on the null-proposal failure visit.
- Plan-actions suite: source deletable after its delivered proposal is deleted.
- Release suite: age-guarded clear, race non-clear, end-to-end orphan heal.

### Manual Testing Steps:

1. Phase 1 walkthrough: generate → deliver → delete proposal → source shows nothing, twice.
2. Phase 1: delete the source afterwards — allowed.
3. Phase 2 walkthrough: strand an orphan (stale job + source delete) → visit proposal → board renders.
4. Phase 2 race check: a just-generated pending proposal still shows the progress page.

## Performance Considerations

The release adds zero reads to any visit: it is one conditional UPDATE, fired only on the
already-rare "pending plan, no job row, check didn't throw" path. The `delivery` column was already
in every relevant projection. The <200 ms drag-drop budget is untouched (no board-path code changes).

## Migration Notes

None. No schema change; existing corrupted rows (any `status='failed'` + `delivery='proposal'` from
past D2 flips on dev/hosted data) are not repaired by this change — they no longer render as failures
only if re-written by hand; acceptable since no production data predates this fix's deploy, per the
repo's "no production data to preserve yet" stance.

## References

- Related research: `context/changes/generation-deletion-integrity/research.md`
- The predicate and its docstring: `src/entities/timetable/model/generation/job-delivery.ts:35-40`
- The flip chain: `src/_pages/plan-detail/api/generation-delivery.ts:212-215,230,268-273`
- The guards: `src/_pages/plans-list/api/pending-guards.ts:74-77,106-114`
- The enqueue window: `src/_pages/plan-detail/api/generation-job.ts:141-155`
- The route's null conflation: `src/pages/plans/[id]/index.astro`
- Prior adjacent fixes: `context/archive/2026-08-25-drift-decided-delivery/reviews/plan-review.md` (F2, F3)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: D2 — the `delivery` discriminator

#### Automated

- [x] 1.1 Unit suite passes: `pnpm test` — 1c15302
- [x] 1.2 New + existing integration cases pass: `pnpm test:integration` (local Supabase running) — 1c15302
- [x] 1.3 Types, lint, structure clean: `pnpm check`, `pnpm lint`, `pnpm steiger` — 1c15302
- [x] 1.4 Build stays clean: `pnpm build` — 1c15302

#### Manual

- [x] 1.5 Generate → deliver → delete proposal: source shows no strip and no failure, on first visit and after refresh — 1c15302
- [x] 1.6 Source plan deletable afterwards without the "deliver it first" refusal — 1c15302
- [x] 1.7 Hub shows no badge for the source after its delivered proposal is deleted, including an already-open tab — 1c15302

### Phase 2: Orphan release — lazy, on visit

#### Automated

- [x] 2.1 New integration suite passes: `pnpm test:integration` (local Supabase running)
- [x] 2.2 Types, lint, structure clean: `pnpm check`, `pnpm lint`, `pnpm steiger`
- [x] 2.3 Build stays clean: `pnpm build`

#### Manual

- [x] 2.4 Stranded orphan (stale job + source delete) renders as an ordinary board on visit
- [x] 2.5 A just-generated pending proposal still shows the progress page (release did not fire early)
