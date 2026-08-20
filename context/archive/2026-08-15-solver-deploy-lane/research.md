---
date: 2026-08-15T17:27:13+0200
researcher: Dobromir Kropielnicki
git_commit: 6015770915c67d1d35858ebdfbd02c9213e84467
branch: feat/solver-deploy-lane
repository: dobrek/ib-timetable-planner
topic: "S-302 solver deploy lane — feasibility and challenges"
tags: [research, codebase, cloudflare-containers, ci-cd, deploy, solver, wrangler, docker]
status: complete
last_updated: 2026-08-16
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Author resolved open questions 3 (no path filtering) and 4 (SOLVER_WORKERS=4); recorded in Decisions taken."
---

# Research: S-302 Solver deploy lane — feasibility and challenges

**Date**: 2026-08-15T17:27:13+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `6015770915c67d1d35858ebdfbd02c9213e84467`
**Branch**: `feat/solver-deploy-lane`
**Repository**: dobrek/ib-timetable-planner

## Research Question

Check the feasibility and challenges of implementing `solver-deploy-lane` as the **S-302** item from `context/foundation/roadmap.md`.

Scope agreed before research: **strict S-302 + the app-side dispatch switch** it implies (today Generate dispatches over `SOLVER_URL`; production must reach the container through a binding). S-304 lifecycle work is assessed only as a dependency. All four challenge dimensions in scope: Cloudflare Containers mechanics, CI/deploy pipeline shape, security & credentials, local fidelity & cost. Depth: feasibility verdict + risk register.

## Summary

**S-302 is feasible and remains correctly sequenced. Nothing in it is blocked.** Every platform capability the slice assumes is real, GA, and verifiable in the version of Wrangler already installed here. The two prior foundations did their job: the app-side transport is already a clean port, so the dispatch switch is a factory swap rather than an architecture fork.

The slice is, however, **materially harder than its one-line Outcome suggests**, and it is hard in a place the roadmap does not name. Six findings change how this should be planned:

1. **The unnamed hard part is the Worker entry, not the container.** A Cloudflare container is *required* to be fronted by a Durable Object class exported from the Worker's entry module. This project does not own its Worker entry — `wrangler.jsonc:4` points `main` at `@astrojs/cloudflare/entrypoints/server`, and the built entry exports **only a default**. The fix exists and is verified available (`@astrojs/cloudflare@14.2.0` exports `./handler` → `handle(request, env, ctx)`), but it means S-302 restructures the app's Worker entry point — the highest-blast-radius edit in the slice, and one no roadmap or PRD line mentions. **This is the item to spike first.**

2. **`containers#162` is fixed.** The mid-solve sleep bug that CLAUDE.md, the PRD (FR-311), and the roadmap's S-304 rationale all treat as a live platform hazard was **closed 2026-05-12** and fixed in `@cloudflare/containers` v0.2.2 (2026-03-31) by in-flight request tracking. Two further related races were fixed in v0.3.4 and v0.3.7. This does not delete S-304 — the platform still offers *no guaranteed maximum runtime*, and the wedged-`running`-row problem is ours, not Cloudflare's — but the specific cited justification is stale and should be re-grounded.

3. **The deploy story is better than assumed, in one respect and worse in another.** Better: a deploy does not kill a running solve — the platform sends SIGTERM and waits **up to 15 minutes** before SIGKILL, and rollouts drain instance by instance. Worse: **rollback is effectively roll-forward-only** for a container deploy, and a Durable Object migration between versions *blocks* `wrangler rollback` outright. The repo's documented rollback escape hatch (`README.md`) stops being true the day the container ships.

4. **The path-filtering premise doesn't survive measurement.** The `solver` job runs in **44 s**; `e2e` runs in **426 s** and is unaffected by any solver filter. Path-filtering saves ~0 on critical path, while the edit it requires — rewriting `deploy`'s `needs:` gate to tolerate skipped jobs — is the single riskiest line in the repo to touch, because the `always()` form that makes skipping safe also disables the implicit failure gate on production deploys. The *container build* step is the expensive new thing, and it is the thing worth filtering.

5. **The cost figure is stale, though its arithmetic was sound.** The recorded "≈$7/month" reproduces exactly ($7.11) under its stated input of a 5-minute solve. The measured full-catalog solve is **~12.5 minutes**, which puts it at **~$14.63/month**; the PRD's own 20-minute ceiling puts it at **~$22.15/month**. Still small, still not a blocker — but the number in the PRD should be restated rather than inherited.

6. **Three configuration defaults are actively wrong for this workload** and will fail quietly if inherited: `instance_type` defaults to `lite` (1/16 vCPU, 256 MiB — a CP-SAT solver would thrash), uvicorn defaults to `--host 127.0.0.1` (container binds loopback, unreachable, `/health` still green from inside), and `SOLVER_WORKERS` defaults to 8 against a 4-vCPU ceiling.

Plus one trap that fails *open*: the `contracts/` schema path is `parents[4]`-anchored, and a wrong image layout makes `/health` return 200 while every solve 500s (`services/solver/src/cpsat_service/app.py:40-46,130-156`). A tier-2 smoke test that only probes `/health` will not catch it.

**Verdict by sub-capability:**

| # | Sub-capability | Verdict | Principal challenge |
| - | -------------- | ------- | ------------------- |
| A | Worker entry restructure + Container DO class | **Feasible — proven** | Spiked 2026-08-16: build, config propagation, export survival and Wrangler binding all confirmed. Residual: type the binding by hand, not with `wrangler types`. |
| B | `wrangler.jsonc` container config | **Feasible** | Schema verified in the installed Wrangler; `standard-4` and `EEUR` both confirmed. Defaults are wrong — set explicitly. |
| C | Dockerfile + `.dockerignore` | **Feasible with caveats** | `parents[4]` layout, editable-install `.pth`, `--host 0.0.0.0`, repo-root build context, no `.dockerignore` exists. |
| D | App-side dispatch switch | **Feasible** | Port already clean. New typing obligation (`Env`); the two live integration suites structurally cannot cover a binding. |
| E | CI container build/push + token scope | **Feasible — one unknown** | Token needs `Containers: Edit`; evidence-backed but **not doc-stated**. The `Edit Cloudflare Workers` template is insufficient. |
| F | Path-filtered solver job | **Dropped by decision** | 44 s vs a 426 s parallel critical path — the premise didn't hold. Resolved 2026-08-16: filter nothing; FR-315's wording needs amending. |
| G | Local fidelity tiers 2 & 3 | **Feasible** | Docker + amd64 buildx confirmed on this machine. Tier 3 runs through `astro dev`/`preview`, **not** `wrangler dev` — roadmap wording is imprecise. |
| H | Hosted enablement (credential) | **Feasible — manual, gating** | Two unticked human steps that fail *upward* into silent privilege escalation. Must precede first hosted run. |

## Decisions taken (2026-08-16)

Two of the Open Questions below were resolved by the author after this research landed. Full rationale in `change.md`; recorded here so the findings are read against the decisions.

- **No path filtering anywhere in `ci.yml`** — resolves Open Question 3, and is a **deliberate deviation from FR-315's "path-filtered" wording**. The measurement (44 s solver job against a 426 s parallel critical path) does not support the filter, and the required `deploy.needs` rewrite is a silent-regression surface on the only production-touching job. Accepted cost: the image build runs on every merge to main. The escape lever, if deploy wall-clock bites, is GHA Docker layer caching — not reintroducing filters. **Carries a doc obligation**: FR-315 and the roadmap's S-302 Outcome now overstate what will ship; one of them must move.
- **Open Question 1 spiked and cleared 2026-08-16** — the Worker-entry restructure works. See "Spike result" below.
- **New requirement added 2026-08-16: a local-app / hosted-database solve mode** (test policy variations on real data without Cloudflare spend). Adds a third env profile and — load-bearing — pins the transport selector so an explicit `SOLVER_URL` **wins over the binding**. The author's local loop is `build && preview`, which runs the built worker against the generated config and so is *more* likely to reach for Docker than `dev` is. Full requirement, risks and the `dev.enable_containers` lever in `change.md`.
- **`SOLVER_WORKERS=4`, set explicitly in container config** — resolves Open Question 4. Reconciles the seed research (4) against F-302's shipped default (8) in favour of the vCPU count. The load-bearing half is *explicitly*: the failure mode is `8` inheriting silently. Known trade-off: at 4 workers CP-SAT loses portfolio diversity (feasibility barely affected; optimality proofs slower and higher-variance). S-308 revisits on production hardware.

## Spike result (2026-08-16) — Open Question 1 is cleared

Run against commit `6015770`, then fully reverted (`git status` clean afterwards). The probe pointed `main` at a project-owned `src/worker.ts` re-exporting `handle` from `@astrojs/cloudflare/handler` plus a named `SolverContainer extends DurableObject`, and added `containers` / `durable_objects.bindings` / `migrations` to `wrangler.jsonc` with a public registry image (`docker.io/library/python:3.13-slim`, so no Docker interaction).

**All three sub-questions answered yes:**

1. **A project-owned `main` builds.** `pnpm build` completed in 4.09 s, no adapter or Vite complaints; `virtual:astro-cloudflare:config` resolved normally.
2. **Container config propagates into the generated config.** `dist/server/wrangler.json` carried all three blocks intact — and Wrangler auto-derived a container `name` the source never set:
   ```json
   "containers": [{"class_name":"SolverContainer","image":"docker.io/library/python:3.13-slim",
                   "instance_type":"standard-4","max_instances":1,
                   "constraints":{"regions":["EEUR"]},
                   "name":"ib-timetable-planner-solvercontainer"}]
   ```
3. **The named export survives Rolldown treeshaking.** `dist/server/entry.mjs` ends in `export { SolverContainer, worker_entry_default as default }`, with the class body present.

**Wrangler accepts it.** `wrangler deploy --dry-run` reported `env.SOLVER (SolverContainer) → Durable Object` alongside the existing bindings, and `The following containers are available: ib-timetable-planner-solvercontainer`. Bundle grew by 0.19 KiB (3788.02 → 3788.21 KiB) — nowhere near the 10 MB ceiling or the repo's 7 MB yellow line.

**`steiger` stayed clean** with `src/worker.ts` present — a top-level `src/` file is outside `layerSequence`, so FSD does not inspect it.

**One new, previously unknown problem — and its remedy.** `pnpm check` (the mandatory type gate) fails on `Cannot find module 'cloudflare:workers'`, because the repo has never generated Cloudflare runtime types. The obvious fix backfires:

- `pnpm exec wrangler types` emits a **543 KB** `worker-configuration.d.ts` and types the binding beautifully (`SOLVER: DurableObjectNamespace<import("./src/worker").SolverContainer>`) — but its Workers globals **shadow DOM lib types in React islands**, producing a fresh error in `src/_pages/plan-detail/ui/chrome/ExportMenu.tsx:131` (`document.body.append(anchor)` resolving `append` against the Workers `Body` type). Causation confirmed: that file was clean on the run immediately before the types were generated.
- A **~12-line hand-written ambient declaration** (`declare module "cloudflare:workers"` + an `Env` interface with the binding) gives `pnpm check` **0 errors, 0 warnings** across 747 files, with no DOM shadowing.

So the typing obligation is real but small, and `wrangler types` is the wrong tool for this repo — a fact worth carrying into the plan, since reaching for it is the natural first move and its failure mode is a type error in an unrelated React island.

## Detailed Findings

### A. The Worker entry problem — the slice's real hard part

A container is always fronted by a Durable Object. From [containers/get-started](https://developers.cloudflare.com/containers/get-started/), the required trio is `containers[]` + `durable_objects.bindings` + `migrations` with `new_sqlite_classes` (not `new_classes`). The installed Wrangler's own schema makes this non-negotiable: `ContainerApp` declares `required: ["image", "class_name"]`, where `class_name` is documented as *"The class name of the Durable Object the container is connected to"* (`node_modules/wrangler/config-schema.json`, definitions → `ContainerApp`).

That class must be **exported from the Worker's entry module**. This project does not own that module:

- `wrangler.jsonc:4` — `"main": "@astrojs/cloudflare/entrypoints/server"`
- `node_modules/@astrojs/cloudflare/dist/entrypoints/server.js` — the entire file is `var server_default = { fetch: handle }; export { server_default as default }`
- The built artifact confirms it: `dist/server/entry.mjs` ends in `export { worker_entry_default as default }` — a **default export and nothing else**.

The build pipeline is more involved than a plain `wrangler deploy`. `@astrojs/cloudflare@14.2.0` builds the Worker through `@cloudflare/vite-plugin@1.42.0` (its `Options` type extends `Pick<PluginConfig, 'auxiliaryWorkers' | 'configPath' | ...>` — `node_modules/@astrojs/cloudflare/dist/index.d.ts:5`), emits a **normalized** config at `dist/server/wrangler.json`, and redirects the CLI to it via `.wrangler/deploy/config.json`:

```json
{"configPath":"../../dist/server/wrangler.json","auxiliaryWorkers":[],"prerenderWorkerConfigPath":"../../dist/server/.prerender/wrangler.json"}
```

So the deployed config is a *projection* of the root `wrangler.jsonc`, with `main` rewritten to `entry.mjs`, `assets.directory` normalized to `../client`, and `no_bundle: true`. I confirmed the round-trip end to end with `pnpm exec wrangler deploy --dry-run` — it resolved `dist/client` as assets and reported `Total Upload: 3788.02 KiB / gzip: 864.91 KiB` (comfortably inside the 10 MB paid ceiling; the repo's own 7 MB yellow line is not in play).

**The fix, verified locally rather than taken from docs.** `@astrojs/cloudflare` exposes its handler as a public subpath:

```
"./handler": "./dist/utils/handler.js"          # package.json exports
export declare function handle(request: Request, env: Env, context: ExecutionContext): Promise<CfResponse>;
```

(`node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts:7`.) So the supported shape — which the Astro docs also give, noting the `workerEntryPoint` adapter option was removed in v13 — is to point `main` at a project-owned module that re-exports both:

```ts
// src/worker.ts (illustrative — not yet written)
import { handle } from "@astrojs/cloudflare/handler";
export { SolverContainer } from "./solver-container";
export default { fetch: handle } satisfies ExportedHandler<Env>;
```

**What is NOT proven, and must be spiked before planning depends on it:**

1. That the Astro/Vite build accepts a project-owned `main` and still resolves `virtual:astro-cloudflare:config` (the adapter's entry imports it at `handler.js:3-7`; a custom resolver marks it external at `dist/index.js:196-199`).
2. That `containers`, `durable_objects.bindings`, and `migrations` **survive into** `dist/server/wrangler.json`. The current generated config contains `"durable_objects":{"bindings":[]}` and `"migrations":[]` but **no `containers` key at all** — consistent with the source having none, but not proof of pass-through.
3. That the emitted `entry.mjs` retains the named class export through Rolldown treeshaking.

That spike is cheap (one build) and it is the difference between S-302 being a two-day slice and a two-week one.

`handler.d.ts` also declares a **global `Env`** type. The repo has no `worker-configuration.d.ts` and no `wrangler types` step anywhere (`package.json`, `ci.yml`), so typing the binding is a net-new obligation with no precedent here.

### B. Container configuration — verified against the installed Wrangler

Rather than trusting prose docs, the authoritative field list was read from `node_modules/wrangler/config-schema.json` (Wrangler **4.102.0**, the exact version CI deploys with). `ContainerApp` accepts exactly: `name`, `max_instances`, `image`, `image_build_context`, `image_vars`, `class_name`, `scheduling_policy`, `instance_type`, `ssh`, `authorized_keys`, `trusted_user_ca_keys`, `constraints`, `rollout_step_percentage`, `rollout_active_grace_period` — with `additionalProperties: false`.

Everything the roadmap's Outcome promises is supported:

- **`standard-4` exists**: schema description reads *"standard-4: 4 vCPU, 12 GiB memory, and 20 GB disk"* — the largest predefined type, and the documented hard per-instance ceiling.
- **`EEUR` pinning is real**: `constraints.regions` is an enum containing `ENAM, WNAM, EEUR, WEUR, APAC, SAM, ME, OC, AFR`. `constraints.jurisdiction: "eu"` is the alternative.
- **Scale-to-zero** is `sleepAfter` on the Container class (default 10 minutes), and billing genuinely stops on sleep.

**Three defaults that must be set explicitly, because inheriting them fails quietly:**

| Setting | Default | Why it's wrong here |
| ------- | ------- | ------------------- |
| `instance_type` | `"lite"` (docs) / `"dev"` (schema) — 1/16 vCPU, 256 MiB | A CP-SAT solve peaked at **854 MB RSS** on the *small* fixture. `lite` is not survivable. |
| uvicorn `--host` | `127.0.0.1` | Container binds loopback → unreachable from the Worker, while `/health` stays green *inside* the container. Neither existing launcher (`mise.toml:31`, `ci.yml:89`) passes `--host`. |
| `SOLVER_WORKERS` | `8` (`services/solver/src/cpsat_service/settings.py:31`) | 8 CP-SAT search workers on a 4-vCPU instance. The seed research obliged `num_workers=4`; F-302 shipped 8. Never reconciled. |

Note also `image_vars` is **build-time only** (`--build-arg`); it is not a runtime env channel.

### C. Image build — what the code demands of the Dockerfile

`services/solver/` builds cleanly, but four code-level facts constrain the Dockerfile, and one of them fails open.

**The `contracts/` trap (fails open).** `services/solver/src/cpsat_service/app.py:40-46`:

```python
REPO_ROOT: Final = Path(__file__).resolve().parents[4]
SCHEMA_PATH: Final = REPO_ROOT / "contracts" / "generation-wire.schema.json"
```

`_build_validator()` catches `OSError` and `ValueError` and returns `None` (`app.py:141-156`); the module still imports, `/health` still answers 200, and every dispatch 500s with *"the wire contract is not readable … the image must COPY contracts/"* (`app.py:136`). Consequences:

- The **build context must be the repo root**, not `services/solver/` — `contracts/` is a sibling of `services/`.
- The repo-relative layout must be preserved *exactly*: `<root>/services/solver/src/cpsat_service/app.py` alongside `<root>/contracts/…`. Copying `services/solver → /app` and `contracts → /app/contracts` is **wrong** — `parents[4]` from `/app/src/cpsat_service/app.py` clamps at `/`, so it looks in `/contracts/`.
- The alternative is `--no-editable`, which relocates modules to site-packages and makes `parents[4]` the venv root — legitimate, but then `contracts/` must be copied *there*. Pick one deliberately; any third layout fails open.
- A tier-2 smoke test must therefore POST a real `SolveRequest` and assert 202, not merely probe `/health`.

**Editable install.** `uv sync` installs the project editable by default (confirmed: `_editable_impl_cpsat_engine.pth` records an **absolute** path). A multi-stage build that copies only `.venv` and drops `src/` breaks at import.

**`--no-dev` matters.** Bare `uv sync` pulls the dev group (mypy alone is ~38 MB of mypyc `.so` plus 17 MB). Local venv is 269 MB; runtime-only is ~165 MB, so expect **~330–400 MB** on `python:3.13-slim` — consistent with the seed research's 300–400 MB estimate, and trivially inside `standard-4`'s 20 GB disk.

**Cross-arch is clean.** Every runtime package in `uv.lock` has a cp313 manylinux x86_64 wheel — zero sdist-only, so no compiler and no QEMU-emulated *build* is needed if you use `--platform linux/amd64` or `uv sync --python-platform x86_64-manylinux_2_28`. Note the amd64 ortools wheel is 29.8 MB vs 21.9 MB for arm64, so the image is larger than local measurement suggests.

**No `.dockerignore` exists anywhere in the repo** (verified: no Dockerfile, no `.dockerignore`, no compose file). Without one the build context ships `node_modules` (934 MB), `.git` (46 MB), and — worst — `services/solver/.venv` (269 MB of **arm64** binaries that would poison the image).

**Amd64 is enforced, not advisory.** `wrangler containers push` rejects a non-amd64 image with `"Unsupported platform"` (verified in `workers-sdk` test source). `wrangler containers build` already injects `--platform linux/amd64` itself, so you never pass it there — but a self-built image must produce amd64.

### D. The app-side dispatch switch — the cheapest part

F-302 built this seam deliberately and it held. `SolverTransport` (`src/entities/timetable/api/solver-transport.ts:20-27`) is a two-method structural type with **no URL in it**; `createSolverTransport(baseUrl)` is one implementation; `getSolverTransport()` is the selector (`src/entities/timetable/api/solver-config.ts:24`); and injection happens at a composition root outside the FSD graph (`src/actions/index.ts:27`). The module's own comment states the intent: *"what changes then is the FACTORY INPUT — not the call sites."*

Consequences for S-302:

- A binding implementation lands beside `solver-config.ts` in `src/entities/timetable/api/`, **excluded from the barrel** — `src/entities/timetable/index.ts` is pulled into ~20 client islands, and a `cloudflare:workers` import would break the client bundle exactly as `astro:env/server` does. `steiger` never inspects `src/actions/`, so the deep import stays legal.
- **No signature change.** `import { env } from "cloudflare:workers"` is a module-scope global, not a per-request value, so `getTransport: () => SolverTransport | null` survives intact. (`Astro.locals.runtime.env` is *removed* in this adapter version — it throws by design.)
- A binding **cannot** travel through `astro:env`: the adapter's env bridge returns `undefined` for non-primitives, so `envField` can never carry it.
- The URL transport must **stay** — it is the tier-1 local loop and the CI integration lane.

**The test gap is structural.** `src/test/solver-transport.integration.test.ts` and `src/test/generation-proposal.integration.test.ts` run under plain vitest (`environment: "node"`), which can resolve neither `cloudflare:workers` nor a DO binding. A binding-based transport **cannot be exercised by the existing integration lane at all** — it would need `wrangler dev` or `@cloudflare/vitest-pool-workers`. The three fake-transport suites are implementation-agnostic and cost nothing. Worth naming in the plan: the binding path's first real proof is the deployed container.

One tuning note: `DISPATCH_TIMEOUT_MS = 15_000` was chosen against a warm loopback POST. Documented container cold starts are *"often in the 1-3 second range"* but image-size dependent, and `startAndWaitForPorts` alone defaults to `instanceGetTimeoutMS: 8000` + `portReadyTimeoutMS: 20000`. **15 s may be too tight for a cold 400 MB image.**

### E. CI and the deploy job

**Docker is already present and load-bearing.** `ubuntu-latest` ships Docker 28.0.4, and the repo already boots ~6 Supabase containers per stack job (92–96 s). A build step adds cost, not a new platform requirement. Stay on x64 runners and cross-compilation never arises.

**`wrangler deploy` builds and pushes the image itself** when `image` is a Dockerfile path, using the local Docker daemon, pushing to Cloudflare's R2-backed `registry.cloudflare.com` with authentication handled automatically. Subsequent deploys push only changed layers. `cloudflare/wrangler-action@v4` runs as a `node24` JS action directly on the runner host (not a Docker container action), so the daemon is reachable; `preCommands` accepts `wrangler containers build -p -t …` if you prefer to decouple.

**There is no official Cloudflare GitHub-Actions + Containers example.** The `/containers/deploy/` page documents exactly two paths — from your machine, and Workers Builds. Cloudflare's total published CI guidance is one sentence: *"install `wrangler` then build and push images using either `wrangler containers build` with the `--push` flag, or using the `wrangler containers push` command."* This slice is therefore mildly off the paved path.

**The token scope — the roadmap's named unknown, now answered with a caveat.** No Cloudflare page states which permissions a container deploy requires; `/containers/deploy/`, image-management, the GitHub Actions page and the wrangler-action README are all silent. The evidence chain nevertheless converges:

- `wrangler`'s containers command namespace declares `containersScope = "containers:write"`.
- `workers-auth` documents that scope as *"Manage Workers Containers"*.
- `Containers Read` / `Containers Edit` exist as **Account**-scoped API token permissions.
- Critically, the **`Edit Cloudflare Workers` template does not include Containers** — its full contents are Workers Routes/Scripts/KV/Tail/R2 + Account Settings Read + User Details/Memberships. So the template Cloudflare's own Actions page tells you to pick is **insufficient**, and `Containers: Edit` must be added by hand.

Conclusion: **`Workers Scripts: Edit` + `Containers: Edit`, both Account-scoped** — high confidence, evidence-backed, not doc-stated. `Cloudflare Images: Edit` is an unrelated product; do not add it. If a 403 appears, `Cloudchamber: Edit` is the next thing to try (Wrangler's OAuth flow requests both) — lower confidence. This satisfies the roadmap's *"the narrow-token posture must not quietly widen"* constraint: it widens by exactly one account-scoped permission.

**Path filtering — the premise is weaker than the roadmap implies.** Measured per-job wall clock on a green `main` run: `verify` 170 s, `integration` 161 s, `e2e` **426 s**, `solver` **44 s**, `deploy` 64 s. Filtering a 44 s job out of a pipeline whose critical path is a 426 s job saves essentially nothing. Meanwhile the required edit is genuinely dangerous:

- `deploy` has `needs: [verify, integration, e2e, solver]` (`ci.yml:207`). A job skipped by a job-level `if:` propagates as not-success, so `deploy` skips too. The fix is `if: always() && !contains(needs.*.result, 'failure') && …` — but **`always()` disables the implicit success gate for all four needs at once**, so the failure check must be written explicitly or a genuinely red `verify` stops blocking production.
- A workflow-level `paths:` filter is worse: it stops the *whole* workflow, so a non-matching push to `main` **never deploys**.
- `contracts/**` is cross-cutting — it is byte-gated by `bench/contract-parity.test.ts` in `verify` **and** `services/solver/tests/test_contract.py` in `solver`. A naive `paths: ['services/solver/**']` would skip the Python half of the very gate the job exists to make honest (`ci.yml:151-155`). The same applies to the *image build*, whose context is the repo root.
- Filters must also cover `.github/**`, `mise.toml`, `pnpm-lock.yaml`, `services/solver/uv.lock`.

Verified live: `main` has **no branch protection and no rulesets** (`gh api …/branches/main/protection` → 404; `…/rulesets` → `[]`). So the "skipped required check" trap is latent, not present — but it is a fact about repo settings, which can change without a commit.

The honest reframing: **the container build is what deserves filtering**, not the 44 s test job.

**Rollback regresses.** `wrangler rollback` is a Worker-version operation; the rollbacks documentation contains no mention of containers or images. There is no image-rollback command. Worse, *"rollbacks will not be allowed if a Durable Object class lifecycle change … has occurred between the version in the active deployment and the version selected to roll back to"* — and containers **are** backed by Durable Objects. Also *"Resources connected to your Worker will not be changed during a rollback."* Whether a rollback triggers a container rollout to the previous image is **undocumented and unverified**; treat container deploys as **roll-forward-only**, and never `wrangler containers images delete` an image you might need to return to. `README.md`'s rollback section needs updating as part of this slice.

**Supply chain gains a third surface.** `verify` runs `pnpm audit`, `solver` runs `uv audit` — a base image plus OS packages would have no scanner.

### F. Local fidelity tiers

**Tier 2 (image smoke) is confirmed workable on this machine**: arm64 host, Docker 29.4.3, buildx v0.33.0 advertising `linux/amd64` among its platforms. Since all runtime wheels have amd64 builds, the *install* needs no emulation; only execution does, which is fine for a correctness smoke and — as the seed research already recorded — **never for performance conclusions**.

**Tier 3's mechanism is not what the roadmap says.** The Outcome promises *"`wrangler dev` with the real container binding"*. In this project the workerd dev/preview path runs through `@cloudflare/vite-plugin`, not a `wrangler dev` subprocess. Two confirmations: `playwright.config.ts:12-13` claims *"`astro preview` = `wrangler dev ./dist`"*, but `@astrojs/cloudflare@14.2.0`'s preview entrypoint calls Vite's `preview()` with the CF plugin — the comment's conclusion (real workerd, via miniflare) holds, its mechanism does not. Encouragingly, the plugin bundles the container toolchain (`buildImage`, `dockerBuild`, `dockerLoginImageRegistry`, and `enable_containers` / `container_engine` defaults), and the generated `dist/server/wrangler.json` already carries `"dev": { …, "enable_containers": true }`. So tier 3 is `astro dev` / `astro preview` with Docker running — but the roadmap's wording should be corrected rather than implemented literally.

Docs-side confirmations: `wrangler dev` does run containers locally, requires a Docker-compatible engine (Docker Desktop or Colima named; podman unverified), does **not** hot-reload container code (`[r]` rebuilds), and requires `EXPOSE` in the Dockerfile for local port access (not needed in production). `vite dev` **cannot pull from the Cloudflare Registry** — a local Dockerfile is the workaround, which is the shape this project would use anyway.

**mise is the right home.** `package.json` is barred from solver steps by CLAUDE.md, and there is no existing deploy-adjacent script — so image build/smoke tasks belong in `mise.toml` beside `solver:dev|test|check`. A Docker step does **not** fit lefthook: an image build is minutes, and it would be the first thing bypassed with `--no-verify`, which CLAUDE.md forbids.

### G. Security, credentials, and the trust boundary

**The binding really is a private path — the inherited assumption checks out.** Cloudflare states plainly: *"Requests are initially routed through a Worker… inbound TCP or UDP traffic from end-users is not supported."* There is no public address for a container. So `services/solver/README.md:72-74`'s *"That binding is the authentication"* survives contact with the platform, and F-302's impl-review blind spot (*"Assumes S-302's binding really is a private container network; that hasn't been designed yet"*) resolves favourably.

**Outbound suits the design.** Ports 80/443 + DNS only — exactly matching the PRD constraint that Supabase is reached over HTTPS/PostgREST, never the Postgres wire protocol. `enableInternet`, `allowedHosts`/`deniedHosts` allow tightening egress to the Supabase host, which would be a cheap hardening win.

**Secrets do not flow automatically.** There is **no `containers[].configuration.secrets` field** (that shape is stale/Cloudchamber-era). Worker secrets are *not* visible in the container; the Worker must forward them explicitly via `envVars` on the Container class or per-instance `startAndWaitForPorts({ startOptions: { envVars } })`. This creates tension with the PRD's *"container secrets live in container config, not the Worker"*: on Cloudflare, the documented channel **is** the Worker's own secret store (or Secret Store), read by Worker code and passed down. The intent — the Worker gains no new *privilege* — is preserved, but the literal wording is not implementable as written and should be restated.

**Two manual, gating steps remain** (`docs/runbooks/solver-credential.md:208-224`), both explicitly assigned to S-302:

- [ ] `supabase config push` (or dashboard toggle) on the hosted project, **then verify the claim**.
- [ ] Provision the hosted machine user; store the password in the container's config.

These matter more than their size suggests, because **absence fails upward**: with no Custom Access Token Hook, GoTrue falls back to `role: authenticated`, which — thanks to `alter default privileges` — reaches every public table. Nothing looks broken. The runbook's rule is the right one: *decode the token and confirm `role` reads `solver_job_writer` before pointing any container at hosted.* CI cannot do this (it deliberately holds no service-role key), so it stays a human gate.

### H. Cost — recomputed

Current published pricing (Workers Paid, billed per 10 ms of running time): CPU $0.000020/vCPU-s after 375 vCPU-min included; memory $0.0000025/GiB-s after 25 GiB-h; disk $0.00000007/GB-s after 200 GB-h. Memory and disk bill on *provisioned* resources; CPU bills on *active* usage; charges stop on sleep.

Applying those to `standard-4` (4 vCPU / 12 GiB / 20 GB), 5 solves/day, 30 days:

| Scenario | CPU | Memory | Disk | **Total/mo** |
| -------- | --- | ------ | ---- | ------------ |
| 5 min solve *(the recorded assumption)* | $3.15 | $3.83 | $0.14 | **$7.11** |
| **12.5 min solve** *(measured, F-302)* | $8.55 | $5.85 | $0.23 | **$14.63** |
| 20 min solve *(PRD ceiling)* | $13.95 | $7.88 | $0.33 | **$22.15** |
| 12.5 min + `sleepAfter` 1 m | $8.55 | $3.42 | $0.12 | **$12.09** |

The recorded "≈$7/month" reproduces **exactly** under its stated inputs — the derivation was sound, the input was overtaken by measurement. Real exposure is roughly **2–3×** the PRD figure, plus Workers + Durable Objects usage, and it remains a small number. Lowering `sleepAfter` recovers ~$2.50/mo but trades against cold starts. Off-season is still ~cents.

## Code References

- `wrangler.jsonc:1-15` — 15 lines; assets + observability only. `main` points into `node_modules`.
- `dist/server/wrangler.json` — the *generated, effective* deploy config (`durable_objects.bindings: []`, `migrations: []`, no `containers`, `no_bundle: true`, `dev.enable_containers: true`).
- `.wrangler/deploy/config.json` — redirects the CLI to the generated config; carries an `auxiliaryWorkers` slot.
- `dist/server/entry.mjs` — `export { worker_entry_default as default }`; **no named exports**.
- `node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts:7` — `handle(request, env, ctx)`, plus a global `Env` the repo never generates.
- `node_modules/wrangler/config-schema.json` → `definitions.ContainerApp` — authoritative field list for Wrangler 4.102.0; `required: ["image","class_name"]`.
- `src/entities/timetable/api/solver-transport.ts:20-27,52-79` — the port and its URL implementation; `DISPATCH_TIMEOUT_MS = 15_000`.
- `src/entities/timetable/api/solver-config.ts:24` — `getSolverTransport()`, the S-302 seam.
- `src/_pages/plan-detail/api/generation-job.ts:46-86` — transport null-gate → assemble → clone → insert → dispatch, with compensating cleanup.
- `services/solver/src/cpsat_service/app.py:40-46,130-156` — `parents[4]` schema anchor and its fail-open validator.
- `services/solver/src/cpsat_service/settings.py:31` — `DEFAULT_WORKERS = 8`.
- `services/solver/src/cpsat_service/supabase.py:115` — the `status=eq.queued` claim CAS (the wedged-row mechanism).
- `.github/workflows/ci.yml:151-161` — the solver job's own note that *"Path filtering still arrives with S-302."*
- `.github/workflows/ci.yml:205-236` — the `deploy` job S-302 extends.
- `mise.toml:28-41` — `solver:dev|test|check`; the natural home for image tasks.
- `astro.config.mjs:79-84` — `SOLVER_URL` declared optional and annotated DEV-ONLY, naming S-302.
- `docs/runbooks/solver-credential.md:208-224` — the S-302 hosted-enablement checklist (two unticked boxes).

## Architecture Insights

- **The seam discipline paid off exactly as designed.** Three prior changes wrote down that the transport must be a factory over a URL *now* and a binding *later* (`plan.md:54` of F-302: *"This split is also the S-302 seam"*). It held: no call site changes, no signature changes, no FSD violation. The cost of the shortcut was never paid.
- **The risk migrated to where nobody was looking.** Because the transport was so carefully abstracted, the residual difficulty concentrated in the one place the seam couldn't reach — the Worker's *entry module*, which the framework owns. The lesson generalizes: abstracting the call site doesn't abstract the deployment topology.
- **Fail-open beats fail-closed for `/health`, and fails badly for `contracts/`.** The same design instinct — *"`/health` must answer on a bare container"* — produces the right behaviour for env knobs and the wrong one for the wire schema, because a missing schema is not a degraded state, it is a broken one. The smoke test has to compensate.
- **This slice is the first in the repo to make CI produce a deployable *artifact* rather than run *checks*.** Every existing gate is idempotent and side-effect-free; an image build/push is neither. That is why the `deploy.needs` rewrite deserves more caution than its diff size implies.
- **Two documented CLAUDE.md rules earned their keep and one is now stale.** "Never write container config or token scopes from memory" was correct — the schema read locally corrected several plausible guesses. The containers#162 rule is now out of date and should be re-grounded on the platform's actual, durable statement: *"Cloudflare does not guarantee that any container instance will run for any set period of time."*

## Historical Context (from prior changes)

- `context/changes/post-poc-cp-sat-refactoring-plan/research.md:42,111-117,146,207-208` — the platform decision of record (standard-4, EEUR, scale-to-zero, ≈$7/mo), the same-Worker+binding shape, and Phase 4 as S-302's forerunner. **Read its dated-snapshot banner at `:23-30` first** — several greedy-related claims in the body are dead.
- `context/archive/2026-08-11-solver-service-transport/change.md:37-40` — image base pinned to `python:3.13-slim`, *"when S-302 writes it"*.
- `context/archive/2026-08-11-solver-service-transport/change.md:65-79` — the decision recording that the solve endpoint is unauthenticated and unbound, *"because S-302 would otherwise inherit it blind"*.
- `context/archive/2026-08-11-solver-service-transport/change.md:93-98` — the measured **~12.5 minute** full-catalog solve that invalidates the cost model's input.
- `context/archive/2026-08-11-solver-service-transport/reviews/plan-review.md:72-73` — origin of the `parents[4]` / *"the image must COPY contracts/"* obligation.
- `context/archive/2026-08-11-solver-service-transport/reviews/impl-review.md` — F2 (wedged `running` row → S-304 must widen the CAS), F3 (trust boundary), F4 (`/health` starvation → container sizing), F5 (timeouts chosen for containers#162).
- `context/archive/2026-08-14-clean-up-bench-generation/change.md:22-30` — the Generate button still has **no E2E coverage**, with *"the FR-315 solver-lane work"* named as a natural owner.
- `context/foundation/lessons.md:68-73` — *"A convention that cites a code mechanism is coupled to it"*. This research found six live instances of exactly that class (below).

**Stale claims found, which this slice should correct rather than inherit:**

| Claim | Where | Reality |
| ----- | ----- | ------- |
| containers#162 is an open hazard | `CLAUDE.md`, `prd.md:352-359`, `roadmap.md:172` | Closed 2026-05-12; fixed in `@cloudflare/containers` v0.2.2 |
| `python:3.12-slim` image base | `tech-stack.md:45,51`, `shape-notes.md:617-618` | Superseded → `python:3.13-slim` |
| Solver at `poc/cp-sat/`, "promoting" | `tech-stack.md:33-35` | Promoted in F-302 |
| Solver tests "run nowhere in CI" | `health-check.md:115-117`, `stack-assessment.md:59` | `solver` job runs ruff + mypy + pytest + audit |
| mise graduation is S-302's | `roadmap.md:77` | Graduated in F-302 |
| `bench` job is the structural template | `post-poc…/research.md:188,234` | `bench` job deleted by `clean-up-bench-generation` |
| ≈$7/month | `prd.md:203-204`, `roadmap`/`shape-notes` | ~$14.63 at the measured solve length |
| Tier 3 = `wrangler dev` | `roadmap.md:127`, `prd.md:403-411` | `astro dev`/`preview` via `@cloudflare/vite-plugin` |

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
| - | ---- | ---------- | ------ | ---------- |
| 1 | ~~Astro/Vite build won't carry a project-owned `main` or won't propagate container config~~ | — | — | **Retired 2026-08-16 — spiked and cleared.** Build, propagation, export survival and `wrangler --dry-run` binding all confirmed. See Spike result. |
| 1b | *(new, from the spike)* `wrangler types` output shadows DOM globals, breaking `pnpm check` in React islands | **M** | **M** | Do **not** use `wrangler types` here. Hand-write the ~12-line ambient `cloudflare:workers` + `Env` declaration — proven to give 0 errors across 747 files. Reaching for `wrangler types` is the natural first move and fails in an unrelated file. |
| 2 | Image layout breaks `contracts/` resolution; `/health` green, every solve 500s | **M** | **H** | Tier-2 smoke must POST `contracts/fixtures/solve-request.json` and assert **202**; assert `_SOLVE_REQUEST_VALIDATOR is not None` and print `SCHEMA_PATH`. |
| 3 | ~~`deploy.needs` rewritten with bare `always()` — red `verify` stops blocking production~~ | — | — | **Retired 2026-08-16** by the no-path-filtering decision: `deploy`'s `needs:`/`if:` gate is not touched, so this surface never opens. Re-arms if filters are ever reintroduced. |
| 4 | Hosted hook not enabled before first hosted run → silent escalation to `authenticated` | **M** | **H** | The runbook's two boxes are a **gate**, not a checklist. Decode the token and confirm `role = solver_job_writer` before pointing any container at hosted. |
| 5 | CF token missing `Containers: Edit` → deploy 403s | **H** | **L** | Add the one account-scoped permission; keep everything else narrow. Known fallback: `Cloudchamber: Edit`. Rotate/replace deliberately. |
| 6 | Container rollback unavailable (DO migration blocks `wrangler rollback`) | **M** | **M** | **Accepted 2026-08-16**: roll-forward-only is the shipped policy, not a gap to close. Deliverables: update `README.md`'s Rollback section; never `wrangler containers images delete` an image still referenced by a reachable version. |
| 7 | `instance_type` left at default `lite` (1/16 vCPU, 256 MiB) | **L** | **H** | Set `standard-4` explicitly; assert it in review. Memory measured at 854 MB peak (8 workers, *small* fixture). |
| 8 | uvicorn binds loopback in-container → unreachable, health green | **M** | **M** | `CMD … --host 0.0.0.0 --port 8000`; smoke from *outside* the container, not `docker exec`. |
| 9 | `SOLVER_WORKERS=8` on 4 vCPU — reproducibility claim quietly weakened | **L** *(was H)* | **M** | **Decided 2026-08-16**: container config sets `SOLVER_WORKERS=4` explicitly. Residual risk is only that the explicit set is forgotten in review — assert it against the deployed container, not just the config file. |
| 10 | 15 s dispatch timeout too tight for a cold ~400 MB image | **M** | **M** | Measure cold-start dispatch on the deployed container; raise the constant with evidence, not by guess. |
| 11 | Build context ships `.venv` (arm64) / `node_modules` — slow builds, poisoned image | **H** | **M** | Add `.dockerignore` in the same commit as the Dockerfile. |
| 12 | No CI layer cache → full rebuild every run | **H** | **M** *(was L — raised 2026-08-16)* | The no-filtering decision means the build runs on **every** merge to main, doc-only included, so this is now the slice's main recurring cost. Measure the added deploy wall-clock first (the repo declined Supabase image caching on measured grounds); if it bites, add GHA layer caching — never path filters, which would reopen risk 3. Push side stays incremental regardless. |
| 13 | Container image is a third unscanned dependency surface | **M** | **L** | Consider a base-image scan step alongside `pnpm audit` / `uv audit`. |
| 14 | Generate flow still has no E2E coverage; the container path's first proof is production | **M** | **M** | **Decided 2026-08-16: deferred to S-306**, which now owns it outright (the `clean-up-bench-generation` ambiguity is resolved). S-302 must not be reported as closing this gap — it stays open and owned. Feeds open question 6. |

## Open Questions

Ranked by what must be resolved **before** `/10x-plan` can produce a trustworthy plan.

1. ~~**Does the Astro build tolerate a project-owned Worker entry and propagate container config?**~~ — **RESOLVED 2026-08-16 by spike: yes, on all three counts.** No blocking unknowns remain. See Spike result. One new sub-finding replaces it: use a hand-written ambient declaration, not `wrangler types`.
2. **Does `wrangler rollback` restore the previous container image, or only Worker code?** *(near-blocking)* Undocumented. It determines whether the deploy lane ships with a working rollback story or an explicit roll-forward-only policy — and `README.md` currently promises the former.
3. ~~**Is path-filtering worth doing at all, given 44 s vs 426 s?**~~ — **RESOLVED 2026-08-16: filter nothing.** See Decisions taken. Leaves a live doc obligation: FR-315's "path-filtered" wording and the roadmap's S-302 Outcome must be amended or annotated, since neither will describe what ships.
4. ~~**`SOLVER_WORKERS`: 4 or 8 on `standard-4`?**~~ — **RESOLVED 2026-08-16: 4, set explicitly in container config**, with S-308 revisiting on production hardware. See Decisions taken.
5. ~~**Should the PRD's cost figure be restated to ~$15/month?**~~ — **RESOLVED 2026-08-16: yes**, as part of the doc truth-up now in S-302's scope.
6. **How is the binding transport tested before production?** *(open — plan phase)* The existing integration lane structurally cannot reach it, and E2E is now deferred to S-306, so the binding's first real proof is the deployed container unless the plan invests in `@cloudflare/vitest-pool-workers`. Name the choice rather than inheriting it.
7. **Does `sleepAfter` need lowering from the 10-minute default?** *(open — deferrable)* Trades ~$2.50/month against cold-start latency on a 400 MB image. Cheap to defer to S-304.
8. ~~**Restate FR-315's "container secrets live in container config, not the Worker"?**~~ — **RESOLVED 2026-08-16: yes**, in the doc truth-up. The intent (no new Worker privilege) is preserved; the mechanism wording is corrected.
9. ~~**Does `wrangler rollback` restore the previous container image?**~~ — **RESOLVED 2026-08-16 by decision, not investigation: ship roll-forward-only.** No production deploy cycle is spent finding out, because the action is identical either way. See `change.md`.

## Related Research

- `context/changes/post-poc-cp-sat-refactoring-plan/research.md` — the seed platform research that selected Cloudflare Containers (dated snapshot; read the banner).
- `context/archive/2026-08-11-solver-service-transport/research.md` — F-302, including the "`SOLVER_URL` is inherently dev-only" finding and the risk table entry handing image weight to S-302.
- `context/archive/2026-08-12-first-verified-proposal/research.md` — S-301, including the confirmation that dispatch-hardening is S-302's and snapshot-binding was S-301's.
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md` — where the "CI half-truth" argument that shaped the solver job was first made.
