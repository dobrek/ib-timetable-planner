---
project: ib-timetable-planner
version: 1
status: draft
created: 2026-07-16
context_type: brownfield
product_type: web-app
target_scale:
  users: small
timeline_budget:
  delivery_weeks: 8
  hard_deadline: null
  after_hours_only: true
---

# PRD — IB Timetable Planner (post-POC CP-SAT solver service)

> Brownfield change PRD, generated from `context/foundation/shape-notes.md`
> (2026-07-16), shaped from the GO verdict of the `poc-cp-sat-backend-service`
> POC. Seed: `context/changes/post-poc-cp-sat-refactoring-plan/research.md`
> (2026-07-16, incl. four follow-up rounds). The prior change PRD (post-demo
> feedback) is archived at `context/foundation/archive/2026-07-16-prd.md`.

## Current System Overview

> Baseline this change is described against. May name real technologies — it
> describes reality, not a stack choice. Grounded in the live codebase and the
> 2026-07-16 research (commit `23d0cfa`).

**Purpose.** An interactive IB timetable editor: a plan author drags compatible
course groupings onto a two-cohort (DP1/DP2) slot grid with live, sub-200 ms
constraint validation, then persists placements atomically to Supabase.

**Architecture & stack.** Astro + React 19 islands on Cloudflare Workers
(workerd), Supabase (Postgres, Frankfurt) for persistence, TypeScript. FSD
layers; all app-data mutations and compute go through thin Astro Actions. The
pure two-cohort constraint core lives in `src/entities/timetable/`.

**Users.** A few Plan Authors at one IB liceum; email + password, single
`Author` role, deny-by-default middleware.

**Generation today — client-side only.**

- The only generation engine is a **TS greedy engine running in a browser Web
  Worker** (20 s budget, FR-016 of the archived prior PRD). There is no server-side generation endpoint;
  the only server round-trip is the persist step.
- The integration seams were deliberately left open for a second engine: the
  engine-agnostic `GeneratePlan` port (diagnostics pre-model `engine: "cp-sat"`,
  `provenOptimal`, `lowerBound`, `stopReason`), the `runVerifiedGeneration`
  runner seam (built "for a possible HTTP/CLI runner later"), the
  `verifyGeneration` oracle that judges every engine's output, and the atomic
  `apply_generated_placements` RPC. Apply-time re-verify plus a catalog drift
  guard mean a bad or stale board cannot reach the database.
- Greedy's measured ceiling: 5–8 h left unplaced per cohort and 217 teacher
  gaps against the ≤ 148 expert bar. Quality investment is past diminishing
  returns (the tuning change's own conclusion).

**The POC asset.** `poc/cp-sat/` — a uv-managed Python package
(`cpsat_engine`, or-tools CP-SAT, ~1,300 LOC + ~750 LOC tests) proven by the
POC: Mode A closes the golden residue (OPTIMAL/SAT in 0.7 s on an M4, complete
oracle-verified board, 0 h unplaced both cohorts, 95 teacher gaps); Mode B
repairs small residues in ~0.75 s; a 10-tier lexicographic quality ladder with
an exact 10/10 parity gate against the TS objective. Transport-agnostic by
design — only `cli.py` is throwaway. Verdict: **GO**.

**What does NOT exist today (all net-new for this change):** any async-job /
polling / status pattern in the app; any Cloudflare bindings (no KV/DO/Queues —
`wrangler.jsonc` is 15 lines); any job table in the database; any CI lane for
Python or a container; solve-to-target stopping or progress emission in the
Python package (it is solve-to-budget, batch-only).

**De-facto monorepo.** The repo already hosts the pnpm app at root plus the uv
package at `poc/cp-sat/`, invisible to all JS gates by design;
`pnpm-workspace.yaml` declares no packages.

## Problem Statement & Motivation

**The gap.** By the product's stated value function, **the complete
full-quality-ladder board is the valuable deliverable** — a valid-but-incomplete
board is worth much less. The greedy engine cannot deliver it (5–8 h unplaced,
217 teacher gaps vs the ≤ 148 bar), and further greedy investment is past
diminishing returns. The POC proved CP-SAT delivers exactly this deliverable —
complete, oracle-verified, quality-optimized boards — but only as a local
file-transport experiment on an Apple Silicon M4. There is no production path:
no server-side generation, no async-job surface, no container deploy lane.

**The change.** Promote the POC package into a production solver service
(Cloudflare Container attached to the existing Worker), give the app its first
async-job muscle (durable job rows in Supabase, polling, proposal-based
delivery), make CP-SAT the engine of record, and — gated on calibration —
retire the greedy engine and its Web Worker path entirely.

**Why now (three reinforcing insights, locked in shaping):**

1. **The POC delivered the GO the seams were waiting for.** Across four prior
   changes, the port, the runner seam, the oracle, and the atomic RPC were
   built in anticipation of a second engine. The service is the payoff of that
   discipline, not a retrofit.
2. **The platform matured just in time.** Cloudflare Containers went GA
   (2026-04) on the plan the project already pays for: standard-4 instance,
   EEUR pinning next to Supabase Frankfurt, scale-to-zero, ~$15/month at peak
   planning season (restated 2026-08-17 — see the cost envelope below).
3. **The value function was reframed.** Greedy's output lost its product value
   the day the POC returned GO; keeping it is operational cost, not product
   value — which is why deletion belongs inside this migration.

**Scope decision (locked):** this is **one change covering the full
migration** — PRD amendment, package promotion + service transport,
contract/jobs schema, app integration (proposal flow), deploy lane,
calibration campaign on production hardware, and the calibration-gated greedy
retirement. It is simultaneously a new module, an engine-of-record migration,
an architectural improvement (monorepo formalization, container deploy lane),
and a significant user-facing feature (the proposal flow).

## User & Persona

**Primary persona — Plan Author (unchanged).** A teacher/admin at one IB
liceum producing the year's timetable; a few such authors. No new persona and
no scale change.

What changes for them is the *generation experience*: instead of a 20-second
local draft that leaves hours unplaced, they kick off a solve job against a
snapshot of their plan, keep editing freely (no locking), watch quality accrue
stage by stage, may stop early and keep the best board so far, and receive a
complete proposal to compare against and adopt deliberately.

## Success Criteria

### Primary

A plan author can obtain a **complete, oracle-verified, quality-optimized
board** as a reviewable proposal, produced by a production CP-SAT solver
service, without ever losing the freedom to edit. The change has succeeded
when, working from an existing plan:

1. The author starts a CP-SAT solve with a policy choice (clean mode as the
   shipped default), and the app clones the plan as the proposal
   target, snapshots the clone, records a durable job, and kicks the solver
   container — **the live plan is never locked**.
2. While the job runs, the author keeps editing freely; the source plan shows
   an advisory "proposal in progress from <time> state" indicator.
3. Progress accrues **stage by stage**; every completed stage checkpoints a
   complete board **never worse-ranked** than the last, and the author can
   **Stop & keep** the best board so far (mirroring the existing cancel
   semantics). _(Trued up 2026-08-20 with S-303: read "strictly better" as
   "never worse". Each stage hardens `tier_k <= best_k`, so a later stage can
   never undo an earlier one — but a stage that finds no improvement leaves the
   ranking unchanged, which is a legitimate and common outcome, not a failure.)_
4. On completion the author is notified and **decides delivery**: they review
   the oracle-verified board and either merge it into the source or keep it as
   a separate plan. The drift check **gates and informs** that decision — an
   unchanged source makes merging a single confirmation; a drifted source is
   named, and merging is offered only where the board still verifies against
   the source as it now stands.
   _(Re-grounded 2026-08-28 with S-306's frame. Was: "the drift check decides
   delivery — an unchanged source is auto-updated … a changed source leaves the
   result as a new plan … (with dominance information)". Two premises expired.
   Auto-apply was introduced at shaping to remove a manual "Apply to source"
   affordance the prior recommendation had proposed — but the author reports
   that reviewing every 12–20 minute board before it touches their plan **is the
   point, not a cost**, so the automation removes a step they want and would
   fire on the majority of runs (they also report leaving the source untouched
   during a solve, making the "unchanged" branch the common one). And
   "dominance information" moved to S-307, which already claims it. The drift
   check itself survives, demoted from decider to gate-and-advisor, so F-301's
   frozen hash semantics stand. See `context/changes/drift-decided-delivery/frame.md`.)_
5. A job survives the author closing the laptop: job state is durable; on
   return the finished proposal is there.
6. Operationally: merge to main ships app + solver through the one pipeline; a
   **calibration campaign on the production instance** has set budgets/targets
   and gated the switch; CP-SAT is the default generate path; the greedy
   engine and its Web Worker path are deleted.

### Secondary

- The author can launch a run with a **dedicated policy** (e.g. clean mode,
  `softHits ≡ 0`) and is **notified on completion — at minimum in-app — with
  the result information**, so "kick it off and walk away" works without
  watching a progress bar. (Email delivery is a possible extension, per the
  research's Phase 6 list.) Nice-to-have, not sufficient alone.

### Guardrails

- **Editing is never blocked by generation.** No plan-level locking at any
  point; the proposal-clone model is the mechanism that keeps this true.
- **The oracle remains the sole trust boundary.** `verifyGeneration` +
  apply-time re-verify + catalog drift guard gate every board from any engine;
  `apply_generated_placements` stays the only write path. A bad or stale board
  must never reach the database — regardless of what the container returns.
- **The <200 ms drag-drop validation budget holds** — this change adds no work
  to the interactive validation path.
- **Generation keeps working throughout the build.** Greedy remains the
  working Generate path until the calibration gate passes and the proposal
  flow ships; deletion never precedes the replacement being deployed and
  calibrated.
- **PII posture preserved.** The dump is UUID-only by construction; names
  never reach the solver.

**Non-functional guardrails.** Each is outside-observable; mechanism is
downstream. Numbers marked *(calibration)* are set by the production
calibration campaign, never tuned locally on the M4.

- **Validation responsiveness (preserved).** Drag-drop validation outcome
  visible within ≤ 200 ms p95 — this change adds no work to that path.
- **Fast solves stay interactive.** A completeness (Mode A) or small-repair
  (Mode B) answer returns within single-digit seconds on production hardware
  *(calibration; expected ~2–4 s)*. Exceeding the interactive budget falls
  back to the background job.
- **The full ladder is an honest background job.** The UI communicates a
  realistic ceiling *(calibration; order of ~12–20 minutes for full polish)*
  and shows stage-by-stage progress — never an indefinite spinner.
- **Job durability.** No job or progress is lost to browser close, container
  sleep, crash, or deploy; on interruption at most the in-flight stage is
  lost — every completed stage is recoverable.
- **Outcome reproducibility.** Delivered board quality is defined by targets
  (a property of the catalog), not wall-clock (a property of hardware); two
  runs to the same targets are comparable even when their paths differ.
- **Cost envelope.** Solver compute **~$15/month** at peak planning season
  and ~cents off-season (scale-to-zero), on the already-paid plan.
  > Restated 2026-08-17 (S-302). The original ≈$7 reproduces exactly ($7.11)
  > under its stated input of a 5-minute solve: the arithmetic was sound, the
  > input was overtaken by F-302's measured ~12.5-minute full-catalog solve,
  > which puts it at $14.63. The PRD's own 20-minute ceiling would be $22.15.
  > S-302's `sleepAfter: 30m` stopgap adds roughly $5/month of idle billing;
  > lowering it trades against cold starts on a ~394 MB image.
- **Privacy (preserved).** Student and teacher names never leave the app; the
  solver receives opaque UUIDs only.

## User Stories

> Delta-framed — each notes what was different before.

### US-301: Generate a complete proposal while continuing to edit

- **Given** an author on an existing plan with residual unplaced hours
- **When** they start a CP-SAT job (default clean-mode policy), keep editing
  the source plan freely, and return after the ladder completes
- **Then** — their edits having drifted the source — the result is held as a
  complete, oracle-verified, quality-optimized board they review before
  anything is applied; the source plan is intact including their edits; they
  compare the two on the existing comparison page, are told the source drifted,
  and either keep the result as a separate plan or merge it deliberately

> Before: generation was a 20-second local greedy draft that left 5–8 h
> unplaced, ran only while the tab stayed open, and overwrote nothing safely —
> there was no proposal concept.

### US-302: Stop & keep at "good enough"

- **Given** a running job that has completed quality tier k of the ladder
- **When** the author stops it mid-run ("Stop & keep")
- **Then** the best completed-stage board — complete and oracle-verifiable —
  is delivered onto the proposal clone rather than discarded; the remaining
  tiers are simply left unpolished

> Before: cancelling greedy kept its best-so-far only in browser memory; a
> long solve had no notion of accrued, keepable progress.

### US-303: Unchanged source merges in one confirmation

- **Given** a running job whose source plan receives no edits during the solve
- **When** the job completes and the author opens the result
- **Then** they are told the source is unchanged, so the board they are looking
  at is exactly the board that was solved for: merging it into the source is a
  single confirmation with nothing to reconcile, and the atomic RPC applies it
  in their own request — no ceremony beyond the one act of saying yes; had the
  source drifted, the drift would be named and merging offered only if the
  board still verifies against the source as it now stands

> Before: the drift guard existed only in the bench import experiment; there
> was no automated delivery path at all.

> _Re-grounded 2026-08-28 with S-306's frame._ Was: "Unchanged source is updated
> automatically … applied atomically to the source plan **without further
> ceremony**". The story's shape survives — the clean case should be
> frictionless — but its mechanism does not: the author confirms rather than
> being informed after the fact. The old Given/When was also unsound, because
> "receives no edits **during the solve**" did not determine the branch: the
> drift window ran to whenever delivery actually fired, which is not job
> completion. Confirmation closes that window at the moment the author acts.

## Scope of Change

> Each item is delta-categorized: `[new]` didn't exist, `[modified]` existing
> behaviour changes, `[preserved]` must keep working unchanged. FR identifiers
> carry over from shaping; `> Socrates:` blockquotes record the strongest
> counter-argument considered and its resolution.

### Generation jobs

- [new] FR-301: Author can start a CP-SAT generation job on a plan: the app
  settles unsaved board state, clones the plan as the proposal target,
  assembles the snapshot from the clone server-side, records a durable
  generation job, and dispatches it to the solver service. Priority: must-have.
  > Socrates: Counter-arguments considered: settle-on-start as a surprising
  > side effect; clone-per-job plan proliferation; server-side assembly vs
  > optimistic client state. Resolution: stands as written — settle-then-clone
  > is the smallest mechanism that makes the snapshot authoritative and the
  > drift guard meaningful.
- [new] FR-302: Author chooses the solve policy when launching a job — **clean
  mode (`softHits ≡ 0`) as the shipped default**, with the canonical
  lexicographic order and the teacher/student trade-off dial as selectable
  alternatives. Priority: must-have.
  > Socrates: Challenge **accepted (revised)**: clean mode must be the
  > default, since it produced the most valued output (the POC's clean board
  > dominated the canonical campaign board). Resolution: FR updated — clean
  > mode is the shipped default; canonical order remains selectable. This
  > resolves the research's open question on the production default policy.
- [new] FR-303: The solve runs Mode A (complete the board) then the staged
  quality ladder under the chosen policy, stopping stages by target
  (solve-to-target) with budget ceilings; after each completed stage the
  incumbent board + objective tuple is durably checkpointed, so an interrupted
  or stopped job still yields the best completed board. Priority: must-have.
  > Socrates: Counter-arguments considered: target thresholds are premature
  > before Phase 5 calibration; per-stage checkpoint churn. Resolution: stands
  > — calibration sets the target *values*, but target-stopping as the
  > strategy is locked (hardware-independence), and checkpoints are what make
  > a 20-minute job stoppable and SIGTERM-safe.
  > Trued up 2026-08-20 (S-303 shipped): "objective tuple" overstated what the
  > solver can produce mid-ladder and is read here as **the board plus the
  > per-stage best/bound the ladder actually holds**. A true 10-tuple is not a
  > by-product of a stage — it needs a separate `evaluate_board` re-solve over
  > the incumbent — so it is not stored, and the checkpoint is a full
  > `GenerationResult` (the same shape the terminal write uses) rather than a
  > board-plus-tuple. The rest of the requirement shipped as written: the
  > machinery for target-stopping is in, gated behind `SOLVER_STAGE_TARGETS`
  > and empty by default, with the *values* still S-308's to measure — which
  > is exactly the split this Resolution locked.
- [new] FR-304: Author can observe a running job from the app — status,
  current stage, progress — by polling the durable job record; the plans list
  shows a job badge; job state survives browser close and container sleep.
  Priority: must-have.
  > Socrates: Counter-argument **accepted (noted, not revised)**: "polling is
  > inferior to push." Resolution: polling ships in this change (simplest thing
  > that works on a durable row at this scale); push — Supabase Realtime or
  > container WebSocket forwarding — is recorded as the acknowledged upgrade
  > if polling UX disappoints. Routed to the Forward block.
- [new] FR-305: Author can stop a running job and keep the best checkpointed
  board ("Stop & keep"), mirroring the greedy path's existing cancel
  semantics; the affordance states exactly what will be kept — the last
  *completed* stage's board, not the in-flight stage. Priority: must-have.
  > Socrates: Counter-argument **accepted (refined)**: "mid-stage semantics
  > are confusing — authors may believe they kept more progress than they
  > did." Resolution: kept, with a UX obligation added — the stop affordance
  > must name the stage of the board being kept.
- [new] FR-306: A result is imported onto any plan only after passing the
  oracle. Review happens on **every** delivery (FR-307), and the review surface
  is the **existing plan-comparison page** — no new side-by-side surface is
  built. The author reaches it from the completed job, is shown whether the
  source drifted from the solved snapshot, and concludes there. Priority:
  must-have.
  > Socrates: Counter-argument **accepted (refined)**: rather than a new
  > side-by-side review UX, reuse the comparison page the product already
  > has. Resolution: FR updated — the existing comparison page is the review
  > surface; dominance info joins it as context.
  > Re-grounded 2026-08-28 (S-306 frame): **the dominance clause moves to
  > FR-302/S-307**, which already claims it ("boards are dominance-checked
  > before presentation"). Three findings. No dominance code exists at any
  > layer, and the wire contract explicitly excludes the objective tuple it
  > would need (`contracts/generation-wire.schema.json:180`) — so it is net-new
  > capability, not reuse. The comparison page is *built* to refuse machine
  > judgement — "it reports; it never judges", restated in five files and
  > physically enforced by every metric formatting to a finished string — so
  > the clause reversed a recorded architectural principle. And the author
  > reports that what makes them confident is **looking at the board**, not a
  > ranking, so it is not load-bearing for this decision. Dominance belongs
  > where competing policies make it bite: S-307. What FR-306 gains instead is
  > narrower and was missing: a route in from the completed job, and a signal
  > for snapshot drift — the page's existing drift banner is provably silent on
  > a source-vs-proposal pair, because it fingerprints the catalog and a
  > board-only edit does not move it.
- [new] FR-307: **The author decides delivery, and the drift check gates the
  decision.** When a job completes the author is notified and reviews the
  oracle-verified board. They may **merge** it into the source via the atomic
  RPC, or **keep** it as a separate plan. Before offering merge the app
  re-derives the source's snapshot digest and compares it to the one recorded
  at dispatch: **unchanged** → merging is a single confirmation, the board
  being exactly what was solved for; **changed** → the drift is named, and
  merge is offered only where the board still passes the oracle against the
  source as it now stands. Nothing is applied without an author action, so
  every write runs inside their own authenticated request. Priority: must-have.
  > Socrates: Challenge **accepted (reshaped)**: instead of a manual "Apply
  > to source" affordance, completion-time drift detection decides delivery —
  > unchanged source ⇒ replace (auto-apply); changed source ⇒ the solution
  > stands as a new plan. Locked follow-up: auto-apply with clone cleanup and
  > notification; post-hoc inspection remains available via the comparison
  > page.
  > **Re-grounded 2026-08-28 (S-306 frame) — the above resolution is retired
  > and the manual affordance it deleted is restored.** The reshape rested on
  > the premise that a confirmation step is a cost worth automating away. The
  > author reports the opposite: reviewing a 12–20 minute board before it
  > touches their plan **is the point**. They also report leaving the source
  > untouched during a solve, so the "unchanged" branch is the common one —
  > meaning auto-apply would have fired on most runs, doing the unwanted thing
  > on the hot path rather than at an edge. Note what the reshape replaced: the
  > prior recommendation was a manual "Apply to source" gated by this same
  > drift check (`context/changes/post-poc-cp-sat-refactoring-plan/research.md:292`),
  > and the reshape was recorded in one sentence with no stated benefit. The
  > PRD's own persona line, PSC #5 and the roadmap's north star had continued
  > to describe author-decides throughout.
  > **What this buys.** Auto-apply was the sole claimant on the expensive half
  > of the slice: a session-free **write** identity — refused twice by name
  > during S-304 as a credential-posture violation — plus the must-have case
  > for a completion clock, the TOCTOU exposure of re-hashing then blind
  > region-replacing, and the reason the digest's dropped `isOptional` field is
  > a safety hole rather than a curiosity. All four collapse to "a machine
  > writes to the author's live plan with no human in the request", and all
  > four leave with it. What remains and is *raised* in importance: the review
  > path is now 100% of runs, and it currently has no route in, no drift signal
  > on this pair, and no act to conclude with. See
  > `context/changes/drift-decided-delivery/frame.md`.
- [new] FR-308: While a job runs, the source plan shows an advisory "proposal
  in progress from <time> state" indicator; one job per source plan is active
  at a time; editing is never blocked. Priority: must-have.
  > Socrates: Counter-arguments considered: one-job-per-plan blocks parallel
  > policy runs; advisory-only indicator under-informs. Resolution: stands as
  > written — the single-job limit is the simplest concurrency model and can
  > be lifted later (per-job container instances make parallel runs cheap).
- [new] FR-309: Author is notified on job completion with the result
  information — in-app when the app is open, and by **email** to match the
  "kick it off and walk away" usage of a 20-minute job. Priority: nice-to-have.
  > Socrates: Counter-argument **accepted (extended)**: "in-app-only misses
  > the walk-away case — email is the notification that actually matches the
  > workflow." Resolution: email joins the FR (was: a later extension);
  > priority stays nice-to-have — the durable job row and auto-apply delivery
  > carry the must-have path.
  > Re-grounded 2026-08-28 (S-306 frame): the resolution's "auto-apply delivery
  > carries the must-have path" is retired with FR-307's automation — the
  > must-have path is now the durable job row plus author-confirmed delivery.
  > The FR is otherwise **unchanged and its email half gets sharper**: with the
  > author in the loop on every result, the notification is what tells them a
  > decision is waiting, so it carries more weight than when delivery could
  > complete itself. Two consequences for S-310. Its stated dependency on S-306
  > still holds — S-306 creates the completion/notification event, and that
  > event must be durable (`generation_jobs.notified_at` exists and is unused)
  > and channel-agnostic rather than a render, or S-310 has nothing to extend.
  > But the walk-away case still needs something that fires with no tab open,
  > and that survives FR-307's retirement as **S-310's** problem, not S-306's —
  > materially cheaper now, because a notifier needs only a read-only identity
  > where auto-apply needed a write one.

### Solver service

- [new] FR-310: The solver service (promoted `cpsat_engine` + HTTP wrapper)
  accepts solve jobs over HTTP, runs with a pinned worker count, writes
  per-stage status/results to the database over HTTPS, and is tested at the
  wrapper level (the untested-CLI lesson). Priority: must-have.
  > Socrates: Counter-arguments considered: two DB write paths (app via
  > Actions, solver direct); FastAPI heavier than two endpoints need.
  > Resolution: stands as written — direct durable writes survive container
  > sleep; the framework choice is a plan-phase detail.
- [new] FR-311: The container's lifecycle is job-aware: activity renewal
  prevents scale-to-zero mid-solve; the stop path persists the latest
  checkpoint and marks the job interrupted on SIGTERM. Priority: must-have.
  > Socrates: Counter-arguments considered: sleepAfter > max job length as
  > the simpler dodge; SIGTERM handler redundant next to per-stage
  > checkpoints. Resolution: stands as written — job-aware lifecycle is a
  > correctness requirement.
  > Re-grounded 2026-08-17 (S-302): the original justification cited
  > containers#162, which was **closed 2026-05-12** and fixed in
  > `@cloudflare/containers` v0.2.2 by in-flight request tracking. FR-311 is
  > unaffected, because the durable reason is the platform's own statement
  > that it "does not guarantee that any container instance will run for any
  > set period of time" — and because the wedged-`running`-row problem is
  > ours, not Cloudflare's. S-302 ships `sleepAfter: 30m` as a stopgap above
  > the 20-minute job ceiling; it is not a lifecycle, and S-304 still owns
  > activity renewal, SIGTERM checkpointing and widening the claim CAS.

### Preserved behaviour & migration

- [preserved] FR-312: Existing interactive editing, drag-drop validation
  (< 200 ms), and all board views keep working unchanged — generation adds no
  work to the interactive validation path. Priority: must-have.
  > Socrates: Counter-argument considered: "preserved is aspirational until
  > measured — polling and job UI land on the plan-detail island."
  > Resolution: stands as a hard guardrail; the NFRs carry the measurable
  > commitment.
- [preserved] FR-313: Every generated board — from any engine — reaches the
  database only through oracle verification, apply-time re-verify, and the
  atomic `apply_generated_placements` RPC; the oracle runs **server-side in
  the job delivery pipeline** (the relocated `runVerifiedGeneration` seam), so
  headless delivery (auto-apply, FR-307) is verified without a browser open.
  Priority: must-have.
  > Socrates: Counter-argument **accepted (pinned)**: "where the oracle runs
  > is unspecified — client-only verification can't serve headless delivery."
  > Resolution: oracle execution pinned to the server-side job pipeline; the
  > trust boundary is unchanged, its location is now explicit.
  > Re-grounded 2026-08-28 (S-306 frame): **"headless" was never defined here,
  > and the two readings it admits are not two implementations of one
  > requirement.** The *location* clause — the oracle runs server-side, not in
  > client JS — is the operative one, and S-301 shipped it
  > (`generation-delivery.ts:185`); this FR is satisfied on that reading and
  > should not be re-planned. The stronger reading the roadmap drew from it
  > ("no browser needs to be open") was carrying FR-307's auto-apply, which is
  > now retired — so the clause "so headless delivery (auto-apply, FR-307) is
  > verified without a browser open" loses its subject. **Read it as: the
  > oracle runs in the delivery pipeline rather than the browser, so
  > verification cannot be bypassed by a client.** A trigger that fires with no
  > tab open is no longer owed by this FR; the only survivor of that
  > requirement is FR-309's notifier, which needs a **read-only** identity, not
  > a write one.
- [modified] FR-314: CP-SAT is the default Generate path — S-301 shipped it,
  and the greedy Web Worker machinery it orphaned has since been deleted
  (`clean-up-bench-generation`), so the Generate button has no greedy path
  left to fall back to. What remains of the retirement is the greedy ENGINE
  itself, which stays in the entity layer, reachable only from its own unit
  tests and the `bench/` experiments, until its preconditions are met:
  clique-bound derivation extracted, a CP-SAT regression baseline pinned and
  executable, and hint-free Mode A measured. Priority: must-have.
  > Socrates: Counter-arguments re-tested: deletion is one-way vs freeze; a
  > slipping retirement could stall the close-out. Resolution: stands — the
  > research's 14:20 follow-up already weighed both; deletion stays inside the
  > migration, gated only on calibration + the proposal flow shipping.

### Dev & ops

- [new] FR-315: A maintainer ships app + solver with one merge to main: a
  solver verify job (ruff + mypy + pytest + audit) joins the CI gate, and the
  deploy job builds/pushes the container image alongside the Worker. Priority:
  must-have.
  > Amended 2026-08-17 (S-302): "path-filtered" removed. Measurement did not
  > support it — the four test jobs run in parallel, so the critical path is
  > `e2e` at ~426 s while the solver job is 44 s; filtering saves billed
  > minutes and zero wall clock. It would also require rewriting `deploy`'s
  > `if:` gate to tolerate skipped jobs, and the `always()` form that does so
  > disables the implicit success check on all four needs at once — on the
  > only job that touches production. `contracts/**` is cross-cutting besides.
  > Accepted cost: the image build runs on every merge. The escape lever is
  > GHA Docker layer caching, never path filters.
  > Socrates: Counter-arguments considered: app releases coupled to Docker
  > builds; deliberate narrow-token posture quietly widening. Resolution:
  > stands — one gate-then-deploy lane matches the single-author load; the
  > exact token scopes stay in Open Questions.
- [new] FR-316: A developer runs the full stack locally at three fidelity
  tiers — native solver (uvicorn) via the env-gated `SOLVER_URL` transport,
  linux/amd64 image smoke, `wrangler dev` with the real container binding —
  orchestrated by mise (toolchain pins + cross-ecosystem tasks; pnpm scripts
  stay the JS-side canon). Priority: must-have.
  > Socrates: Counter-arguments considered: three tiers over-engineered for
  > one developer; mise tasks duplicating pnpm scripts. Resolution: stands —
  > the tiers document what already exists rather than adding machinery, and
  > the grain rule keeps pnpm the JS-side canon.
  > Confirmed 2026-08-17 (S-302): all three shipped, and "`wrangler dev` with
  > the real container binding" turned out to be literally right — `wrangler
  > dev` honours `.wrangler/deploy/config.json`, so it picks up the generated
  > `dist/server/wrangler.json` and its container config, and a hidden
  > `--enable-containers` flag overrides `dev.enable_containers: false` for a
  > session. (Research had expected this to be inaccurate; it is not.) One
  > clarification the FR should carry: tiers 2 and 3 are **opt-in** and Docker
  > is not otherwise required — `pnpm dev`/`pnpm preview` never build an
  > image. A fourth mode arrived beside the tiers: a hosted-solve campaign
  > (`mise run solver:hosted`) running the native solver against the hosted
  > database, for policy comparison on real data.

## Constraints & Compatibility

- **The wire contract is frozen and parity-gated.** The dump/result contract
  (`GeneratorSnapshot`/`GenerationResult`) gets a committed tech-neutral
  schema artifact (in `contracts/`), validated against golden fixtures in
  both the TS and Python test suites; `formatVersion` gates incompatibility.
  The exact 10/10 objective-parity discipline continues.
- **Persistence path unchanged.** `apply_generated_placements` stays the only
  write path for generated boards; the existing `clone_plan` is reused for
  the proposal clone. Additive migrations only; `generation_jobs` is a new
  table with RLS + explicit grants per the least-privilege lesson.
- **Engine transition compatibility.** Generate runs CP-SAT as of S-301, and
  the greedy Web Worker path is gone; the archived prior PRD's FR-016 is amended
  engine-agnostically (an engine produces a verified board under a
  budget/target) so greedy's remaining retirement is a PRD non-event. Retirement
  preconditions for the engine itself: clique-bound derivation extracted out of
  `engines/greedy/`, a CP-SAT regression baseline pinned and executable,
  hint-free Mode A measured.
- **Runtime split.** The workerd constraint (no Node-only APIs) continues to
  bind all app code; the solver appliance is exempt by design. Container
  reality: linux/amd64 images, 4 vCPU ceiling (standard-4), outbound ports
  80/443 only — Supabase reached over HTTPS, never the Postgres wire
  protocol; region pinned EEUR next to Supabase Frankfurt.
- **Repo structure (locked in the research follow-ups).** `poc/cp-sat/`
  promotes to `services/solver/`; contract artifacts land in a new
  tech-neutral `contracts/`; the Astro app stays at the repo root — no
  `apps/` move inside this migration; no Turborepo/Nx/pnpm-workspace
  packages; `supabase/` stays root as shared infra. mise graduates to
  toolchain pins + cross-ecosystem tasks (pnpm scripts remain the JS canon).
- **Deploy posture.** The single gate-then-deploy pipeline extends (solver
  verify + container deploy step); the container receives its credential via
  Worker secrets forwarded through the Durable Object's `envVars`, and the
  Worker gains no new privilege by carrying it (the same publishable key it
  already holds, plus a password only the container ever uses); the CF API
  token broadens by exactly one account-scoped permission,
  `Containers: Edit`, alongside `Workers Scripts: Edit`.
  > Amended 2026-08-17 (S-302). Two corrections. "Path-filtered" is dropped —
  > see FR-315. And "container secrets live in container config, not the
  > Worker" is not implementable as written: Cloudflare exposes no
  > `containers[].configuration.secrets` field, and the documented channel IS
  > the Worker's own secret store, read by Worker code and passed down. The
  > *intent* — no new Worker privilege — is preserved and now stated as the
  > property rather than as a mechanism. The token scope, listed as an open
  > question, is resolved.
- **Tuning discipline.** Budgets/targets are never tuned on the M4; the
  production calibration campaign is the only source of shipped numbers and
  gates the default-path switch.
- **Auth unchanged.** Deny-by-default middleware, single Author role; job
  Actions sit behind the existing session requirement.

## Business Logic Changes

**Current rule.** The app continuously (a) validates that any proposed
placement stays collision-free for students, teachers (within and across
cohorts, week-aware), and availability — live, under 200 ms; (b) recommends
compatible course groupings; and (c) generates fill-the-gaps boards via a
greedy best-effort engine under a 20-second budget, every generated board
judged by the `verifyGeneration` oracle before persisting. This change
**replaces the generation decision rule** and **adds job-delivery rules**;
interactive validation and recommendation are untouched.

**Generation rule — modified: complete-then-optimize.** Mode A first
guarantees completeness — every required hour placed for both cohorts — then
a staged lexicographic quality ladder improves the board tier by tier under
the chosen policy. Each stage stops when it reaches its target
(solve-to-target; budget ceilings as backstop), and every completed stage
hardens its tier before the next begins, so quality accrues monotonically: an
interrupted run still holds a complete board no worse than the previous
stage. If the fast completeness solve exceeds its interactive budget, it
falls back to the background job — locked in shaping: one product behavior,
no special waiting UI.

**Policy is configuration — new.** Tier order and hard/soft split are
request-level configuration, not hidden constants: **clean mode
(`softHits ≡ 0`) is the shipped default** (locked in shaping); the canonical
lexicographic order and the teacher/student trade-off dial are selectable.
Boards are dominance-checked before presentation so a strictly-worse board is
never offered as the outcome.

**Delivery rule — new: the author decides, drift gates.** A solve result is
meaningful only against the exact snapshot it was produced from. The solve
never runs against the live plan — the live plan is never locked. On completion
the author is notified and reviews the oracle-verified board on the existing
comparison page, then either **merges** it into the source or **keeps** it as a
separate plan. The drift check runs at that moment, not to decide but to gate
and inform: **unchanged** → merging is a single confirmation; **changed** → the
drift is named, and merge is offered only where the board still passes the
oracle against the source as it now stands. No board reaches a plan except
through an author action in their own authenticated request.

_(Re-grounded 2026-08-28 with S-306's frame — was "drift decides", with an
unchanged source auto-applied. See FR-307 for the full reasoning: the author
reviews every result by preference, so the automation removed a step they want,
and it was the sole claimant on a session-free write credential the project has
twice refused.)_

**Job rules — new.** One active job per source plan; stage checkpoints are
durable; "Stop & keep" adopts the last *completed* stage. The oracle remains
the single judge of any engine's board (unchanged), now executed server-side
in the job delivery pipeline.

## Access Control Changes

**No human-facing access control changes — current model preserved.**
Authentication stays email + password; the single `Author` role is unchanged;
the deny-by-default middleware is untouched. The new job surface (start / poll
/ cancel) consists of Astro Actions behind the existing session requirement,
like every other mutation.

**One new machine principal.** The solver container authenticates to Supabase
over HTTPS to write `generation_jobs` status/results (job state lives in the
database, not in the container). Stance locked: **least privilege** — the
container gets a credential scoped as narrowly as practical, and the
`generation_jobs` table ships with RLS + explicit grants per the project's
least-privilege lesson. The concrete credential/role/grants design is deferred
(see Open Questions).

## Non-Goals

**New scope boundaries locked for this change:**

- **Off-Cloudflare hosting.** Cloud Run / Fly.io remain escape hatches,
  considered only if calibration proves the 4-vCPU ceiling genuinely binding.
  The image stays host-portable by construction, but no second platform is
  built or operated.
- **`apps/` repo restructure.** The Astro app stays at the repo root;
  role-named satellites (`services/`, `contracts/`, future `tools/`) are the
  structure. Any `apps/web` move is a dedicated, purely mechanical change
  after this migration ships — never sharing a diff with behavior changes.
- **Parallel jobs per plan.** One active job per source plan stands;
  multi-policy parallel runs (per-job container instances) are a later lift.

**Deliberately not ruled out** (available during the build without
re-shaping, though no FR commits to them): push-based progress
(Realtime/WebSockets), Workflows/Queues adoption, Mode B interactive repair
in the board UI, new scheduling rules, author-configurable policy presets.

**Carried forward from the product's existing non-goals (unchanged):** room /
location validation; custom slot-grid editor (presets only); student- and
teacher-facing self-entry flows; multi-school tenancy; mobile-optimized UX;
printable / PDF export; teacher soft preferences and hours-per-week caps.

## Open Questions

1. **Solver container credential scoping.** Which Supabase key/role does the
   container get? A dedicated role limited to `generation_jobs` writes would be
   cleanest; needs a grants design consistent with the least-privilege lesson.
   — Owner: author + plan phase.
2. **Solve-to-target thresholds.** Which quality tiers get targets and at what
   values (e.g. `teacherHoles ≤ 148`? ≤ 100?). — Owner: calibration campaign +
   expert input. (The *strategy* — solve-to-target with budget ceilings — is
   locked; only the values are open.)
3. **CF API token scopes for Containers deploys.** The deploy token is
   deliberately narrow today (Workers Scripts: Edit); verify the exact scopes
   Containers requires against current Cloudflare docs when wiring the deploy
   lane. — Owner: deploy-lane phase.
4. **When the proposal plan is materialised.** _(Opened 2026-08-28 by S-306's
   frame; FR-301 still describes cloning at dispatch.)_ The clone has no reader
   between dispatch and completion — the poll projection omits it, the solver
   cannot see the column, and the client discards the id — while in that window
   it is a visible, editable, deletable plan that can destroy a 20-minute solve,
   and it drives six orphan-deletion call sites. Materialising at **completion**
   instead would close that window and most of those paths. Two author
   constraints bound the choice: the proposal must be viewable **as a board**
   (that is what produces confidence in the merge decision), and a result the
   author declines should **persist by default** rather than vanish — which
   together rule out materialising only on "keep", since a plan row is what
   makes a board viewable and durable today. So the live question is dispatch
   vs. completion, not dispatch vs. never. Deliberately left open here: it is a
   mechanism choice with a real counter-argument (a clone made at dispatch is
   the only durable copy of the display catalog the snapshot omits, so a
   completion-time clone can fail natural-key translation when the catalog
   moved). — Owner: S-306 plan phase.

> Resolved during shaping (recorded for traceability): default policy → clean
> mode (FR-302); plan locking → never, proposal clones (FR-307/308); ~~delivery
> → drift-decided auto-apply vs new plan (FR-307)~~ **[retired 2026-08-28 —
> delivery → author-decided merge-or-keep, drift gates rather than decides;
> see FR-307]**; Mode-A timeout → fall back
> to the background job (Business Logic); snapshot assembly → settle, then
> clone, then assemble server-side (FR-301 — clone *timing* reopened as Open
> Question 4); notifications → polling + in-app
> now, email nice-to-have, push recorded as upgrade (FR-304/309).
