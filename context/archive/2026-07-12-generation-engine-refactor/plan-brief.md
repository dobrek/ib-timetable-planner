# Generation Engine Refactor — Plan Brief

> Full plan: `context/changes/generation-engine-refactor/plan.md`

## What & Why

The plan-generation engine (GRASP/LNS in `engines/greedy.ts`) landed correct and benchmarked well, but a critical review found it structurally fragile: CI cannot detect quality regressions, the test suite pays ~24 s of real-time solving per run, the 926-line engine file violates the repo's single-responsibility conventions, and the fail-fast precondition lives in the worker instead of beside the engine. This change hardens the guardrails and restructures the code without changing behavior.

## Starting Point

The engine ships behind an engine-agnostic `GeneratePlan` port, judged by a verify-as-oracle harness that strongly protects *validity* — but nothing in CI asserts *quality* (slot counts), the objective definition is greedy-private, and three test helpers reimplement engine logic. Benchmark envelope: dp1 = 50 slots (bar ≤ 50), dp2 = 46 (bar ≤ 48).

## Desired End State

CI fails if slot-minimization capability regresses; `pnpm test`'s generation portion runs in seconds, not 24; the engine is a folder of concept files (`search` / `problem` / `board` / `stages`) with the objective and RNG shared at `generation/` level; any runner — present worker or future HTTP endpoint — gets precondition → engine → verdict from one `runVerifiedGeneration` seam.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| CI quality guard shape | Crafted descent-required instance + synthetic slot bars | Only an instance where construction provably exceeds the optimum guards descent/LNS; the easy synthetic catalog may hit its optimum via construction alone. | Plan |
| Tuning seam | `createGreedyEngine(tuning?)` factory | Keeps greedy-only knobs (stagnation window, attempts) out of the engine-agnostic port a future CP-SAT engine would share. | Plan |
| Real-time solving in CI | One real-budget smoke, everything else tuned fast | CI keeps a genuinely realistic solve while the suite gets ~5× faster. | Plan |
| Bench dp2 bar | Pin 46 under extended windows (stagnation 10 s, budget 60 s) | Stagnation, not budget, ends runs — scaling the window makes the pin machine-speed independent; ~5-run validation, fallback ≤ 47 documented. | Plan |
| Bench in CI | Non-blocking parallel `bench` job (not in `deploy.needs`) | The slow real-catalog quality signal runs on every push at zero wall-clock cost; deploy-gating waits until the pin proves stable on GitHub runners (probation protocol recorded). | Plan |
| Second engine / CP-SAT | Deferred | Spike shows the prize is ~1–2 dp1 slots; wait for checkpoint 2.8's real manual counts. | Review |
| Objective ownership | Extract to `generation/objective.ts` | It's the engine-agnostic definition of board quality; engines and bench must share it. | Review |

## Scope

**In scope:** CI quality bar; tunable engine factory; suite retuning; bench pin + non-blocking `bench` CI job; `objective.ts` + `rng.ts` extraction with first `countStudentHoles` tests; entity-barrel trim; `engines/greedy/` decomposition (board/problem/stages/search) with seam tests and convention fixes; `runVerifiedGeneration` runner seam + thin worker.

**Out of scope:** HTTP adapter / CP-SAT sidecar; `studentHoles` move operator; week-aware metrics; any search-behavior, objective, protocol, or UI change; dp1 parity-bar tightening.

## Architecture / Approach

Safety net first, then extractions smallest-risk-first, then the mechanical split, then the seam. Phases 2–4 are behavior-preserving refactors executed under the Phase 1 guard: the existing verify-as-oracle suite carries validity; the new quality bar carries capability. Every phase leaves `/verify` green.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. CI quality bar + tunable engine | Capability guard in CI; ~5× faster suite; dp2 = 46 bench pin + non-blocking bench CI job | Crafted fixture design; pin stability on dev machine and GH runners |
| 2. Extract engine-agnostic pieces | `objective.ts` + `rng.ts`; first tier-2/4 tests; barrel trim | Silent behavior drift in `scoreCandidate` re-signature |
| 3. Decompose greedy | `engines/greedy/` concept files + seam tests + convention fixes | Non-mechanical edits sneaking into the move |
| 4. Runner seam | `runVerifiedGeneration`; thin worker | Precondition error-path parity with current UX |

**Prerequisites:** none — `main` is clean, all inputs landed.
**Estimated effort:** ~10–13 h across 4 sessions (one per phase).

## Open Risks & Assumptions

- dp2 = 46 may prove unstable even under extended windows → documented fallback to ≤ 47 (decided upfront, not a blocker).
- GitHub runners may not reproduce the dev machine's 46 → the bench CI job stays non-blocking until probation proves it (promotion is a follow-up decision, never a silent gate).
- The crafted descent-required instance must be designed carefully; its "construction exceeds optimum" property is demonstrated once at implementation time and recorded in the fixture comment.
- Assumes no undiscovered external consumer of the greedy internals the barrel stops exporting (`pnpm check` will prove this in Phase 2).

## Success Criteria (Summary)

- A refactor (or future change) that breaks slot minimization turns CI red instead of shipping silently.
- `pnpm test` no longer pays ~24 s for generation; developers run it more, not less.
- The engine reads as concept-sized modules a new contributor can navigate; a second engine could be added by implementing the port and reusing objective, verify, and the runner seam unchanged.
