# Stop & keep (S-305) Implementation Plan

## Overview

Implement roadmap slice **S-305**: the author can stop a running generation job and keep the best
checkpointed board ("Stop & keep"), with the kept board delivered onto the proposal clone through
the existing delivery chain. Everything downstream of a `stopped` row already exists and is tested
(S-303/S-304/S-306 pre-paid the column, the status, the RLS window, the latch, the delivery
predicate, and even the strip copy) — **this slice builds the producer**: the solver-side poll that
observes `stop_requested_at`, the app-side action that writes it, and the affordance that names the
stage being kept (FR-305, US-302).

## Current State Analysis

From `context/changes/stop-and-keep/research.md` (2026-09-01, commit `750830a`), verified against
the code:

- **Database: zero migrations owed.** `stop_requested_at` exists
  (`supabase/migrations/20260810200122_generation_jobs.sql:81`), `'stopped'` is in the status CHECK
  (`:97`) and the solver's RLS `with check` (`20260810200931:99`). The solver may **SELECT** the
  flag but is deliberately **not granted UPDATE** on it (`20260820075348:16-19`) — the app writes
  the stop request; the solver only observes. Two exact-list pins police the grants
  (`src/test/solver-credential.integration.test.ts:211-217,224-236`).
- **Solver: the seam is wired, the producer is missing.** `SolveHooks.should_stop` reads
  `entry.stop.is_set` (`runner.py:252`); `registry.request_stop` latches reason-first then calls
  `stop_search()` as a speed-up (`registry.py:108-119,149-169`). `STOP_OUTCOMES` maps
  `"shutdown" → interrupted` and carries its own instruction: *"S-305's `stop_requested_at` polling
  adds `"requested" -> stopped` here and nowhere else"* (`runner.py:77-82`). Nothing reads
  `stop_requested_at` today — `JobRowClient` has no read of it, and `_Heartbeat` only renews
  `heartbeat_at` every 15 s (`runner.py:388-435`, `settings.py:53`).
- **App: no stop action exists.** `createGenerationActions` has exactly two members
  (`generation-actions.ts:19-28`); nothing anywhere writes `stop_requested_at`.
  `PendingProposalPage.tsx` already polls via `use-pending-proposal.ts` and its
  `GenerationJobView` already carries `checkpointStageIndex`/`stageIndex`/`stageName` — the
  "name the stage" obligation needs no data-layer change beyond projecting the flag itself.
- **Delivery: already built and idempotent.** `isDeliverableJob` admits a halted status with a
  checkpoint; `payloadColumn` routes halted rows to `checkpoint`
  (`job-delivery.ts:61-72`, `generation-delivery.ts:479`); two integration tests already pass
  against a hand-made `stopped` row (`generation-delivery.integration.test.ts:235,257`). A
  `stopped` row with no checkpoint is `isSweepableJob` — the clone is deleted by `settle`.
- **The honest latency is minutes, not seconds** (research C1): `should_stop` is polled only at
  improving solutions, `stop_search()` no-ops between solves, an unproductive stage burns its full
  120 s / 300 s budget, and the flag poll adds ≤15 s. Worst case click→terminal is ~5 minutes.
- **The transcript must never key the terminal status** (research C2, S-304's CRITICAL finding):
  an async latch typically leaves `stoppedBy: "budget"` or nothing, so `_stop_outcome` keys on the
  latch — this slice adds a producer and must not touch that keying.
- **Coverage hole** (research C3): every existing shutdown test fakes the solve;
  `stop_search()` from another thread against a live CP-SAT solve is wired but unproven.

## Desired End State

An author on a pending proposal page sees a **Stop & keep** button while the job is active.
Clicking it opens a confirm step that names exactly what will be kept ("the board from stage k of
10", or "nothing yet — no stage has completed") and is honest that stopping can take a few minutes.
Confirming:

- on a **queued** row: terminalises it app-side to `stopped` (no checkpoint); the next poll tick
  sweeps the clone and the page shows a neutral "you stopped this" terminal state;
- on a **running** row: writes `stop_requested_at`; within ≤15 s the solver's heartbeat observes
  it, fires the latch with reason `"requested"`, `stop_search()` interrupts the live solve, the
  ladder breaks, and the worker writes `status='stopped'` with an author-facing error naming the
  kept stage. The pending page's next tick delivers the checkpoint onto the proposal and navigates
  to the board — the same path a succeeded job takes;
- while the stop is pending, the page shows a **"Stopping…"** state and the button is disabled;
- if the solve finishes first (race, C6), the author simply gets the full board — no error;
- if the container is dead (C5), the reclaim sweeps the row to `interrupted` after the grace, and
  the copy (not the status) tells the honest story.

Verify: solver suite green including two new tests (poll→latch→`stopped`, live `stop_search()`),
app integration tests green for the three stop outcomes, `pnpm check`/lint/steiger/build green, and
a manual end-to-end stop against `mise run solver:dev`.

### Key Discoveries:

- `progress` already PATCHes with `Prefer: return=representation` + `select=id`, filtered
  `status=eq.running`, and never raises (`supabase.py:175-209`) — widening the projection to
  `id,stop_requested_at` delivers the flag in the same round-trip as the heartbeat: no new request,
  no new thread, no new grant, and a terminal row simply stops answering.
- `registry.request_stop` is idempotent (first-writer-wins latch) and safe from another thread —
  `stop_search()` is lock-guarded (`registry.py:149-169`; measured returning in 0.00 s).
- `_stop_error` hardcodes the prefix "interrupted by …" (`runner.py:354-365`) — a `stopped` row
  would render "interrupted by …", and `interrupted` is a sibling status with a different meaning.
  This string reaches the author through `GenerationJobView.error`.
- Every field that joins the poll snapshot must join `sameView` too
  (`use-pending-proposal.ts:119-133`) or the equality gate silently defeats republishing (research
  C11, F5 of `extract-share-polling-store`).
- `GenerationStatusStrip.haltedSummary` (`:176-179`) says "Stopped" for **interrupted** jobs — the
  vocabulary was written for S-305 and is mildly wrong for S-304's case; the wedged-label decision
  (keep `interrupted`, true up copy) makes fixing it part of this slice.
- The app-side terminalise write is legitimate: `authenticated` holds table-wide UPDATE with
  `using(true) with check(true)` and the CHECK admits `stopped`. There is no per-author ownership
  anywhere in this database (C14) — copy must not imply one.
- The stopped-no-checkpoint sweep deletes the very plan the pending page renders; that is exactly
  what the existing failed-job path already does from this page, so the terminal-panel behaviour is
  consistent, not new.

## What We're NOT Doing

- **No migrations, no wire-contract change, no delivery change.** The chain is untouched;
  `formatVersion` stays 1.
- **No hub affordance and no hub projection widening.** The pinned 10-key indicator list
  (`generation-status.integration.test.ts:230-241`) stays exactly as it is. The hub keeps showing
  progress; stopping happens from the pending proposal page (decision Q1).
- **No reclaim change.** A stop-requested row that wedges still lands `interrupted` (decision Q4);
  S-304's reclaim CAS and its tests are untouched.
- **No solver-side claim-CAS change.** The queued case is handled app-side (decision Q2).
- **No edits to applied migrations.** The future-tense S-305 comments in
  `20260820075348_solver_progress_select_grants.sql` are a historical record and stay.
- **No measured latency number in shipped copy** (decision Q5) — the copy is budget-derived and
  qualitative; the live-solve test asserts a ceiling but its number is never quoted.
- **No push/Realtime, no un-stop, no per-author ownership claims.**

## Implementation Approach

Build outward from the solver: first the producer (Python), so a hand-written flag already
produces a correct `stopped` row; then the app write path that sets the flag; then the affordance
that calls it; then the doc true-ups the diff falsifies. Each phase leaves `main` shippable — an
earlier phase without the later ones is dead code behind no UI, never a broken state.

Two inherited rules govern the whole slice:

1. **The latch is the signal, never the transcript** (S-304). The new producer only ever fires
   `registry.request_stop`; `_stop_outcome`'s keying is not touched.
2. **The stop write has exactly one legitimate actor: the author's own authenticated request**
   (S-304 refused both session-free credentials; the solver is barred at the grant layer).

## Critical Implementation Details

- **`progress`'s never-raises contract must survive its widening.** It is called from inside the
  engine's stage hook on the solving thread; any escape kills a healthy solve. The new return value
  (the matched row, or `None`) must be produced inside the existing try/except, and a malformed
  body must degrade to `None`, not raise.
- **Fire the latch at most once per job.** The heartbeat keeps beating after the flag is seen (the
  row is still `running` until the worker's terminal write); `request_stop` is idempotent, but the
  heartbeat should still remember it has fired and not re-invoke `stop_search()` every 15 s while
  the ladder winds down.
- **Order of the two app writes matters.** Try the `queued → stopped` CAS first, then fall back to
  the flag write filtered to active statuses. Done the other way round, a queued row would get a
  flag nothing will ever poll (the claim CAS doesn't consult it) and then be terminalised anyway —
  two writes where one suffices, and a confusing audit trail.
- **`sameView` must gain the new field in the same commit as the projection** (C11) — a
  `stopRequestedAt` that changes without republishing means the "Stopping…" state never renders.
- **The confirm copy is live.** The dialog reads `checkpointStageIndex` from the polled snapshot,
  so the named stage can advance while the dialog is open — that is correct behaviour (the copy
  always names what would actually be kept), not a bug to suppress.
- **Existing SIGTERM error strings must not change.** `test_service.py` exercises the
  `interrupted` branch; deriving the new prefix from `StopOutcome.status` keeps
  "interrupted by container shutdown: …" byte-identical while yielding
  "stopped by …" for the new reason.

---

## Phase 1: Solver — the stop producer

### Overview

Make the solver observe `stop_requested_at` and terminalise as `stopped`, using only the existing
latch. Four small edits plus the two tests the research names — including the genuinely missing
live-solve `stop_search()` test (C3).

### Changes Required:

#### 1. `progress` returns the row it matched, carrying the flag

**File**: `services/solver/src/cpsat_service/supabase.py`

**Intent**: Deliver `stop_requested_at` to the caller in the same round-trip as the heartbeat —
no new request, no new thread, no new grant (the solver's SELECT grant already covers the column,
and the exact-list pin at `solver-credential.integration.test.ts:211-217` stays green).

**Contract**: `progress(job_id, payload)` changes its projection from `select=id` to
`select=id,stop_requested_at` and its return type from `None` to `dict[str, Any] | None` — the
matched row, or `None` when the write matched nothing or failed. The never-raises contract and the
matched-nothing WARNING are preserved verbatim; the stage-reporter call site in `runner.py`
ignores the return value. Update the module/method docstrings that describe the old shape.

#### 2. `_Heartbeat` fires the latch when the flag appears

**File**: `services/solver/src/cpsat_service/runner.py`

**Intent**: The 15 s heartbeat becomes the stop poll's cadence. When a beat's returned row carries
a non-null `stop_requested_at`, fire `registry.request_stop(job_id, REQUESTED_REASON)` — which
latches, publishes the reason, and `stop_search()`es the live solver. The worker thread then
terminalises through the existing latch-keyed path; the heartbeat itself never writes status.

**Contract**: `_Heartbeat.__init__` gains a way to fire the stop — a
`request_stop: Callable[[], bool]` callback closed over the registry at the construction site in
`run_job` (keeps `_Heartbeat` decoupled from `JobRegistry`). `_beat` invokes it at most once
(local flag), on the first beat whose returned row has `stop_requested_at` non-null. The callback
must be exception-proof from the timer thread's point of view (the registry's `request_stop`
already is).

#### 3. The `"requested" → stopped` outcome, and an honest error prefix

**File**: `services/solver/src/cpsat_service/runner.py`

**Intent**: Map the new reason to the `stopped` status (the one-line change the comment at
`runner.py:77-79` prescribes), and fix the author-facing bug (research C9): `_stop_error`'s
hardcoded "interrupted by …" prefix would misname a `stopped` row.

**Contract**: A `REQUESTED_REASON: Final = "requested"` constant beside `SHUTDOWN_REASON`;
`STOP_OUTCOMES` gains `REQUESTED_REASON: StopOutcome(status="stopped", cause="the author")`.
`_stop_error` derives its leading word from `stop.status` instead of the literal — the
`interrupted` rendering stays byte-identical ("interrupted by container shutdown: …"), and the new
row reads "stopped by the author: the solve was stopped after stage k (…) — the board kept is the
last completed stage's checkpoint, not a finished ladder".

#### 4. Solver tests

**Files**: `services/solver/tests/test_service.py` (or a sibling), `services/solver/tests/test_stage_stop.py`

**Intent**: Prove the two things nothing proves today. (a) Wrapper-level: a heartbeat whose
`progress` response carries the flag ends the job as `stopped` — with `stages`, without `result`,
with the "stopped by the author" error. (b) Engine-level, the C3 hole: `request_stop` fired from
another thread against a **real live CP-SAT solve** interrupts it promptly and the incumbent
checkpoint survives — the first test of the actual `stop_search()` mechanism.

**Contract**: (a) follows the existing fake-client pattern (`test_service.py`'s SIGTERM tests):
the fake's `progress` returns a row with `stop_requested_at` set after N beats, and the assertion
is on the `finish` call's `status`/`error`/absent `result`. Note `test_service.py:887` already
pins first-recorded-reason-wins with `"requested"` as the second reason — it must stay green.
(b) runs the real engine on a golden fixture with a stage budget generous enough that an
un-stopped solve would demonstrably run longer, fires `request_stop` mid-stage from the test
thread once `on_solver` has attached a handle, and asserts the solve returns well inside the
budget with the prior checkpoint intact. Its measured latency is an assertion ceiling only —
never copy.

#### 5. Comment true-ups (solver side)

**Files**: `services/solver/src/cpsat_service/registry.py`, `runner.py`, `supabase.py`

**Intent**: The diff falsifies the future-tense S-305 comments in all three modules
(`registry.py:18-20`, `runner.py:77-79`, `supabase.py:186-188`); true them up in the same commit
(lessons.md: a doc that names a mechanism is coupled to it).

**Contract**: Prose only — "will fire"/"S-305 adds" becomes present tense describing the two
producers as they now exist.

### Success Criteria:

#### Automated Verification:

- Full solver suite green: `cd services/solver && uv run pytest`
- New wrapper-level test passes: flag observed via heartbeat → terminal `stopped` write with stages, no result
- New live-solve test passes: `request_stop` interrupts a real CP-SAT solve promptly; incumbent checkpoint survives
- Strict typing and lint green: `uv run mypy` and `uv run ruff check`

#### Manual Verification:

- `mise run solver:dev` against the local stack: dispatch a job, `update generation_jobs set stop_requested_at = now()` mid-solve via Studio/psql, observe the row land `stopped` with the new error text within one heartbeat interval + the current stage's tail

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 2: App — the stop write path

### Overview

One new domain function + action + client wrapper, and the flag joins the pending page's
projection. No UI yet — the action is callable and integration-tested.

### Changes Required:

#### 1. The `stopGeneration` domain function

**File**: `src/_pages/plan-detail/api/generation-stop.ts` (new)

**Intent**: The single legitimate stop writer (decision Q2): terminalise a queued row app-side, or
request a stop on a running one. Framework-free, throws `DomainError`, following the
Actions-as-single-transport lesson and the newspaper order of the sibling files.

**Contract**: `stopGenerationInput = z.object({ jobId: z.uuid() })`;
`stopGeneration(supabase, input)` returns a discriminated outcome the UI can narrate:

```ts
type StopGenerationResult = { outcome: "stopped" | "stopping" | "already-finished" };
```

Two writes, in order, both with `.select("id")` so a matched-nothing is observable (the standing
PostgREST 204 rule):

1. CAS `update({ status: "stopped", error: <author-stopped-before-start text>, finished_at, stop_requested_at }).eq("id", jobId).eq("status", "queued")`
   → matched: `"stopped"`. The row is `isSweepableJob`; the next `checkPlan` visit sweeps the
   clone through the existing `settle` branch — this function does not touch `plans`.
2. Fallback: `update({ stop_requested_at }).eq("id", jobId).eq("status", "running")` — never
   `queued`: the CAS just failed to match `queued` and no transition returns a row there, while a
   flag on a queued row would be exactly the write-into-a-void C4 warns about
   → matched: `"stopping"`; matched nothing: `"already-finished"` (the C6 race — benign, never an
   error).

A failed write (not a lost CAS) throws `DomainError("INTERNAL_SERVER_ERROR", …)`.

#### 2. Wire the action and the client

**Files**: `src/_pages/plan-detail/api/generation-actions.ts`,
`src/_pages/plan-detail/api/generation-client.ts`, `src/_pages/plan-detail/api/index.ts` (if the
barrel enumerates exports)

**Intent**: Third member of the generation family. No injected dependency — stopping never talks
to the solver, only to the row.

**Contract**: `stopGeneration: defineDomainAction({ input: stopGenerationInput, run: stopGeneration })`
inside `createGenerationActions`; a `stopGeneration(jobId)` wrapper in `generation-client.ts` via
`callActionData`, with a docblock stating the ≤15 s + current-stage-tail latency honestly.

#### 3. The flag joins the view

**Files**: `src/_pages/plan-detail/api/generation-delivery.ts`,
`src/_pages/plan-detail/model/generation/use-pending-proposal.ts`

**Intent**: The pending page needs to render "Stopping…" across ticks and reloads, so the poller
must project the flag — one narrow, payload-free column, consistent with the projection
discipline.

**Contract**: `stop_requested_at` joins `STATUS_COLUMNS`, `StatusRow`, and `GenerationJobView`
(as `stopRequestedAt: string | null`, mapped in `toView`); `sameView` gains
`a.stopRequestedAt === b.stopRequestedAt` **in the same commit** (C11).

#### 4. Integration tests

**File**: `src/_pages/plan-detail/api/generation-stop.integration.test.ts` (new)

**Intent**: Pin the three outcomes and the sweep interplay, built through `src/test/factories/`
with `teardown`, mirroring the delivery suite's style.

**Contract**: (a) stop on a hand-made `queued` row → `outcome: "stopped"`, row terminal with
`checkpoint_stage_index` null, and a subsequent `checkPlan` sweeps the clone (the
stopped-no-checkpoint branch the research says is handled-but-untested); (b) stop on a `running`
row → `outcome: "stopping"`, `stop_requested_at` set, status untouched; (c) stop on a terminal
row → `outcome: "already-finished"`, row untouched. Also assert the queued-CAS loses cleanly to a
row already `running` (falls through to the flag write).

### Success Criteria:

#### Automated Verification:

- Unit suite green: `pnpm test`
- New integration suite green: `pnpm test:integration src/_pages/plan-detail/api/generation-stop.integration.test.ts`
- Existing delivery + credential pins stay green: `pnpm test:integration src/_pages/plan-detail/api/generation-delivery.integration.test.ts src/test/solver-credential.integration.test.ts` (a red credential pin means a grant was widened — a wrong turn, per research)
- Types and lint: `pnpm check` (after `astro sync`) and `pnpm lint`

#### Manual Verification:

- None beyond Phase 1's — this phase has no UI; the action is exercised by tests

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 3: UI — the affordance and the vocabulary

### Overview

The Stop & keep button with its confirm step on the pending proposal page, the "Stopping…" state,
and the stopped/interrupted copy true-up in the strip and the pending page's terminal panel.

### Changes Required:

#### 1. Stop & keep on the pending proposal page

**File**: `src/_pages/plan-detail/ui/PendingProposalPage.tsx` (+ a small extracted component if it
keeps the file readable)

**Intent**: The affordance (decision Q1/Q3): a button in the active-job panel that opens a confirm
step naming exactly what will be kept, then calls the client's `stopGeneration(job.jobId)`.
Satisfies FR-305's Socrates obligation at the moment of decision.

**Contract**: Uses `AlertDialog` from `@/shared/ui` and semantic theme tokens only. States, all
derived from the polled `GenerationJobView` (no local status mirror beyond the in-flight call):

- **Active, no stop requested**: button visible. Confirm copy branches on `checkpointStageIndex`:
  - `k !== null`: "Keep the board from stage k of 10 — the stage now running is discarded."
  - `null`: "No stage has completed yet — stopping now keeps nothing."
  plus the budget-derived latency line (decision Q5): stopping is not immediate — the solver
  finishes reacting within a few minutes; the page updates on its own.
- **Stop requested, still active** (`stopRequestedAt !== null`): button replaced by a disabled
  "Stopping…" indicator; `stageLabel` line stays (the in-flight stage genuinely continues).
- **Delivered while stopping** (C6): nothing special — the existing `onDelivered` navigation
  simply lands the full board.
- The action's `"already-finished"`/`"stopped"` outcomes need no dedicated UI: the next tick's
  snapshot tells the truth; the click handler only needs to surface a thrown `DomainError`
  (sonner toast or inline line, matching the page's existing failure tone).

The confirm copy reads the **live** snapshot — a stage completing while the dialog is open
correctly updates the named stage.

#### 2. The terminal panel learns the author's own act

**File**: `src/_pages/plan-detail/ui/PendingProposalPage.tsx`

**Intent**: A `stopped` row with no checkpoint currently renders the destructive "This generation
ended without a board" panel — wrong tone for something the author did on purpose.

**Contract**: The terminal branch distinguishes `job.status === "stopped"` with a neutral (non
destructive) panel: "You stopped this generation before any stage finished — nothing was kept."
(A stopped row *with* a checkpoint never renders here — it delivers and navigates.)

#### 3. Strip vocabulary true-up (decision Q4)

**File**: `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx`

**Intent**: The strip currently says "Stopped" for **interrupted** jobs. With `stopped` gaining a
real producer, the two must read differently: the author's act vs the platform's.

**Contract**: `haltedSummary` and the halted-no-checkpoint source branch take the status (or a
`stopped: boolean`) and split the vocabulary: `stopped` → "Stopped early — kept the board from
stage k of 10." / "You stopped this generation — nothing was kept."; `interrupted` → "Interrupted
— kept the board from stage k of 10." / "Generation was interrupted before any stage finished —
nothing was kept." The docblock's "A cancel button is still S-305's" line is trued up.

### Success Criteria:

#### Automated Verification:

- Types, lint, structure, build: `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build`
- Unit suite green: `pnpm test`
- Generation E2E stays green: `pnpm test:e2e e2e/specs/generation.spec.ts` (with `mise run solver:dev` up and `SOLVER_URL` in the built `.dev.vars`, per README) — the spec drives the very page this phase restructures

#### Manual Verification:

- Against `mise run solver:dev` + `pnpm build && pnpm preview`: Generate, open the pending
  proposal, stop mid-run → confirm names the current checkpoint stage, "Stopping…" appears, the
  board lands on the proposal within the promised window, and the strip on the delivered proposal
  reads "Stopped early — kept the board from stage k of 10."
- Stop immediately after Generate (queued / no stage completed) → confirm says nothing will be
  kept; after confirming, the pending page reaches the neutral "You stopped this generation"
  terminal state and the clone is swept from the hub
- Let a stop race completion (stop during the last stage of a short fixture) → the full board
  arrives with no error surfaced
- Both themes: dialog, button, and panels use semantic tokens only

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 4: Docs & drift sweep

### Overview

The diff falsifies at least eight in-code comments and two foundation-doc entries that name S-305
as future work (research C8/C12). S-303 gated this class with a grep in its success criteria —
copy that.

### Changes Required:

#### 1. Foundation docs true-up

**Files**: `context/foundation/prd.md`, `context/foundation/roadmap.md`

**Intent**: (decision Q6) FR-305's "mirroring the greedy path's existing cancel semantics" cites
an affordance S-301 deleted — restate the semantics from the checkpoint model. The roadmap's
S-305 entry overstates the stop mechanism ("records `stoppedBy: "cancelled"` and the ladder
breaks out" is true only for the predicate-observed path) and implies immediacy the mechanism
does not have.

**Contract**: Prose edits only; no renumbering (the ID series is append-only). FR-305 drops the
greedy-mirror clause in favour of the shipped semantics (author-requested stop → `stopped` row →
checkpoint delivery; the affordance names the stage). Roadmap S-305: correct the mechanism
sentence (the latch is the signal; `stoppedBy` in the transcript is informational), note the
honest latency, flip **Status** to `done` when the slice lands.

#### 2. App-side comment sweep

**Files**: `src/entities/timetable/model/generation/job-delivery.ts` (the S-305 hand-off note),
`src/entities/timetable/model/generation/job-status.ts` (":16-18 — `stopped` and `interrupted`
have no producer yet", stale for both), `src/_pages/plan-detail/ui/chrome/GenerateButton.tsx`
(the epitaph's "a stop path … is S-305's"), plus any hit the grep below surfaces.

**Intent**: Same rule as Phase 1's solver sweep — present tense, producers named as they exist.

**Contract**: Prose only. Applied migrations under `supabase/migrations/` are explicitly left
untouched (historical record).

#### 3. Change close-out

**File**: `context/changes/stop-and-keep/change.md`

**Intent**: Reflect reality as phases land.

**Contract**: `status` and `updated` maintained per the change-folder convention.

### Success Criteria:

#### Automated Verification:

- Grep gate: `grep -rn "S-305" src services contracts supabase --include='*' | grep -v supabase/migrations` returns only lines whose prose is historical/past-tense — no remaining "will/owns/future" claims about this slice
- Full local gate green: the `/verify` skill (sync → check → lint → steiger → test → build)

#### Manual Verification:

- Read the updated FR-305 and roadmap S-305 entries against the shipped behaviour — no clause
  promises immediacy or cites the deleted greedy affordance

---

## Testing Strategy

### Unit Tests (solver):

- Wrapper-level stop: fake client's `progress` returns the flag after N beats → `finish` called
  with `status="stopped"`, the new error prefix, `stages`, no `result`
- `_stop_error` prefix derivation: `interrupted` rendering byte-identical; `stopped` rendering
  names the author and the kept stage
- Existing pins stay green: first-recorded-reason-wins (`test_service.py:887`), all SIGTERM tests

### Unit Tests (engine — the C3 test):

- Live `stop_search()`: real solve on a golden fixture, `request_stop` from the test thread
  mid-stage → returns well inside the stage budget, incumbent checkpoint intact, latch-keyed
  outcome. The measured time is an assertion ceiling, never copy.

### Integration Tests (app):

- `generation-stop.integration.test.ts`: queued→stopped CAS + subsequent sweep; running→flag
  write; terminal→benign; queued-CAS losing to a claim falls through to the flag write
- Existing suites unchanged and green: `generation-delivery` (the two stopped-row delivery tests
  now describe a real producer), `solver-credential` (grant pins), `generation-status` (hub
  projection untouched)
- Note the standing flake: the integration lane is ~1-in-5 red under `--maxWorkers=2` on `main`
  already — judge failures against that baseline, not this diff

### Manual Testing Steps:

1. Phase 1: flag a live solve by SQL; watch the row land `stopped`
2. Phase 3: the three end-to-end scenarios listed in its Manual Verification
3. Theme pass over the new dialog/panels

## Performance Considerations

None material. The stop poll adds zero requests (piggybacked on the existing heartbeat PATCH);
`stop_requested_at` is a scalar column joining an already-narrow projection; the pending page's
poll cadence is unchanged. FR-312 is untouched — no polling surface gains a board.

## Migration Notes

No schema changes. Rollout is safe in either order at runtime, but ship as one change: an app
without Phase 1 writing flags is harmless (nothing polls them — today's behaviour), and a solver
with Phase 1 but no writer never observes a flag. Do not merge to `main` mid-solve (standing
README rule — the deploy replaces the container).

## References

- Research: `context/changes/stop-and-keep/research.md` (the challenge register C1–C15 drives this plan)
- Roadmap S-305: `context/foundation/roadmap.md:181-198`; PRD FR-305 `context/foundation/prd.md:356-364`, US-302 `:260-269`
- The latch-not-transcript rule: `context/archive/2026-08-20-job-aware-container-lifecycle/plan.md:206-218`
- The delivery down-payment: `src/entities/timetable/model/generation/job-delivery.ts:51-64`
- The one-line map: `services/solver/src/cpsat_service/runner.py:77-82`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Solver — the stop producer

#### Automated

- [ ] 1.1 Full solver suite green: `cd services/solver && uv run pytest`
- [ ] 1.2 New wrapper-level test passes: flag observed via heartbeat → terminal `stopped` write with stages, no result
- [ ] 1.3 New live-solve test passes: `request_stop` interrupts a real CP-SAT solve promptly; incumbent checkpoint survives
- [ ] 1.4 Strict typing and lint green: `uv run mypy` and `uv run ruff check`

#### Manual

- [ ] 1.5 SQL-flagged live solve lands `stopped` with the new error text within one heartbeat + stage tail

### Phase 2: App — the stop write path

#### Automated

- [ ] 2.1 Unit suite green: `pnpm test`
- [ ] 2.2 New integration suite green: `pnpm test:integration src/_pages/plan-detail/api/generation-stop.integration.test.ts`
- [ ] 2.3 Existing delivery + credential pins stay green
- [ ] 2.4 Types and lint: `pnpm check` and `pnpm lint`

### Phase 3: UI — the affordance and the vocabulary

#### Automated

- [ ] 3.1 Types, lint, structure, build: `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build`
- [ ] 3.2 Unit suite green: `pnpm test`
- [ ] 3.3 Generation E2E stays green: `pnpm test:e2e e2e/specs/generation.spec.ts`

#### Manual

- [ ] 3.4 End-to-end stop mid-run: confirm names the stage, "Stopping…" shows, checkpoint board delivered, strip reads "Stopped early — kept the board from stage k of 10"
- [ ] 3.5 Stop while queued/no stage: confirm says nothing kept; neutral terminal state; clone swept
- [ ] 3.6 Stop racing completion delivers the full board with no error
- [ ] 3.7 Both themes: semantic tokens only on the new dialog/button/panels

### Phase 4: Docs & drift sweep

#### Automated

- [ ] 4.1 Grep gate: no remaining future-tense "S-305" claims outside `supabase/migrations/` and archives
- [ ] 4.2 Full local gate green via `/verify`

#### Manual

- [ ] 4.3 FR-305 + roadmap S-305 read true against shipped behaviour
