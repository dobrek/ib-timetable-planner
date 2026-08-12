---
date: 2026-08-11T10:00:01+02:00
researcher: Dobromir Kropielnicki
git_commit: f9f12e483a48927b7dfd343686a3eeeb22f06c9a
branch: feat/solver-service-transport
repository: 10xdev3
topic: "Feasibility of implementing F-302 (solver-service-transport)"
tags: [research, codebase, feasibility, solver, cp-sat, http-transport, contracts, mise, mypy]
status: complete
last_updated: 2026-08-11
last_updated_by: Dobromir Kropielnicki
---

# Research: Feasibility of implementing F-302 (solver-service-transport)

**Date**: 2026-08-11T10:00:01+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `f9f12e483a48927b7dfd343686a3eeeb22f06c9a`
**Branch**: `feat/solver-service-transport`
**Repository**: 10xdev3

## Research Question

Is roadmap foundation task **F-302 "solver-service-transport"** feasible as written? Its outcome
(`context/foundation/roadmap.md:97`): promote `poc/cp-sat/` to `services/solver/`; add a thin HTTP
wrapper that accepts a solve job, runs the engine with a pinned worker count, and writes
status/results durably to the database over HTTPS; test at the wrapper level; let a developer run
the service natively against the app via the env-gated `SOLVER_URL` transport (local fidelity
tier 1), with mise carrying the toolchain pins.

Two scoping calls were made before research began: (1) assess both F-302 and the app-side seam and
**recommend where the cut falls** vs S-301; (2) resolve the open unknowns with **recommendations**,
not just a feasibility report.

## Summary

**F-302 is feasible, with no blockers.** Every load-bearing assumption it rests on was verified
rather than inferred, and all four held. The task is unusually well-prepared: F-301 did not merely
land a schema — it forward-designed the exact surface F-302 writes into, froze F-302's HTTP request
envelope in the contract, made the engine's dict-entry-point public _for_ F-302, and left a written
checklist in the credential runbook.

The work is real but almost entirely **mechanical**, and it splits into four unequal parts:

1. **The HTTP wrapper itself — small.** The engine is already transport-agnostic and side-effect-free
   when `log_dir=None`. The wrapper is routing + validation + a background thread + ~11 column writes.
2. **The promotion (`poc/cp-sat/` → `services/solver/`) — small but sharp-edged.** ~20 references
   across 10 files, one of which (`ci.yml`) gates `deploy`.
3. **The `mypy --strict` debt — the largest single item, and a policy decision.** Measured: **70
   errors** in `src/`, **38** in `tests/`.
4. **The app-side seam — needs a deliberate cut, because the obvious one is wrong.** See §6.

Four verifications that turn assumptions into facts:

| Assumption under F-302                                                             | Verified             | Result                                                           |
| ---------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------- |
| CP-SAT releases the GIL, so one process can solve _and_ serve                      | empirical probe      | **Yes** — 56 main-thread ticks during a live solve               |
| A solve can be interrupted from another thread (needed by S-303/S-305 later)       | empirical probe      | **Yes** — `stop_search()` returned in 0.00s                      |
| workerd can reach a native localhost service in dev (the tier-1 premise)           | `wrangler dev` probe | **Yes** — `OK status=200`, on the repo's pinned wrangler 4.102.0 |
| Hint-free Mode A works — `SolveRequest` carries no warm start (flagged unmeasured) | golden-dump run      | **Yes** — OPTIMAL, complete board, **0.7s** vs 0.6s hinted       |

That last one was the biggest open risk going in and is now retired: see §3.4.

### Verdict by outcome component

| F-302 outcome component                    | Verdict                                                         | Note                                                                  |
| ------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Promote `poc/cp-sat/` → `services/solver/` | **Feasible — mechanical**                                       | ~20 refs / 10 files; `ci.yml` gates `deploy` (§7)                     |
| Thin HTTP wrapper accepting a solve job    | **Feasible — envelope already frozen**                          | `SolveRequest` exists in the contract, projected by neither side (§2) |
| Run engine with pinned worker count        | **Already supported**                                           | `SolveConfig.workers` → `num_workers` (`solve.py:483`)                |
| Write status/results durably over HTTPS    | **Feasible — surface pre-built**                                | 11 grantable columns, `httpx` sufficient (§4, §5)                     |
| Wrapper-level tests                        | **Feasible**                                                    | `TestClient` + the existing 56-test pytest lane (§8)                  |
| Env-gated `SOLVER_URL` transport           | **Feasible — but shape it as transport, not as `GeneratePlan`** | §6 — the important finding                                            |
| mise toolchain pins                        | **Feasible — resolves a live inconsistency**                    | Three Python versions currently in play (§8)                          |

## Detailed Findings

### 1. The engine seam — what a wrapper actually calls

The POC was built to be wrapped, and it shows. `poc/cp-sat/src/cpsat_engine/__init__.py:12` states
"Only the file transport is throwaway; everything else is the service core," and `cli.py:1-8` says a
future service "wraps `solve` in HTTP without touching this file."

Entry points (`poc/cp-sat/src/cpsat_engine/solve.py`):

- `solve_staged(dump, config) -> SolveResult` (`solve.py:147`) — full 10-tier ladder
- `solve_complete(dump, config) -> SolveResult` (`solve.py:188`) — Mode A, then chains the ladder
- `solve_repair(dump, config) -> SolveResult` (`solve.py:232`) — Mode B
- `to_generation_result(dump, result, engine="cp-sat") -> dict` (`solve.py:268`) — pure shaping into
  the wire `GenerationResult`

`SolveConfig` (`solve.py:30-40`) already carries `workers` (→ `solver.parameters.num_workers`,
`solve.py:483`), `seed`, and the three budget fields. **Pinning the worker count needs no new code.**

**The engine is side-effect-free when `log_dir=None`** (`solve.py:489-493`): no `mkdir`, no log file,
no stdout. All `print()` lives in `cli.py`. A server can call the engine cleanly.

**Two gaps the wrapper must close:**

- **No progress or cancellation hook exists today.** Strictly batch: call, block, return. The only
  hook is `solver.log_callback = lines.append` (`solve.py:482`), which buffers text for a post-hoc
  file write. This is correct for F-302 (which explicitly excludes checkpoints and lifecycle) but
  see §3.3 for the cheap structural choice that keeps S-303/S-305 from needing a rewrite.
- **The engine performs no input validation.** `wire.py:28` is explicit: "Validation lives in the
  test lane (`jsonschema`, dev group), never in the solve path." `parse_snapshot` does raw dict key
  access (`schema.py:149-158`), so a malformed payload raises a bare `KeyError`, not a domain error.
  **A wrapper accepting arbitrary HTTP JSON must validate at the boundary** — see §9 R3.

**Error surface** the wrapper must translate:

- `PreconditionError` (`model.py:56`) — raised by `build_model` via `_assert_pins_precondition`
  (`model.py:370-379`) when the snapshot's pins already violate a hard rule. Every entry point calls
  `build_model`, so this is the primary domain error → a client-data failure, not a solver failure.
- Raw `KeyError`/`TypeError` on malformed input (above).
- **Silent non-exceptional failure:** a non-OPTIMAL/FEASIBLE status does _not_ raise — it yields
  `best=None` and continues (`solve.py:169-172`, `339-354`). The wrapper must inspect
  `SolveResult.proven_optimal` and `stages[*].status`, not rely on exceptions.

#### 1.1 The engine cannot accept a solve policy today — a roadmap-accuracy finding

The roadmap's S-307 risk line states that "policy is already request-level configuration in the
engine (the POC's ladder is policy-parameterized)" (`roadmap.md:194`). **Verified against the code:
it is not.**

- The tier order is a hardcoded tuple literal — `build_objective` (`objective.py:55-66`).
- `solve_staged` hardcodes the ladder as `range(1, 10)` (`solve.py:152`).
- `SolveConfig` (`solve.py:30-40`) has **no** tier-order field and **no** hard/soft field — only
  budgets, `seed`, `workers`, `hops`, `log_dir`.
- There is **no** `softHits`-as-hard-constraint code anywhere (i.e. "clean mode" is unimplemented),
  despite clean mode being FR-302's *shipped default*.

The POC's three-board frontier — teacher gaps swinging 75 → 124 and student gaps 579 → 824 on one
unchanged catalog (`context/archive/2026-07-15-poc-cp-sat-backend-service/results.md:120-150`) — was
therefore produced by editing the tier tuple, not through a public knob.

**Consequences.** Nothing for F-302, which never inspects `policy` (R2). But **S-307 is materially
larger than the roadmap implies**: it must plumb tier order + the hard/soft split through
`SolveConfig` and `_run_ladder` before any launch-time picker can mean anything, and it must
implement clean mode — which FR-302 already names as the default the product ships. Worth
re-scoping S-307 when it comes up; flagged here because F-302 is the change that made the engine's
public surface legible.

### 2. The HTTP envelope is already frozen — and projected by neither side

`contracts/generation-wire.schema.json` `$defs.SolveRequest` describes itself as _"The envelope the
future POST /solve wrapper (F-302) accepts."_ It is:

```json
{
  "required": ["formatVersion", "snapshot"],
  "additionalProperties": false,
  "properties": {
    "formatVersion": { "const": 1 },
    "snapshot": { "$ref": "#/$defs/GeneratorSnapshot" },
    "warmStart": { "type": "array", "items": { "$ref": "#/$defs/GeneratedPlacement" } }
  }
}
```

Correspondingly, `parse_snapshot` was deliberately made public (`schema.py:142-148`): _"Public because
the snapshot is a contract payload in its own right — the F-302 `SolveRequest` carries one without a
dump envelope around it."_ The dict-in entry point F-302 needs already exists.

**Three consequences:**

1. **`SolveRequest` has no TS type, no Python dataclass, no golden fixture, and no test.**
   `contracts/fixtures/` holds only `generator-snapshot.json` and `generation-result.json`;
   `test_contract.py`'s 16 tests cover snapshot + result only. So the both-suites contract gate that
   protects everything else **does not currently cover the envelope F-302 is built on.** F-302 owns
   projecting it — and should bring it under the same gate (§9 R4).

2. **`SolveRequest` carries no job identity and no policy.** With `additionalProperties: false`, the
   wrapper cannot smuggle a `jobId` into the body. Resolution in §9 R2.

3. **`Dump` ≠ `SolveRequest`.** The solve entry points take `Dump` (`schema.py:93-107`:
   `format_version`, `meta`, `snapshot`, `greedy_placements`, `greedy_diagnostics`, `objective`), but
   `SolveRequest` carries only `snapshot` + optional `warmStart`. The wrapper must construct a `Dump`
   with `greedy_diagnostics={}`, `objective=()`, `meta={}`. This degrades gracefully —
   `Dump.lower_bound` returns `None` on empty diagnostics (`schema.py:104-107`) and an empty hint
   board is a no-op — but it means a wrapper-driven solve runs **hint-free and without clique cuts**.
   That was the headline risk; measured and cleared in §3.4.

   > Caveat for later slices: `solve_repair`'s neighbourhood is computed from `greedy_placements`
   > (`solve.py:397-414`). Without a `warmStart`, everything reads as residue and the whole board is
   > freed — **Mode B is only meaningful when a real warm start is supplied.**

### 3. Concurrency, lifecycle, and the hint-free question — measured

#### 3.1 The GIL is released during solve

The decisive question for a single-process wrapper. Probed against the installed ortools 9.15.6755:
a hard model solved on a background thread while the main thread ticked every 50 ms.

```
main-thread ticks during a running solve: 56   (0 or 1 => GIL held; ~60 => released)
```

**The GIL is released.** One uvicorn process can run a 20-minute solve on a background thread and
still answer `/health` and `/status`. No multiprocessing, no external queue, no Celery.

#### 3.2 A running solve can be stopped from another thread

`CpSolver.stop_search()` exists in the installed version, is documented _"Stops the current search
asynchronously,"_ and is lock-guarded around a live `SolveWrapper`. Probed:

```
stop_search() -> thread ended: True after 0.00s
```

This is the mechanism S-305 ("Stop & keep") and S-304 (SIGTERM persistence) will need.

#### 3.3 Structural implication for F-302

F-302 correctly excludes checkpoints and lifecycle (`roadmap.md:106`). But since interruption depends
on **holding a reference to the live `CpSolver`**, and the engine currently constructs solvers
internally (`solve.py:469-486`), the cheap move is: have the wrapper keep a small in-process job
registry (`jobId → thread + handle`). That is a few lines now and avoids S-303/S-304/S-305 having to
re-architect the wrapper. Building the _behaviour_ stays out of scope; leaving the _seam_ does not.

#### 3.4 Hint-free Mode A — the flagged unknown, now retired

Hint-free Mode A was listed as unmeasured and a precondition for S-308/S-309
(`prd.md:380-389`). Since the wrapper's natural input carries no warm start (§2.3), this sat directly
on F-302's critical path. Measured on the golden dump by stripping exactly what `SolveRequest` cannot
carry (the 224 greedy placements and both cohort `lowerBound` values):

| Variant                                            | Tier-1 completeness          | Placements | Unplaced |
| -------------------------------------------------- | ---------------------------- | ---------- | -------- |
| **A — hinted** (greedy warm start + clique bounds) | `OPTIMAL best=0` in **0.6s** | 232        | 0        |
| **B — hint-free** (what `SolveRequest` carries)    | `OPTIMAL best=0` in **0.7s** | 232        | 0        |

The hinted run reproduces the POC's recorded 0.7s, confirming the harness. Hint-free costs
essentially nothing on this catalog and still returns a **complete board**.

> These are **feasibility probes on an M4, not calibration numbers.** The tuning-discipline rule
> (`prd.md:443-445`) reserves shipped budgets/targets to the S-308 production campaign. Nothing here
> should be promoted into a budget.

### 4. The database write surface — F-301 handed it over pre-built

`supabase/migrations/20260810200122_generation_jobs.sql` was forward-designed across all ten slices.
Everything a wrapper needs already exists: `status` (CHECK `queued|running|succeeded|failed|stopped|
interrupted`), `result` jsonb, `error`, `started_at`/`finished_at`/`heartbeat_at`, `stage_index`,
`stage_name`, `stages` jsonb, `checkpoint`, `checkpoint_stage_index`.

The solver's permissions, after the column-scoping fix in `f1db907`
(`supabase/migrations/20260810200931_solver_job_writer_role.sql`):

- **SELECT** — table-wide, every row (`using (true)`).
- **UPDATE** — exactly **11 columns**: `status, result, error, started_at, finished_at,
heartbeat_at, stage_index, stage_name, stages, checkpoint, checkpoint_stage_index`; only on rows
  currently `queued`/`running`; may never write the row back to `queued`.
- **No INSERT, no DELETE, no other table.** It cannot touch `snapshot`, `snapshot_hash`, `policy`,
  `plan_id`, `proposal_plan_id`, `delivery`, `delivered_plan_id`.

**No schema gap found for F-302** — no additive migration is required. The one absent concept is
worker/attempt bookkeeping (`worker_id`, `attempt`), which the design deliberately replaces with
`heartbeat_at` renewal. That is S-304's concern, not F-302's.

Behaviour is already pinned by `src/test/solver-credential.integration.test.ts` and
`src/test/generation-jobs.integration.test.ts`, so the wrapper's failure modes are known in advance:
`42501` outside the 11 columns, `23505` on double-enqueue, `23514` on a bad status string.

**Operational constraint:** the migration header and the runbook both require a **narrow column
projection** on every poll — `select()` with no argument drags the ~124 KB TOASTed snapshot each time.

**Canonicalization does _not_ apply to the DB write.** `contracts/README.md:66-70` names exactly two
byte-exact consumers: the golden fixtures and `generation_jobs.snapshot_hash` (a hash over
`snapshot`, not `result`). The `result` the solver writes must be _schema-conformant_, not
_byte-canonical_ — Postgres re-serializes jsonb anyway.

### 5. Authenticating from Python — settled, and lighter than expected

`docs/runbooks/solver-credential.md` resolves this and states it twice, independently of F-301's
research: **`httpx` alone is enough — no Supabase SDK is required**, which matters because the venv
pins protobuf/numpy tightly for ortools.

Sequence: the container holds `SUPABASE_URL`, `SUPABASE_KEY` (**publishable**, never a secret key),
and `SOLVER_MACHINE_PASSWORD`; it calls `POST /auth/v1/token?grant_type=password`; the Custom Access
Token Hook (`supabase/migrations/20260810200934_custom_access_token_hook.sql`) rewrites
`claims.role` to `solver_job_writer` when `app_metadata.machine_role` matches, fail-closed otherwise;
PostgREST `set role`s to that claim.

Two operational facts F-302 must honour, both already written down:

- **Re-run the password grant near expiry — never the refresh grant.** `jwt_expiry` is 3600s (a solve
  fits inside one token), and the runbook is explicit that the password grant demonstrably fires the
  hook while the refresh grant was never verified — _"a refresh that silently returned an
  `authenticated` token would be the exact escalation this design exists to prevent."_
- **The hosted hook is not yet enabled — and F-302 does not need it.** Hook config does not travel
  with `supabase db push`; the hosted project needs a one-time `supabase config push` or dashboard
  toggle. But the hook **is** enabled where F-302 runs: `supabase/config.toml`
  (`[auth.hook.custom_access_token] enabled = true`), which the CI `integration` job boots and
  `src/test/solver-credential.integration.test.ts` passes against. F-302 is local-fidelity tier 1 by
  definition and touches nothing hosted. See §5.1.

#### 5.1 Hosted enablement belongs to S-302, and must stay manual

**Not a prerequisite for starting F-302.** The gate is the first moment a *hosted* container
authenticates against *hosted* Supabase — S-302's deploy lane, and hard-required before S-308 runs
calibration jobs on production.

**It must stay manual**, for two independent reasons, neither of them inertia:

1. `supabase config push` rewrites the **whole** `config.toml` on the hosted project — auth rate
   limits, SMTP, providers, session settings. The runbook already made this call: extending the
   `deploy` job to push config "would let any merge change auth configuration."
2. Provisioning the hosted machine user needs `SUPABASE_SERVICE_ROLE_KEY`
   (`scripts/provision-solver-user.mjs:67`), which CI deliberately does not hold — the four repo
   secrets exclude it by design, and README is explicit that pointing CI at production is exactly
   what that separation prevents.

**The failure mode is escalation, not breakage** — the decisive point. Per
`supabase/config.toml:274-276`, disabling the hook is _"a silent escalation, not a degradation: the
machine user falls back to `authenticated`, which reaches the whole database."_ A container pointed
at hosted without the hook **does not error** — it signs in fine and silently holds full database
access. So token verification (`role` must decode to `solver_job_writer`) is a **gate before** the
first hosted container run, never a check afterwards.

**Runbook checklist split (done 2026-08-11).** `docs/runbooks/solver-credential.md` previously filed
all five items under "Checklist for F-302", mixing container behaviour with hosted setup — a trap in
both directions (premature hosted work, or a step mentally ticked off that never happens before the
first deploy, where the failure is silent escalation). Now two sections: **F-302 — the container's
own behaviour** (env vars, password-grant-not-refresh, narrow projections; all locally verifiable)
and **S-302 — hosted enablement** (`config push`, provision the machine user; both manual).

I verified there is no dependency-resolution obstacle. Three candidate stacks all co-resolve against
`ortools>=9.15,<9.16` with no protobuf/numpy conflict:

| Stack                                             | Packages | Notes                       |
| ------------------------------------------------- | -------- | --------------------------- |
| ortools + starlette + uvicorn + httpx             | 46       | lightest                    |
| **ortools + fastapi + uvicorn[standard] + httpx** | **78**   | recommended (§9 R1)         |
| ortools + supabase (SDK)                          | 105      | unnecessary per the runbook |

### 6. The app-side seam — and the recommended F-302 / S-301 cut

This is where the roadmap text most needs interpretation, and where the obvious reading is wrong.

**What already exists.** The engine-agnostic port is in place and was written for this:
`GeneratePlan` (`src/entities/timetable/model/generation/types.ts:122`) and `runVerifiedGeneration`
(`run.ts:16`), whose doc comment says every runner — _"the Web Worker today, a possible HTTP/CLI
runner later"_ — calls it rather than re-implementing the precondition and re-judge. Generation today
is **100% client-side**: the sole caller is `generate.worker.ts:38` with `generatePlanGreedy`
injected. **No generation Astro Action exists.**

**The trap.** It is tempting to have F-302 implement CP-SAT as a second `GeneratePlan`. That does not
fit. `GeneratePlan` is `(snapshot, config, hooks) => Promise<GenerationResult>` — a single awaited
call that returns the board. A CP-SAT job returns **202 Accepted** and delivers its result minutes
later **through a database row**. Forcing the async job into that port produces either a Worker
request held open for 20 minutes (impossible) or a fake promise wrapping a polling loop.

**The correct shape** — and it is compatible with the existing port, just at a different point:

- **Dispatch** is a _transport_, not an engine: `dispatchSolveJob(jobId, snapshot) -> Promise<void>`,
  returning as soon as the service accepts.
- **`runVerifiedGeneration` still applies — on the result-read side.** When S-301 reads a completed
  job row, it verifies the returned board through the existing oracle by injecting a trivial
  `GeneratePlan` that returns the already-fetched result. The trust boundary is preserved exactly;
  only the runner relocates server-side, which is precisely what `roadmap.md:113` calls "the relocated
  runner seam."

**`SOLVER_URL` is inherently dev-only.** Verified against current Cloudflare docs: production reaches
a container through a **Durable Object container binding** (`containers[].class_name` +
`durable_objects.bindings`), not a URL. So the transport function must abstract _URL fetch now,
container binding at S-302_ — which is exactly what the seed research anticipated
(`post-poc-cp-sat-refactoring-plan/research.md:444`: _"the binding is a deploy detail, not an
architecture fork"_).

**Reachability verified.** The repo had **zero outbound `fetch()` anywhere in `src/`** — F-302 would
be the Worker's first — and no doc confirmed workerd could reach a local process. Probed with a
minimal Worker under the repo's pinned wrangler 4.102.0 against a native HTTP server on 127.0.0.1:

```
OK status=200 body={"solver":"alive"}
```

**Env pattern to follow** — `astro:env/server`, not `import.meta.env` or `process.env`. Declare
`SOLVER_URL` in the `astro.config.mjs:75-80` schema with `optional: true`, mirroring
`SUPABASE_URL`/`SUPABASE_KEY`; the existing gating precedent is `src/app/config/config-status.ts:11-19`
(`configured: Boolean(...)`) plus `src/shared/api/supabase.ts:7-9` returning `null` when unset. Files
to touch: `astro.config.mjs`, `.env.example`, `.envs/local.vars`, `.envs/prod.vars`, and the
`.dev.vars` writer step in `ci.yml` if CI ever needs it.

> **Recommended cut.** F-302 ships: the Python service, the `SOLVER_URL` `astro:env` field, and a
> single typed dispatch function + health probe on the app side — nothing more. Its proof-of-life is
> a **dev script or integration test** that posts a real `SolveRequest` and observes the job row
> transition `queued → running → succeeded`, **not** a UI flow. S-301 keeps everything that makes it
> the north star: settle-then-clone, server-side snapshot assembly, the durable job record, the
> relocated oracle, and the atomic apply. This gives S-301 a working transport to build on without
> F-302 swallowing the slice that is supposed to prove the architecture.

### 7. Promotion blast radius

~20 references across 10 files (excluding `context/archive/**` and narrative foundation docs):

| File                                                     | What changes                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **`.github/workflows/ci.yml:103,116`**                   | `working-directory: poc/cp-sat` **twice** — job default _and_ the `setup-uv` step (the latter is separate by design, `ci.yml:107-110`) |
| `.gitignore:84,88,89,90`                                 | `/poc/cp-sat/data/`, `/poc/cp-sat/.venv/` (the `__pycache__/`-style globs carry over automatically)                                    |
| `.prettierignore:9`                                      | ignores bare `poc/` — a **new** `services/solver/` entry is required, or prettier starts touching the moved tree                       |
| `contracts/README.md`                                    | 7 lines, incl. `cd poc/cp-sat` **3×** in the goldens-regen script                                                                      |
| `bench/export-snapshot.experiment.ts:40,41,48`           | doc + default `OUT` fallback                                                                                                           |
| `bench/generate-contract-goldens.experiment.ts:17,34,44` | doc + default `DUMP` value                                                                                                             |
| `bench/contract-parity.test.ts:18`                       | doc comment naming the Python sibling                                                                                                  |
| `src/entities/timetable/model/generation/wire.ts:15,17`  | doc comments naming the Python mirror                                                                                                  |
| `CLAUDE.md:32,36`                                        | section header + frozen-contract paragraph                                                                                             |
| `poc/cp-sat/README.md`                                   | 6 self-referential paths                                                                                                               |

**The one real risk is `ci.yml`.** The `solver` job is already in `deploy.needs`, so a botched rename
breaks deploys rather than failing quietly.

**Confirmed non-issues:** `lefthook.yml` has no `.py` glob; `steiger` is scoped by `pnpm steiger src`;
ESLint flat-config simply matches nothing under a Python tree; `pnpm-workspace.yaml` declares no
`packages:` and a pure-Python service needs no entry; `package.json` has no solver reference (the
"solver steps never enter `package.json`" rule is currently honoured and should stay that way).

### 8. Toolchain — mise, mypy, and a version inconsistency

**mise is a 2-line stub** (`mise.toml`: a `node_modules/.bin` PATH shim, nothing else). F-302 is where
it graduates to toolchain pins + cross-ecosystem tasks, per `tech-stack.md:65-67`.

Doing so resolves a genuine inconsistency — **three Python versions are currently in play**:
`poc/cp-sat/.python-version` says `3.13`; `pyproject.toml` says `requires-python = ">=3.12"`; and
`tech-stack.md:51` names a `python:3.12-slim` image. The venv is actually on 3.13. F-302 should pin
one and make the image match.

**`mypy --strict` is the largest single work item, and it is a policy call.** CLAUDE.md states all
solver code stays fully type-annotated with `mypy --strict` as the gate, and that "if you touch
solver tooling before then, wire it up rather than skipping it." F-301 explicitly deferred it to
S-302 because mypy was not yet a dependency. **F-302 is the first change to substantially touch
solver tooling**, so it either wires the gate or records another deliberate deferral.

Measured (via an ephemeral `uv run --with mypy` overlay — no lockfile changes):

| File                           | `--strict` errors | Character                                                                                |
| ------------------------------ | ----------------: | ---------------------------------------------------------------------------------------- |
| `objective.py`                 |                26 | mostly one root cause: `Term = object` (`model.py:53`) vs `sum()`/`LinearExpr` operators |
| `solve.py`                     |                17 | ~15 bare `tuple` in `dict[tuple, int]`; 2 real fixes                                     |
| `model.py`                     |                13 | same `Term` ripple + 4 untyped `pins`/`strong` params                                    |
| `cli.py`                       |                11 | untyped `args`/`dump` params, bare `dict` returns                                        |
| `schema.py`                    |                 2 | generic args on `Dump.meta` / `greedy_diagnostics`                                       |
| `wire.py`                      |                 1 | one `no-any-return`                                                                      |
| `explain.py`, `__init__.py`    |                 0 | already strict-clean                                                                     |
| **`src/` total**               |            **70** |                                                                                          |
| `tests/` (with `MYPYPATH=src`) |                38 | needs `types-jsonschema`; a `py.typed` marker or `mypy_path`                             |

Good news: **ortools ships `py.typed`** (`ortools/sat/py.typed`) plus an 87 KB `.pyi` for the C
extension — the CP-SAT API is genuinely typed. Note `cli.py` **must** survive the promotion (the
goldens-regen script in `contracts/README.md` depends on it), so its 11 errors cannot be dodged by
deleting the file.

#### 8.1 `Term = object` is a placeholder, not a design decision — measured

`model.py:53` reads `Term = object  # cp_model.IntVar | int` — the intended type is in the comment.
Tested by patching a scratch copy and re-running `mypy --strict` (repo untouched):

| `Term = …`                        | total errors | `operator` | `arg-type` |
| --------------------------------- | -----------: | ---------: | ---------: |
| `object` (today)                  |           70 |          9 |         18 |
| `cp_model.IntVar \| int` (comment) |           49 |          0 |          7 |
| **`cp_model.LinearExpr \| int`**   |       **46** |      **0** |      **5** |

`LinearExpr` — not `IntVar` — is the correct base: `IntVar` subclasses it and the tier code builds
`LinearExpr` values. **One line removes 24 of the 70 errors, including every `operator` error.**
Runtime-verified: the union alias evaluates fine under 3.13.

The 5 residual `arg-type` errors are **list invariance** (`list[IntVar]` passed where `list[Term]` is
expected), fixed idiomatically by taking `Sequence[Term]` in ~4 helper signatures
(`_sum_var`, `_as_var`, and two siblings). No `cast()`s and no narrowing gymnastics are needed.

Also checked: `objective.py:208` is **not** a latent `None` bug — the code already filters with
`if d is not None`; the local just needs annotating.

**Post-fix remainder — 46 errors, all benign:** 20 `type-arg` (bare `tuple`/`dict`, the
`dict[tuple, int]` placement key ×15), 17 `no-untyped-def` (11 of them in `cli.py`), 5 `arg-type`
(the `Sequence` fix), and 4 singles including one real `CpSolverStatus`-typed-as-`int` mismatch
(`solve.py:486`).

**Existing test lane is healthy:** 56 tests in **7.45s**, no `conftest.py`, `builders.py` imported
directly. The slowest test is a real 4.11s Mode-A solve. Adding a wrapper suite is cheap.

**Also for F-302:** re-run `uv audit` after adding wrapper deps — `health-check.md:61-63` notes the
solver's audit surface is currently the single `ortools` dependency and the wrapper will grow it.

## Recommendations on the open unknowns

**R1 — HTTP framework: FastAPI.** `tech-stack.md:45-47` already names it; the PRD kept it formally
open as "a plan-phase detail" (`prd.md:349-351`). It resolves cleanly (78 packages, no ortools
conflict), and `TestClient` directly supplies the wrapper-level test surface FR-310 demands — which
is the whole point of the untested-`cli.py` lesson. Starlette alone (46 packages) is the fallback if
weight ever matters; the difference is not decision-relevant here.

**R2 — Job identity and policy — DECIDED 2026-08-11: zero schema edit, and F-302 ignores `policy`.**
`POST /jobs/{jobId}/solve` with an **unmodified** `SolveRequest` body.

- **`jobId` travels in the URL path.** `SolveRequest` is `additionalProperties: false`, so the body
  cannot carry it. The path is the only option that leaves the schema untouched.
- **F-302 does not read `policy` at all.** It solves the canonical order and records status/results.
  The app writes `policy` into the job row for the audit trail; **S-307 owns making the solver honour
  it** (see §1.1 — the engine cannot accept a policy today regardless).
- **`contracts/generation-wire.schema.json` is not edited by F-302.** No `formatVersion` bump, no
  golden regeneration, no bilateral commit. The alternative considered — adding `policy?` as an
  additive-optional property — was bump-free too (`contracts/README.md`, "Versioning") but was
  rejected: policy already lives in `generation_jobs.policy` (`jsonb not null`), so putting it in the
  envelope as well would create **two copies that can disagree**, working against the PRD's
  reproducibility guardrail. One authoritative home is better.

Consequences:

1. **The wrapper needs no DB read path for the solve itself** — only the status/result writes of §4.
   (This supersedes an earlier reading of this decision that assumed a `policy` SELECT.)
2. **Policy shape stays outside the frozen contract.** `generation_jobs.policy` is untyped `jsonb`
   and this keeps it that way. Harmless for F-302, which never inspects it; **S-307 is where that
   shape becomes user-visible** and should decide then whether it wants a formal home.

**R3 — Validate against the JSON Schema, not a hand-written Pydantic model.** The engine does raw
dict access and raises bare `KeyError` on malformed input (§1), so the boundary must validate. But a
Pydantic projection of `GeneratorSnapshot` would become a **third projection** of a contract that is
explicitly "owned by neither side" and free to drift. Validate the request body with `jsonschema`
against `contracts/generation-wire.schema.json` — the contract stays the single source of truth.
This moves `jsonschema` from the dev group to a runtime dependency, which is a deliberate, correct
change to its current "TEST-LANE concern only" comment in `pyproject.toml`.

**R4 — Bring `SolveRequest` under the both-suites contract gate.** It is the one `$def` with no
fixture and no test (§2.1). Add a `contracts/fixtures/solve-request.json` golden and assertions in
both `poc/cp-sat/tests/test_contract.py` and `bench/contract-parity.test.ts`, so F-302's own envelope
gets the discipline every other payload already has.

**R5 — Execution model: 202 + background thread + DB as the status channel.** Justified by the GIL
measurement (§3.1). Keep a `jobId → (thread, CpSolver handle)` registry so S-303/S-305 inherit a seam
rather than a rewrite (§3.3). Call the engine with `log_dir=None`.

**R6 — Supabase access: `httpx`, password grant only, narrow column projections.** Per the runbook
(§5). No Supabase SDK.

**R7 — Wire `mypy --strict` in F-302 rather than deferring again — DECIDED 2026-08-11 (land it,
early).** The gate lands as an **early phase, before the wrapper**, so the new HTTP module is written
under it rather than retrofitted — the module FR-310 singles out for attention because of the
untested-`cli.py` lesson is exactly the one that must not start life untyped. Scope: gate `src/`
strictly in F-302; take `tests/` (38 more, needs `types-jsonschema` + a `py.typed` marker or
`mypy_path`) in the same change only if it stays cheap. Sequence: `Term` one-liner (§8.1, −24) →
`Sequence[Term]` helpers (−5) → the mechanical `type-arg`/`no-untyped-def` pass → 4 singles.
Original rationale below.

**R8 — `Term = cp_model.LinearExpr | int` — DECIDED 2026-08-11.** Not a design choice; `Term = object`
was a placeholder whose own comment names the fix, one notch too narrow. Measured in §8.1: one line,
−24 errors, all `operator` errors gone, runtime-verified. Pair it with `Sequence[Term]` in the ~4
helper signatures that currently take `list[Term]`.

**R9 — Pin Python 3.13 everywhere — DECIDED 2026-08-11.** Three sources disagree today (§8): uv reads
`.python-version`, so local **and CI already run 3.13** — the only 3.12 in the story is the
not-yet-written production image, which would mean testing on 3.13 and shipping 3.12. Set
`requires-python = ">=3.13"`, keep `.python-version` at 3.13, and correct the image base to
`python:3.13-slim` when S-302 writes it. ortools 9.15 already runs on 3.13 here, so there is no
compatibility question.

**R10 — Idempotency: two layers, both free — DECIDED 2026-08-11.** The DB's partial unique index
enforces one active job *per plan* but does not stop a duplicate `POST` for the same `jobId` (a
dispatch retry after a slow 202), which would run two solves interleaving status writes.
(a) *In-process*: the `jobId → (thread, CpSolver handle)` registry from R5 doubles as the guard —
already registered ⇒ return without starting a second solve. (b) *Durable* (survives the container
restart that clears the registry): make the mandatory `status → 'running'` write **conditional** —
`WHERE id = ? AND status = 'queued'` — and proceed only if it affected a row. The write is required
anyway, so this costs one filter plus an affected-row check. Note the RLS `WITH CHECK` window permits
`running → running`, so the guard must be the `status = 'queued'` filter, **not** the policy.

*(R7 original rationale)* It is CLAUDE.md's standing rule,
the debt is quantified and mostly mechanical, and it is cheaper to fix 70 errors before a new HTTP
module lands than after. If deferred, record the reason explicitly, as F-301 did.

## Risks

| #   | Risk                                                                                | Severity | Mitigation                                                                            |
| --- | ----------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| 1   | `ci.yml`'s `solver` job hardcodes `poc/cp-sat` **twice** and sits in `deploy.needs` | **High** | Treat the rename as its own verified step; run CI before stacking wrapper work on top |
| 2   | ~~`mypy --strict` debt collides with CLAUDE.md's standing rule~~ **RESOLVED** — 70 → 46 after the §8.1 one-liner, remainder mechanical | Low | R7/R8 — gate lands as an early F-302 phase, before the wrapper |
| 3   | `SolveRequest` is ungated by the contract suite                                     | Medium   | R4                                                                                    |
| 4   | Engine raises bare `KeyError` on malformed input                                    | Medium   | R3 — validate at the boundary                                                         |
| 5   | Hosted Custom Access Token Hook not yet enabled — absence fails **upward** (machine user falls back to `authenticated`, reaching the whole DB, with no error) | Medium (S-302, not F-302) | §5.1 — manual `config push` + provisioning before the first hosted container run; token-claim verification is a gate. F-302 is unaffected (hook is live locally) |
| 6   | `.prettierignore` covers `poc/`, not `services/`                                    | Low      | New entry in the promotion commit                                                     |
| 7   | Mode B (`solve_repair`) is meaningless without `warmStart`                          | Low      | Not F-302 scope; note for S-301/S-303                                                 |
| 8   | Container image weight — venv is 177 MB (ortools 66 M, pandas 47 M, numpy 24 M)     | Low      | S-302's concern; noted so it is not a surprise                                        |
| 9   | **S-307 is under-scoped in the roadmap** — policy is not parameterized in the engine (§1.1) | Medium (downstream) | Not F-302 work; re-scope S-307 to include `SolveConfig` plumbing + clean-mode implementation |

## Code References

- `poc/cp-sat/src/cpsat_engine/solve.py:30-40` — `SolveConfig`, incl. `workers` and `log_dir`
- `poc/cp-sat/src/cpsat_engine/solve.py:147,188,232,268` — the four callable entry points
- `poc/cp-sat/src/cpsat_engine/solve.py:483` — `num_workers` / `max_time` / `random_seed` application
- `poc/cp-sat/src/cpsat_engine/solve.py:489-493` — `log_dir=None` ⇒ zero disk/stdout I/O
- `poc/cp-sat/src/cpsat_engine/schema.py:93-107` — `Dump` (what the engine takes)
- `poc/cp-sat/src/cpsat_engine/schema.py:142-158` — `parse_snapshot`, made public for F-302
- `poc/cp-sat/src/cpsat_engine/model.py:56` — `PreconditionError`
- `poc/cp-sat/src/cpsat_engine/wire.py:28` — "validation lives in the test lane, never in the solve path"
- `contracts/generation-wire.schema.json` `$defs.SolveRequest` — F-302's frozen HTTP envelope
- `contracts/README.md:66-70` — the only two byte-exact consumers (goldens, `snapshot_hash`)
- `contracts/README.md:126-138` — `formatVersion` bump policy
- `supabase/migrations/20260810200122_generation_jobs.sql` — table, CHECK, partial unique index, RLS
- `supabase/migrations/20260810200931_solver_job_writer_role.sql` — the 11-column UPDATE grant
- `supabase/migrations/20260810200934_custom_access_token_hook.sql` — role-claim rewrite
- `docs/runbooks/solver-credential.md:175-182` — the written F-302 checklist
- `src/entities/timetable/model/generation/types.ts:122` — the `GeneratePlan` port
- `src/entities/timetable/model/generation/run.ts:16` — `runVerifiedGeneration` (the runner seam)
- `src/_pages/plan-detail/model/generation/generate.worker.ts:38` — today's only caller
- `astro.config.mjs:75-80` — the `astro:env` schema (the `SOLVER_URL` pattern)
- `src/app/config/config-status.ts:11-19` — the env-gating precedent
- `.github/workflows/ci.yml:103,116` — the two `working-directory: poc/cp-sat` lines

## Architecture Insights

1. **This foundation was pre-paid.** F-301 froze F-302's request envelope, made the engine's dict
   entry point public _for_ F-302, forward-designed every column the wrapper writes, and left a
   checklist. The unusual thing about F-302 is how little design remains.
2. **The async job does not fit the `GeneratePlan` port — and does not need to.** The port applies on
   the _result-read_ side, not the dispatch side (§6). Recognizing this is what keeps the oracle trust
   boundary intact while relocating it server-side.
3. **`SOLVER_URL` is a dev-tier affordance, not the production transport.** Production is a Durable
   Object container binding. The seam must be a transport abstraction from the first line, or S-302
   pays for the shortcut.
4. **The contract is the validator.** The strongest reason to reject a Pydantic projection is
   architectural, not ergonomic: a third projection of a schema "owned by neither side" is exactly
   the drift the contract exists to prevent.
5. **Verify-don't-infer paid off four times here.** GIL release, external stop, workerd→localhost, and
   hint-free Mode A were all load-bearing and all unverified in the repo. Each was cheap to test and
   each could have distorted the plan.

## Historical Context (from prior changes)

- `context/archive/2026-08-10-solver-contract-and-jobs-schema/` (F-301) — the contract artifact, the
  jobs table, and the credential design. Its impl-review records the column-scoping fix (`f1db907`),
  found by probing live: as `solver_job_writer`, a table-wide UPDATE rewrote `snapshot`,
  `snapshot_hash`, `delivery` and `proposal_plan_id`.
- `context/archive/2026-07-15-poc-cp-sat-backend-service/` — the GO verdict. Mode A 0.7s, teacher
  gaps 95 vs the ≤148 bar, Mode B ~0.75s; full ladder ≈243s with tiers 3–10 hitting a 30s cap at
  FEASIBLE. Source of the **untested-`cli.py` lesson**: _"the HTTP wrapper should get the test
  attention the CLI never did."_
- `context/changes/post-poc-cp-sat-refactoring-plan/research.md` — the seed research. Settles
  POST-body snapshot delivery, `services/solver/` placement, the mise graduation, and the three
  local-fidelity tiers (`research.md:436-444`), including the env-gated `SOLVER_URL` premise this
  research verified.
- `context/foundation/health-check.md:187-199` — Fix 2 (`mypy --strict` for the solver) is still open.
  Its claim that solver tests "run nowhere in CI" is **stale**: F-301 landed the `solver` job.
- `context/foundation/infrastructure.md` — contains **no** Containers content (it predates the
  decision); the platform detail lives in the post-poc research. Not a contradiction, but do not
  expect it there.

## Related Research

- `context/changes/post-poc-cp-sat-refactoring-plan/research.md` — migration seed research
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md` — F-301
- `context/archive/2026-07-15-poc-cp-sat-backend-service/results.md` — POC measurements

## Open Questions

All four questions opened by this research were closed on 2026-08-11 — see R7–R10 and §8.1:

1. ~~Does `mypy --strict` land in F-302 or defer?~~ → **Land it, as an early phase** (R7).
2. ~~`Term = object` — narrow the alias or `cast()`?~~ → **`cp_model.LinearExpr | int`**, measured at
   −24 errors for one line; no `cast()`s (R8, §8.1).
3. ~~Which Python version is canonical?~~ → **3.13 everywhere** (R9).
4. ~~Does dispatch need an idempotency guard?~~ → **Yes; two layers, both free** (R10).

Still genuinely open, and owned elsewhere:

5. **How large is S-307 really?** §1.1 shows the engine cannot accept a policy today — the roadmap's
   "already request-level configuration" claim does not hold. Re-scope S-307 when it comes up; not
   F-302 work.
6. **Does `tests/` join the strict gate in F-302 or later?** R7 takes it only if cheap; 38 errors plus
   `types-jsonschema` and a `py.typed`/`mypy_path` decision.
