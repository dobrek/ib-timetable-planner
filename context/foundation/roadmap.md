---
project: ib-timetable-planner
version: 1
status: draft
created: 2026-07-16
updated: 2026-07-16
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

**S-301: Author starts a CP-SAT job and receives a complete, oracle-verified board on the proposal plan** — the smallest end-to-end flow that proves the change's core hypothesis (the claim everything else depends on): that a production CP-SAT service can deliver the complete, quality-optimized board *as a proposal*, through the existing oracle trust boundary, without ever locking the author's editing.

> The **north star** is the smallest end-to-end slice whose successful delivery would prove that claim — placed as early as its prerequisites allow, because everything else (progress, stop-&-keep, drift delivery, calibration, retirement) only matters if this works. It sits immediately after the two foundations because it exercises every new layer at once: the frozen contract, the jobs schema, the solver service, and the server-side oracle.

## At a glance

| ID   | Change ID                       | Outcome (user can …)                                                                    | Prerequisites          | PRD refs                                                          | Status   |
| ---- | ------------------------------- | --------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------- | -------- |
| F-301 | solver-contract-and-jobs-schema | (foundation) frozen wire-contract artifact + durable jobs schema, least-privilege machine access | —                      | FR-301, FR-310, §Constraints & Compatibility, §Access Control Changes | ready    |
| F-302 | solver-service-transport        | (foundation) promoted solver package accepts jobs over HTTP, writes durable status/results | F-301                   | FR-310, FR-316                                                    | proposed |
| S-301 | first-verified-proposal         | start a CP-SAT job (clean-mode default) and receive a complete, oracle-verified board on the proposal plan | F-301, F-302             | FR-301, FR-302, FR-303, FR-308, FR-310, FR-313, US-301             | proposed |
| S-302 | solver-deploy-lane              | (maintainer) ship app + solver with one merge to main; container runs attached to the Worker | F-302                   | FR-315, FR-316                                                    | proposed |
| S-303 | staged-progress-and-checkpoints | watch a job stage by stage; every completed stage durably checkpoints a strictly better board | S-301                   | FR-303, FR-304, FR-308, FR-312                                    | proposed |
| S-304 | job-aware-container-lifecycle   | a running job survives container sleep, crash, and deploy — at most the in-flight stage is lost | S-302, S-303             | FR-311                                                            | proposed |
| S-305 | stop-and-keep                   | stop a running job and keep the best completed-stage board                              | S-303                   | FR-305, US-302                                                     | proposed |
| S-306 | drift-decided-delivery          | unchanged source auto-updates; changed source yields a new plan reviewed on the comparison page | S-301                   | FR-306, FR-307, FR-313, US-301, US-303                              | proposed |
| S-307 | solve-policy-choice             | choose the solve policy at launch — canonical order and trade-off dial join the clean default | S-301                   | FR-302                                                            | proposed |
| S-308 | production-calibration-campaign | see honest, production-calibrated budgets/targets; the default-switch gate is evaluated | S-304                   | FR-303, FR-314, Non-functional guardrails                         | proposed |
| S-309 | greedy-retirement               | Generate defaults to CP-SAT; the greedy engine + Web Worker path are deleted            | S-305, S-306, S-307, S-308 | FR-312, FR-314                                                    | proposed |
| S-310 | job-completion-email            | get notified of completion by email as well as in-app — "kick it off and walk away"     | S-306                   | FR-309                                                            | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                              | Chain                                    | Note                                                                                                    |
| ------ | ---------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A      | Contract → service → first proposal | `F-301` → `F-302` → `S-301`                 | The north-star track; quality-sequenced — the contract parity gate and server-side oracle land before any UI promise. |
| B      | Platform proof & retirement        | `S-302` → `S-304` → `S-308` → `S-309`        | The external-blocker track, started as early as F-302 allows; joins Stream C at `S-304` (SIGTERM persistence needs S-303's checkpoints). |
| C      | Job experience                     | `S-303` → `S-305`                          | Stage-by-stage progress + durable checkpoints, then Stop & keep; runs parallel with Stream B's deploy lane. |
| D      | Delivery, policy & notification    | `S-306` → `S-310`, with `S-307` parallel    | Drift-decided delivery and the launch-time policy picker both hang directly off `S-301`; email tails delivery. |

## Baseline

What's already in place in the codebase as of 2026-07-16 (auto-researched + author-confirmed). Foundations below assume these are present and do NOT re-scaffold them.

**Generic platform — present (per tech-stack.md + the prior roadmap; not re-probed):**

- **Frontend:** present — Astro + React 19 islands, Tailwind v4.
- **Backend / API:** present — Astro Actions are the single mutation/compute transport.
- **Data:** present — Supabase Postgres, 51 migrations.
- **Auth:** present — email/password, deny-by-default `src/middleware.ts`, single Author role. Human-facing auth is unchanged in this change.
- **Deploy / infra:** present *for the app* — GitHub Actions gate-then-deploy (`ci.yml`: verify/integration/e2e/bench/deploy → wrangler-action + `supabase db push`).
- **Observability:** partial — Cloudflare observability only. Not promoted to a foundation; the PRD demands job-status durability, not telemetry.

**Change-specific:**

- **Generation seams:** present — engine-agnostic `GeneratePlan` port (`src/entities/timetable/model/generation/types.ts:104`), `runVerifiedGeneration` (`run.ts:16`), `verifyGeneration` oracle (`verify.ts:51`), `apply_generated_placements` RPC, `clone_plan` RPC, plan-comparison page (`src/pages/plans/compare.astro`), greedy Web Worker (`generate.worker.ts:38`). These are consumed, not rebuilt.
- **Async-job layer:** absent — no job table, no polling/status-record pattern anywhere in `src/`. → F-301, S-301, S-303.
- **Cloudflare bindings:** absent — `wrangler.jsonc` is ~15 lines (assets + observability only); no KV/DO/Queues/containers. → S-302.
- **Solver package:** partial — `poc/cp-sat` (`cpsat_engine`, ~1,783 LOC src + ~764 LOC tests, uv-managed, `schema.py` mirrors the TS contract with a golden-fixture round-trip), but no HTTP wrapper (CLI only), no solve-to-target, no checkpoints/progress emission (solve-to-budget, batch-only). → F-302, S-303.
- **Wire-contract artifact:** absent — no `contracts/` directory. → F-301.
- **Python CI lane / container deploy:** absent — no Dockerfile, no docker steps, no path-filtered jobs. → S-302.
- **mise:** present — `mise.toml` at repo root; graduation to toolchain pins + cross-ecosystem tasks still to come. → F-302, S-302.

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
- **Status:** ready

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
- **Status:** proposed

## Slices

### S-301: First verified proposal  *(north star)*

- **Outcome:** Author can start a CP-SAT solve on an existing plan with the shipped clean-mode default policy: the app settles unsaved board state, clones the plan as the proposal target, assembles the snapshot from the clone server-side, records a durable job (one active job per source plan), and dispatches it to the solver; on completion the complete board passes the **server-side** oracle (the relocated runner seam) and lands on the proposal plan through the atomic RPC, ready to open. Runs against the native/local solver — production deploy is S-302.
- **Change ID:** first-verified-proposal
- **PRD refs:** FR-301, FR-302, FR-303, FR-308, FR-310, FR-313, US-301
- **Prerequisites:** F-301, F-302
- **Parallel with:** S-302
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The proof that the whole architecture hangs together — contract, jobs schema, service, and the oracle moved server-side (FR-313's pinned resolution) are exercised in one flow; if the seams don't compose, better to learn here than after the deploy lane and UI investment. Carries FR-302's *default* only (policy selection UI is S-307) and FR-303's Mode A + ladder under budget ceilings (target-stopping machinery is S-303). Sequenced immediately after the foundations because, per `main_goal: quality`, no UI promise is made before the trust boundary works end-to-end.
- **Status:** proposed

### S-302: Solver deploy lane

- **Outcome:** A maintainer ships app + solver with one merge to main: a path-filtered solver verify job (ruff + pytest) joins the CI gate, and the deploy job builds/pushes the container image (linux/amd64) alongside the Worker; the container runs attached to the existing Worker (standard-4, EEUR, scale-to-zero); local fidelity tiers 2 and 3 work (image smoke, `wrangler dev` with the real container binding), orchestrated by mise.
- **Change ID:** solver-deploy-lane
- **PRD refs:** FR-315, FR-316
- **Prerequisites:** F-302
- **Parallel with:** S-301
- **Blockers:** —
- **Unknowns:**
  - CF API token scopes for Containers deploys — the deploy token is deliberately narrow today (Workers Scripts: Edit); verify the exact scopes against current Cloudflare docs when wiring — Owner: deploy-lane phase. Block: no (resolved inside this slice; the narrow-token posture must not quietly widen).
- **Risk:** The head of the external-blocker track — Cloudflare Containers is a young GA platform, so getting a real container deployed and reachable early (parallel with S-301, not after the whole proposal flow) is the cheapest way to surface platform surprises while there's still time to react; the Cloud Run/Fly.io escape hatches stay unbuilt but the image stays host-portable. Container secrets live in container config, not the Worker.
- **Status:** proposed

### S-303: Staged progress + durable checkpoints

- **Outcome:** Author can observe a running job from the app — status, current stage, progress — by polling the durable job record; the plans list shows a job badge and the source plan shows the advisory "proposal in progress from \<time\> state" indicator; stages stop by target (solve-to-target, budget ceilings as backstop) and after each completed stage the incumbent board + objective tuple is durably checkpointed, so quality accrues monotonically and job state survives browser close; editing is never blocked.
- **Change ID:** staged-progress-and-checkpoints
- **PRD refs:** FR-303, FR-304, FR-308, FR-312
- **Prerequisites:** S-301
- **Parallel with:** S-302, S-306, S-307
- **Blockers:** —
- **Unknowns:**
  - Polling cadence/UX for a 12–20-minute job — Owner: dev. Block: no (polling is locked for this change; push via Realtime/WebSockets is the recorded upgrade if polling UX disappoints, see Parked).
- **Risk:** The deepest new solver capability (target-stopping + checkpoint emission — the POC is solve-to-budget, batch-only) lands here, in the first slice that makes it user-visible, per progressive disclosure; it is also what makes long jobs stoppable (S-305) and SIGTERM-safe (S-304), so both tracks converge on this slice. The job UI lands on the plan-detail island — the FR-312 guardrail (< 200 ms drag-drop validation untouched) is re-proven here.
- **Status:** proposed

### S-304: Job-aware container lifecycle

- **Outcome:** A running job survives the platform's lifecycle: activity renewal prevents scale-to-zero mid-solve; on SIGTERM the stop path persists the latest checkpoint and marks the job interrupted; a crash, sleep, or deploy loses at most the in-flight stage — every completed stage is recoverable. Proven against the deployed container, not just locally.
- **Change ID:** job-aware-container-lifecycle
- **PRD refs:** FR-311
- **Prerequisites:** S-302, S-303
- **Parallel with:** S-305, S-306, S-307
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The core external-blocker de-risk: the platform's documented mid-solve sleep issue (containers#162) makes job-aware lifecycle a correctness requirement, not hygiene — and the calibration campaign (S-308) cannot trust 20-minute production runs until this holds, which is why it gates Stream B. Needs S-302 (a real container to renew/terminate) and S-303 (checkpoints to persist on SIGTERM).
- **Status:** proposed

### S-305: Stop & keep

- **Outcome:** Author can stop a running job and keep the best checkpointed board ("Stop & keep"), mirroring the greedy path's existing cancel semantics; the affordance states exactly what will be kept — the last *completed* stage's board, not the in-flight stage — and the kept board is delivered onto the proposal clone rather than discarded.
- **Change ID:** stop-and-keep
- **PRD refs:** FR-305, US-302
- **Prerequisites:** S-303
- **Parallel with:** S-304, S-306, S-307, S-310
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Thin on mechanism (the checkpoints already exist from S-303) but load-bearing on UX honesty — the Socrates-added obligation that the stop affordance names the stage being kept guards against authors believing they kept more progress than they did. Part of the "proposal flow ships" precondition for retirement (S-309), since greedy's cancel affordance can't be deleted before its replacement exists.
- **Status:** proposed

### S-306: Drift-decided delivery

- **Outcome:** On job completion the app detects whether the source plan changed since the solved snapshot (the drift guard promoted to production): an **unchanged** source is auto-updated with the oracle-verified result via the atomic RPC — working clone cleaned up, author notified in-app; a **changed** source leaves the result as a new plan carrying the solution, which the author reviews on the existing comparison page (with dominance information) and adopts deliberately. Headless delivery is verified server-side — no browser needs to be open.
- **Change ID:** drift-decided-delivery
- **PRD refs:** FR-306, FR-307, FR-313, US-301, US-303
- **Prerequisites:** S-301
- **Parallel with:** S-303, S-304, S-305, S-307
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The delivery decision rule is where a stale board could reach the database if the drift guard is wrong — the oracle + apply-time re-verify remain the trust boundary regardless of what the container returns. Reuses the existing comparison page as the review surface (FR-306's locked resolution — no new side-by-side UI), keeping the frontend investment deliberately small.
- **Status:** proposed

### S-307: Solve-policy choice

- **Outcome:** Author chooses the solve policy when launching a job: clean mode (`softHits ≡ 0`) remains the shipped default, and the canonical lexicographic order and the teacher/student trade-off dial become selectable alternatives; boards are dominance-checked before presentation so a strictly-worse board is never offered.
- **Change ID:** solve-policy-choice
- **PRD refs:** FR-302
- **Prerequisites:** S-301
- **Parallel with:** S-303, S-304, S-305, S-306, S-310
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Small, additive launch-surface work — policy is already request-level configuration in the engine (the POC's ladder is policy-parameterized), so the risk is UI clarity, not mechanism. Sequenced off S-301 and kept independent so it never blocks the delivery or platform tracks; it must land before retirement (FR-302 is part of the proposal flow FR-314 gates on).
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

- **Outcome:** CP-SAT is the author's default Generate path; the greedy engine and its Web Worker machinery are deleted, with the retirement preconditions honored first: clique-bound derivation extracted out of the greedy package, the bench re-anchored to pinned CP-SAT numbers, and hint-free Mode A already measured (S-308). Interactive editing, drag-drop validation, and all board views keep working unchanged.
- **Change ID:** greedy-retirement
- **PRD refs:** FR-312, FR-314
- **Prerequisites:** S-305, S-306, S-307, S-308
- **Parallel with:** S-310
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Deletion is one-way — which is exactly why it's last and double-gated (calibration passed + proposal flow shipped, per FR-314); until this slice, greedy remains the working Generate affordance untouched, so generation never stops working during the build. The Socrates re-test already weighed freeze-vs-delete and locked deletion inside this migration; a slipping retirement is the named close-out risk.
- **Status:** proposed

### S-310: Job-completion email

- **Outcome:** Author is notified on job completion with the result information by email as well as in-app, so "kick it off and walk away" works for a 20-minute job without watching a progress bar.
- **Change ID:** job-completion-email
- **PRD refs:** FR-309
- **Prerequisites:** S-306
- **Parallel with:** S-304, S-305, S-307, S-308, S-309
- **Blockers:** —
- **Unknowns:**
  - Email delivery mechanism available from the existing stack — Owner: dev. Block: no (resolved in `/10x-plan`; the durable job row and auto-apply delivery already carry the must-have path).
- **Risk:** The one nice-to-have slice (FR-309) — deliberately last in its stream and skippable without endangering the Primary Success Criterion; it hangs off S-306 because the completion/notification event it extends is created there. Under `main_goal: quality` it is not allowed to displace any correctness-gated slice.
- **Status:** proposed

## Backlog Handoff

Handed off to GitHub 2026-07-16: milestone **"CP-SAT solver service migration"**, tracking issue [#108](https://github.com/dobrek/ib-timetable-planner/issues/108) (dependency-ordered checklist). One issue per item, below.

| Roadmap ID | Change ID                       | Issue | Suggested issue title                                                       | Ready for `/10x-plan` | Notes |
| ---------- | ------------------------------- | ----- | ---------------------------------------------------------------------------- | --------------------- | ----- |
| F-301       | solver-contract-and-jobs-schema | [#96](https://github.com/dobrek/ib-timetable-planner/issues/96) | Frozen wire-contract artifact + generation_jobs schema (least privilege)     | yes                   | Run `/10x-plan solver-contract-and-jobs-schema` — no prerequisites |
| F-302       | solver-service-transport        | [#97](https://github.com/dobrek/ib-timetable-planner/issues/97) | Promote solver to services/solver with HTTP transport + wrapper tests        | no                    | Promotes to `ready` once F-301 done |
| S-301       | first-verified-proposal         | [#98](https://github.com/dobrek/ib-timetable-planner/issues/98) | First end-to-end CP-SAT proposal: start job → oracle-verified board (north star) | no                | Promotes to `ready` once F-301 + F-302 done |
| S-302       | solver-deploy-lane              | [#99](https://github.com/dobrek/ib-timetable-planner/issues/99) | Container deploy lane: path-filtered solver CI + image ship with the Worker  | no                    | Promotes to `ready` once F-302 done; parallel with S-301 |
| S-303       | staged-progress-and-checkpoints | [#100](https://github.com/dobrek/ib-timetable-planner/issues/100) | Solve-to-target + per-stage checkpoints + polling progress UI                | no                    | Promotes to `ready` once S-301 done |
| S-304       | job-aware-container-lifecycle   | [#101](https://github.com/dobrek/ib-timetable-planner/issues/101) | Job-aware lifecycle: activity renewal + SIGTERM checkpoint persistence       | no                    | Promotes to `ready` once S-302 + S-303 done |
| S-305       | stop-and-keep                   | [#102](https://github.com/dobrek/ib-timetable-planner/issues/102) | Stop & keep the best completed-stage board                                   | no                    | Promotes to `ready` once S-303 done |
| S-306       | drift-decided-delivery          | [#103](https://github.com/dobrek/ib-timetable-planner/issues/103) | Drift-decided delivery: auto-apply unchanged source / new plan on drift      | no                    | Promotes to `ready` once S-301 done |
| S-307       | solve-policy-choice             | [#104](https://github.com/dobrek/ib-timetable-planner/issues/104) | Launch-time solve-policy choice (canonical order + trade-off dial)           | no                    | Promotes to `ready` once S-301 done |
| S-308       | production-calibration-campaign | [#105](https://github.com/dobrek/ib-timetable-planner/issues/105) | Calibration campaign on production hardware — set budgets/targets, evaluate gate | no                | Promotes to `ready` once S-304 done |
| S-309       | greedy-retirement               | [#106](https://github.com/dobrek/ib-timetable-planner/issues/106) | Retire greedy: CP-SAT default Generate, delete Web Worker path               | no                    | Promotes to `ready` once S-305 + S-306 + S-307 + S-308 done |
| S-310       | job-completion-email            | [#107](https://github.com/dobrek/ib-timetable-planner/issues/107) | Email notification on job completion                                         | no                    | Promotes to `ready` once S-306 done; nice-to-have |

## Open Roadmap Questions

1. **Solver container credential scoping.** Which Supabase key/role does the container get? A dedicated role limited to `generation_jobs` writes would be cleanest; needs a grants design consistent with the least-privilege lesson. — Owner: author + plan phase. Block: none (resolved inside `/10x-plan solver-contract-and-jobs-schema`, F-301).
2. **Solve-to-target thresholds.** Which quality tiers get targets and at what values (e.g. `teacherHoles ≤ 148`? ≤ 100?). The strategy — solve-to-target with budget ceilings — is locked; only the values are open. — Owner: calibration campaign + expert input. Block: none (resolved by S-308 itself).
3. **CF API token scopes for Containers deploys.** The deploy token is deliberately narrow today (Workers Scripts: Edit); verify the exact scopes Containers requires against current Cloudflare docs when wiring the deploy lane. — Owner: deploy-lane phase. Block: none (resolved inside S-302).

## Parked

- **Off-Cloudflare hosting (Cloud Run / Fly.io)** — Why parked: PRD §Non-Goals; escape hatches considered only if calibration (S-308) proves the 4-vCPU ceiling genuinely binding. The image stays host-portable by construction.
- **`apps/` repo restructure** — Why parked: PRD §Non-Goals; any `apps/web` move is a dedicated, purely mechanical change after this migration ships — never sharing a diff with behavior changes.
- **Parallel jobs per plan** — Why parked: PRD §Non-Goals; one active job per source plan stands; multi-policy parallel runs (per-job container instances) are a later lift.
- **Push-based progress (Supabase Realtime / container WebSockets)** — Why parked: deliberately not ruled out by the PRD; the acknowledged upgrade if S-303's polling UX disappoints.
- **Cloudflare Workflows / Queues adoption** — Why parked: deliberately not ruled out; a retry-durability upgrade, not needed for the locked job model.
- **Mode B interactive repair in the board UI** — Why parked: deliberately not ruled out; available during the build without re-shaping, but no FR commits to it.
- **New scheduling rules; author-configurable policy presets** — Why parked: deliberately not ruled out; no FR commits to them.
- **Room / location validation; custom slot-grid editor (presets only); student- and teacher-facing self-entry flows; multi-school tenancy; mobile-optimized UX; printable / PDF export; teacher soft preferences and hours-per-week caps** — Why parked: PRD §Non-Goals (carried forward from the product's existing non-goals, unchanged).

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived. Do NOT pre-populate.)
