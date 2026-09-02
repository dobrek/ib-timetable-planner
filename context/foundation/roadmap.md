---
project: ib-timetable-planner
version: 1
status: draft
created: 2026-07-16
updated: 2026-09-02
prd_version: 1
main_goal: quality
top_blocker: external
---

# Roadmap: IB Timetable Planner (post-POC CP-SAT solver service)

> Derived from `context/foundation/prd.md` (v1 — the post-POC CP-SAT migration PRD) + auto-researched codebase baseline (2026-07-16).
> Edit-in-place; archive when superseded. The completed post-demo-feedback roadmap is archived at `context/foundation/archive/2026-07-16-roadmap.md`.
> Slices below are listed in dependency order. The `## At a glance` table is the index.

## Vision recap

The timetable editor's only generation engine is a client-side greedy solver at its measured ceiling (5–8 h unplaced per cohort, 217 teacher gaps vs the ≤ 148 expert bar), while the POC proved CP-SAT delivers the deliverable the product actually values — a **complete, oracle-verified, quality-optimized board** — but only as a local file-transport experiment. This change promotes the POC package into a production solver service (Cloudflare Container attached to the existing Worker), gives the app its first async-job muscle (durable job rows, polling, proposal-clone delivery that never locks editing), and — gated on a production calibration campaign — makes CP-SAT the engine of record and deletes the greedy engine and its Web Worker path. The integration seams built across four prior changes (the engine-agnostic port, the runner seam, the oracle, the atomic RPC) are the payoff this migration collects, not a retrofit.

## North star

**S-301: Author starts a CP-SAT job and receives a complete, oracle-verified board on the proposal plan** — the smallest end-to-end flow that proves the change's core hypothesis (the claim everything else depends on): that a production CP-SAT service can deliver the complete, quality-optimized board _as a proposal_, through the existing oracle trust boundary, without ever locking the author's editing.

> The **north star** is the smallest end-to-end slice whose successful delivery would prove that claim — placed as early as its prerequisites allow, because everything else (progress, stop-&-keep, drift delivery, calibration, retirement) only matters if this works. It sits immediately after the two foundations because it exercises every new layer at once: the frozen contract, the jobs schema, the solver service, and the server-side oracle.

## At a glance

| ID    | Change ID                       | Outcome (user can …)                                                                                       | Prerequisites              | PRD refs                                                              | Status   |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------- | -------- |
| F-301 | solver-contract-and-jobs-schema | (foundation) frozen wire-contract artifact + durable jobs schema, least-privilege machine access           | —                          | FR-301, FR-310, §Constraints & Compatibility, §Access Control Changes | done     |
| F-302 | solver-service-transport        | (foundation) promoted solver package accepts jobs over HTTP, writes durable status/results                 | F-301                      | FR-310, FR-316                                                        | done     |
| S-301 | first-verified-proposal         | start a CP-SAT job (clean-mode default) and receive a complete, oracle-verified board on the proposal plan | F-301, F-302               | FR-301, FR-302, FR-303, FR-308, FR-310, FR-313, US-301                | done |
| S-302 | solver-deploy-lane              | (maintainer) ship app + solver with one merge to main; container runs attached to the Worker               | F-302                      | FR-315, FR-316                                                        | done     |
| S-303 | staged-progress-and-checkpoints | watch a job stage by stage on the plans list; every completed stage durably checkpoints a never-worse board | S-301                      | FR-303, FR-304, FR-308, FR-312                                        | done     |
| S-304 | job-aware-container-lifecycle   | a running job survives container sleep, crash, and deploy — at most the in-flight stage is lost            | S-302, S-303               | FR-311                                                                | done     |
| S-305 | stop-and-keep                   | stop a running job and keep the best completed-stage board                                                 | S-303                      | FR-305, US-302                                                        | done     |
| S-306 | drift-decided-delivery          | the proposal is a plan — pending while it solves, an ordinary plan once delivered; the source is never written to | S-301                      | FR-306, FR-307, FR-308, FR-309, FR-313, US-301, US-303                | done     |
| S-307 | solve-policy-choice             | choose the solve policy at launch — canonical order and student-first order join the clean default         | S-301                      | FR-302                                                                | proposed |
| S-308 | production-calibration-campaign | see honest, production-calibrated budgets/targets; the default-switch gate is evaluated                    | S-304                      | FR-303, FR-314, Non-functional guardrails                             | proposed |
| S-309 | greedy-retirement               | The greedy engine is deleted (CP-SAT default + Web Worker removal already shipped in S-301 / cleanup)     | S-305, S-306, S-307, S-308 | FR-312, FR-314                                                        | proposed |
| S-310 | job-completion-email            | get notified of completion by email as well as in-app — "kick it off and walk away"                        | S-306                      | FR-309                                                                | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                               | Chain                                    | Note                                                                                                                                     |
| ------ | ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Contract → service → first proposal | `F-301` → `F-302` → `S-301`              | The north-star track; quality-sequenced — the contract parity gate and server-side oracle land before any UI promise.                    |
| B      | Platform proof & retirement         | `S-302` → `S-304` → `S-308` → `S-309`    | The external-blocker track, started as early as F-302 allows; joins Stream C at `S-304` (SIGTERM persistence needs S-303's checkpoints). |
| C      | Job experience                      | `S-303` → `S-305`                        | Stage-by-stage progress + durable checkpoints, then Stop & keep; runs parallel with Stream B's deploy lane.                              |
| D      | Delivery, policy & notification     | `S-306` → `S-310`, with `S-307` parallel | Delivery onto the proposal plan and the launch-time policy picker both hang directly off `S-301`; email tails delivery, extending the durable `notified_at` row transition `S-306` creates, and since 2026-08-28 also carries the walk-away trigger `S-306` no longer owes. |

## Baseline

What's already in place in the codebase as of 2026-07-16 (auto-researched + author-confirmed). Foundations below assume these are present and do NOT re-scaffold them.

**Generic platform — present (per tech-stack.md + the prior roadmap; not re-probed):**

- **Frontend:** present — Astro + React 19 islands, Tailwind v4.
- **Backend / API:** present — Astro Actions are the single mutation/compute transport.
- **Data:** present — Supabase Postgres, 51 migrations.
- **Auth:** present — email/password, deny-by-default `src/middleware.ts`, single Author role. Human-facing auth is unchanged in this change.
- **Deploy / infra:** present _for the app_ — GitHub Actions gate-then-deploy (`ci.yml`: verify/integration/e2e/solver/deploy → wrangler-action + `supabase db push`).
- **Observability:** partial — Cloudflare observability only. Not promoted to a foundation; the PRD demands job-status durability, not telemetry.

**Change-specific:**

- **Generation seams:** present — engine-agnostic `GeneratePlan` port (`src/entities/timetable/model/generation/types.ts:104`), `runVerifiedGeneration` (`run.ts:16`), `verifyGeneration` oracle (`verify.ts:51`), `apply_generated_placements` RPC, `clone_plan` RPC, plan-comparison page (`src/pages/plans/compare.astro`). These are consumed, not rebuilt. (The greedy Web Worker that once sat here was deleted by `clean-up-bench-generation`; Generate now dispatches to the CP-SAT service.)
- **Async-job layer:** absent — no job table, no polling/status-record pattern anywhere in `src/`. → F-301, S-301, S-303.
- **Cloudflare bindings:** absent — `wrangler.jsonc` is ~15 lines (assets + observability only); no KV/DO/Queues/containers. → S-302.
- **Solver package:** partial — `poc/cp-sat` (`cpsat_engine`, ~1,783 LOC src + ~764 LOC tests, uv-managed, `schema.py` mirrors the TS contract with a golden-fixture round-trip), but no HTTP wrapper (CLI only), no solve-to-target, no checkpoints/progress emission (solve-to-budget, batch-only). → F-302, S-303.
- **Wire-contract artifact:** absent — no `contracts/` directory. → F-301.
- **Python CI lane / container deploy:** absent — no Dockerfile, no docker steps. → S-302. *(Shipped 2026-08-17: `solver` job since F-302; Dockerfile + image build/push in `deploy` since S-302. No path filters — see S-302.)*
- **mise:** present — `mise.toml` at repo root; graduation to toolchain pins + cross-ecosystem tasks still to come. → F-302. *(Graduated in F-302, not S-302; S-302 added the image/tier-3/campaign tasks on top.)*

## Foundations

### F-301: Wire-contract artifact + generation-jobs schema

- **Outcome:** (foundation) the frozen dump/result wire contract exists as a committed tech-neutral schema artifact in `contracts/`, golden-fixture-gated in **both** the TS and Python suites with `formatVersion` gating incompatibility; the `generation_jobs` table exists (additive migration, RLS + explicit grants) together with a least-privilege machine credential design for the solver's status/result writes.
- **Change ID:** solver-contract-and-jobs-schema
- **PRD refs:** FR-301, FR-310, §Constraints & Compatibility, §Access Control Changes
- **Unlocks:** F-302, S-301; reduces Open Roadmap Question 1 (credential scoping); establishes the contract-parity verification path every wire-touching slice is gated by.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Solver container credential scoping — which Supabase key/role, and the grants design consistent with the least-privilege lesson (a role limited to `generation_jobs` writes would be cleanest) — Owner: author + plan phase. Block: no (resolved inside `/10x-plan`).
- **Risk:** Two components (app Actions and the Python service) write against this schema and speak this contract, so folding it into S-301 would create a cycle (F-302 needs it first) — that downstream fan-in is why it's a foundation and not slice-work. Scope is deliberately minimal: one artifact, one table, one credential design; the least-privilege lesson (revoke, don't just grant) applies directly.
- **Status:** done

### F-302: Solver service transport

- **Outcome:** (foundation) `poc/cp-sat` is promoted to `services/solver/`; a thin HTTP wrapper accepts a solve job, runs the engine with a pinned worker count, and writes status/results durably to the database over HTTPS; the wrapper is tested at the wrapper level (the untested-CLI lesson); a developer runs the service natively against the app via the env-gated `SOLVER_URL` transport (local fidelity tier 1), with mise carrying the toolchain pins.
- **Change ID:** solver-service-transport
- **PRD refs:** FR-310, FR-316
- **Unlocks:** S-301, S-302; establishes the wrapper-level test surface FR-310 demands.
- **Prerequisites:** F-301
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - HTTP framework choice (FastAPI vs lighter) — Owner: dev. Block: no (the PRD explicitly calls it a plan-phase detail).
- **Risk:** The minimal enabler for any job slice — without a service that accepts a job and records its outcome, no vertical slice exists. Deliberately excludes solve-to-target, checkpoint emission, and lifecycle handling (those land with the first slices that make them user-visible: S-303, S-304), so S-301 still integrates this layer through a real user capability. The greedy Generate path stays untouched throughout.
- **Status:** done

## Slices

### S-301: First verified proposal _(north star)_

- **Outcome:** Author can start a CP-SAT solve on an existing plan with the shipped clean-mode default policy: the app waits for pending board edits to settle, clones the plan as the proposal target, assembles the snapshot from the **source** plan server-side, records a durable job (one active job per source plan), and dispatches it to the solver; on completion the complete board passes the **server-side** oracle (the relocated runner seam), has its `courseId`s translated into the clone's id space, and lands on the proposal plan through the atomic RPC, ready to open. Runs against the native/local solver — production deploy is S-302.
  - _Wording corrected during implementation (2026-08-13), twice, both owed by decisions recorded in `first-verified-proposal/change.md`._ **"assembles the snapshot from the clone"** was not implementable: `clone_plan` re-mints every course UUID (measured: 0 of 84 survive), so a clone-assembled snapshot could never hash equal to a source-assembled one — FR-307's drift check would report drift on every run and S-306's auto-apply could never fire. The snapshot is assembled and hashed from the source; the clone is the apply target, reached by natural-key `courseId` translation. **"settles unsaved board state"** described a draft buffer that does not exist: every board mutation persists per gesture, so "settle" is the existing `busy` guard on in-flight optimistic writes, already labelled _"Waiting for pending edits to settle"_.
- **Change ID:** first-verified-proposal
- **PRD refs:** FR-301, FR-302, FR-303, FR-308, FR-310, FR-313, US-301
- **Prerequisites:** F-301, F-302
- **Parallel with:** S-302
- **Blockers:** —
- **Unknowns:**
  - **Clean mode is not implemented in the engine — added 2026-08-11 (F-302 research).** This slice's outcome ships "the shipped clean-mode default policy", but `softHits` exists only as tier 5 of the objective (`objective.py:60,172`); nothing anywhere constrains it to `0` as a hard rule, so clean mode (`softHits ≡ 0`) has no implementation. Whoever ships the default must build it — it is **not** inherited from the POC and **not** deferrable to S-307 (which adds the selectable alternatives on top of the default). Owner: plan phase. Block: no, but it is engine work this slice's estimate did not previously carry.
- **Risk:** The proof that the whole architecture hangs together — contract, jobs schema, service, and the oracle moved server-side (FR-313's pinned resolution) are exercised in one flow; if the seams don't compose, better to learn here than after the deploy lane and UI investment. Carries FR-302's _default_ only (policy selection UI is S-307) and FR-303's Mode A + ladder under budget ceilings (target-stopping machinery is S-303) — but see Unknowns: that default is net-new engine work, not existing configuration. Sequenced immediately after the foundations because, per `main_goal: quality`, no UI promise is made before the trust boundary works end-to-end.
- **Status:** done

### S-302: Solver deploy lane

- **Outcome:** A maintainer ships app + solver with one merge to main: the solver verify job (ruff + mypy + pytest + audit) is part of the CI gate, and the deploy job builds/pushes the container image (linux/amd64) alongside the Worker; the container runs attached to the existing Worker (standard-4, EEUR, scale-to-zero, `SOLVER_WORKERS=4`); local fidelity tiers 2 and 3 work (image smoke, `wrangler dev --enable-containers` with the real container binding), orchestrated by mise. Two additions beyond the original outcome: a **hosted-solve campaign** (`mise run solver:hosted`) that points the native solver at the hosted database for policy comparison on real data, and a **fail-closed role assertion** in the solver, which refuses to start when its token is not `solver_job_writer`.
- **Amended 2026-08-17:** "path-filtered" removed — the measurement did not support it (44 s solver job against a 426 s parallel critical path) and the required `deploy.needs` rewrite is a silent-regression surface on the only production-touching job. See PRD FR-315. Cost restated to ~$15/month. The CF-token unknown is resolved: `Workers Scripts: Edit` + `Containers: Edit`, both account-scoped.
- **Change ID:** solver-deploy-lane
- **PRD refs:** FR-315, FR-316
- **Prerequisites:** F-302
- **Parallel with:** S-301
- **Blockers:** —
- **Unknowns:**
  - ~~CF API token scopes for Containers deploys~~ — **RESOLVED 2026-08-17**: `Workers Scripts: Edit` + `Containers: Edit`, both account-scoped. The posture widens by exactly one permission. Note Cloudflare's `Edit Cloudflare Workers` template does **not** include Containers, so it is insufficient; `Cloudchamber: Edit` is the fallback on a 403.
- **Risk:** The head of the external-blocker track — Cloudflare Containers is a young GA platform, so getting a real container deployed and reachable early (parallel with S-301, not after the whole proposal flow) is the cheapest way to surface platform surprises while there's still time to react; the Cloud Run/Fly.io escape hatches stay unbuilt but the image stays host-portable. Container secrets live in container config, not the Worker.
- **Status:** done

### S-303: Staged progress + durable checkpoints

- **Outcome:** Author can observe a running job from the app — status, current stage, progress — by polling the durable job record; the **plans list** shows a live "Generating — stage N of 10 · \<tier\>" badge (5 s, only while a job is active, paused when the tab is hidden) and the source plan keeps the static advisory "proposal in progress from \<time\> state" indicator plus a link to the list; stages stop by target **when a target is configured** (`SOLVER_STAGE_TARGETS`, empty by default — values ship with S-308; budget ceilings remain the backstop) and after each completed stage the incumbent board **+ that stage's best/bound** is durably checkpointed, so board quality is **never worse** stage over stage and job state survives browser close; editing is never blocked.
- **Change ID:** staged-progress-and-checkpoints
- **PRD refs:** FR-303, FR-304, FR-308, FR-312
- **Prerequisites:** S-301
- **Parallel with:** S-302, S-306, S-307
- **Blockers:** —
- **Unknowns:**
  - ~~Polling cadence/UX for a 12–20-minute job~~ — **RESOLVED 2026-08-20**: 5 s, active-only, visibility-aware, with terminal states remembered in the tab. An idle hub issues no requests at all; a tab returning to the foreground makes one discovery read so a job started in another tab is picked up. Push via Realtime/WebSockets stays the recorded upgrade — see Parked for the trigger that would justify it.
- **Risk:** The deepest new solver capability (target-stopping + checkpoint emission — the POC is solve-to-budget, batch-only) lands here, in the first slice that makes it user-visible, per progressive disclosure; it is also what makes long jobs stoppable (S-305) and SIGTERM-safe (S-304), so both tracks converge on this slice. *(Re-grounded 2026-08-20: the job UI landed on the **plans list**, not the plan-detail island. That retires the FR-312 guardrail **structurally** rather than by proof — `/plans` has no board on it, so a poll cannot contend with drag-drop validation at all, and `src/_pages/plan-detail/model/**` has no diff in the slice. The plan page keeps the static FR-308 advisory and gains only a link.)*
- **Status:** done

### S-304: Job-aware container lifecycle

- **Outcome:** A running job survives the platform's lifecycle: activity renewal prevents scale-to-zero mid-solve; on SIGTERM the stop path persists the latest checkpoint and marks the job interrupted; a crash, sleep, or deploy loses at most the in-flight stage — every completed stage is recoverable. Proven against the deployed container, not just locally.
- **Change ID:** job-aware-container-lifecycle
- **PRD refs:** FR-311
- **Prerequisites:** S-302, S-303
- **Inherited from S-303 (2026-08-20):** `heartbeat_at` now renews on every stage event rather than
  once at claim, so a wedged row is already *coarsely* detectable — but Mode A alone can run 300 s
  between renewals, so the finer resolution (a timer thread) is still this slice's. The column SELECT
  grant the widened claim CAS needs (`heartbeat_at`, and `stop_requested_at` for S-305) was **pre-paid**
  by S-303's migration, so no grant work remains here. The reclaim half below is unchanged.
- **Parallel with:** S-305, S-306, S-307
- **Blockers:** —
- **Unknowns:** —
- **Inherited from F-302 — scope this in, it is not covered by the Outcome above:** a job can reach a
  state no redispatch can rescue. `JobRowClient.claim` is a compare-and-set filtered on
  `status=eq.queued` (`services/solver/src/cpsat_service/supabase.py`), so a row left at `running` is
  permanently unclaimable — and F-302's terminal write can leave one there if all three retry
  attempts fail, or if the container dies between the last checkpoint and the final PATCH. **Renewing
  `heartbeat_at` is therefore only half the job: something must also be allowed to RECLAIM a
  `running` row whose heartbeat has gone stale**, which means widening that CAS filter (e.g.
  `status=eq.queued` OR `status=eq.running AND heartbeat_at < now() - <grace>`) and confirming the
  RLS `using`/`with check` windows on `generation_jobs` still permit it. Without the reclaim half,
  the heartbeat makes the wedge *visible* but still not *recoverable*. Recorded 2026-08-12 from the
  F-302 implementation review (finding F2) — see
  `context/archive/2026-08-11-solver-service-transport/reviews/impl-review.md`.
- **Risk:** The core external-blocker de-risk: job-aware lifecycle is a correctness requirement, not hygiene — and the calibration campaign (S-308) cannot trust 20-minute production runs until this holds, which is why it gates Stream B. Needs S-302 (a real container to renew/terminate) and S-303 (checkpoints to persist on SIGTERM). *(Re-grounded 2026-08-17: the original citation, containers#162, was closed 2026-05-12 and fixed in `@cloudflare/containers` v0.2.2. S-304 is unaffected — the durable reason is that Cloudflare "does not guarantee that any container instance will run for any set period of time", and the wedged-`running`-row problem is ours. S-302 shipped `sleepAfter: 30m` as a stopgap and `rollout_active_grace_period: 1200`, which does **not** protect an in-flight solve; both hand off here.)*
- **Status:** done

### S-305: Stop & keep

- **Outcome:** Author can stop a running job and keep the best checkpointed board ("Stop & keep"); the affordance states exactly what will be kept — the last _completed_ stage's board, not the in-flight stage — and the kept board is delivered onto the proposal clone rather than discarded.
- **Change ID:** stop-and-keep
- **PRD refs:** FR-305, US-302
- **Prerequisites:** S-303
- **Inherited from S-303 (2026-08-20):** the stop SEAM existed and was tested, so this slice added a
  *source* rather than a mechanism. `SolveHooks.should_stop` is honoured by the engine's solution
  callback; `registry.attach_solver` holds the live `CpSolver` for an immediate `stop_search()`;
  `stopReason: "cancelled"` and per-stage `stoppedBy` were already in contract; and
  `stop_requested_at` is readable by the solver role but deliberately **not** writable by it. What
  was missing was the button, the write, and the poll.
- **As shipped (2026-09-01):** the poll rides the S-304 heartbeat — `progress` projects
  `id,stop_requested_at` on the round trip it already makes — and fires the SAME latch SIGTERM does,
  with reason `"requested"`, which the runner maps to a `stopped` row. **The latch is the signal, not
  the transcript** (S-304's rule): `stoppedBy: "cancelled"` is recorded only when the solution
  callback fires, so an externally interrupted stage often reads `"budget"` or nothing at all, and
  the terminal status is keyed off the latch alone. The ladder's own break is likewise a
  best-effort speed-up rather than the mechanism.
- **Honest latency:** a stop is a request, not an interrupt. Worst case is the heartbeat interval
  (≤ 15 s) plus the tail of the stage in flight plus at most one further short hinted stage — minutes,
  not seconds, which is what the affordance's copy says and why no measured number is quoted.
- **Parallel with:** S-304, S-306, S-307, S-310
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Thin on mechanism (the checkpoints already exist from S-303) but load-bearing on UX honesty — the Socrates-added obligation that the stop affordance names the stage being kept guards against authors believing they kept more progress than they did. Part of the "proposal flow ships" precondition for retirement (S-309), since greedy's cancel affordance can't be deleted before its replacement exists.
- **Status:** done

### S-306: The proposal is a plan

- **Outcome:** Generate clones the source as `Proposal — <name>`, and the clone is **pending** from its first second: listed on the hub with a live job badge, openable read-only with progress, and refused by every edit path. When a deliverable result exists, the next visit — to the proposal or to the source — verifies it, translates ids, applies the board **onto the proposal** and clears the flag; from that moment the proposal is an ordinary plan the author compares, renames, keeps or deletes. **The source is never written to.** There is no merge and no drift gate. The hub badge is a durable row state (pending → ready) that survives reloads until the proposal is opened once, and an open hub toasts on the transition — the channel-agnostic notification event S-310 extends. Every write runs inside the author's own authenticated request.
- **Change ID:** drift-decided-delivery
- **PRD refs:** FR-306, FR-307, FR-308, FR-309, FR-313, US-301, US-303
- **Prerequisites:** S-301
- **Parallel with:** S-303, S-304, S-305, S-307
- **Blockers:** —
- **Unknowns:** **(1) When the proposal is materialised — RESOLVED (plan phase):** clone at dispatch, `plans.pending_proposal` until delivered. The editable window was the real hazard, and a flag closes it without giving up the dispatch clone's unique property (the only T0-faithful copy of the display catalog the snapshot omits). PRD Open Question 4 is closed on this. **(2) What the notification event is — RESOLVED (plan phase):** a durable **row transition**, `delivered_plan_id is not null and notified_at is null`. S-306 gives `notified_at` its first writer (an in-app view of the delivered proposal); the toast is a by-product of the poll, not the event. S-310's emailer is the second writer of the same column and skips already-notified rows.
- **Risk:** **The pending guard is the new hazard.** The proposal is a real `plans` row from dispatch, so every plan-scoped by-id surface must refuse it while pending — the detail route, the three catalog routes (`courses`/`students`/`teachers`), the two person-view routes, the comparison page, and the `rename`/`clone`/`delete` actions. A missed surface lets an in-flight clone be edited, which corrupts a 20-minute solve's apply target. The guard surface is enumerated from *today's* routes: **any future plan-scoped page must check `pending_proposal`**. Board-mutation actions (`placeCourse`, …) are deliberately not guarded individually — they are unreachable without a rendered board and the pending page renders none — which is a documented assumption, not an enforced one. Secondary: `generation_jobs.plan_id` cascades on delete, so deleting the **source** mid-solve would strand the clone; that path is guarded too.
- **Status:** done

  > **Re-grounded again 2026-08-28 (second round, plan phase — `context/changes/drift-decided-delivery/plan.md`).** Was the block below plus "**merge** it into the source … or **keep** it as a separate plan; the drift guard … gates and informs". **Merge and the drift gate are retired in turn.** For the author's stated workflow — the source is left alone during a solve — merging into the source is exactly equal to deleting the source and renaming the proposal, and both acts already exist as one hub click each; in the rare drifted case merge was gated on the board re-verifying against the moved source, which a board-only drift almost never satisfies. So the branch that justified the machinery was also the branch that would almost never fire. Leaving with it: the T1 re-hash per proposal visit, the TOCTOU window, the `isOptional` digest blind spot, a decision panel, three actions, and a `delivery` vocabulary of three values (now one). The accepted cost is that there is **no fold-in path** for the author who edits the source mid-solve and wants both sets of changes — they re-apply by hand or re-generate. The slice's centre of gravity moves from "a decision surface" to "a guard surface": see the rewritten Risk.
  >
  > **Re-grounded 2026-08-28 by `/10x-frame` (`context/changes/drift-decided-delivery/frame.md`).** Was: "an **unchanged** source is auto-updated … a **changed** source leaves the result as a new plan … (with dominance information) … Headless delivery is verified server-side — no browser needs to be open." Three corrections. **(a) Auto-apply is retired** — the author reports that reviewing every 12–20 minute board is the point, not a cost, and that they leave the source untouched during a solve, so the automation would have fired on the *majority* of runs doing the unwanted thing. It was also the sole claimant on a session-free write credential the project refused twice during S-304; that cost leaves with it. **(b) Dominance moves to S-307**, which already claims it — it exists at no layer today, the wire contract excludes the objective tuple it needs, and the comparison page is built to refuse machine judgement. **(c) "No browser needs to be open" was a stronger claim than FR-313 makes** — FR-313's operative clause is about the oracle running server-side rather than in client JS, which S-301 shipped. The surviving walk-away requirement is FR-309's notifier and belongs to S-310, where it needs only a read-only identity. The former `Unknowns: —` was the most misleading line in this entry.

### S-307: Solve-policy choice

- **Outcome:** Author chooses the solve policy when launching a job: clean mode (`softHits == floor`) remains the shipped default, and the canonical lexicographic order and the student-first order become selectable alternatives. The choice rides `SolveRequest.policy` (additive-optional, `formatVersion` stays `1`), is written to `generation_jobs.policy` from the same validated value, becomes engine configuration (`SolveConfig.clean_mode` + `SolveConfig.ladder`, a permutation of the canonical visit order), is exposed on the file-transport CLI as `--policy`, and is named on the delivered proposal's provenance line.
- **Change ID:** solve-policy-choice
- **PRD refs:** FR-302
- **Prerequisites:** S-301
- **Parallel with:** S-303, S-304, S-305, S-306, S-310
- **Blockers:** —
- **Unknowns:** **Dominance was split out of this slice on 2026-09-02** (author decision, `context/changes/solve-policy-choice/research.md` §7): it has no producer — one job yields one board, so there is nothing to compare at launch — and no consumer — the comparison page refuses to judge, restated in eleven files and type- and test-enforced. Its successor is a follow-up slice, **"true objective tuple on the wire"**: capture the finished board's ten-tuple beside `_extract_board` (no `evaluate_board` re-solve is needed from tier 2 on — the hardened `best` values are exact), carry it on `GenerationResult` under a `formatVersion` bump, and let that same field fix `deriveCleanLabel`'s upper-bound read of tier 5's `best` and add checkpoint monotonicity. Until then `compareObjectives` stays lexicographic and the comparison page keeps its refusal.
- **Risk:** **Corrected 2026-09-02 (S-307 implementation): the mechanism was smaller than priced.** `_run_ladder` was already order-parameterised (position and identity kept separate, the clique cut identity-keyed) and `clean_mode` was already the hard/soft field, so the engine change was one `SolveConfig.ladder` field plus a preset table; the real work was the contract widening, the runner writing `stage_index` as the ladder *position* rather than the tier (so "stage N of 10" never counts backwards under a permuted order), and the dialog. The earlier note stands as the record of why it was priced as engine work: **Re-scoped 2026-08-11 (F-302 research) — this is engine work, not just launch-surface work.** The earlier claim that "policy is already request-level configuration in the engine (the POC's ladder is policy-parameterized)" was verified against the code and **does not hold**: the tier order is a hardcoded tuple literal (`objective.py:55-66`), `solve_staged` hardcodes the ladder as `range(1, 10)` (`solve.py:152`), and `SolveConfig` (`solve.py:30-40`) has no tier-order and no hard/soft field — only budgets, seed, workers, hops, log_dir. The POC's three-board frontier was produced by editing the tier tuple, not through a public knob. So the risk is **mechanism as well as UI clarity**: this slice must first plumb tier order and the hard/soft split through `SolveConfig` and `_run_ladder` before any launch-time picker can mean anything. Note the _clean-mode default itself_ is a separate prerequisite carried by S-301 (see that slice's Unknowns) — S-307 adds the selectable **alternatives** on top of it. Sequenced off S-301 and kept independent so it never blocks the delivery or platform tracks; it must land before retirement (FR-302 is part of the proposal flow FR-314 gates on).
- **Status:** proposed

### S-308: Production calibration campaign

- **Outcome:** Solve budgets and stage targets are set from a calibration campaign on the **production** instance (never tuned on the M4): fast solves (Mode A / small repair) return within the measured interactive budget or fall back to the background job; the UI communicates a realistic full-ladder ceiling instead of an indefinite spinner; hint-free Mode A is measured; the calibration gate for the default-path switch is evaluated and recorded.
- **Change ID:** production-calibration-campaign
- **PRD refs:** FR-303, FR-314, Non-functional guardrails
- **Prerequisites:** S-304
- **Parallel with:** S-305, S-306, S-307, S-310
- **Blockers:** —
- **Unknowns:**
  - Solve-to-target threshold values — which quality tiers get targets and at what values (e.g. `teacherHoles ≤ 148`? ≤ 100?) — Owner: calibration campaign + expert input. Block: no (this slice exists to resolve it; the strategy is locked, only the values are open).
- **Risk:** The only source of shipped numbers — running it before S-304 would risk losing 20-minute runs to mid-solve container sleep and calibrating against a lying platform; running it on the M4 would violate the locked tuning discipline. Its output (targets + the gate verdict) is the sole thing standing between the proposal flow and retirement, so it sits on Stream B's critical path.
- **Status:** proposed

### S-309: Greedy retirement — CP-SAT becomes the engine of record

- **Outcome:** the greedy ENGINE is deleted. Half of this slice's original outcome has already shipped: S-301 made CP-SAT the author's default Generate path, and `clean-up-bench-generation` deleted the orphaned Web Worker machinery, so what remains here is the entity-layer engine package plus its own tests and the `bench/` experiments that drive it — a pure `src/entities/timetable/` deletion with no page-slice involvement. Retirement preconditions must be honored first: clique-bound derivation extracted out of the greedy package, a CP-SAT regression baseline pinned and executable, and hint-free Mode A already measured (S-308). Interactive editing, drag-drop validation, and all board views keep working unchanged.
- **Change ID:** greedy-retirement
- **PRD refs:** FR-312, FR-314
- **Prerequisites:** S-305, S-306, S-307, S-308
- **Parallel with:** S-310
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Deletion is one-way — which is exactly why it's last and double-gated (calibration passed + proposal flow shipped, per FR-314). The "generation never stops working during the build" guarantee no longer rests on greedy: Generate has run CP-SAT since S-301, so the engine this slice deletes has had no production caller for the whole stretch. The Socrates re-test already weighed freeze-vs-delete and locked deletion inside this migration; a slipping retirement is the named close-out risk.
- **Status:** proposed

### S-310: Job-completion email

- **Outcome:** Author is notified on job completion with the result information by email as well as in-app, so "kick it off and walk away" works for a 20-minute job without watching a progress bar.
- **Change ID:** job-completion-email
- **PRD refs:** FR-309
- **Prerequisites:** S-306
- **Parallel with:** S-304, S-305, S-307, S-308, S-309
- **Blockers:** —
- **Unknowns:**
  - Email delivery mechanism available from the existing stack — Owner: dev. Block: no (resolved in `/10x-plan`; the durable job row and author-confirmed delivery already carry the must-have path).
  - **A trigger that fires with no tab open — inherited 2026-08-28 from S-306's frame, and now this slice's to solve.** The walk-away case is what FR-309 exists for, and it cannot be served by anything browser-bound: nothing today notices a completed job (no `triggers`/`crons`/`queues` in `wrangler.jsonc`, no `scheduled` export, no `pg_cron`/`pg_net`, no Edge Functions), and the Worker's only Supabase client is request-and-cookie-bound. It became S-310's when S-306 retired auto-apply — but it also got **materially cheaper**: a notifier needs a **read-only** identity over `generation_jobs`, where auto-apply needed write access to `placements`/`plans`/`courses`. The solver cannot substitute: it cannot read `plan_id` and holds zero privileges on `public.plans`. Owner: S-310 plan phase. Block: no — the slice is nice-to-have and skippable by design.
- **Risk:** The one nice-to-have slice (FR-309) — deliberately last in its stream and skippable without endangering the Primary Success Criterion; it hangs off S-306 because the completion/notification event it extends is created there. *(Still true after 2026-08-28's re-grounding, and now load-bearing rather than incidental: if S-306 makes "notified in-app" a render of delivery state rather than a durable event, this slice has nothing to extend. S-306 carries that as a named Unknown.)* Under `main_goal: quality` it is not allowed to displace any correctness-gated slice.
- **Status:** proposed

## Backlog Handoff

Handed off to GitHub 2026-07-16: milestone **"CP-SAT solver service migration"**, tracking issue [#108](https://github.com/dobrek/ib-timetable-planner/issues/108) (dependency-ordered checklist). One issue per item, below.

| Roadmap ID | Change ID                       | Issue                                                             | Suggested issue title                                                            | Ready for `/10x-plan` | Notes                                                              |
| ---------- | ------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------ |
| F-301      | solver-contract-and-jobs-schema | [#96](https://github.com/dobrek/ib-timetable-planner/issues/96)   | Frozen wire-contract artifact + generation_jobs schema (least privilege)         | done                  | Archived 2026-08-11 → `context/archive/2026-08-10-solver-contract-and-jobs-schema/` |
| F-302      | solver-service-transport        | [#97](https://github.com/dobrek/ib-timetable-planner/issues/97)   | Promote solver to services/solver with HTTP transport + wrapper tests            | done                  | Archived 2026-08-12 → `context/archive/2026-08-11-solver-service-transport/` |
| S-301      | first-verified-proposal         | [#98](https://github.com/dobrek/ib-timetable-planner/issues/98)   | First end-to-end CP-SAT proposal: start job → oracle-verified board (north star) | yes                   | Unblocked — F-301 + F-302 done. Run `/10x-plan first-verified-proposal`. Inherits from F-302: the snapshot binding (compare the row's `snapshot_hash` after claim) and the relocated `runVerifiedGeneration` oracle |
| S-302      | solver-deploy-lane              | [#99](https://github.com/dobrek/ib-timetable-planner/issues/99)   | Container deploy lane: solver CI + image ship with the Worker (no path filters)  | yes                   | Unblocked — F-302 done; parallel with S-301. Inherits from F-302: the image must `COPY contracts/`, and the container binding IS the solve endpoint's authentication (see `services/solver/README.md` § trust boundary) |
| S-303      | staged-progress-and-checkpoints | [#100](https://github.com/dobrek/ib-timetable-planner/issues/100) | Solve-to-target + per-stage checkpoints + polling progress UI                    | no                    | Promotes to `ready` once S-301 done                                |
| S-304      | job-aware-container-lifecycle   | [#101](https://github.com/dobrek/ib-timetable-planner/issues/101) | Job-aware lifecycle: activity renewal + SIGTERM checkpoint persistence           | no                    | Promotes to `ready` once S-302 + S-303 done. **Scope is short by one item** — heartbeat renewal alone cannot rescue a job wedged at `running`; the claim CAS must also be widened to reclaim stale-heartbeat rows. See the S-304 item body, "Inherited from F-302" |
| S-305      | stop-and-keep                   | [#102](https://github.com/dobrek/ib-timetable-planner/issues/102) | Stop & keep the best completed-stage board                                       | no                    | Promotes to `ready` once S-303 done                                |
| S-306      | drift-decided-delivery          | [#103](https://github.com/dobrek/ib-timetable-planner/issues/103) | The proposal is a plan: pending while it solves, an ordinary plan once delivered; source never written to | no                    | **Unblocked — S-301 done. Re-grounded twice on 2026-08-28** (frame: auto-apply retired, dominance → S-307; plan: merge + drift gate retired). Research, frame and plan are written (`context/changes/drift-decided-delivery/`); PRD Open Question 4 is **resolved** (clone at dispatch, pending until delivered) and the notification event is a durable row transition. In implementation. Issue #103's title/body still describe auto-apply and need updating when the PR opens |
| S-307      | solve-policy-choice             | [#104](https://github.com/dobrek/ib-timetable-planner/issues/104) | Launch-time solve-policy choice (canonical order + student-first order)               | no                    | Promotes to `ready` once S-301 done                                |
| S-308      | production-calibration-campaign | [#105](https://github.com/dobrek/ib-timetable-planner/issues/105) | Calibration campaign on production hardware — set budgets/targets, evaluate gate | no                    | Promotes to `ready` once S-304 done                                |
| S-309      | greedy-retirement               | [#106](https://github.com/dobrek/ib-timetable-planner/issues/106) | Retire greedy: CP-SAT default Generate, delete Web Worker path                   | no                    | Promotes to `ready` once S-305 + S-306 + S-307 + S-308 done        |
| S-310      | job-completion-email            | [#107](https://github.com/dobrek/ib-timetable-planner/issues/107) | Email notification on job completion                                             | no                    | Promotes to `ready` once S-306 done; nice-to-have                  |

## Open Roadmap Questions

1. **Solver container credential scoping.** Which Supabase key/role does the container get? A dedicated role limited to `generation_jobs` writes would be cleanest; needs a grants design consistent with the least-privilege lesson. — Owner: author + plan phase. Block: none (resolved inside `/10x-plan solver-contract-and-jobs-schema`, F-301).
2. **Solve-to-target thresholds.** Which quality tiers get targets and at what values (e.g. `teacherHoles ≤ 148`? ≤ 100?). The strategy — solve-to-target with budget ceilings — is locked; only the values are open. — Owner: calibration campaign + expert input. Block: none (resolved by S-308 itself).
3. ~~**CF API token scopes for Containers deploys.**~~ **RESOLVED 2026-08-17 in S-302**: `Workers Scripts: Edit` + `Containers: Edit`, both account-scoped — the narrow-token posture widens by exactly one permission. Cloudflare's `Edit Cloudflare Workers` template does not include Containers; `Cloudchamber: Edit` is the documented fallback if a container push 403s.

## Parked

- **Off-Cloudflare hosting (Cloud Run / Fly.io)** — Why parked: PRD §Non-Goals; escape hatches considered only if calibration (S-308) proves the 4-vCPU ceiling genuinely binding. The image stays host-portable by construction.
- **`apps/` repo restructure** — Why parked: PRD §Non-Goals; any `apps/web` move is a dedicated, purely mechanical change after this migration ships — never sharing a diff with behavior changes.
- **Parallel jobs per plan** — Why parked: PRD §Non-Goals; one active job per source plan stands; multi-policy parallel runs (per-job container instances) are a later lift.
- **Push-based progress (Supabase Realtime / container WebSockets)** — Why parked: deliberately not ruled out by the PRD; the acknowledged upgrade if S-303's polling UX disappoints. **The trigger, defined 2026-08-20 so "disappoints" is not a matter of taste:** adopt push when either (a) a stage transition routinely takes more than ~10 s to appear on the plans list — which polling can only fix by shortening the interval, i.e. by multiplying the request count — or (b) hub polling becomes a measurable share of Supabase request volume. Until one of those is observed, the current shape reads nothing on an idle hub and nothing on a hidden tab, so neither is expected.
- **Cloudflare Workflows / Queues adoption** — Why parked: deliberately not ruled out; a retry-durability upgrade, not needed for the locked job model.
- **Mode B interactive repair in the board UI** — Why parked: deliberately not ruled out; available during the build without re-shaping, but no FR commits to it.
- **New scheduling rules; author-configurable policy presets** — Why parked: deliberately not ruled out; no FR commits to them.
- **Room / location validation; custom slot-grid editor (presets only); student- and teacher-facing self-entry flows; multi-school tenancy; mobile-optimized UX; printable / PDF export; teacher soft preferences and hours-per-week caps** — Why parked: PRD §Non-Goals (carried forward from the product's existing non-goals, unchanged).

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived. Do NOT pre-populate.)

- **F-301: (foundation) the frozen dump/result wire contract exists as a committed tech-neutral schema artifact in `contracts/`, golden-fixture-gated in **both** the TS and Python suites with `formatVersion` gating incompatibility; the `generation_jobs` table exists (additive migration, RLS + explicit grants) together with a least-privilege machine credential design for the solver's status/result writes.** — Archived 2026-08-11 → `context/archive/2026-08-10-solver-contract-and-jobs-schema/`. Lesson: —.
- **F-302: (foundation) `poc/cp-sat` is promoted to `services/solver/`; a thin HTTP wrapper accepts a solve job, runs the engine with a pinned worker count, and writes status/results durably to the database over HTTPS; the wrapper is tested at the wrapper level (the untested-CLI lesson); a developer runs the service natively against the app via the env-gated `SOLVER_URL` transport (local fidelity tier 1), with mise carrying the toolchain pins.** — Archived 2026-08-12 → `context/archive/2026-08-11-solver-service-transport/`. Lesson: —.
- **S-301: Author can start a CP-SAT solve on an existing plan with the shipped clean-mode default policy: the app waits for pending board edits to settle, clones the plan as the proposal target, assembles the snapshot from the **source** plan server-side, records a durable job (one active job per source plan), and dispatches it to the solver; on completion the complete board passes the **server-side** oracle (the relocated runner seam), has its `courseId`s translated into the clone's id space, and lands on the proposal plan through the atomic RPC, ready to open. Runs against the native/local solver — production deploy is S-302.** — Archived 2026-08-13 → `context/archive/2026-08-12-first-verified-proposal/`. Lesson: —.
- **S-303: Author can observe a running job from the app — status, current stage, progress — by polling the durable job record; the **plans list** shows a live "Generating — stage N of 10 · \<tier\>" badge (5 s, only while a job is active, paused when the tab is hidden) and the source plan keeps the static advisory "proposal in progress from \<time\> state" indicator plus a link to the list; stages stop by target **when a target is configured** (`SOLVER_STAGE_TARGETS`, empty by default — values ship with S-308; budget ceilings remain the backstop) and after each completed stage the incumbent board **+ that stage's best/bound** is durably checkpointed, so board quality is **never worse** stage over stage and job state survives browser close; editing is never blocked.** — Archived 2026-08-20 → `context/archive/2026-08-19-staged-progress-and-checkpoints/`. Lesson: —.
- **S-302: A maintainer ships app + solver with one merge to main: the solver verify job (ruff + mypy + pytest + audit) is part of the CI gate, and the deploy job builds/pushes the container image (linux/amd64) alongside the Worker; the container runs attached to the existing Worker (standard-4, EEUR, scale-to-zero, `SOLVER_WORKERS=4`); local fidelity tiers 2 and 3 work (image smoke, `wrangler dev --enable-containers` with the real container binding), orchestrated by mise. Two additions beyond the original outcome: a **hosted-solve campaign** (`mise run solver:hosted`) that points the native solver at the hosted database for policy comparison on real data, and a **fail-closed role assertion** in the solver, which refuses to start when its token is not `solver_job_writer`.** — Archived 2026-08-20 → `context/archive/2026-08-15-solver-deploy-lane/`. Lesson: —.
- **S-304: A running job survives the platform's lifecycle: activity renewal prevents scale-to-zero mid-solve; on SIGTERM the stop path persists the latest checkpoint and marks the job interrupted; a crash, sleep, or deploy loses at most the in-flight stage — every completed stage is recoverable. Proven against the deployed container, not just locally.** — Archived 2026-08-25 → `context/archive/2026-08-20-job-aware-container-lifecycle/`. Lesson: —.
- **S-306: Generate clones the source as `Proposal — <name>`, and the clone is **pending** from its first second: listed on the hub with a live job badge, openable read-only with progress, and refused by every edit path. When a deliverable result exists, the next visit — to the proposal or to the source — verifies it, translates ids, applies the board **onto the proposal** and clears the flag; from that moment the proposal is an ordinary plan the author compares, renames, keeps or deletes. **The source is never written to.** There is no merge and no drift gate. The hub badge is a durable row state (pending → ready) that survives reloads until the proposal is opened once, and an open hub toasts on the transition — the channel-agnostic notification event S-310 extends. Every write runs inside the author's own authenticated request.** — Archived 2026-08-29 → `context/archive/2026-08-25-drift-decided-delivery/`. Lesson: —.
- **S-305: Author can stop a running job and keep the best checkpointed board ("Stop & keep"); the affordance states exactly what will be kept — the last _completed_ stage's board, not the in-flight stage — and the kept board is delivered onto the proposal clone rather than discarded.** — Archived 2026-09-02 → `context/archive/2026-09-01-stop-and-keep/`. Lesson: —.
