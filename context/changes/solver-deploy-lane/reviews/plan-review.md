<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Solver Deploy Lane (S-302)

- **Plan**: context/changes/solver-deploy-lane/plan.md
- **Mode**: Deep
- **Date**: 2026-08-16
- **Verdict**: REVISE → SOUND after triage (7/7 fixed)
- **Findings**: 0 critical, 6 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

14/14 paths ✓ (3 to-be-created files correctly absent), symbols ✓ (`DISPATCH_TIMEOUT_MS`, `getSolverTransport`, `parents[4]`, `DEFAULT_WORKERS = 8`, `sign_in`, `ContainerApp` schema, `--enable-containers`, `--containers-rollout`, `@astrojs/cloudflare/handler`), brief↔plan ✓. Progress↔Phase: one orphan bullet (F6), otherwise 1:1.

Verified in installed sources (wrangler 4.102.0, @cloudflare/vite-plugin 1.42.0, @astrojs/cloudflare 14.2.0): any `main` is fine; `handle` subpath exists; container config + `dev` survive into `dist/server/wrangler.json` with absolute image paths; `enable_containers: false` keeps preview Docker-free while `env.SOLVER` stays bound; `wrangler dev` honors the `.wrangler/deploy/config.json` redirect and has a hidden `--enable-containers`; `ContainerApp` field names, `standard-4`, `EEUR`, `rollout_active_grace_period` all present. `@cloudflare/containers` is not installed (plan already adds it).

## Findings

### F1 — Fail-closed role assertion fails silently: row stays `queued` forever

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (and Desired End State "refuses to run")
- **Detail**: Phase 1 says a wrong role raises "a typed exception the runner already maps to a failed job / 500 at dispatch". Neither is true. `sign_in()` is lazy — first called from `_headers()` inside `claim()` on the worker thread (`supabase.py:79-93,149-153`), after the HTTP handler has already returned 202. `_claim` swallows any exception and logs "the claim itself failed — leaving the row untouched" (`runner.py:132-150`). The row sits `queued` indefinitely, the clone stays alive, and the only trace is a container log line. No lifespan/startup sign-in exists in `app.py`.
- **Fix A ⭐ Recommended**: Assert at service startup (lifespan), keep the per-mint check
  - Strength: Wrong role → process exits non-zero → `startAndWaitForPorts` fails → dispatch error → `generation-job.ts:78-86` already marks the row `failed` and deletes the clone. Visible, self-cleaning; tier-2 smoke exercises it on boot.
  - Tradeoff: Boot needs Supabase reachable; `/health` must stay dependency-free (check lives in lifespan, not `/health`).
  - Confidence: HIGH — the dispatch-failure cleanup path is already in the code.
  - Blind spot: exact container start-failure message shape unverified until `@cloudflare/containers` is installed.
- **Fix B**: Keep it lazy; correct the prose; document the queued-forever outcome
  - Strength: Zero startup coupling; smallest change.
  - Tradeoff: User sees "job never starts"; recovery is manual SQL; Phase 7 must read logs to prove it.
  - Confidence: HIGH — matches current runner semantics.
  - Blind spot: a misconfigured hosted hook goes unnoticed until someone inspects logs.
- **Decision**: FIXED via Fix A

### F2 — `wrangler deploy --dry-run` is NOT Docker-free; `astro build` needs the Dockerfile

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 Overview + criterion 2.4; Critical Details "Ordering"
- **Detail**: Wrangler 4.102.0 runs `verifyDockerInstalled` and `docker build` (no push) for Dockerfile-backed containers even under `--dry-run` (`wrangler-dist/cli.js:149387-149411`, "needed … even in dry-run mode"). Only `--containers-rollout=none` skips it. Separately, config load calls `isDockerfile` → `fs.existsSync`; a missing Dockerfile is a config error, so `astro build` itself (CI verify/e2e too) fails without it.
- **Fix**: Reword 2.4 into two checks — Docker-free binding check `wrangler deploy --dry-run --containers-rollout=none` (lists `env.SOLVER`) and a full `--dry-run` with Docker running as the container-build proof; state that the Dockerfile must be committed before any `pnpm build`.
- **Decision**: FIXED

### F3 — `containerFetch(..., { signal })` over DO RPC is likely non-serializable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §6 (binding transport contract)
- **Detail**: The transport calls `startAndWaitForPorts`/`containerFetch` on the `getContainer()` stub — Workers RPC. Passing `signal: AbortSignal.timeout(...)` inside `init` is not structured-cloneable, so the RPC would throw before reaching the container. (Reasoned from RPC serialization rules; package not installed yet.)
- **Fix**: Keep the timeout Worker-side — `stub.fetch(new Request(url, {method, headers, body, signal}))` (`Container.fetch` proxies to `defaultPort` and starts the container) or keep the RPC pair and race against a Worker-side timer, dropping `signal` from `init`. Add "verify RPC-arg serializability against the installed version" to Phase 2.
  - Strength: Preserves the 15 s budget without relying on RPC cloning an AbortSignal.
  - Tradeoff: `stub.fetch` blurs "not up" vs "dispatch failed" unless the error is inspected.
  - Confidence: MED — RPC rule firm; exact Container API surface re-verified at implement time.
  - Blind spot: `Container` behaviour when `ctx.container` is absent (preview, `enable_containers:false`).
- **Decision**: FIXED (RPC pair + Worker-side `withTimeout`; `stub.fetch` recorded as fallback; verify-on-install step added)

### F4 — A merge to `main` mid-solve replaces the only container instance

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §5 (wrangler config), Phase 7, Migration Notes
- **Detail**: With no path filters every merge runs `wrangler deploy`, which rolls the container out when the image changes; `max_instances: 1` means the running instance is the one replaced. A 12–20 min solve in flight is killed → wedged `running` row (S-304's problem). Wrangler's `ContainerApp` schema exposes `rollout_active_grace_period` and `rollout_step_percentage` (verified), currently unset.
- **Fix A ⭐ Recommended**: Set `rollout_active_grace_period` explicitly (≥ 20-min ceiling)
  - Strength: Fits "explicit over inherited"; one config line; field verified in installed schema.
  - Tradeoff: Semantics must be read from current CF docs before setting (CLAUDE.md rule).
  - Confidence: MED — field verified; behaviour not.
  - Blind spot: whether an unchanged image digest triggers a rollout at all.
- **Fix B**: Document "don't merge during a solve" and hand the rest to S-304
  - Strength: No unverified config.
  - Tradeoff: Human rule guarding a correctness property.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (with Fix B as the documented fallback if the docs show the field doesn't protect in-flight solves)

### F5 — `.dev.vars` is snapshotted at build time; tier-3/campaign ordering must respect it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3 (tier 3), §1 README
- **Detail**: The vite plugin copies root `.dev.vars` into `dist/server/.dev.vars` during `astro build` (vite-plugin `index.mjs:59916-59922, 64949-64953`); `astro preview` and the redirected `wrangler dev` read the copy. If the tier-3 task rewrites `.dev.vars` after `pnpm build`, the unset `SOLVER_URL` never reaches workerd and the URL transport silently wins.
- **Fix**: Make the order explicit in Phase 3 §3 — rewrite `.dev.vars` → `pnpm build` → `wrangler dev --enable-containers` → restore; README line: changing `.dev.vars`/env profile requires a rebuild before preview.
- **Decision**: FIXED

### F6 — Phase 6 has an orphan "Automated" bullet with no Progress row

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 6 Success Criteria / Progress § Phase 6
- **Detail**: `- (none — CI deliberately holds no service-role key)` under `#### Automated Verification:` has no matching `- [ ] 6.x` row; every other phase maps 1:1.
- **Fix**: Replace the bullet with prose (`_No automated verification — CI deliberately holds no service-role key._`) or drop the Automated heading for Phase 6.
- **Decision**: FIXED

### F7 — Small completeness gaps in Phase 1

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §4–5, Phase 7 §2
- **Detail**: (a) Phase 7 says "log the settings at startup if the service doesn't already" — it doesn't (`app.py:38` only sets `basicConfig`); that is Phase 1 code. (b) `solver:image:smoke` needs `SOLVER_MACHINE_PASSWORD` but the plan doesn't say where it comes from. (c) The deny-list `.dockerignore` variant omits `.envs/`, `.env*`, `.dev.vars`.
- **Fix**: Add "log effective non-secret settings at startup" to Phase 1 §1; smoke task fails fast if `SOLVER_MACHINE_PASSWORD` is unset in the shell; mandate the positive-list `.dockerignore`.
- **Decision**: FIXED
