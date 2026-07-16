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
  Worker** (20 s budget, FR-016). There is no server-side generation endpoint;
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
   EEUR pinning next to Supabase Frankfurt, scale-to-zero, ≈ $7/month at peak
   planning season.
3. **The value function was reframed.** Greedy's output lost its product value
   the day the POC returned GO; keeping it is operational cost, not product
   value — which is why deletion belongs inside this migration.

**Scope decision (locked):** this is **one change covering the full
migration** — PRD amendment, package promotion + service transport,
contract/jobs schema, app integration (proposal flow), deploy lane,
calibration campaign on production hardware, and the calibration-gated greedy
retirement. It is simultaneously a new module, an engine-of-record migration,
an architectural improvement (monorepo formalization, CI path-filtering,
container deploy lane), and a significant user-facing feature (the proposal
flow).

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
   complete board strictly better-ranked than the last, and the author can
   **Stop & keep** the best board so far (mirroring the existing cancel
   semantics).
4. On completion the drift check decides delivery: an **unchanged source is
   auto-updated** with the oracle-verified result (working clone cleaned up,
   author notified); a **changed source leaves the result as a new plan** the
   author reviews on the existing comparison page (with dominance
   information) and adopts deliberately.
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
- **Cost envelope.** Solver compute ≈ $7/month at peak planning season and
  ~cents off-season (scale-to-zero), on the already-paid plan.
- **Privacy (preserved).** Student and teacher names never leave the app; the
  solver receives opaque UUIDs only.

## User Stories

> Delta-framed — each notes what was different before.

### US-01: Generate a complete proposal while continuing to edit

- **Given** an author on an existing plan with residual unplaced hours
- **When** they start a CP-SAT job (default clean-mode policy), keep editing
  the source plan freely, and return after the ladder completes
- **Then** — their edits having drifted the source — the result is delivered
  as a new plan holding a complete, oracle-verified, quality-optimized board;
  the source plan is intact including their edits; they compare the two on the
  existing comparison page (with dominance information) and adopt the result
  deliberately

> Before: generation was a 20-second local greedy draft that left 5–8 h
> unplaced, ran only while the tab stayed open, and overwrote nothing safely —
> there was no proposal concept.

### US-02: Stop & keep at "good enough"

- **Given** a running job that has completed quality tier k of the ladder
- **When** the author stops it mid-run ("Stop & keep")
- **Then** the best completed-stage board — complete and oracle-verifiable —
  is delivered onto the proposal clone rather than discarded; the remaining
  tiers are simply left unpolished

> Before: cancelling greedy kept its best-so-far only in browser memory; a
> long solve had no notion of accrued, keepable progress.

### US-03: Unchanged source is updated automatically

- **Given** a running job whose source plan receives no edits during the solve
- **When** the job completes
- **Then** the oracle-verified result is applied atomically to the source plan
  without further ceremony, the working clone is cleaned up, and the author is
  notified; had the source drifted, the result would instead have been
  delivered as a new plan for comparison and deliberate adoption

> Before: the drift guard existed only in the bench import experiment; there
> was no automated delivery path at all.

## Scope of Change

> Each item is delta-categorized: `[new]` didn't exist, `[modified]` existing
> behaviour changes, `[preserved]` must keep working unchanged. FR identifiers
> carry over from shaping; `> Socrates:` blockquotes record the strongest
> counter-argument considered and its resolution.

### Generation jobs

- [new] FR-001: Author can start a CP-SAT generation job on a plan: the app
  settles unsaved board state, clones the plan as the proposal target,
  assembles the snapshot from the clone server-side, records a durable
  generation job, and dispatches it to the solver service. Priority: must-have.
  > Socrates: Counter-arguments considered: settle-on-start as a surprising
  > side effect; clone-per-job plan proliferation; server-side assembly vs
  > optimistic client state. Resolution: stands as written — settle-then-clone
  > is the smallest mechanism that makes the snapshot authoritative and the
  > drift guard meaningful.
- [new] FR-002: Author chooses the solve policy when launching a job — **clean
  mode (`softHits ≡ 0`) as the shipped default**, with the canonical
  lexicographic order and the teacher/student trade-off dial as selectable
  alternatives. Priority: must-have.
  > Socrates: Challenge **accepted (revised)**: clean mode must be the
  > default, since it produced the most valued output (the POC's clean board
  > dominated the canonical campaign board). Resolution: FR updated — clean
  > mode is the shipped default; canonical order remains selectable. This
  > resolves the research's open question on the production default policy.
- [new] FR-003: The solve runs Mode A (complete the board) then the staged
  quality ladder under the chosen policy, stopping stages by target
  (solve-to-target) with budget ceilings; after each completed stage the
  incumbent board + objective tuple is durably checkpointed, so an interrupted
  or stopped job still yields the best completed board. Priority: must-have.
  > Socrates: Counter-arguments considered: target thresholds are premature
  > before Phase 5 calibration; per-stage checkpoint churn. Resolution: stands
  > — calibration sets the target *values*, but target-stopping as the
  > strategy is locked (hardware-independence), and checkpoints are what make
  > a 20-minute job stoppable and SIGTERM-safe.
- [new] FR-004: Author can observe a running job from the app — status,
  current stage, progress — by polling the durable job record; the plans list
  shows a job badge; job state survives browser close and container sleep.
  Priority: must-have.
  > Socrates: Counter-argument **accepted (noted, not revised)**: "polling is
  > inferior to push." Resolution: polling ships in this change (simplest thing
  > that works on a durable row at this scale); push — Supabase Realtime or
  > container WebSocket forwarding — is recorded as the acknowledged upgrade
  > if polling UX disappoints. Routed to the Forward block.
- [new] FR-005: Author can stop a running job and keep the best checkpointed
  board ("Stop & keep"), mirroring the greedy path's existing cancel
  semantics; the affordance states exactly what will be kept — the last
  *completed* stage's board, not the in-flight stage. Priority: must-have.
  > Socrates: Counter-argument **accepted (refined)**: "mid-stage semantics
  > are confusing — authors may believe they kept more progress than they
  > did." Resolution: kept, with a UX obligation added — the stop affordance
  > must name the stage of the board being kept.
- [new] FR-006: On completion the result is imported onto its plan only after
  passing the oracle; when review is needed (the drifted case of FR-007), the
  author reviews the result against the source on the **existing
  plan-comparison page** (with dominance/quality information) — no new
  side-by-side surface is built. Priority: must-have.
  > Socrates: Counter-argument **accepted (refined)**: rather than a new
  > side-by-side review UX, reuse the comparison page the product already
  > has. Resolution: FR updated — the existing comparison page is the review
  > surface; dominance info joins it as context.
- [new] FR-007: On job completion the app detects whether the source plan
  changed since the solved snapshot (the catalog/board drift guard promoted to
  production). If **unchanged**, the oracle-verified result is
  **auto-applied** to the source via the atomic RPC, the working clone is
  cleaned up, and the author is notified. If **changed**, the result is
  delivered as a **new plan carrying the solution**, reviewed on the
  comparison page and adopted deliberately. Priority: must-have.
  > Socrates: Challenge **accepted (reshaped)**: instead of a manual "Apply
  > to source" affordance, completion-time drift detection decides delivery —
  > unchanged source ⇒ replace (auto-apply); changed source ⇒ the solution
  > stands as a new plan. Locked follow-up: auto-apply with clone cleanup and
  > notification; post-hoc inspection remains available via the comparison
  > page.
- [new] FR-008: While a job runs, the source plan shows an advisory "proposal
  in progress from <time> state" indicator; one job per source plan is active
  at a time; editing is never blocked. Priority: must-have.
  > Socrates: Counter-arguments considered: one-job-per-plan blocks parallel
  > policy runs; advisory-only indicator under-informs. Resolution: stands as
  > written — the single-job limit is the simplest concurrency model and can
  > be lifted later (per-job container instances make parallel runs cheap).
- [new] FR-009: Author is notified on job completion with the result
  information — in-app when the app is open, and by **email** to match the
  "kick it off and walk away" usage of a 20-minute job. Priority: nice-to-have.
  > Socrates: Counter-argument **accepted (extended)**: "in-app-only misses
  > the walk-away case — email is the notification that actually matches the
  > workflow." Resolution: email joins the FR (was: a later extension);
  > priority stays nice-to-have — the durable job row and auto-apply delivery
  > carry the must-have path.

### Solver service

- [new] FR-010: The solver service (promoted `cpsat_engine` + HTTP wrapper)
  accepts solve jobs over HTTP, runs with a pinned worker count, writes
  per-stage status/results to the database over HTTPS, and is tested at the
  wrapper level (the untested-CLI lesson). Priority: must-have.
  > Socrates: Counter-arguments considered: two DB write paths (app via
  > Actions, solver direct); FastAPI heavier than two endpoints need.
  > Resolution: stands as written — direct durable writes survive container
  > sleep; the framework choice is a plan-phase detail.
- [new] FR-011: The container's lifecycle is job-aware: activity renewal
  prevents scale-to-zero mid-solve; the stop path persists the latest
  checkpoint and marks the job interrupted on SIGTERM. Priority: must-have.
  > Socrates: Counter-arguments considered: sleepAfter > max job length as
  > the simpler dodge; SIGTERM handler redundant next to per-stage
  > checkpoints. Resolution: stands as written — the platform's documented
  > mid-solve sleep issue (containers#162) makes job-aware lifecycle a
  > correctness requirement.

### Preserved behaviour & migration

- [preserved] FR-012: Existing interactive editing, drag-drop validation
  (< 200 ms), and all board views keep working unchanged — generation adds no
  work to the interactive validation path. Priority: must-have.
  > Socrates: Counter-argument considered: "preserved is aspirational until
  > measured — polling and job UI land on the plan-detail island."
  > Resolution: stands as a hard guardrail; the NFRs carry the measurable
  > commitment.
- [preserved] FR-013: Every generated board — from any engine — reaches the
  database only through oracle verification, apply-time re-verify, and the
  atomic `apply_generated_placements` RPC; the oracle runs **server-side in
  the job delivery pipeline** (the relocated `runVerifiedGeneration` seam), so
  headless delivery (auto-apply, FR-007) is verified without a browser open.
  Priority: must-have.
  > Socrates: Counter-argument **accepted (pinned)**: "where the oracle runs
  > is unspecified — client-only verification can't serve headless delivery."
  > Resolution: oracle execution pinned to the server-side job pipeline; the
  > trust boundary is unchanged, its location is now explicit.
- [modified] FR-014: The greedy Web Worker path remains the working Generate
  affordance, untouched, until the calibration gate passes and the proposal
  flow ships; then CP-SAT becomes the default generate path and the greedy
  engine + Web Worker machinery are deleted (clique-bound derivation
  extracted, bench re-anchored to pinned CP-SAT numbers, and hint-free Mode A
  measured first). Priority: must-have.
  > Socrates: Counter-arguments re-tested: deletion is one-way vs freeze; a
  > slipping retirement could stall the close-out. Resolution: stands — the
  > research's 14:20 follow-up already weighed both; deletion stays inside the
  > migration, gated only on calibration + the proposal flow shipping.

### Dev & ops

- [new] FR-015: A maintainer ships app + solver with one merge to main: a
  path-filtered solver verify job (ruff + pytest) joins the CI gate, and the
  deploy job builds/pushes the container image alongside the Worker. Priority:
  must-have.
  > Socrates: Counter-arguments considered: app releases coupled to Docker
  > builds; deliberate narrow-token posture quietly widening. Resolution:
  > stands — one gate-then-deploy lane matches the single-author load; the
  > exact token scopes stay in Open Questions.
- [new] FR-016: A developer runs the full stack locally at three fidelity
  tiers — native solver (uvicorn) via the env-gated `SOLVER_URL` transport,
  linux/amd64 image smoke, `wrangler dev` with the real container binding —
  orchestrated by mise (toolchain pins + cross-ecosystem tasks; pnpm scripts
  stay the JS-side canon). Priority: must-have.
  > Socrates: Counter-arguments considered: three tiers over-engineered for
  > one developer; mise tasks duplicating pnpm scripts. Resolution: stands —
  > the tiers document what already exists rather than adding machinery, and
  > the grain rule keeps pnpm the JS-side canon.

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
- **Engine transition compatibility.** The greedy Web Worker path keeps
  working, untouched, until the calibration gate; PRD FR-016 is amended
  engine-agnostically (an engine produces a verified board under a
  budget/target) so greedy's later retirement is a PRD non-event. Retirement
  preconditions: clique-bound derivation extracted out of `engines/greedy/`,
  bench re-anchored to pinned CP-SAT numbers, hint-free Mode A measured.
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
- **Deploy posture.** The single gate-then-deploy pipeline extends
  (path-filtered solver verify + container deploy step); container secrets
  live in container config, not the Worker; the CF API token broadens only as
  far as Containers deploys require (exact scopes in Open Questions).
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

**Delivery rule — new: drift decides.** A solve result is meaningful only
against the exact snapshot it was produced from. The solve always runs
against a clone — the live plan is never locked. On completion the app
compares the source plan with the solved snapshot: **unchanged** → the
oracle-verified result is auto-applied to the source and the working clone is
cleaned up; **changed** → the result stands as a new plan carrying the
solution, reviewed on the existing comparison page.

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

> Resolved during shaping (recorded for traceability): default policy → clean
> mode (FR-002); plan locking → never, proposal clones (FR-007/008); delivery
> → drift-decided auto-apply vs new plan (FR-007); Mode-A timeout → fall back
> to the background job (Business Logic); snapshot assembly → settle, then
> clone, then assemble server-side (FR-001); notifications → polling + in-app
> now, email nice-to-have, push recorded as upgrade (FR-004/009).
