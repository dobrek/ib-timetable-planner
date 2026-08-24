---
date: 2026-07-16T11:42:10+02:00
researcher: Claude (Fable 5)
git_commit: 23d0cfa4e70a5d84372d5ad73c9930128cdffbe2
branch: main
repository: ib-timetable-planner
topic: "Post-POC CP-SAT: feasibility, Cloudflare deployment options, target architecture, monorepo question, and the POC→production route map"
tags: [research, codebase, cp-sat, backend-service, cloudflare-containers, architecture, monorepo, generation, post-poc-cp-sat-refactoring-plan]
status: complete
last_updated: 2026-07-16
last_updated_by: Claude (Fable 5)
last_updated_note: "Follow-ups: (1) 20-minute job concurrency/notifications/sleepAfter; (2+3) greedy lifecycle → deletion inside the migration; (4) monorepo structure; (5) local full-stack story + mise orchestration"
---

# Research: Post-POC CP-SAT — from GO verdict to production-ready service

**Date**: 2026-07-16T11:42:10+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: 23d0cfa4e70a5d84372d5ad73c9930128cdffbe2
**Branch**: main
**Repository**: ib-timetable-planner

> **Dated snapshot — 2026-08-15 note.** Findings below are pinned to `23d0cfa` and are not
> maintained against the current codebase. Two of them have since been overtaken by events:
> the greedy Web Worker path is **deleted** (S-301 put CP-SAT behind Generate;
> `clean-up-bench-generation` swept the orphaned client path), and the retirement precondition
> phrased as *"retirement re-anchors regression to pinned CP-SAT numbers"* named the CI `bench`
> job, which the same change deleted as noise — the precondition now reads "a CP-SAT regression
> baseline is pinned and executable" (S-308's output). The body is unedited on purpose. Current
> statements live in `context/foundation/prd.md` (FR-314) and `roadmap.md` (S-309).

Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/23d0cfa4e70a5d84372d5ad73c9930128cdffbe2/`

## Research Question

In light of the `poc-cp-sat-backend-service` findings (verdict: **GO**), check feasibility and opportunities: What options exist for implementing this as a new module? What options does Cloudflare (our deployment platform) give us? How do the platform limitations relate to the fact that the POC ran locally on an Apple Silicon M4? What is the optimal architecture for this change and for the whole application? Does this imply introducing/migrating to a monorepo? Build a route map from POC to production-ready service.

## Summary

**Feasibility: high, and the path is unusually well-prepared.** Every seam the service needs already exists by deliberate prior design: the engine-agnostic `GeneratePlan` port, the `runVerifiedGeneration` seam built "for a possible HTTP/CLI runner later", the `verifyGeneration` oracle, the atomic `apply_generated_placements` RPC, and a transport-agnostic Python package whose only throwaway file is `cli.py`. The genuinely new work is: an HTTP/job wrapper around `solve.py`, an async-job surface in the app (net-new — no job table, no polling, no Cloudflare bindings exist today), a container deploy lane in CI, and a PRD amendment (FR-016 currently locks generation to a client-side Web Worker).

**Platform: Cloudflare Containers is the answer, and it matured just in time.** GA since 2026-04-13 on the plan the project already pays for. A `standard-4` instance gives a real 4-vCPU/12-GiB isolated VM, scale-to-zero (`sleepAfter`), regional pinning to **EEUR** next to Supabase Frankfurt, deploys via the existing `wrangler deploy` flow, and costs ≈ **$7/month at peak planning season, ~cents off-season**. Python Workers (Pyodide — no native extensions) and WASM CP-SAT (no threads in workerd) are definitively ruled out. Cloud Run (8 vCPU) and Fly.io are viable escape hatches, at meaningfully higher operational overhead for a one-person project.

**M4 → cloud reality: apply a 3–5× wall-clock multiplier and change the stopping strategy.** An M4 P-core is ~2.3–3.5× faster than a good cloud vCPU, and the POC used ~11 CP-SAT workers vs the container's 4. Consequences: the decision-critical solves stay interactive (Mode A feasibility 0.7 s → ~2–4 s; Mode B repair ~0.75 s → ~2–3 s), while the full quality ladder becomes an honest background job (~243 s → ~12–20 min for M4-equivalent quality). This is exactly why the POC's own recommendation — **solve-to-target instead of solve-to-budget** — matters: it makes the *outcome* hardware-independent even when the path isn't. Solve-to-target does not exist in the package yet and is new work.

**Optimal architecture: the hybrid the archives already converged on.** Keep the TS greedy engine as the interactive/fallback path in the browser; add CP-SAT as an async job — Astro Action starts it, a `generation_jobs` table in Supabase carries status/result durably across container sleep, the client polls, and the returned board re-enters through the exact same oracle → drift-guard → persist pipeline the POC import experiment already demonstrated. The tier order and hard/soft split ship as first-class configuration (the POC's "product dial" finding), with a dominance check before presenting a board.

**Monorepo: you already have one — formalize it, don't tool it up.** The repo is a de-facto polyglot monorepo (pnpm app at root + uv package at `poc/cp-sat/`, invisible to all JS gates by design). The right move is promotion (`poc/cp-sat/` → `services/solver/`), CI path-filtering, and a contract-parity gate — **not** Turborepo/Nx/pnpm-workspace packages, which buy nothing at 2 units, and **not** a separate repo, which would break the parity discipline that makes the Python numbers trustworthy.

A phased route map (0–6) is at the end of Detailed Findings.

## Detailed Findings

### 1. What the POC established, and what it obligates the service to do

From `context/archive/2026-07-15-poc-cp-sat-backend-service/results.md`:

- **GO.** Mode A closes the golden residue (OPTIMAL/SAT in 0.7 s, complete oracle-verified board, 0 h unplaced both cohorts); G2 passes (teacherHoles 95 ≤ 148 bar); G3 passes (fabricated seed residue repaired in ~0.75 s). Large residues want Mode A (global), not Mode B — Mode B's niche is small interactive fix-ups.
- **The objective policy is the dominant product lever.** Same catalog, three tier orders → teacher gaps 75→124, student gaps 765→579. The service must ship the lexicographic order + hard/soft split as configuration, offer a "clean" mode (`softHits ≡ 0`), and surface the teacher/student trade-off rather than hide it.
- **Non-determinism is structural.** Two identical clean runs landed at different frontier points. Recommended stance: **solve-to-target** (stop when `teacherHoles ≤ X`) so outcomes are stable even when paths are not — the most product-friendly option and the recommended generate-path default.
- **A solve result is only meaningful against the exact snapshot it was produced from** — the persist path must re-check the pairing (the import experiment's drift guard already does: `bench/import-generated.experiment.ts:76,109-120`).
- **Dominance-check before presenting**: the canonical campaign board was dominated by the clean board; budget and order both matter.
- **The student tier is the hardest** (bound stays single-digit while incumbent sits in the hundreds) — give it the largest share of any stage budget.

### 2. The app-side integration seam (what exists, what's missing)

**The most important architectural fact: generation runs client-side today, in a browser Web Worker — there is no server-side generation endpoint at all.** The only server round-trip is the persist step.

Current flow:
- UI trigger: `src/_pages/plan-detail/ui/chrome/GenerateButton.tsx:17-67` (progress `{elapsed}s / {budget}s`, "Stop & keep" cancel).
- Snapshot assembly at click: `src/_pages/plan-detail/model/use-cohort-board-state.ts:168-178` → `assembleGeneratorSnapshot` (`src/entities/timetable/model/generation/assemble-snapshot.ts:33-51`), placements in as pins, parked bundles flattened.
- Orchestration: `src/_pages/plan-detail/model/generation/use-generate-plan.ts:102-158` spawns a Vite module worker; protocol `start/cancel ↔ progress/done/error` (`worker-protocol.ts:17-24`), budget `GENERATION_BUDGET_MS = 20_000` (`worker-protocol.ts:12`).
- Engine seam: `generate.worker.ts:38-46` calls `runVerifiedGeneration(generatePlanGreedy, snapshot, config, {signal, onProgress})`; the runner (`src/entities/timetable/model/generation/run.ts:16-31`) does precondition → injected engine → post-solve `verifyGeneration`. **The engine is injected — this is where a `generatePlanCpSat` substitutes.** `run.ts:4-10` explicitly names "a possible HTTP/CLI runner later".
- Port + diagnostics already anticipate CP-SAT: `GeneratePlan` (`types.ts:104-108`), `engine: "cp-sat"`, `provenOptimal`, `stopReason`, per-cohort `lowerBound` (`types.ts:64-83`).
- Persist: apply-time re-verify against the live board (`use-cohort-board-state.ts:116-146`, `reason:"stale"` if the board moved) → `applyGeneratedPlacements` action → `apply_generated_placements` RPC (`supabase/migrations/20260711202237_apply_generated_placements.sql`) — atomic, convergent, plan-scoped, both cohorts in one call.

**What does NOT exist (all net-new for an async service):**
- No async-job/polling/status pattern anywhere in `src/` (the only "run" state is client React state, `use-generate-plan.ts:14-17`).
- No Cloudflare bindings at all: `wrangler.jsonc` (15 lines) has no KV/R2/Queues/DO/D1/service bindings — just `nodejs_compat`, the `ASSETS` binding, and observability.
- No job/run tables in the database (confirmed against the full migration list).
- No CI lane for Python or a container: `.github/workflows/ci.yml` jobs are `verify`/`integration`/`e2e`/`bench` (non-blocking)/`deploy` (Supabase `db push` + `wrangler-action@v4`); nothing references `poc/`.

**Transport conventions that bind the design** (`context/foundation/lessons.md:19-24`): all app-data mutations and compute go through Astro Actions (thin handler: `requireSession` → `requireSupabase` → `runDomain`, `src/shared/lib/actions/define-domain-action.ts:13-26`); `src/pages/api/*` is the sanctioned carve-out for raw Request/Response needs (streaming, webhooks, external consumers). Start-job and poll-status fit Actions; only if progress streaming (SSE/WebSocket) is wanted later does an API route enter.

**The re-entry pipeline is already demonstrated end-to-end** by the POC import experiment: oracle gate against the exact solved snapshot → catalog drift guard (`assertCatalogMatches`) → `persistRegion` via the same RPC → analyzer comparison (`bench/import-generated.experiment.ts:54-90`, shared harness `bench/experiment-harness.ts:9-19`). The service's response handler is this experiment, relocated.

### 3. The POC package is the service core — audit of what carries over and what's missing

`poc/cp-sat/` (package `cpsat_engine`, uv, Python ≥3.12, ~1,300 LOC source + ~750 LOC tests). The package docstring itself declares "only the file transport is throwaway" (`src/cpsat_engine/__init__.py:12`) — and the audit confirms it:

- **Pure/transport-agnostic (service core):** `schema.py` (dump JSON → frozen dataclasses, opaque ids only, `formatVersion` gate), `model.py` (`build_model` → CpModel + all 9 hard rules, `PreconditionError`), `objective.py` (10 lexicographic tiers + clique-cut vars), `explain.py` (conflict set via assumptions — requires `num_workers=1`; max-completable framing). `solve.py` is pure except the optional per-stage log tee gated on `SolveConfig.log_dir` (pass `None` in a service).
- **Throwaway:** `cli.py` only (argparse, three-artifact file layout).
- **Linux-ready:** no absolute paths, no macOS assumptions, no module-level mutable state; uv.lock is multi-platform (manylinux x86_64 + aarch64 wheels for ortools 9.15.6755). Footprint: `.venv` ≈ 174 MB, dominated by ortools (66 MB) + pandas (47 MB) + numpy (24 MB) — pandas/numpy are unavoidable transitive deps of ortools that this code never imports.

**Gaps that are new work for the service (all confirmed absent):**
1. **No solve-to-target.** Everything is solve-to-budget (`max_time_in_seconds` per stage, `solve.py:463-487`); the only target-shaped stop is Mode A's pure feasibility solve. The POC's own recommendation #4 (solve-to-target for reproducibility) requires adding `CpSolverSolutionCallback.StopSearch()` / `best_bound_callback` / gap-limit support.
2. **No progress streaming.** Batch-only; the sole hook buffers CP-SAT's log text to a file after the fact. A job-status API wanting per-stage progress needs a solution callback surface.
3. **Non-deterministic by default.** `workers=0` (auto) everywhere except parity/evaluate; a service must pin `num_workers` explicitly (both for reproducibility stance and because auto-detect inside a cgroup-limited container is unreliable).
4. **Model rebuild per request** — `build_model(dump)` runs fresh each call (safe for concurrency, no cross-request leaks; each `CpSolver()` is per-stage). Acceptable at this load; worth a load-test for C++-side memory release in a long-running process.
5. **`cli.py` has zero tests**, golden-dump parity is CI-skipped (gitignored dump), and budget-timeout/`unknown`-outcome paths are untested — the HTTP wrapper should get the test attention the CLI never did.
6. **Wall-clock exposure:** full mode can hold a worker ~20+ min at default budgets — must be a job, never a request-scoped call.

### 4. Cloudflare platform options (verified against docs, 2026-07-16)

**Ruled out definitively:**
- **Python Workers (Pyodide):** native CPython extensions like ortools cannot run; ortools is not in Pyodide's package set (open unfulfilled request, pyodide/pyodide#5212). The Dec 2025 Python Workers improvements didn't change the native-extension story.
- **WASM CP-SAT in workerd:** workerd has no threads/SharedArrayBuffer substrate (unchanged in 2026), and the Workers CPU cap (30 s default, 5 min max on paid) can't host multi-minute solves. The 2026-07-11 spike's failure stands for workerd; multithreaded WASM CP-SAT exists for browsers/Node but does not transfer.

**Cloudflare Containers — the natural answer (GA 2026-04-13, on the already-paid Workers plan):**
- **Model:** a container is a Durable-Object-backed class bound to a Worker (`@cloudflare/containers`); the Worker is the programmable gateway (`getContainer(env.SOLVER, id)` → `start()` → `fetch()` into it). Lifecycle hooks (`onStart`/`onStop`/`onError`) catch crashes without polling. WebSocket forwarding is supported if push-based progress is ever wanted.
- **Instance types:** lite (1/16 vCPU) … **standard-4 (4 vCPU / 12 GiB / 20 GB disk)**; custom types 1–4 vCPU (min 3 GiB/vCPU). **4 vCPU is the hard per-instance ceiling.** Images must be **linux/amd64**; max image size = instance disk; 50 GB registry storage per account.
- **Scale-to-zero:** `sleepAfter` stops billing for memory/disk on idle; disk is ephemeral (fresh from image each start — fine for a stateless solver). Cold starts officially "often 1–3 s" for cached slim images.
- **Pricing (on top of $5/mo Workers Paid):** CPU $0.000020/vCPU-s after 375 included vCPU-min; memory $0.0000025/GiB-s after 25 GiB-h; disk after 200 GB-h. Worked estimate for this workload (5 solves/day × 5 min saturating 4 vCPU at peak, `sleepAfter 10m`): **≈ $7/month at peak, ~cents off-season.**
- **Placement:** regional pinning (2026-04-05) — pin **EEUR** to sit next to Supabase Frankfurt (deploy-plan already fixes Supabase region as load-bearing).
- **Deploy/ops:** Dockerfile referenced from `wrangler.jsonc`; one `wrangler deploy` builds + pushes to the Cloudflare registry (Docker required — preinstalled on GitHub `ubuntu-latest`). `wrangler containers ssh`/`instances`/`exec`, correlated container+Worker logs.
- **The one real gotcha:** container outbound is **ports 80/443 only** — no Postgres wire protocol (5432/6543) to Supabase. The container must use the HTTPS surface (supabase-js/PostgREST) — which is what the app uses anyway.
- **Autoscaling/latency-aware routing still unshipped** (docs: "planned") — irrelevant here; one named DO instance ("the solver") is exactly the right model for this workload.

**Async orchestration:** the idiomatic minimal pattern is Action → DO-addressed container `POST /solve` → container runs the solve on a background thread and writes status/result to Supabase over HTTPS → client polls a status Action. Writing status to Supabase (not container memory) survives container sleep and is the robust choice. Cloudflare Workflows (GA, per-step billing starts 2026-08-10) is optional insurance for retry durability, not necessary at a few solves/day. Queues: overkill.

**Off-Cloudflare alternatives (escape hatches):**
| | Max vCPU | Est. peak cost | Overhead |
|---|---|---|---|
| **Cloud Run** | 8 (60-min request timeout) | ~$4–10/mo | Highest (separate GCP project/IAM/billing) |
| **Fly.io Machines** | 8+ dedicated (perf-8x $0.3577/h) | ~$2–5/mo | Moderate (separate account, flyctl) |
| **Railway** | 8+ | ~$3–6/mo | Low, but fragile sleep semantics |

Choose Cloud Run/Fly only if calibration shows the hard instances materially need CP-SAT's 8-worker portfolio (see §5).

### 5. The M4 caveat — what the local numbers do and don't promise

The POC's protocol note is explicit: every number is from one run on one machine (M4, `num_workers=0` ≈ 11 workers). Portability facts:

- **CP-SAT is a portfolio solver, tuned for 16 workers** (Laurent Perron: minimum 8, sweet spot 16; true cores, not hyperthreads). At 4 workers you keep the LNS pool (starts at 2 workers) but lose portfolio diversity and most bound-improvement workers: **feasibility solves nearly unaffected; optimality proofs and lower-bound progress noticeably slower and higher-variance.**
- **Single-core gap:** M4 P-core ≈ 2.3–2.5× a good modern dedicated cloud core (Graviton4/Axion/Turin class; GB6 ~3,781 vs ~1,300–1,900), 2.5–3.5× a median shared vCPU. Combined with 11→4 workers: **apply a 3–5× wall-clock multiplier to local budgets.**
- **Concretely against the POC results:** Mode A 0.7 s → ~2–4 s (still interactive; **G1, the gate that decides the service, is hardware-insensitive**). Mode B seed repair ~0.75 s → ~2–3 s (still interactive — the hybrid affordance survives). The 243 s staged ladder → **~12–20 min** for M4-equivalent quality as a background job — or keep 30 s caps and accept weaker stage outcomes (tiers 3–10 were budget-capped FEASIBLE on the M4 anyway; the tier-4 bound was 2 at timeout, so headroom exists in both directions).
- **The right mitigation is strategic, not just budgetary:** solve-to-target (stop at `teacherHoles ≤ X`) makes the outcome hardware-independent; `max_deterministic_time` gives portable budget units; gap limits stop at "good enough". Don't chase `interleave_search` determinism (experimental, large overhead per or-tools#4783).
- **Memory is a non-issue:** ~10k-boolean model = a few MB per worker; low hundreds of MB total. The 3 GiB/vCPU floor on custom Cloudflare types means memory never binds.
- **Image reality:** `python:3.12-slim` + `pip install ortools` ≈ 300–400 MB uncompressed, built `--platform linux/amd64` from the ARM Mac. No official ortools base image (the community one was archived 2026-04-19).
- **Obligation for the route map:** a **calibration campaign on the production instance type** is a required phase — re-run the golden campaign (parity is hardware-independent; timings are not), set production budgets/targets from measured container numbers, and only then wire the UI promises (e.g. "clean mode in ~N minutes").

### 6. Options for implementing "the new module"

Three implementation shapes were considered for the solver's placement relative to the app:

1. **Same Worker + Container binding (recommended).** The existing `ib-timetable-planner` Worker gains a `Container` DO class + binding in `wrangler.jsonc`; Actions talk to the container directly. Lowest operational surface (one deployable pipeline, correlated logs, same account/token flow), matches the single-author load. Cost: the app deploy now builds a Docker image; CI needs Docker (already on runners) and the CF API token needs Containers scope (today it is `Workers Scripts: Edit` only — `context/deployment/deploy-plan.md:123-124`).
2. **Separate solver-gateway Worker + service binding.** Isolates deploy cadence (solver changes don't redeploy the app) at the cost of a second Worker, second secret set, and cross-Worker plumbing. Justified only if solver iteration becomes frequent and disruptive; can be adopted later without rework (the container class moves).
3. **External host (Cloud Run/Fly).** Only if the 4-vCPU ceiling proves binding in calibration. Highest overhead; keeps Cloudflare account risk diversity as a side benefit.

Within the app, the module boundary is already drawn: the remote engine is a `GeneratePlan` implementation (an HTTP client), `runVerifiedGeneration` relocates from the browser worker to the job pipeline, and the greedy Web Worker path remains untouched as the interactive/fallback engine (hybrid, per `generation-quality-tuning/change.md:209-211`).

### 7. Optimal architecture (target state)

```
Browser (plan-detail island)
  ├─ interactive: greedy engine in Web Worker (unchanged, 20 s budget, fallback path)
  └─ "Solve (CP-SAT)": Action startGenerationJob
        → assembleGeneratorSnapshot (server-side, same assembly the harness uses)
        → insert generation_jobs row (snapshot hash, policy config, status=queued)
        → getContainer(env.SOLVER, "solver").fetch(POST /solve {jobId, dump, policy, targets})
Container (services/solver, FastAPI + cpsat_engine, standard-4, EEUR, sleepAfter≈10m)
  ├─ solves on background thread: Mode A → ladder (policy-ordered tiers, solve-to-target)
  ├─ writes per-stage progress + final GenerationResult to Supabase over HTTPS
  └─ onStop/onError hooks mark job failed
Browser polls Action getGenerationJob(jobId)
  → on done: verifyGeneration (oracle) + apply-time re-verify + catalog drift guard
  → author reviews/dominance info → applyGeneratedPlacements RPC (existing, atomic)
```

Load-bearing choices, each traceable to a prior decision or POC finding:
- **Hybrid, not replacement** — greedy stays interactive/offline-capable (`generation-quality-tuning/change.md:209-211`); CP-SAT is the completeness/quality path.
- **Job state in Supabase, not in the container or DO** — survives container sleep/crash, keeps the app's single persistence story, gives the poller a plain Action. RLS + grants per the least-privilege lesson.
- **Oracle and persist unchanged** — `verifyGeneration` stays the single judge for any engine (portability invariant); `apply_generated_placements` stays the only write path; the drift guard from the import experiment becomes a production check.
- **Policy as configuration** — tier order, hard/soft split, clean mode, and solve targets are request fields with a documented default (canonical order), per the POC's "product dial" finding; boards are dominance-checked before presentation.
- **Solve-to-target as the generate-path default** — the POC's reproducibility stance, and the M4→cloud mitigation (§5).
- **PII posture preserved** — the dump is UUID-only by construction; names never reach the solver.

For the whole application this is an evolution, not an upheaval: the app remains a single Astro-on-Workers deployable plus one attached compute appliance; FSD layers, Actions-as-transport, and the deny-by-default middleware are untouched. The PRD needs a deliberate amendment — FR-016 currently specifies client-side-only generation and `prd.md:429-430` pins new logic to workerd; the auto-placement non-goal reversal (recorded in the roadmap) is the precedent for how to amend it honestly.

### 8. The monorepo question

**The repo is already a de-facto polyglot monorepo** — the POC put a uv-managed Python package at top level, deliberately invisible to steiger (scans `src/` only), ESLint (JS/TS globs + gitignore-derived ignores), Vitest, and CI. The existing `pnpm-workspace.yaml` declares no `packages:` — it exists only for `allowBuilds`/`overrides` — so there is no JS workspace to join either.

Recommendation: **formalize, don't tool up.**
- **Promote `poc/cp-sat/` → `services/solver/`** (name it as a deployable, not an experiment); keep uv + ruff + pytest self-contained; add the Dockerfile there. Update the gitignore paths and the `mise.toml` Python pin (the POC's own graduation criterion: "promote to `mise.toml` only if the POC graduates" — it has).
- **No Turborepo/Nx/pnpm-workspace packages.** Turborepo treats Python as an opaque shell command; Nx's `@nxlv/python` is community-owned and would force restructuring both sides. At one app + one service, their value ("many packages, shared build graph") doesn't exist. uv workspaces become relevant only if a second Python package appears.
- **No separate repo.** The wire contract (`GeneratorSnapshot`/`GenerationResult`) spans both sides and is guarded by an exact 10/10 parity gate; splitting repos would turn every contract change into a cross-repo dance and orphan the parity tests that make Python numbers trustworthy.
- **CI: path-filtered jobs, one workflow.** `dorny/paths-filter@v3` gates a `solver` job (ruff + pytest, peer of `verify`; the non-blocking `bench` job is the structural template) and a `deploy-solver` step on `services/solver/**` changes. `wrangler deploy` builds + pushes the image in one command (Docker preinstalled on `ubuntu-latest`; linux/amd64 is native there).
- **Contract sharing:** Zod schema in the app as source of truth → committed JSON Schema artifact → either generated Pydantic models (`datamodel-code-generator`) or the current hand-written dataclasses pinned by a golden-fixture parity test in both CIs. For exactly one contract, the parity-test-only option is defensible and is closest to what already exists (`formatVersion` gate + seed fixture round-trip tests).

### 9. Roadmap: POC → production-ready service

Phases ordered so each is independently shippable and the expensive unknowns (container performance) are measured before UI promises are made.

**Phase 0 — Decision record + PRD amendment (docs only).**
Amend FR-016/non-goals: generation gains a server-side async engine; workerd constraint scoped to app code, not the solver appliance (precedent: the auto-placement non-goal reversal). Record platform choice (CF Containers standard-4, EEUR) and the hybrid stance. Exit: updated `prd.md`, this change's `plan.md` scoped.

**Phase 1 — Promote the package; add the service transport.**
`poc/cp-sat/` → `services/solver/`. Add FastAPI wrapper (`POST /solve`, `GET /healthz`) over `solve.py` with `log_dir=None`, explicit `num_workers`, background-thread job execution, Supabase status writes (HTTPS). Add the missing solver capabilities the POC deferred: **solve-to-target** (solution/bound callbacks, gap limits), per-stage progress emission, pinned `num_workers=4`. Tests for the wrapper (the untested-CLI lesson). Dockerfile (`python:3.12-slim`, linux/amd64, ~300–400 MB). Exit: `docker run` locally solves the committed seed fixture end-to-end.

**Phase 2 — Contract + jobs schema.**
`generation_jobs` migration (id, plan id, snapshot hash, policy config, status, progress, result JSONB, error; RLS + grants per the least-privilege lesson). Freeze the dump/result wire contract: Zod schema on the app side, JSON Schema artifact committed, parity test in both test suites; bump `formatVersion` semantics documented. Exit: both sides validate the same golden fixtures in CI.

**Phase 3 — App integration (hybrid).**
Actions: `startGenerationJob` (server-side snapshot assembly + job insert + container kick-off), `getGenerationJob` (poll), `cancelGenerationJob`. Response handling: oracle verify + drift guard + apply-time re-verify → existing `applyGeneratedPlacements`. UI: second generate affordance with policy picker (canonical default, clean mode, teacher/student dial), progress from job rows, dominance info on completion. Greedy path untouched. Exit: solve-from-app round trip against a locally-run container.

**Phase 4 — Deploy lane.**
`wrangler.jsonc`: Container class + DO binding + migration. Broaden the CF API token for Containers; container secrets (Supabase URL + a scoped key) via the container config, not the Worker. CI: paths-filtered `solver` verify job + container deploy step in the existing single gate-then-deploy workflow. Exit: merge to main ships app + solver; `wrangler containers instances` shows the EEUR instance; correlated logs visible.

**Phase 5 — Calibration campaign on production hardware.**
Re-run the golden campaign against the deployed container (parity → Mode A → policy frontier), measure real wall-clocks at 4 vCPU, set production budgets/targets (largest share to the student tier), decide the Mode-A-timeout policy (extend vs fall back to full mode), and record a `results.md`-style verdict. This is the gate for switching the default generate path. If 4 vCPU disappoints badly, this is the decision point for Cloud Run (8 vCPU) — the container image is host-portable by construction. Exit: documented production solve envelope; go/no-go on making CP-SAT the default.

**Phase 6 — Hardening (as needed).**
Regression gate for solver quality (deterministic via `max_deterministic_time` or target-based assertions — the bench precedent is wall-clock-noisy and not in CI), Workflows adoption only if retry durability proves necessary, WebSocket progress only if polling UX disappoints, Mode B interactive repair surfaced in the board UI (its ~2–3 s container latency qualifies).

## Code References

- `src/entities/timetable/model/generation/run.ts:4-31` — the runner seam ("a possible HTTP/CLI runner later"); precondition → injected engine → oracle
- `src/entities/timetable/model/generation/types.ts:64-108` — `GeneratePlan` port; diagnostics pre-modeled for cp-sat (`engine`, `provenOptimal`, `lowerBound`, `stopReason`)
- `src/entities/timetable/model/generation/verify.ts:51-129` — the engine-agnostic oracle every returned board must pass
- `src/entities/timetable/model/generation/assemble-snapshot.ts:33-51` — single snapshot assembly (app + harness)
- `src/_pages/plan-detail/model/generation/use-generate-plan.ts:102-158` — client orchestration (busy/progress/cancel) to mirror for the job flow
- `src/_pages/plan-detail/model/generation/worker-protocol.ts:12` — `GENERATION_BUDGET_MS = 20_000` (the interactive budget the service escapes)
- `src/_pages/plan-detail/model/use-cohort-board-state.ts:116-146` — apply-time re-verify + stale guard + persist dispatch
- `src/_pages/plan-detail/api/placements.ts:112-133` + `supabase/migrations/20260711202237_apply_generated_placements.sql` — the atomic persist path (unchanged for the service)
- `src/shared/lib/actions/define-domain-action.ts:13-26` — the thin-action pattern new job actions must follow
- `bench/import-generated.experiment.ts:54-120` — the demonstrated re-entry pipeline: oracle gate, catalog drift guard (`assertCatalogMatches`), persist, analyze
- `bench/experiment-harness.ts:9-19` — shared assembly/persist so greedy and cp-sat cannot drift
- `poc/cp-sat/src/cpsat_engine/__init__.py:12` — "only the file transport is throwaway"
- `poc/cp-sat/src/cpsat_engine/solve.py:29-52,146-304,463-487` — `SolveConfig`/`SolveResult`, staged ladder, `to_generation_result`; budget-only stopping (no solve-to-target today)
- `poc/cp-sat/src/cpsat_engine/explain.py:34-76` — infeasibility conflict set (assumptions require `num_workers=1`)
- `poc/cp-sat/tests/test_objective.py:22-49` — exact 10-tuple parity pin (seed committed; golden skipped when dump absent)
- `wrangler.jsonc` — no bindings today; the Container class/binding lands here
- `.github/workflows/ci.yml:84-133` — `bench` (template for a non-blocking added job) and `deploy` (where the container lane slots in)
- `pnpm-workspace.yaml` — no `packages:` field; not a multi-package workspace
- `.gitignore:84-93` — POC data/venv ignores to migrate on promotion

## Architecture Insights

- **Every integration seam was left open on purpose, across four changes.** The port (`GeneratePlan`), the runner comment ("HTTP/CLI runner later"), the diagnostics fields (`engine: "cp-sat"`, `provenOptimal`), and the extracted engine-agnostic objective were all built in anticipation. The service is the payoff of that discipline, not a retrofit.
- **The oracle is the trust boundary, not the network.** `verifyGeneration` judging every engine's output — plus the apply-time re-verify and the drift guard — means a remote solver adds no new trust surface: a bad board cannot reach the database regardless of what the container returns.
- **Async is the genuinely new muscle.** The app has deliberately avoided background-job infrastructure (`has_background_jobs: false` in tech-stack.md; queues/DO named "a documented scale escape hatch only" since `port-grouping-algorithm`). This change is the moment that escape hatch opens — keeping it to one job table + one container binding honors the original minimalism.
- **Hardware-independence comes from the stopping rule, not the budget.** Solve-to-budget results are functions of the machine; solve-to-target results are functions of the catalog. The M4 caveat dissolves once targets, not wall-clocks, define "done" — wall-clock only determines *how long* the job runs, which calibration (Phase 5) measures.
- **The policy dial is a product feature disguised as solver config.** The three-board frontier showed tier order moves outcomes more than any budget. Shipping it as request-level configuration (with dominance checks) is what makes the service worth more than "greedy but complete".

## Historical Context (from prior changes)

- `context/archive/2026-07-15-poc-cp-sat-backend-service/results.md` — GO verdict, gates G1–G3, three-board frontier, productionisation next-steps list this research expands
- `context/archive/2026-07-12-generation-quality-tuning/change.md:186-216` — the service charter: container, async job with polling, TS engine as fallback, `verifyGeneration` stays the oracle
- `context/archive/2026-07-12-plan-quality-analyzer/change.md:23-27` — hybrid recommendation origin; "rules missing, not mis-specified"; digit-for-digit parity discipline
- `context/archive/2026-07-12-generation-engine-refactor/change.md:34-56,135-141` — engine-agnostic seams built for a second engine; `runVerifiedGeneration` as "the seam a future HTTP runner calls"
- `context/archive/2026-07-11-plan-generation/change.md:70-116` + `research.md:113-140` — WASM spike failure record (workerd: no threads); Containers named "held-in-reserve heavy option"; the engine contract
- `context/archive/2026-06-04-port-grouping-algorithm/research.md:116-117` — the original async/queued-compute escape hatch this change opens
- `context/archive/2026-07-10-batch-xlsx-export/research.md:35,96-106` — Workers compute envelope (CPU raisable to 5 min; no threads) — the ceiling the container exists to break past
- `context/foundation/prd.md:283-309,429-430` — FR-016 client-side framing + workerd pin: the PRD-level constraint Phase 0 amends
- `context/foundation/tech-stack.md:26-38` — `has_background_jobs: false`, "no background queues" — superseded deliberately by this change
- `context/deployment/deploy-plan.md:123-144,178-181` — single-Worker/single-lane deploy, narrow CF token, secrets posture — the deploy assumptions Phase 4 extends
- `context/foundation/infrastructure.md` — original platform selection (Workers), risk register; Containers were explicitly out of scope then ("Workers doesn't use containers") — now stale in that one respect

## Related Research

- `context/archive/2026-07-15-poc-cp-sat-backend-service/research.md` — the POC feasibility research (encoding inventory, reuse path §7 that this research productionises)
- `context/archive/2026-07-11-plan-generation/research.md` — original engine/solver viability research
- `context/archive/2026-07-12-generation-quality-tuning/research.md` — expert rule elicitation (R1–R21) behind the encoded model

External sources (checked 2026-07-16): Cloudflare Containers docs (limits, pricing, platform details, scaling-and-routing, outbound-traffic, image-management; GA changelog 2026-04-13), Workers Python packages docs + pyodide/pyodide#5212, Workers limits, Workflows limits/pricing, CP-SAT Primer (parameters), or-tools-discuss (Perron on worker counts), or-tools#4783 (interleave), sat_parameters.proto, PyPI ortools 9.15.6755, Geekbench 6 / PassMark single-core aggregates (M4 vs cloud vCPU), Cloud Run CPU/timeout/pricing docs, Fly.io pricing/suspend docs, Railway pricing/sleeping docs, Turborepo multi-language guide, @nxlv/python, uv workspaces docs, dorny/paths-filter, datamodel-code-generator.

## Open Questions

1. **Real cold-start + solve wall-clock for the actual image on a standard-4 instance** — the 3–5× multiplier is an estimate from benchmark proxies; Phase 5 calibration answers it with data. Includes verifying `num_workers=4` behavior under cgroup limits.
2. **Default policy order for production** — canonical vs clean as the shipped default is a product decision the frontier data informs but doesn't make; needs the user's call (likely with the expert).
3. **Solve-to-target thresholds** — which tiers get targets and at what values (e.g. `teacherHoles ≤ 148`? ≤ 100?); calibration + expert input.
4. **Mode-A-timeout policy** — extend budget vs fall back to `--mode full`, flagged open by the POC's next-steps; decide in Phase 3/5.
5. **Container secret scoping** — which Supabase key the container gets (a dedicated role limited to `generation_jobs` writes would be cleanest; needs a grants design consistent with the least-privilege lesson).
6. **CF API token broadening** — exact scopes Containers deploys require; verify against current Cloudflare docs when wiring Phase 4 (deploy-plan pins the current token to Workers Scripts only).
7. **Snapshot assembly location** — the job Action should assemble server-side from the DB (authoritative), but the client board may hold unsaved optimistic state; decide whether job start forces a settle/save first (the apply-time stale guard suggests yes).

## Follow-up Research 2026-07-16T13:55+02:00 — the 20-minute full-ladder job: does it change the architecture?

**Business premise (user):** the full quality ladder is the valuable deliverable — a valid-but-not-optimal board is worth much less. Given the ladder may take up to ~20 minutes on production hardware: does that change the architecture? Do we need a notification system? Should the plan under calculation be locked against edits?

**Verdict: the transport/platform architecture stands unchanged (async container job + durable Supabase job state). What changes is the product surface and the concurrency model — and the strongest answer to "should we lock the plan?" is "no: solve against a clone and deliver a proposal", which the codebase is already unusually well-equipped for.**

### 1. The stale-board problem — proposal clones beat locking

A 20-minute solve is computed against a snapshot taken at T0. If the author edits the plan during that window, the current guards (apply-time re-verify with `reason:"stale"`, `use-cohort-board-state.ts:116-146`; catalog drift guard, `bench/import-generated.experiment.ts:109-120`) protect **correctness** — a stale result is rejected, never misapplied. But rejection after 20 minutes wastes the run; that is the business problem. Three options were weighed:

- **(a) Pessimistic lock (user's suggestion): block edits while a job runs.** Correct but expensive: enforcement must cover every mutation family (placements, bundles, shelf, availability, undo/redo…) — realistically a `plans`-level flag checked in the shared action wrapper (`define-domain-action.ts:13-26`) plus UI affordances across the board — and it imposes a 20-minute read-only window on an app whose entire point is interactive editing. A failed or stale job wastes the lock time too.
- **(b) Solve against a clone; deliver a proposal (recommended).** `startGenerationJob` clones the plan (existing `clone_plan`, board included so current placements ride along as pins), exports the snapshot **from the clone**, solves, and imports the result **onto the clone**. The live plan is never touched and never locked. The author reviews the finished proposal side-by-side using the existing plan-comparison feature and adopts it deliberately. This is not a new invention — it is exactly the POC's own methodology ("one export + one solve + one import per board"; results.md: "a solve result is only meaningful against the exact snapshot/clone it was produced from"), and it composes with the three-board-frontier finding: multiple policy runs naturally become multiple comparable proposals.
- **(c) Optimistic in-place apply with drift check.** Keep editing free; on completion auto-apply only if the source is unchanged. Graceful, but as the sole mechanism it makes the 20-minute run a lottery.

**Recommended synthesis: (b) as the delivery model, with (c) as a convenience on top** — "Apply to source" succeeds only if the source plan still matches the solved snapshot (the drift guard, promoted from the import experiment to production code); otherwise the proposal remains available for comparison/adoption. A lightweight **advisory indicator** on the source plan ("a proposal is being computed from this plan's 13:42 state") replaces any hard lock. The lock surface shrinks to the job-owned clone itself (hidden or badge-marked until the job completes) — trivial compared to locking the live editing surface.

### 2. Cancel-keeps-best: the 20 minutes is not all-or-nothing

The staged ladder is monotone: tier 1 (completeness) solves in seconds even on 4 vCPU, and every completed stage hardens its tier before the next begins (`solve.py:347`). So a job interrupted at minute 8 still holds a **complete, oracle-verifiable board that is strictly better-ranked than greedy's** — the remaining minutes only polish lower tiers. The service should exploit this:

- The container **checkpoints the incumbent board + tuple to the job row after each completed stage** (this extends the Phase 1 "progress emission" gap — per-stage checkpointing, not just status text).
- The job UI gets a **"Stop & keep"** affordance that adopts the last checkpoint — deliberately mirroring the greedy path's existing cancel semantics (`use-generate-plan.ts:153-158`), so both engines share one product promise.
- This also de-risks SIGTERM: on shutdown the job row already holds the best completed stage.

Business reading: "full ladder = up to 20 minutes" is the *ceiling for full polish*, not the price of getting anything. The author sees quality accrue stage by stage and can stop when satisfied — which is solve-to-target with a human in the loop.

### 3. Notification system — durable job rows first; push channels are optional

At one author and a few solves/day, the need is **durability + visibility**, not push:

- **Baseline (sufficient):** the `generation_jobs` row is the source of truth; the plan-detail island polls while open (5–10 s interval — negligible load); the plans list shows a status badge ("solving — stage 6/10, 12 min"). Closing the laptop loses nothing; returning shows the finished proposal. This requires no new infrastructure beyond what Phase 2/3 already planned.
- **In-app completion toast** when the app is open: free by-product of polling.
- **Email on completion** (Resend/SES from a Worker, or Supabase edge function): a cheap Phase 6 nice-to-have that matches the "kick it off and walk away" usage; not architecture-bearing.
- **Supabase Realtime / WebSockets / Web Push: not recommended now.** Each adds a dependency the app has deliberately avoided, to eliminate a few seconds of polling latency on a 20-minute job. The Container platform supports WebSocket forwarding if this is ever revisited.

### 4. A verified platform wrinkle: `sleepAfter` vs a 20-minute solve

Confirmed against the `@cloudflare/containers` docs and repo (checked 2026-07-16): the sleep timer is reset by **incoming requests** — and since job status lives in Supabase (not polled through the container), a 20-minute solve with no inbound traffic **can be put to sleep mid-solve**. There is a known issue where the `sleepAfter` alarm fires during long-running operations (cloudflare/containers#162). The platform provides the fix:

- `renewActivityTimeout()` — callable from background work to count it as activity; and/or `keepAlive: true` (30 s heartbeat pings, never auto-timeout — pair with explicit `stop()` when the job ends so scale-to-zero still happens);

  > **Correction (2026-08-24, S-304).** `keepAlive` **does not exist** in `@cloudflare/containers@0.3.7` — grep over `dist/` returns nothing and it is absent from `ContainerOptions`. The two real APIs are `renewActivityTimeout()` and an overridable `onActivityExpired()` (default body: `this.stop()`), and S-304 ships the override. The `#162` citation above is separately stale — that issue was closed 2026-05-12. See `context/changes/job-aware-container-lifecycle/research.md` § 1.
- `onActivityExpired()` is overridable — guard it so the container only stops when no job is running;
- On shutdown: SIGTERM, then SIGKILL after **15 minutes** — ample for "persist checkpoint, mark job interrupted".

This is a Phase 1/4 implementation requirement, now recorded: **the container must actively renew its activity while a solve runs, and its stop path must be job-aware.** Sources: developers.cloudflare.com/containers/container-class/, github.com/cloudflare/containers (README + issue #162), containers FAQ.

### 5. Concurrency of jobs themselves

One job per source plan at a time (unique partial index on `generation_jobs` where status ∈ {queued, running}) keeps the model simple. If two plans need solving simultaneously, DO addressing gives one container instance **per job id** at no idle cost (`getContainer(env.SOLVER, jobId)`) — parallel solves without a queue. At this scale either stance works; per-job instances avoid head-of-line blocking for free.

### 6. Roadmap amendments from this follow-up

- **Phase 1**: add per-stage checkpointing (incumbent board + tuple per completed stage) and the activity-renewal/`keepAlive` + job-aware stop logic to the container wrapper. SIGTERM handler persists the last checkpoint.
- **Phase 2**: `generation_jobs` gains proposal-clone linkage (`proposal_plan_id`), per-stage checkpoint columns (or JSONB), and the one-active-job-per-plan partial unique index.
- **Phase 3**: delivery is **proposal-based** (clone → solve → import onto clone → compare/adopt), with optional drift-guarded "Apply to source"; advisory "proposal in progress" indicator on the source plan; "Stop & keep" job cancel mirroring the greedy affordance. **No plan locking.**
- **Phase 6**: email notification joins the as-needed list (ahead of WebSockets).
- **Open question 7 narrows**: with clone-at-start, the job snapshots the clone, so the "unsaved optimistic state" question becomes "settle the board before cloning" — same answer (force a settle on job start), smaller blast radius.

## Follow-up Research 2026-07-16T14:05+02:00 — the greedy engine: keep, freeze, or delete?

**Question (user):** with CP-SAT as the engine of record, is there any need to keep the existing greedy algorithm, or should it be cleaned up so the app relies on CP-SAT alone?

**Verdict: keep it frozen through the migration; retire it later behind an explicit gate — do not delete it in this change, and do not invest in it further.** The value reframe that decides this: by the stated value function (a complete full-ladder board ≫ a valid-but-incomplete one), greedy's *output* lost its product value the day the POC returned GO — greedy leaves 5–8 h unplaced and missed the teacher bar (217 vs ≤ 148; CP-SAT: 0 h, 95). Greedy is no longer a product feature. It is **operational infrastructure**, and should be judged — and eventually retired — on operational grounds.

### What greedy still does today (the four remaining roles)

1. **Zero-infrastructure fallback.** Greedy is the only engine that runs with no network, no container, no Cloudflare dependency — in the browser, off the loaded catalog. The solver path adds real failure modes (cold start, deploy regression, CF outage, the account-suspension risk already in infrastructure.md's risk register). Honest sizing of this value: *moderate, not critical* — generation is a planning-season activity, and the app's core (editing, validation, views) depends on no engine at all. If the solver is down for a day, the author edits manually or waits.
2. **Warm-start donor + same-instance baseline.** The dump contract carries greedy's board (CP-SAT's first incumbent) and its diagnostics. But this is an *accelerator, not a dependency*: the Python side self-starts (`_place_maximally` builds its own warm start, `solve.py:158-171`; Mode A feasibility solves in seconds even cold). The service does not need greedy to function.
3. **Clique lower bounds — the one genuine dependency.** The per-cohort max-weight-clique bound is computed by greedy's `problem.ts:131-156` B&B and consumed by the CP-SAT tier-3 cut ("free strength the solver demonstrably does not find alone" — POC research) and by diagnostics/analyzer context. This derivation currently lives *inside* `engines/greedy/` — contrary to the engine-refactor portability invariant that shared derivations belong outside the engine. **Extracting it to an engine-agnostic module is a precondition for any greedy retirement** (and worth doing during the service work regardless).
4. **Regression baseline.** `bench:generation` and the POC comparisons use greedy as the same-instance baseline. Retirement re-anchors regression to pinned CP-SAT numbers (which Phase 5 calibration produces anyway).

### The cost of keeping it (why "forever" is wrong too)

The recurring tax is **rule-change amplification**: every hard-rule change lands in three places — `verify.ts` (the definition), greedy's `fitsAt` mirror, and the Python encoding. Rules do evolve (day-scoped course rules landed 2026-07-11). The failure mode is safe (trust-but-verify rejects an invalid greedy board rather than persisting it) but degrades greedy silently. Quality-side investment is already past diminishing returns — the tuning change's own conclusion. Footprint: `engines/greedy/` is ~2,015 lines incl. tests; full retirement also removes the generate Web Worker path (`generate.worker.ts`, worker protocol, parts of `use-generate-plan.ts`) once the job flow replaces it.

### Recommended lifecycle (three stages, gate-driven)

- **Now → Phase 5 (build + calibrate): keep as-is, frozen.** Correctness-only maintenance (mirror new hard rules in `fitsAt`; no new operators, no tuning). Greedy is also what keeps the Generate button working while the service is built — removing the only working engine before its replacement is deployed and calibrated inverts the risk profile for zero gain.
- **At CP-SAT-default (post-calibration gate): demote.** CP-SAT proposals become the primary generate affordance; greedy drops to a secondary "quick local draft" / solver-unavailable fallback. Stop shipping greedy quality changes entirely.
- **Retire (a small dedicated change) when ALL of:** (a) CP-SAT has been the default through a full planning cycle without the fallback being needed; (b) Mode B interactive repair is shipped (superseding greedy's interactivity niche at ~2–3 s); (c) the clique-bound derivation is extracted out of `engines/greedy/`; (d) bench regression is re-anchored to pinned CP-SAT numbers; (e) PRD FR-016 is already engine-agnostic (Phase 0 should write the amendment that way, making retirement a PRD non-event).
- **Never deleted regardless:** `verify.ts` (oracle), `objective.ts`, `assemble-snapshot.ts`, deficits/golden-sets, the analyzer — engine-agnostic by construction; they define quality and correctness, and they were never greedy's.

### Roadmap amendment

- **Phase 1 (or 2) gains a small task:** extract the clique lower-bound derivation from `engines/greedy/problem.ts` into an engine-agnostic module (it feeds the dump contract and the CP-SAT cut, and it un-blocks eventual retirement).
- **Phase 0 PRD amendment:** write FR-016 engine-agnostic (an engine produces a verified board under a budget/target; the Web Worker and the service are both runners), so neither keeping nor retiring greedy requires another PRD pass.
- **Phase 6 backlog:** "retire greedy engine" recorded with the five-condition gate above — explicitly out of scope for this change.

> **Superseded by the 14:20 follow-up below:** the five-condition gate (notably "a full planning cycle on default") was challenged and compressed — deletion moves into the migration itself. See next section.

## Follow-up Research 2026-07-16T14:20+02:00 — challenge accepted: greedy deletion moves into the migration

**Challenge (user):** git history already preserves the reference that the algorithm existed and worked to some extent; deleting it buys maintainability and architectural cleanness — why keep it frozen at all?

**Revised verdict: the challenge partially lands — the endpoint changes from "freeze behind a five-condition gate" to "delete as a phase of this migration". The sequencing constraint survives unchanged.**

### What the challenge overturned

1. **The insurance argument was over-weighted.** The catastrophic scenario in the risk register — Cloudflare account suspension — takes down the Worker, i.e. the whole app, so a browser-side fallback engine dies with it. Greedy's insurance only covers "container path broken while the app is up" (bad solver deploy, Containers product outage). For a seasonal activity where manual editing is unaffected, that is an inconvenience measured in hours, not an outage. Small value.
2. **"Frozen" is not free.** The engine stays in the type graph (every shared-type refactor touches it), in CI time, and under the `fitsAt` mirror obligation for every future hard rule. The repo's own lessons register documents how retained-but-stale artifacts propagate false premises.
3. **The "full planning cycle on default" gate risked never firing** — an indefinite freeze by default, the worst of both worlds.
4. **The reference value genuinely lives in git + archives here.** The tuning/refactor archives document greedy's operator design and its measured ceiling (217 teacher gaps, 5–8 h residue) better than most living code is documented. Nothing knowledge-shaped is lost by deletion.

### What survives the challenge

1. **Sequencing is a hard constraint.** Greedy is the only working engine until Phase 5 completes; deleting it earlier regresses shipped FR-016 for the entire build with nothing to show. The challenge is read as "plan for deletion, not indefinite freezing" — not "delete before the replacement works."
2. **Deletion is one-way in practice.** Git preserves the reference, not a working fallback: a year of rule/type evolution means a restored greedy fails the oracle or the compiler — restoration ≈ rewrite. Acceptable, but the decision should be made knowing that.

### Revised lifecycle (replaces the three-stage/five-condition gate)

- **Phases 1–5:** greedy stays untouched (no ceremony, no investment — it simply keeps the Generate button alive).
- **New retirement phase (post-calibration, inside this migration):** delete `engines/greedy/` (~2,015 lines incl. tests) **and** the Web Worker generate path (`generate.worker.ts`, `worker-protocol.ts`, the worker-orchestration parts of `use-generate-plan.ts`) — the job/proposal flow replaces that client machinery, so this is a genuine cleanness gain, not just dead-code removal. The oracle/objective/snapshot/analyzer are untouched as always.
- **Three technical preconditions (facts, not judgment):**
  1. Clique lower-bound derivation extracted from `engines/greedy/problem.ts` to an engine-agnostic module (CP-SAT's tier-3 cut needs it regardless).
  2. Regression bench re-anchored to pinned CP-SAT numbers from Phase 5.
  3. **Hint-free Mode A measured during Phase 5 calibration** — every POC number was warm-started from a greedy board; cold-start feasibility was never measured. Seconds-scale cold Mode A (expected) confirms greedy's last functional role is dead; a blow-up is data wanted *before* deleting the warm-start source.
- **Consciously accepted cost:** solver path down ⇒ no generation until fixed (manual editing unaffected); the 20 s offline local draft disappears (near-zero value under the stated complete-board value function).

### Roadmap delta

Phase 5's calibration protocol gains the hint-free Mode A measurement; the former "Phase 6 backlog: retire greedy" becomes a first-class **retirement phase** of this migration, gated only on the calibration verdict and the proposal flow shipping.

## Follow-up Research 2026-07-16T14:35+02:00 — monorepo structure: role-named satellites; the app stays at root

**Question (user):** we agree the repo is already a de-facto monorepo — should it be structured more cleanly, with dedicated folders for the frontend and the backend service, open to future units (features, modules, a CLI) not bound to frontend/backend/terminal technology?

**Verdict: adopt the role-named structure now, but do NOT move the Astro app off the repo root. The "open for any kind of unit" property comes from role-named top-level directories, not from relocating the app — and relocating the app is where nearly all the cost of the classic `apps/` layout lives.**

### Recommended target layout

```
/                        # repo root = the Astro app (unchanged)
├── src/  bench/  public/  scripts/
├── supabase/            # stays root deliberately — SHARED infra: the solver writes
│                        # generation_jobs too; it is not "the frontend's database"
├── services/
│   └── solver/          # promoted poc/cp-sat — uv, FastAPI, Dockerfile (Phase 1)
├── contracts/           # Phase 2 lands here: wire-contract JSON Schemas + golden
│                        # fixtures — tech-neutral, consumed by both TS and Python;
│                        # owned by neither side
├── tools/               # future CLIs/automation, any language — created when the
│                        # first tool exists, not before
├── context/  docs/
```

Naming is by **role** (`services/`, `contracts/`, `tools/`), never by technology — any future unit (a provisioning CLI per the author-provisioning runbook, an export tool, a second service if rooms/multi-school ever lands) has an obvious home regardless of language. `contracts/` is structure *and* deliverable: Phase 2's schema artifacts placed where neither side owns them.

### Why the app does not move (the honest cost accounting)

1. **Tooling churn:** `astro.config.mjs`, `wrangler.jsonc`, steiger/eslint/vitest configs, `bench/` (aliased to `@/`), lefthook, the CI composite action and cache keys are all root-assuming. All mechanical, all risk-bearing, all product-value-zero.
2. **The reference fabric — the repo-specific cost.** The `context/` corpus, `CLAUDE.md`, lessons, and agent memories cite `src/...` paths hundreds of times; this is the navigation fabric that makes the agent workflow effective. Moving the app stales all of it at once (archives are forgivable historical snapshots; the living docs would need a full sweep — the "convention cites a mechanism" lesson is exactly this failure class).
3. **Timing:** a mechanical relocation at the front of the CP-SAT migration doubles the moving parts precisely when Phases 1–5 need stable ground.
4. **The workspace benefit doesn't require the move.** pnpm supports the root package as a workspace member — `pnpm-workspace.yaml` can gain `packages: ["services/*", "packages/*", "tools/*"]` with the app remaining the root package, whenever a second TS unit wants linking.

### Decision rule for the full `apps/` layout (deferred, concrete trigger)

Adopt `apps/web/` when either (a) a second **app** appears, or (b) ≥ 2 TS packages need workspace linking. The move costs the same whenever it is done — deferral loses nothing. If the symmetry is wanted earlier for its own sake, that is a legitimate preference — but it must be a **dedicated, purely mechanical change after the solver migration ships**, never sharing a diff with behavior changes, with the living-docs sweep (CLAUDE.md, README, foundation docs, steiger/CI paths) as part of its definition of done.

### Roadmap delta

Phase 1's promotion target is confirmed as `services/solver/`; Phase 2's contract artifacts land in `contracts/` (new top-level, tech-neutral) rather than inside either side; `tools/` is documented as the future-unit slot but not created empty. No `apps/` move inside this migration.

## Follow-up Research 2026-07-16T14:50+02:00 — running the whole stack locally + mise as the orchestrator

**Question (user):** can the whole stack run locally? Should we introduce orchestration (Makefile / dedicated script — or mise) to set everything up?

**Verdict: yes, the full stack runs locally — every component, at three fidelity tiers — and mise (the user's suggestion) is the right orchestrator for this repo: it is already present, already designated as the Python pin's graduation home by the POC decision, and it solves both toolchain bootstrap and polyglot tasks without adding Make culture.**

### Can it run locally? Yes — three fidelity tiers

Verified against the Containers local-dev docs (checked 2026-07-16): `wrangler dev` builds the container image from the local Dockerfile automatically and makes it routable via the local Worker (Docker-compatible engine required, e.g. Docker Desktop/Colima); Worker code hot-reloads, container rebuilds on `[r]`. The same support exists in the Cloudflare Vite plugin (`vite dev`) — which the `@astrojs/cloudflare` adapter's workerd dev path builds on, so `pnpm dev` may host the binding directly (**verify in Phase 4**; not load-bearing either way, see the transport fallback below).

- **Tier 1 — daily loop (no Docker for the solver):** local Supabase (exists) + `pnpm dev` on workerd (exists) + solver via `uv run uvicorn` natively. ortools ships macOS arm64 wheels; on the M4 the solver runs *faster* than production — great for iteration, but budgets/targets must never be tuned locally (that is Phase 5's calibration job; the M4 asymmetry cuts the friendly way for dev and the misleading way for tuning).
- **Tier 2 — prod-parity smoke:** `docker run` of the built linux/amd64 image instead of uvicorn. On Apple Silicon it runs under Rosetta/QEMU emulation — slower; fine for correctness smoke, never for performance conclusions.
- **Tier 3 — full fidelity (pre-deploy):** `wrangler dev` with the real Container binding, exercising the DO-gateway path end-to-end.

**Design requirement that makes Tier 1 possible (Phase 1/3):** the solver transport is env-gated — dev uses plain HTTP to `SOLVER_URL` (localhost:8000), production uses the container binding. Because job state flows through Supabase rows, the app-side code path is identical in both modes; the binding is a deploy detail, not an architecture fork.

### Orchestration: mise, not Makefile

- `mise.toml` already exists (PATH-entry only today), and the POC decision explicitly named mise as where the Python pin graduates "if the POC graduates to a real service" — it has.
- mise covers **both** needs: **toolchain bootstrap** (pin node 24.15.0, python 3.13, uv — one `mise install` sets up a machine) and **polyglot tasks** (language-neutral, `depends`, per-dir) — a Makefile would add a second convention for a subset of this.
- Task sketch: `mise run stack` (boot Supabase if down → background uvicorn → foreground `pnpm dev`), `mise run solver`, `mise run smoke:container` (build amd64 image + run seed-fixture solve), `mise run verify` (JS gates + ruff/pytest — and the `/verify` skill extends to match).
- Honest limitation: mise is a task runner, not a process manager — the stack task backgrounds the solver and foregrounds the app, which is fine at three processes; do not add overmind/foreman/compose-for-everything.
- Grain rule: pnpm scripts remain the JS-side canon (CLAUDE.md, CI, habit); mise tasks compose across ecosystems, they don't replace within one.

### Roadmap delta

Phase 1 gains: mise graduation (toolchain pins + task definitions), the env-gated `SOLVER_URL`/binding transport, and the Tier-1/Tier-2 dual local mode for the solver. Phase 4 gains: verify whether `pnpm dev` (Cloudflare Vite plugin) hosts the Container binding, else document `wrangler dev` as the Tier-3 path. CI's e2e job can run the solver natively (uvicorn on the Linux runner — no emulation penalty) once a proposal-flow E2E exists.
