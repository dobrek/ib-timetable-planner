# Solver Deploy Lane (S-302) Implementation Plan

## Overview

Ship the CP-SAT solver as a Cloudflare Container attached to the existing Worker, so that **one merge to `main` deploys app + solver together**, and give the developer machine three local fidelity tiers — native solver, image smoke, and real container in local workerd — plus a one-command **hosted-solve campaign** (local app + native solver against the hosted database). Roadmap slice **S-302**, PRD FR-315 / FR-316, change id `solver-deploy-lane`.

The seam F-302 built holds: production changes the *factory input* of `SolverTransport` (a Durable Object container binding instead of a URL), not the call sites. The genuinely new work is (a) a project-owned Worker entry that exports the container's DO class, (b) the image and its CI build/push, (c) the local modes, and (d) a manual hosted-enablement gate that must precede the first production container start.

## Current State Analysis

Grounded in `context/changes/solver-deploy-lane/research.md` (read it first; its Spike result and Decisions taken are authoritative) and `change.md`.

- **Worker entry is framework-owned.** `wrangler.jsonc:4` points `main` at `@astrojs/cloudflare/entrypoints/server`, whose build emits a default export only. A container *must* be fronted by a DO class exported from the entry module. **Spiked and cleared 2026-08-16**: a project-owned `src/worker.ts` re-exporting `handle` from `@astrojs/cloudflare/handler` plus a named `SolverContainer` builds, survives Rolldown treeshaking, propagates `containers`/`durable_objects`/`migrations` into `dist/server/wrangler.json`, and passes `wrangler deploy --dry-run`. `steiger` ignores top-level `src/` files.
- **Typing**: `wrangler types` shadows DOM globals in React islands (`ExportMenu.tsx:131` breaks). A ~12-line hand-written ambient declaration (`declare module "cloudflare:workers"` + `Env`) gave `pnpm check` 0 errors. `@cloudflare/workers-types` is only a transitive dep of the adapter (pnpm, not hoisted).
- **Transport seam**: `src/entities/timetable/api/solver-transport.ts` (pure factory over `fetch`, `DISPATCH_TIMEOUT_MS = 15_000`), `solver-config.ts:24` (`getSolverTransport()` reads `SOLVER_URL` from `astro:env/server`; deliberately **not** barrel-exported), injected at `src/actions/index.ts:27`. `checkHealth` has no production consumer today.
- **Solver package** (`services/solver/`): uv, `src/cpsat_service/app.py:40-46` anchors the wire schema at `parents[4]` → the image must preserve `<root>/services/solver/src/…` beside `<root>/contracts/…` or every solve 500s while `/health` stays 200. `settings.py:31` `DEFAULT_WORKERS = 8`. `supabase.py:79-93` `sign_in()` stores the access token without inspecting claims. Neither launcher (`mise.toml:31`, `ci.yml:89`) passes `--host`; uvicorn defaults to loopback.
- **CI** (`.github/workflows/ci.yml`): `verify`/`integration`/`e2e`/`solver` run in parallel (critical path `e2e` 426 s; `solver` 44 s); `deploy` (`needs: [verify, integration, e2e, solver]`, push to `main` only) runs `astro sync` → build → `supabase db push` → `cloudflare/wrangler-action@v4 deploy` (pinned `4.102.0`). Docker 28 is on `ubuntu-latest`. The `solver` job comment says "Path filtering still arrives with S-302" — decided otherwise.
- **`@cloudflare/vite-plugin@1.42.0`** (verified in source during planning): a Dockerfile `image` path and `image_build_context` in the root `wrangler.jsonc` are resolved to **absolute paths** relative to the source config before the normalized `dist/server/wrangler.json` is written; image builds happen only at `astro dev`/`astro preview` server start and are gated by `dev.enable_containers` (top-level only, default `true`); `astro build` never builds an image; `wrangler deploy` builds/pushes it.
- **Env profiles**: `.envs/local.vars` (has `SOLVER_URL`), `.envs/prod.vars` (deliberately no `SOLVER_URL`, with a comment whose reason is inaccurate — see `change.md`); `pnpm env:local|env:prod` copy to `.env.local` **and** `.dev.vars`; preview/e2e read `.dev.vars`.
- **Runbook** `docs/runbooks/solver-credential.md` (uncommitted edits on this branch already prefer the dashboard toggle over `supabase config push`): three unticked hosted-enablement boxes.
- **No Dockerfile, no `.dockerignore`, no `@cloudflare/containers` dependency, no mise image tasks.**

## Desired End State

- `git push` to `main` → CI green → `deploy` applies migrations, builds the linux/amd64 solver image from the repo root, pushes it to the Cloudflare registry and deploys the Worker with `SolverContainer` (`standard-4`, `EEUR`, `max_instances: 1`, `sleepAfter: 30m`, `SOLVER_WORKERS=4`), all in one `wrangler deploy`.
- In production, Generate dispatches through the container binding; locally (`SOLVER_URL` set) it dispatches to the native solver — an explicit `SOLVER_URL` always wins.
- `mise run solver:image:build` / `solver:image:smoke` prove the image (tier 2); `mise run solver:tier3` runs the real container inside local workerd; `mise run solver:hosted` runs the one-command hosted-solve campaign; `pnpm dev`/`pnpm preview` never touch Docker.
- The solver refuses to run with a token whose `role` is not `solver_job_writer`.
- Docs tell the truth: no path filtering, roll-forward-only rollback, ~$15/mo, containers#162 closed, tier 3 mechanism, secrets channel.

**Verify**: `pnpm check` / `lint` / `steiger` / `test` / `build` green; `mise run solver:check` + `solver:test` green; tier-2 smoke returns 202; `wrangler deploy --dry-run` lists `env.SOLVER (SolverContainer)` and the container; after the merge, a production Generate on a scratch plan completes and `wrangler containers list`/dashboard show `standard-4`/`EEUR`.

### Key Discoveries

- `handle` is public at `@astrojs/cloudflare/handler` (`node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts:7`); `main` may be project-owned (Astro docs; spike).
- `import { env } from "cloudflare:workers"` is module-scope, so `getTransport: () => SolverTransport | null` keeps its signature; bindings cannot travel through `astro:env`.
- `@cloudflare/containers` `Container` class: `defaultPort`, `sleepAfter`, `envVars` (constructor may read `env` to forward secrets), `startAndWaitForPorts({ startOptions, ports, cancellationOptions: { portReadyTimeoutMS, instanceGetTimeoutMS } })`, `containerFetch(url, init, port)`; `getContainer(ns, id)` for a singleton (verified via Context7 during planning; re-verify signatures against the installed version when implementing).
- Dispatch answers 202 immediately, so **no request is in flight during a solve** — the default 10-min `sleepAfter` would sleep the container mid-solve. `sleepAfter = "30m"` is S-302's stopgap; S-304 owns the real lifecycle.
- The `contracts/` fail-open trap requires the tier-2 smoke to POST a real `SolveRequest` (`contracts/fixtures/`), not just `/health`.
- `wrangler containers push`/`deploy` require amd64; `.dockerignore` must exclude `services/solver/.venv` (arm64), `node_modules`, `.git`, `dist`.
- CF API token needs `Containers: Edit` in addition to `Workers Scripts: Edit` (evidence-backed, not doc-stated; fallback `Cloudchamber: Edit`).

## What We're NOT Doing

- **No path filtering** anywhere in `ci.yml`; `deploy.needs`/`if:` untouched (decision 2026-08-16).
- **No GHA Docker layer caching now** — measure deploy wall-clock first; it is the named lever if it bites (never path filters).
- **No empirical rollback test** — roll-forward-only is the shipped policy.
- **No E2E for Generate** — S-306 owns it. **No `@cloudflare/vitest-pool-workers`** lane.
- **No job-aware lifecycle** (activity renewal, SIGTERM checkpointing, CAS widening) — S-304. `sleepAfter 30m` is a stopgap and says so.
- **No image vulnerability scanner** — recorded as a known gap; base image pinned by tag `python:3.13-slim`, not digest.
- **No Secrets Store binding**; no egress `allowedHosts` hardening (noted as a follow-up).
- **No `wrangler types`**; no editing `.envs/prod.vars` to add `SOLVER_URL`.
- **No `supabase config push`** — dashboard toggle only.
- **No changes to `SOLVER_WORKERS` code default** (`8` stays the code default; `4` is set in container config; S-308 revisits).

## Implementation Approach

Build inside-out and keep every phase independently green: solver-side hardening and the image first (no app change), then the Worker entry + binding transport (app change, dry-run verifiable, no Docker), then the local modes on top of both, then the CI lane, then docs. The manual hosted gate is a distinct human phase placed **before** the merge; the merge itself is the last phase, with a production smoke that records the numbers S-304/S-308 will need. Single PR, squash-merged.

Two design rules carry through every phase: **explicit over inherited** (`instance_type`, `SOLVER_WORKERS`, `sleepAfter`, `--host`, `dev.enable_containers` are all set, never defaulted) and **`SOLVER_URL` wins over the binding**.

## Critical Implementation Details

- **Ordering — Dockerfile before container config.** Both wrangler and `@cloudflare/vite-plugin` resolve `containers[].image` as a Dockerfile via `fs.existsSync` at *config load*; a missing file is a config error. Once Phase 2's `wrangler.jsonc` block references `./services/solver/Dockerfile`, **every `pnpm build` (CI `verify`/`e2e` included), not just the dry-run, fails without it** — so Phase 1 must land first and the Dockerfile must be committed.
- **`wrangler deploy --dry-run` is not Docker-free.** Wrangler 4.102.0 runs `verifyDockerInstalled` + `docker build` (no push) for Dockerfile-backed containers even under `--dry-run`; only `--containers-rollout=none` skips the build. Two distinct checks therefore exist: `wrangler deploy --dry-run --containers-rollout=none` (Docker-free; proves the `env.SOLVER` binding, migration and entry) and a full `wrangler deploy --dry-run` with Docker running (also proves the image builds from the normalized config).
- **Image layout.** Preserve the repo-relative layout: `WORKDIR /app`, `COPY services/solver /app/services/solver`, `COPY contracts /app/contracts`, `uv sync --locked --no-dev` run *in* `/app/services/solver` (editable install writes an absolute `.pth`, so the venv must be created at its final path — no cross-stage relocation). `parents[4]` from `/app/services/solver/src/cpsat_service/app.py` is `/app`. Build context is the repo root (`image_build_context: "."`).
- **`.dockerignore` lands in the same commit as the Dockerfile.** Without it the context ships `node_modules` (~934 MB), `.git`, `dist`, and an arm64 `services/solver/.venv` that would poison the image.
- **Typing.** Hand-write `src/cloudflare-env.d.ts` (ambient `cloudflare:workers` module + `Env` interface with `SOLVER`, `SUPABASE_URL`, `SUPABASE_KEY`, `SOLVER_MACHINE_PASSWORD`). Never run `wrangler types`. If DO types are needed, add `@cloudflare/workers-types` as a devDependency scoped via a `/// <reference>` in that one file — and re-run `pnpm check` to confirm no DOM shadowing.
- **Client bundle.** Nothing importing `cloudflare:workers` or `@cloudflare/containers` may be reachable from `src/entities/timetable/index.ts` (pulled into ~20 islands). The binding transport factory stays pure (structural `ContainerLike` param); only `solver-config.ts` (already outside the barrel) and `src/worker.ts` touch the runtime modules.
- **Selector precedence.** `getSolverTransport()`: `SOLVER_URL` set → URL transport; else `env.SOLVER` present → binding transport; else `null`. Locally with `enable_containers=false` the binding *object* still exists in preview, so `pnpm env:prod` + preview will report a transport and a dispatch would fail at container start with a clear error — document this; the read-only smoke does not Generate.
- **Cold start.** Binding transport: `startAndWaitForPorts` with an explicit `portReadyTimeoutMS` (start at 45 s; constant with a "measure on the deployed container" comment) *then* `containerFetch` under the existing 15 s dispatch timeout — enforced Worker-side around the RPC promise, not as an `AbortSignal` in `init` (RPC args must be structured-cloneable). Errors distinguish "container did not come up" from `SolverDispatchError`.
- **Secrets channel.** `SolverContainer`'s constructor sets `this.envVars` from `env.SUPABASE_URL`, `env.SUPABASE_KEY`, `env.SOLVER_MACHINE_PASSWORD` plus literals `SOLVER_WORKERS=4`, `SOLVER_MAX_CONCURRENT_JOBS=1`, `SOLVER_LOG_LEVEL=INFO`. Worker secrets are the channel; there is no `containers[].configuration.secrets`.
- **Hosted-solve campaign writes to production.** The mise task must (1) print a loud confirmation, (2) wrap the solver in `caffeinate -i` (macOS) so a sleeping laptop cannot wedge a `running` row, (3) restore `pnpm env:local` on exit (trap), (4) never echo secrets. It sources `.envs/prod-solver.vars` (gitignored) which carries the trio *plus* `SOLVER_MACHINE_PASSWORD` for the hosted machine user.
- **CI e2e job** keeps working without Docker because `dev.enable_containers=false` (preview never builds the image). CI `deploy` builds it via `wrangler deploy` on the runner's Docker daemon; `wrangler-action` runs on the host, so the daemon is reachable.

---

## Phase 1: Solver hardening + container image (tier 2)

### Overview

Everything solver-side, with no app change: fail-closed role assertion, the Dockerfile + `.dockerignore`, `--host 0.0.0.0`, and mise tasks that build the amd64 image and smoke it with a real `SolveRequest`.

### Changes Required:

#### 1. Fail-closed role assertion at sign-in

**File**: `services/solver/src/cpsat_service/supabase.py` (+ `tests/` wrapper-level test)

**Intent**: After the password grant, decode the JWT payload (base64url middle segment; no signature check — we only guard against misconfiguration, not forgery) and refuse the token if `role != "solver_job_writer"`, raising a clear error naming the runbook's hosted-enablement section. Turns "hook not enabled → silent `authenticated`" from fail-upward into fail-closed.

**Where the check runs — twice, and the startup one is the visible one.** `sign_in()` is lazy today: first called from `_headers()` inside `claim()` on the worker thread (`supabase.py:79-93,149-153`), i.e. *after* the HTTP handler returned 202, and `_claim` swallows any exception and leaves the row `queued` (`runner.py:132-150`). A per-mint check alone would therefore fail silently: row stuck at `queued`, clone alive, one container log line. So:

1. **Startup assertion (FastAPI lifespan, `app.py`)**: when the credential trio is configured, sign in once at boot and assert the role; on a wrong role log the runbook pointer and exit non-zero. The container then never comes up, `startAndWaitForPorts` fails, and the dispatch error already flows through `generation-job.ts:78-86` (row → `failed`, clone deleted) — visible and self-cleaning. `/health` stays dependency-free (the check lives in lifespan, not `/health`); when the trio is *not* configured (bare `/health` boots) skip the check exactly as today.
2. **Per-mint assertion (`sign_in()`)**: the same check on every re-mint (tokens are re-minted hourly), so a hook disabled mid-life still fails closed — accepted that this path's only trace is the log line.

Also in the lifespan: **log the effective non-secret settings once at startup** (`SOLVER_WORKERS`, `SOLVER_MAX_CONCURRENT_JOBS`, `SOLVER_LOG_LEVEL`, machine email, whether the trio is configured — never the password or key). The service does not do this today (`app.py:38` only calls `basicConfig`); Phase 7's production smoke reads these lines to prove `SOLVER_WORKERS=4` is in effect.

**Contract**: `sign_in()` keeps returning `str`; on a wrong role it raises a `SupabaseError` subclass (the module's existing error style). Add a constant `REQUIRED_ROLE: Final = "solver_job_writer"` and a small pure `assert_role(token: str)` helper both call sites share. Tests (wrapper level, through the injected `httpx.Client` fake the suite already uses): happy path (role present), wrong role, missing claim, malformed token — for `sign_in()`; plus the lifespan path refuses to start on a wrong role and starts cleanly with the trio unset. `mypy --strict` clean.

#### 2. Bind uvicorn to all interfaces where the container needs it

**File**: `services/solver/Dockerfile` (CMD) — **not** `mise.toml:31` / `ci.yml:89`, which stay loopback.

**Intent**: The container must be reachable from the Worker; loopback would keep `/health` green inside while unreachable outside.

**Contract**: `CMD ["uv", "run", "--no-sync", "uvicorn", "cpsat_service.app:app", "--host", "0.0.0.0", "--port", "8000"]` (or the venv's `uvicorn` directly); `EXPOSE 8000` (needed for local `wrangler dev` port access).

#### 3. Dockerfile

**File**: `services/solver/Dockerfile`

**Intent**: A `python:3.13-slim`-based image, uv-installed from `uv.lock` with `--locked --no-dev`, preserving the repo layout so `parents[4]` resolves `contracts/`. Build context = repo root.

**Contract**: `FROM python:3.13-slim` (tag, not digest); install uv (pinned to the same `0.12.3` as `mise.toml`/CI); `WORKDIR /app`; `COPY contracts /app/contracts`; `COPY services/solver /app/services/solver`; `RUN cd /app/services/solver && uv sync --locked --no-dev`; run as non-root; `ENV` for `SOLVER_WORKERS` etc. is **not** baked (comes from `envVars`); `EXPOSE 8000`; CMD from item 2. Comment the `parents[4]` obligation inline, citing `app.py:40-46`.

#### 4. `.dockerignore`

**File**: `.dockerignore` (repo root — same commit as the Dockerfile)

**Intent**: Keep the context to `services/solver/` sources + `contracts/`.

**Contract**: **Positive-list style** — `*`, then `!contracts/**` and `!services/solver/**`, then re-exclude inside the allowed trees: `services/solver/.venv`, `**/__pycache__`, `**/.pytest_cache`, `**/.mypy_cache`, `**/.ruff_cache`. A deny-list would have to enumerate `node_modules`, `.git`, `dist`, `.astro`, `.wrangler`, `data/`, `context/`, `docs/`, `e2e/`, `src/`, `public/`, `supabase/` **and** every secret-bearing file (`.envs/`, `.env*`, `.dev.vars`) — and stays wrong the day a new top-level directory appears; the positive list cannot leak by omission.

#### 5. mise tasks — build + smoke

**File**: `mise.toml`

**Intent**: Tier 2 = build the amd64 image and smoke it *from outside the container* by POSTing a golden `SolveRequest` and asserting **202** (the `contracts/` fail-open trap makes `/health` alone insufficient).

**Contract**: `solver:image:build` → `docker build --platform linux/amd64 -f services/solver/Dockerfile -t ib-solver:local .`; `solver:image:smoke` → runs the image with `-p 8000:8000`, env trio pointing at the local stack via `host.docker.internal:54321` (`SUPABASE_KEY` = the local publishable key; `SOLVER_MACHINE_PASSWORD` read from the caller's shell — the same way `solver:dev` gets it today — and the task **fails fast with a named message if it is unset**, since a bare container would otherwise boot fine and 500 later), waits on `/health`, POSTs `contracts/fixtures/<solve-request golden>` to `/jobs/<uuid>/solve` and asserts 202, then stops the container. Print `SCHEMA_PATH` resolution failure hints on 500. Document that Docker Desktop must be running and that timing conclusions from emulated amd64 are invalid.

### Success Criteria:

#### Automated Verification:

- `mise run solver:check` (ruff + mypy --strict) passes
- `mise run solver:test` passes, including the new role-assertion tests
- `mise run solver:image:build` produces a linux/amd64 image (`docker image inspect … --format '{{.Architecture}}'` = `amd64`)
- `mise run solver:image:smoke` returns 202 for the golden fixture against the local Supabase stack

#### Manual Verification:

- Image size is in the ~330–450 MB range (sanity, not a gate)
- Smoke log shows the job row advancing to `running`/`succeeded` in the local `generation_jobs`
- Role assertion observed to refuse a token when the local hook is temporarily disabled (optional drill; re-enable afterwards)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Worker entry, container binding, transport selector

### Overview

The app-side half: a project-owned Worker entry exporting `SolverContainer`, the container config in `wrangler.jsonc`, ambient types, the binding transport + selector with unit tests. Verifiable with `pnpm build && wrangler deploy --dry-run --containers-rollout=none` without Docker; the full `--dry-run` (which builds the image) needs Docker running.

### Changes Required:

#### 1. Dependency

**File**: `package.json`

**Intent**: Add `@cloudflare/containers` (latest, ≥ 0.3.7 — the version with the in-flight-tracking and race fixes) as a runtime dependency. Add `@cloudflare/workers-types` as a devDependency **only if** the ambient declaration cannot be written without it (see Critical Details).

#### 2. Worker entry

**File**: `src/worker.ts` (new), `wrangler.jsonc` (`main`)

**Intent**: Own the entry so a named DO class can be exported alongside Astro's handler.

**Contract**: `import { handle } from "@astrojs/cloudflare/handler"; export { SolverContainer } from "./solver-container"; export default { fetch: handle } satisfies ExportedHandler<Env>;` — `main: "./src/worker.ts"`. Comment why (container ⇒ DO class ⇒ must be exported from the entry; steiger does not inspect top-level `src/` files).

#### 3. Container class

**File**: `src/solver-container.ts` (new)

**Intent**: The DO fronting the container: port, sleep policy, secrets forwarding, and lifecycle logging.

**Contract**: `export class SolverContainer extends Container<Env>` with `defaultPort = 8000`, `sleepAfter = "30m"` (comment: stopgap above the PRD's 20-min job ceiling because dispatch is 202-and-detach; S-304 owns activity renewal), constructor forwarding `env.SUPABASE_URL`, `env.SUPABASE_KEY`, `env.SOLVER_MACHINE_PASSWORD` + literals `SOLVER_WORKERS="4"`, `SOLVER_MAX_CONCURRENT_JOBS="1"`, `SOLVER_LOG_LEVEL="INFO"` into `this.envVars`; `onStart`/`onStop`/`onError` log to console (observability is enabled on the Worker). Never log secret values.

#### 4. Ambient types

**File**: `src/cloudflare-env.d.ts` (new)

**Intent**: Type `cloudflare:workers` and the global `Env` the adapter's `handle` expects, without `wrangler types`.

**Contract**: `declare module "cloudflare:workers" { export const env: Env; export class DurableObject … }` as needed; `interface Env { SOLVER: DurableObjectNamespace<SolverContainer>; SUPABASE_URL?: string; SUPABASE_KEY?: string; SOLVER_MACHINE_PASSWORD?: string; }`. `pnpm check` must stay 0/0 (the spike's 12-line shape is the reference).

#### 5. `wrangler.jsonc` container config

**File**: `wrangler.jsonc`

**Intent**: Declare the container, its DO binding and migration, and keep local dev/preview Docker-free.

**Contract**: `containers: [{ class_name: "SolverContainer", image: "./services/solver/Dockerfile", image_build_context: ".", instance_type: "standard-4", max_instances: 1, constraints: { regions: ["EEUR"] }, rollout_active_grace_period: <≥ the PRD's 20-min job ceiling> }]`; `durable_objects.bindings: [{ name: "SOLVER", class_name: "SolverContainer" }]`; `migrations: [{ tag: "v1", new_sqlite_classes: ["SolverContainer"] }]`; `dev: { enable_containers: false }`. Every value gets a one-line comment stating *why explicit* (defaults are `lite`/unbounded/any-region/`true`). Verify field names against `node_modules/wrangler/config-schema.json` (`ContainerApp`), not memory.

**Deploy-during-solve.** With no path filters, every merge to `main` runs `wrangler deploy`; when the image changes the container rolls out and, at `max_instances: 1`, the running instance is the one replaced — a 12–20 min solve in flight would die and leave a wedged `running` row (S-304's problem, but S-302 must not make it routine). `rollout_active_grace_period` (present in the installed schema alongside `rollout_step_percentage`) is the lever. **Before setting it, read its exact semantics from the current Cloudflare Containers rollout docs** (CLAUDE.md: never from memory) — what "active" means, whether it delays the deploy or lets the old instance drain, and whether an unchanged image digest triggers a rollout at all — and record the answer in the config comment and `change.md`. If the docs show it does not protect an in-flight solve, keep the field explicit anyway, document "do not merge to `main` while a production solve is running" in the README Deployment section, and hand the mechanism to S-304.

#### 6. Binding transport (pure)

**File**: `src/entities/timetable/api/solver-binding-transport.ts` (new; not barrel-exported) + `solver-binding-transport.test.ts`

**Intent**: The second `SolverTransport` implementation, over a structural container handle so it is unit-testable in plain vitest.

**Contract**: `type ContainerLike = Pick<Container, "startAndWaitForPorts" | "containerFetch">` (declared structurally, no runtime import); `createBindingSolverTransport(container: ContainerLike): SolverTransport`. `dispatchSolveJob`: `startAndWaitForPorts({ ports: 8000, cancellationOptions: { portReadyTimeoutMS: CONTAINER_START_TIMEOUT_MS } })` then `containerFetch("/jobs/<id>/solve", { method: "POST", body: canonicalizeSolveRequest(request), headers }, 8000)`; 202 is the only success (reuse `SolverDispatchError`); a start failure surfaces as a distinct error type/message. **Timeouts are enforced Worker-side, never passed over RPC**: the container handle is a Durable Object stub, so every argument crosses Workers RPC and must be structured-cloneable — an `AbortSignal` in `init` is not (the URL transport's `signal: AbortSignal.timeout(...)` idiom does not carry over). Wrap the `containerFetch` promise in a small `withTimeout(promise, DISPATCH_TIMEOUT_MS)` helper (rejects with the same dispatch-failure error class); `startAndWaitForPorts` already carries its own `portReadyTimeoutMS`. First step of this item: install `@cloudflare/containers` and re-verify the exact `startAndWaitForPorts`/`containerFetch` signatures and RPC-arg shapes against the installed version (if `containerFetch` proves awkward over RPC, the fallback is `stub.fetch(new Request(url, init))` — `Container.fetch` proxies to `defaultPort` and starts the container itself — at the cost of a blurrier "not up" vs "refused" split, which the error mapping must then recover from the response). `checkHealth`: `containerFetch("/health")` → `ok`, never throws (note in a comment that it wakes the container). Export the shared constants from `solver-transport.ts` rather than duplicating. Tests: URL path untouched; binding start-then-POST order; 202-only; start failure vs dispatch failure; Worker-side timeout fires as a dispatch failure; health never throws.

#### 7. Selector

**File**: `src/entities/timetable/api/solver-config.ts` (+ a pure `select-solver-transport.ts` with tests, if the precedence logic is more than one line)

**Intent**: Explicit `SOLVER_URL` wins; binding is the fallback; `null` when neither.

**Contract**: `getSolverTransport(): SolverTransport | null` — `SOLVER_URL ? createSolverTransport(SOLVER_URL) : env.SOLVER ? createBindingSolverTransport(getContainer(env.SOLVER, "solver")) : null`, with `env` from `cloudflare:workers` and `getContainer` from `@cloudflare/containers`. Update the module docblock (it currently promises "when production moves to a binding, this module is what changes" — make it so). Precedence unit-tested through the pure helper with fakes.

#### 8. Comments that will be false after this phase

**File**: `astro.config.mjs:79-84`, `src/entities/timetable/api/solver-transport.ts` docblock, `.envs/prod.vars` comment (restated in Phase 3)

**Intent**: Truth-up in-code prose that named S-302 as future work.

### Success Criteria:

#### Automated Verification:

- `pnpm exec astro sync && pnpm check` — 0 errors, 0 warnings
- `pnpm lint`, `pnpm steiger`, `pnpm test` pass (new transport/selector tests included)
- `pnpm build` succeeds; `dist/server/entry.mjs` exports `SolverContainer`; `dist/server/wrangler.json` carries `containers` (absolute image path + build context), the DO binding, the migration and `dev.enable_containers: false`
- `pnpm exec wrangler deploy --dry-run --containers-rollout=none` (Docker-free) lists `env.SOLVER (SolverContainer) → Durable Object`; a full `pnpm exec wrangler deploy --dry-run` with Docker running additionally builds the image and lists the container

#### Manual Verification:

- `pnpm env:local && pnpm build && pnpm preview` starts **without Docker running** and Generate still dispatches to a native `mise run solver:dev` (URL wins)
- Bundle size delta is negligible (< 50 KiB)

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Local modes — hosted-solve campaign and tier 3

### Overview

The `prod-solver` env profile, the one-command hosted-solve campaign, and the opt-in tier-3 command; README documentation of the three tiers and the campaign.

### Changes Required:

#### 1. Third env profile

**File**: `package.json` (`env:prod-solver` script), `README.md` (§ Environment Profiles), `.envs/prod.vars` comment (restate)

**Intent**: A named, opt-in profile: hosted `SUPABASE_URL`/`SUPABASE_KEY` + `SOLVER_URL=http://127.0.0.1:8000` + `SOLVER_MACHINE_PASSWORD=<hosted machine password>` (used only by the mise task, harmless in `.env.local`/`.dev.vars` since `astro:env` ignores undeclared keys — verify). `env:prod` stays the read-only smoke and **never** gains `SOLVER_URL`. Restate the `prod.vars` comment: the hazard is "a developer running against hosted data dispatches production jobs to their laptop", not "gives prod a dispatch surface".

**Contract**: `"env:prod-solver": "cp .envs/prod-solver.vars .env.local && cp .envs/prod-solver.vars .dev.vars"`; README documents the file's contents template (gitignored, per-machine).

#### 2. Hosted-solve campaign command

**File**: `mise.toml` (`solver:hosted`)

**Intent**: One friendly command for the campaign: local app + native solver against the **hosted** database, cheap and fast, not for daily work.

**Contract**: Task steps — (1) assert `.envs/prod-solver.vars` exists and carries the four keys; (2) print a loud banner ("writes to PRODUCTION: job rows, plan clones, placements; laptop must not sleep") and require an explicit confirmation (`--yes` or interactive `read`); (3) `pnpm env:prod-solver`; (4) start the solver from `services/solver` with the profile sourced (`set -a; . .envs/prod-solver.vars; set +a`), under `caffeinate -i` on Darwin, in the background; (5) `pnpm build && pnpm preview`; (6) `trap` on exit: stop the solver, `pnpm env:local`. Document that timing conclusions are invalid on M-series hardware and that quality/policy comparisons are legitimate.

#### 3. Tier-3 command

**File**: `mise.toml` (`solver:tier3`), README (§ Running the solver service)

**Intent**: The rarely-used proof of the real container inside local workerd, opt-in, without flipping `dev.enable_containers` in the committed config.

**Contract**: `pnpm exec wrangler dev --enable-containers` through the `.wrangler/deploy/config.json` redirect (wrangler 4.102.0 honors the redirect for `dev` and carries a hidden `--enable-containers` flag — verified in the installed CLI). **Ordering is load-bearing**: `astro build` snapshots the root `.dev.vars` into `dist/server/.dev.vars`, and both `astro preview` and the redirected `wrangler dev` read *that copy*, so the task must (1) write the session `.dev.vars` with `SOLVER_URL` **unset** (so the binding is exercised), (2) `pnpm build`, (3) `wrangler dev --enable-containers`, (4) restore `.dev.vars` on exit (trap). Writing `.dev.vars` after the build silently leaves the URL transport in charge. **First step of this phase: verify** the redirected `wrangler dev` actually reaches the container (POST visible in container logs); if it does not, the fallback is a documented manual flip of `dev.enable_containers` for the session, and the task prints those instructions instead. Record which one shipped in `change.md`.

#### 4. README — the three tiers + campaign

**File**: `README.md` (§ Running the solver service (dev), § Environment Profiles)

**Intent**: Document tier 1 (native, existing), tier 2 (`solver:image:build/smoke`), tier 3 (`solver:tier3`), and the hosted-solve campaign, with the campaign's risks (production writes, laptop sleep, timing invalid) and prerequisites (hosted enablement done — Phase 6). Add one rule under § Environment Profiles: **`.dev.vars` is snapshotted into `dist/server/` at build time — after switching an `env:*` profile, rebuild before `pnpm preview`** (a stale build keeps the previous profile's transport).

### Success Criteria:

#### Automated Verification:

- `pnpm env:prod-solver && pnpm env:local` round-trips (files identical to `.envs/*.vars`)
- `mise tasks` lists `solver:image:build`, `solver:image:smoke`, `solver:tier3`, `solver:hosted` with descriptions
- `pnpm lint`/`pnpm check` still green (no code change expected here beyond scripts)

#### Manual Verification:

- `mise run solver:tier3` (Docker running) boots workerd with the container; a Generate on a local plan reaches the container (container logs show the POST) and the job completes
- `mise run solver:hosted` runs end to end against a local stack stand-in first (point the profile at local to rehearse), then — **only after Phase 6** — against hosted once (that run doubles as Phase 6's credential proof)
- Aborting the campaign (Ctrl-C) restores `env:local` and stops the solver

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: CI deploy lane

### Overview

Make `deploy` build/push the image with the Worker; truth-up the workflow's comments; no filters, no `needs` change.

### Changes Required:

#### 1. `deploy` job

**File**: `.github/workflows/ci.yml` (deploy job)

**Intent**: `wrangler deploy` now also builds (from the runner's Docker daemon) and pushes the container image. Keep the single `wrangler-action` step; add a `docker version`/`docker buildx version` sanity step before it (fail fast, clear message) and note the ~+N min build cost in a comment with the measured number after the first run.

**Contract**: No `paths:`/`paths-ignore:`; `needs: [verify, integration, e2e, solver]` and the `if:` are unchanged; comment names the token scope (`Workers Scripts: Edit` + `Containers: Edit`, account-scoped) and that image layer push is incremental. If `wrangler-action` cannot see the daemon (unexpected), fallback: `preCommands: pnpm exec wrangler containers build -p -t …` — document, do not pre-build.

#### 2. Workflow comment truth-up

**File**: `.github/workflows/ci.yml` (`solver` job header, `e2e` job header)

**Intent**: Remove "Path filtering still arrives with S-302"; state the decision (44 s job vs 426 s critical path; filters would require rewriting the production gate). Note the e2e preview stays Docker-free via `dev.enable_containers=false`.

#### 3. README CI/CD + secrets tables

**File**: `README.md` (§ CI / CD, § Deployment)

**Intent**: `deploy` job now "builds/pushes the solver image and ships the Worker + container"; the CF token row gains `Containers: Edit`; Worker secrets gain `SOLVER_MACHINE_PASSWORD`; the manual-deploy escape hatch notes Docker is required locally for `wrangler deploy` (or `--containers-rollout=none` to ship the Worker without touching the container).

### Success Criteria:

#### Automated Verification:

- `actionlint` (via `pnpm exec`/`npx actionlint` or the pre-existing lint step if any) / YAML parses; workflow still has no `paths` keys (`grep -c 'paths' .github/workflows/ci.yml` = 0)
- The full CI run on the branch is green (`verify`, `integration`, `e2e`, `solver`; `deploy` skipped on non-main)

#### Manual Verification:

- Reviewer confirms `deploy.needs`/`if:` lines are byte-identical to `main`

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Doc truth-up

### Overview

Correct every document this slice makes false or that was already stale (evidenced in `research.md` § Historical Context and `change.md`). Precedent: `docs(clean-up-bench-generation): truth-up …`.

### Changes Required:

#### 1. PRD

**File**: `context/foundation/prd.md`

**Intent**: FR-315 — drop "path-filtered", record the deviation and its rationale (measurement + production-gate risk); restate "container secrets live in container config, not the Worker" as "the container receives its credential via Worker secrets forwarded through the DO's `envVars`; the Worker gains no new privilege (same publishable key + a password only the container uses)". FR-316 — tier 3 is `wrangler dev`/`astro preview` via `@cloudflare/vite-plugin`, opt-in. FR-311 — containers#162 is closed (fixed in `@cloudflare/containers` v0.2.2, 2026-05-12); re-ground on "Cloudflare does not guarantee that any container instance will run for any set period of time"; note S-302's `sleepAfter 30m` stopgap. Cost: ≈$7 → ~$15/month at the measured 12.5-min solve (~$22 at the 20-min ceiling).

#### 2. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: S-302 Outcome — remove "path-filtered", fix tier-3 wording, add the hosted-solve campaign and the role assertion; S-304 rationale re-grounded (do **not** delete S-304); `roadmap.md:77` mise graduation attributed to F-302; cost figure; the CF-token unknown marked resolved (`Containers: Edit`).

#### 3. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Replace the containers#162 sentence with the durable no-guaranteed-runtime statement (keep "job-aware lifecycle is a correctness requirement (FR-311)"); add one line: `src/worker.ts` is the Worker entry and exports `SolverContainer` — don't repoint `main`; never `wrangler types` (use `src/cloudflare-env.d.ts`); `contracts/` must be COPYed into the image (repo-root build context).

#### 4. README rollback + misc

**File**: `README.md`

**Intent**: Rollback section — container deploys are **roll-forward-only** (`wrangler deploy` a fix); state the two facts (DO migration between versions blocks `wrangler rollback`; "resources connected to your Worker will not be changed during a rollback"); operational rule: never `wrangler containers images delete` an image still referenced by a reachable Worker version. Known gap: no image vulnerability scanner.

#### 5. Runbook

**File**: `docs/runbooks/solver-credential.md`

**Intent**: Land the uncommitted dashboard-toggle edits; the S-302 checklist gains `wrangler secret put SOLVER_MACHINE_PASSWORD`, the CF-token scope step, and the in-code role assertion as the backstop ("verification is still a gate; the assertion is a seatbelt"); note the hosted-solve campaign uses the same credential.

#### 6. Foundation docs, cheap fixes

**File**: `context/foundation/tech-stack.md:33-35,45,51`, `shape-notes.md:617-618`, `health-check.md:115-117`, `stack-assessment.md:59`

**Intent**: `python:3.13-slim`; solver promoted (no longer `poc/cp-sat`); solver tests run in CI (`solver` job); no `bench` job.

#### 7. `change.md`

**File**: `context/changes/solver-deploy-lane/change.md`

**Intent**: Note which tier-3 mechanism shipped (Phase 3), the measured deploy wall-clock delta (after Phase 7), and cross-link the doc obligations as done.

### Success Criteria:

#### Automated Verification:

- `grep -rn "containers#162" CLAUDE.md context/foundation/prd.md context/foundation/roadmap.md` returns only re-grounded/historical mentions (no "live hazard" wording)
- `grep -rn "path-filtered" context/foundation/prd.md context/foundation/roadmap.md` returns 0 lines (or only the recorded deviation note)
- `pnpm format` / prettier clean on touched markdown

#### Manual Verification:

- Each stale-claim row in `research.md` § Historical Context has a corresponding edit
- FR-315/FR-316 read as an accurate description of what ships

**Implementation Note**: Pause for manual confirmation before Phase 6.

---

## Phase 6: Manual hosted gate (human)

### Overview

The one-time human steps that must be complete before the branch merges (and before the first hosted-solve campaign). Absence fails upward; the Phase 1 assertion is the seatbelt, not the gate.

### Changes Required:

#### 1. Hosted enablement checklist

**File**: `docs/runbooks/solver-credential.md` (tick the boxes as done, with dates)

**Intent**: Execute, in order:

1. Dashboard → Authentication → Hooks → enable `public.custom_access_token_hook` (no `supabase config push`).
2. Provision the hosted machine user (`SOLVER_MACHINE_PASSWORD='…' node scripts/provision-solver-user.mjs` against hosted with the hosted service-role key, from a human shell; store the password in the password manager and in `.envs/prod-solver.vars`).
3. Verify: sign in as the machine user against hosted, decode the token, `role == solver_job_writer`.
4. `pnpm exec wrangler secret put SOLVER_MACHINE_PASSWORD` on the Worker (Supabase URL/KEY secrets already exist).
5. Cloudflare API token: add `Containers: Edit` (account-scoped) to the deploy token — or mint a replacement token with `Workers Scripts: Edit` + `Containers: Edit` and rotate the `CLOUDFLARE_API_TOKEN` repository secret. Record which.
6. Run `mise run solver:hosted` once against hosted with a scratch plan as the credential proof (this is Phase 3's deferred manual check).

### Success Criteria:

#### Automated Verification:

_No automated verification — CI deliberately holds no service-role key._

#### Manual Verification:

- Decoded hosted token shows `role: solver_job_writer`
- `wrangler secret list` shows `SOLVER_MACHINE_PASSWORD`
- Token permissions verified in the Cloudflare dashboard (`Containers: Edit` present)
- One hosted-solve campaign job completed on a scratch plan; the clone was inspected/deleted

**Implementation Note**: Do not merge until every box above is ticked.

---

## Phase 7: Merge, first deploy, production smoke

### Overview

Squash-merge the PR; watch the first container deploy; prove the binding path in production; record the numbers.

### Changes Required:

#### 1. Merge and observe

**File**: `context/changes/solver-deploy-lane/change.md` (record measurements)

**Intent**: Open the PR (`gh` under the `dobrek` account), CI green, squash-merge. Watch the `deploy` job: image build time, push, `wrangler deploy` output listing the container. Record the total deploy wall-clock delta vs the previous ~64 s (this is the input to the "add GHA layer caching?" decision).

#### 2. Production smoke

**Intent**: Verify the deployed container and the binding path end to end.

**Contract**: `wrangler containers list` / dashboard shows the app with `standard-4`, `EEUR`, `max_instances 1`; run one Generate on a scratch plan in production; job reaches `succeeded`; container logs show the Phase 1 startup line with `SOLVER_WORKERS=4` in effect and the role assertion passing; measure cold-start dispatch latency (first request after sleep) and note it against `CONTAINER_START_TIMEOUT_MS`; confirm the container sleeps after 30 min idle (billing stops). If a 403 hits the deploy: add `Cloudchamber: Edit` and re-run.

#### 3. Follow-ups filed

**Intent**: In `change.md` (or S-304/S-308 notes): measured cold start; whether layer caching is warranted; `sleepAfter` handoff to S-304; egress `allowedHosts` hardening; image scanner gap; E2E for Generate → S-306.

### Success Criteria:

#### Automated Verification:

- `deploy` job green on `main`; `pnpm exec wrangler deployments list` shows the new version

#### Manual Verification:

- Production Generate on a scratch plan succeeds via the container binding
- Container instance type/region/env verified; cold-start latency and deploy wall-clock recorded in `change.md`
- Rollback section's roll-forward policy re-read against reality (no rollback attempted)

---

## Testing Strategy

### Unit Tests:

- `solver-binding-transport.test.ts` — start-then-POST ordering, 202-only success, start failure vs `SolverDispatchError`, `checkHealth` never throws.
- Selector precedence (pure helper) — URL wins; binding fallback; null when neither.
- Solver `tests/` — role assertion: correct role, wrong role, missing claim, malformed token (wrapper level, through the fake client).
- Existing fake-transport suites are implementation-agnostic and must stay green untouched.

### Integration Tests:

- Existing `solver-transport.integration.test.ts` and `generation-proposal.integration.test.ts` keep exercising the URL path (CI `integration` job). The binding path is structurally out of the vitest lane — proven by tier 3 and the production smoke (decision recorded).

### Manual Testing Steps:

1. Phase 1: `mise run solver:image:build && mise run solver:image:smoke` → 202.
2. Phase 2: preview without Docker; Generate → native solver.
3. Phase 3: `mise run solver:tier3` → Generate reaches the container; `mise run solver:hosted` rehearsal against local, then hosted once (Phase 6).
4. Phase 7: production Generate on a scratch plan; inspect container settings; record cold start.

## Performance Considerations

- `SOLVER_WORKERS=4` on 4 vCPU (portfolio diversity drops; feasibility barely affected). S-308 re-evaluates on production hardware — never tune budgets on M-series numbers.
- `sleepAfter 30m` costs ~+$5/mo idle billing after each solve; ~$15–20/mo total at 5 solves/day.
- Image build adds minutes to `deploy` on every merge (no filters). Measure; layer caching is the lever.
- Cold start on a ~400 MB image: expect several seconds; `CONTAINER_START_TIMEOUT_MS` starts at 45 s and is corrected from measurement.

## Migration Notes

- `migrations: [{ tag: "v1", new_sqlite_classes: ["SolverContainer"] }]` is a DO lifecycle change; after it ships, `wrangler rollback` to a pre-container version is blocked — roll forward.
- Every later merge that changes the image rolls the single container instance; `rollout_active_grace_period` (Phase 2 §5) is what stands between a deploy and an in-flight solve until S-304 lands activity-aware lifecycle.
- No database migration. Hosted hook enablement and machine-user provisioning are one-time manual steps (Phase 6).
- Existing Worker secrets unchanged; one new secret `SOLVER_MACHINE_PASSWORD`.

## References

- Research: `context/changes/solver-deploy-lane/research.md` (Spike result, Decisions taken, Risk Register)
- Change notes: `context/changes/solver-deploy-lane/change.md`
- Seam: `src/entities/timetable/api/solver-transport.ts`, `solver-config.ts:24`, `src/actions/index.ts:27`
- Solver: `services/solver/src/cpsat_service/app.py:40-46`, `settings.py:31`, `supabase.py:79-93`
- CI: `.github/workflows/ci.yml:151-236`
- Runbook: `docs/runbooks/solver-credential.md` § Hosted enablement
- Prior: `context/archive/2026-08-11-solver-service-transport/` (F-302), `context/changes/post-poc-cp-sat-refactoring-plan/research.md` (platform choice; read its banner)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Solver hardening + container image (tier 2)

#### Automated

- [x] 1.1 `mise run solver:check` (ruff + mypy --strict) passes — 0dbf6f2
- [x] 1.2 `mise run solver:test` passes, including the new role-assertion tests — 0dbf6f2
- [x] 1.3 `mise run solver:image:build` produces a linux/amd64 image — 0dbf6f2
- [x] 1.4 `mise run solver:image:smoke` returns 202 for the golden fixture against the local Supabase stack — 0dbf6f2

#### Manual

- [x] 1.5 Image size is in the ~330–450 MB range — 0dbf6f2
- [x] 1.6 Smoke log shows the job row advancing in local `generation_jobs` — 0dbf6f2
- [x] 1.7 Role assertion observed to refuse a token when the local hook is temporarily disabled (optional drill) — 0dbf6f2

### Phase 2: Worker entry, container binding, transport selector

#### Automated

- [x] 2.1 `pnpm exec astro sync && pnpm check` — 0 errors, 0 warnings — f6097bb
- [x] 2.2 `pnpm lint`, `pnpm steiger`, `pnpm test` pass (new transport/selector tests included) — f6097bb
- [x] 2.3 `pnpm build` succeeds; `entry.mjs` exports `SolverContainer`; `dist/server/wrangler.json` carries containers, DO binding, migration, `dev.enable_containers: false` — f6097bb
- [x] 2.4 `wrangler deploy --dry-run --containers-rollout=none` (Docker-free) lists `env.SOLVER (SolverContainer)`; full `--dry-run` with Docker builds the image and lists the container — f6097bb

#### Manual

- [x] 2.5 `pnpm env:local && pnpm build && pnpm preview` starts without Docker and Generate dispatches to a native solver — f6097bb
- [x] 2.6 Bundle size delta is negligible (< 50 KiB) — f6097bb

### Phase 3: Local modes — hosted-solve campaign and tier 3

#### Automated

- [x] 3.1 `pnpm env:prod-solver && pnpm env:local` round-trips — ad10ad6
- [x] 3.2 `mise tasks` lists `solver:image:build`, `solver:image:smoke`, `solver:tier3`, `solver:hosted` with descriptions — ad10ad6
- [x] 3.3 `pnpm lint`/`pnpm check` still green — ad10ad6

#### Manual

- [x] 3.4 `mise run solver:tier3` boots workerd with the container; a local Generate reaches the container and completes — ad10ad6
- [x] 3.5 `mise run solver:hosted` rehearsed against a local stand-in; run against hosted once after Phase 6 — ad10ad6
- [x] 3.6 Aborting the campaign restores `env:local` and stops the solver — ad10ad6

### Phase 4: CI deploy lane

#### Automated

- [x] 4.1 Workflow YAML valid; no `paths` keys anywhere in `ci.yml` — 0d2b562
- [x] 4.2 Full CI run on the branch is green (`deploy` skipped on non-main)

#### Manual

- [x] 4.3 Reviewer confirms `deploy.needs`/`if:` lines are byte-identical to `main`

### Phase 5: Doc truth-up

#### Automated

- [x] 5.1 No live-hazard `containers#162` wording remains in CLAUDE.md / prd.md / roadmap.md
- [x] 5.2 No unqualified "path-filtered" wording remains in prd.md / roadmap.md
- [x] 5.3 `pnpm format` clean on touched markdown

#### Manual

- [x] 5.4 Each stale-claim row in `research.md` § Historical Context has a corresponding edit
- [x] 5.5 FR-315/FR-316 read as an accurate description of what ships

### Phase 6: Manual hosted gate (human)

#### Manual

- [ ] 6.1 Decoded hosted token shows `role: solver_job_writer`
- [ ] 6.2 `wrangler secret list` shows `SOLVER_MACHINE_PASSWORD`
- [ ] 6.3 CF token has `Containers: Edit` (verified in dashboard)
- [ ] 6.4 One hosted-solve campaign job completed on a scratch plan; clone inspected/deleted

### Phase 7: Merge, first deploy, production smoke

#### Automated

- [ ] 7.1 `deploy` job green on `main`; `wrangler deployments list` shows the new version

#### Manual

- [ ] 7.2 Production Generate on a scratch plan succeeds via the container binding
- [ ] 7.3 Container instance type/region/env verified; cold-start latency and deploy wall-clock recorded in `change.md`
- [ ] 7.4 Rollback section's roll-forward policy re-read against reality
