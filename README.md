# IB Schedule Planner

Interactive timetable planner for IB (International Baccalaureate) programmes. A plan author drags compatible course groupings onto a two-cohort slot grid with live, sub-200 ms constraint validation — replacing the current "algorithm output + manual spreadsheet" workflow.

## Tech Stack

- [Astro](https://astro.build/) v7 — server-first framework with React islands
- [React](https://react.dev/) v19 — interactive UI components (drag-and-drop grid, validation feedback)
- [TypeScript](https://www.typescriptlang.org/) v6 — strict types across the codebase
- [Tailwind CSS](https://tailwindcss.com/) v4 — utility-first styling
- [Supabase](https://supabase.com/) — Postgres persistence + email/password auth
- [Cloudflare Workers](https://workers.cloudflare.com/) — edge deployment runtime (workerd)

## Prerequisites

- Node.js 24.15.0 (see `.node-version`)
- [pnpm](https://pnpm.io/) 11.9.0 (declared in `packageManager`)
- [Docker Desktop](https://www.docker.com/) — required by the local Supabase stack

## Getting Started

1. Install dependencies:

```bash
pnpm install
```

2. Start the local Supabase stack (first run pulls Docker images):

```bash
pnpm exec supabase start
```

3. Copy the **Publishable** key printed by the CLI and create your env files:

```bash
mkdir -p .envs
cat > .envs/local.vars <<EOF
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<Publishable key from supabase start>
SOLVER_URL=http://127.0.0.1:8000
EOF
```

> `.envs/` is gitignored, so these files are per-machine — this snippet is the only place their contents are specified. `SOLVER_URL` is optional: leave it out and generation dispatch is simply unavailable (`getSolverTransport()` returns `null`). See [Running the solver service](#running-the-solver-service-dev).

4. Activate the local environment profile:

```bash
pnpm env:local
```

5. Run the dev server:

```bash
pnpm dev
```

The app is served at `http://localhost:4321`. Local Supabase Studio is at `http://127.0.0.1:54323` and Mailpit (email capture) at `http://127.0.0.1:54324`.

## Available Scripts

| Script           | Description                                             |
| ---------------- | ------------------------------------------------------- |
| `pnpm dev`       | Start the Astro dev server (Cloudflare workerd runtime) |
| `pnpm build`     | Production build                                        |
| `pnpm preview`   | Preview the production build locally                    |
| `pnpm lint`      | ESLint (flat config, type-checked)                      |
| `pnpm lint:fix`  | Auto-fix lint issues                                    |
| `pnpm format`    | Prettier across the tree                                |
| `pnpm env:local` | Switch `.env.local` + `.dev.vars` to local Supabase     |
| `pnpm env:prod`  | Switch `.env.local` + `.dev.vars` to hosted Supabase    |

## Project Structure

The codebase follows [Feature-Sliced Design](https://feature-sliced.design/) (enforced by `pnpm steiger`). Layers import downward only: `app` → `_pages` → `widgets` → `entities` → `shared`.

```
src/
├── app/            # App shell, layouts, global styles
├── _pages/         # FSD page slices (e.g. plan-detail/, courses/, teachers/)
│   └── <slice>/    #   api/ (Supabase), model/ (domain logic + hooks), lib/, ui/
├── widgets/        # Composed read-only UI shared across page slices (timetable-board)
├── entities/       # Business-domain slices (timetable/ — pure read-side scheduling core)
├── shared/         # Reused across slices: api/ (Supabase client), lib/, config/, ui/
├── actions/        # Astro Actions (thin; logic lives in slice model/api)
├── pages/          # Astro file-routing — routes + API endpoints (src/pages/api/)
└── middleware.ts   # Deny-by-default route protection
contracts/          # The frozen TS↔Python generation wire contract (JSON Schema + goldens)
supabase/           # Local Supabase config, migrations, generated seed.sql
data/               # Reference CSV fixtures (not read at runtime)
context/            # Foundation docs (PRD, tech-stack, infrastructure, deploy plan)
public/             # Static assets
wrangler.jsonc      # Cloudflare Workers configuration
```

> The pure two-cohort (dp1/dp2) constraint/validation core lives in `src/entities/timetable/` (shared by the editing board and the read-only perspective views). Editing orchestration (drag state, optimistic placements, hooks) stays in `src/_pages/plan-detail/model/`.
>
> `contracts/generation-wire.schema.json` is owned by neither the TypeScript nor the Python side: both are projections of it, and both suites byte-gate the same golden fixtures. Read [`contracts/README.md`](contracts/README.md) before changing anything on either side of the wire — it is normative for the canonical JSON form and the `formatVersion` policy.

## Environment Profiles

The project uses three profiles across two Supabase targets — **local** (default for development) and **hosted**. Profile files live in `.envs/`, which is gitignored, so each is per-machine:

| File                     | Database | `SOLVER_URL` | What it is for                                          |
| ------------------------ | -------- | ------------ | ------------------------------------------------------- |
| `.envs/local.vars`       | local    | set          | the default dev loop                                    |
| `.envs/prod.vars`        | hosted   | **unset**    | read-only smoke against hosted                          |
| `.envs/prod-solver.vars` | hosted   | set          | the [hosted-solve campaign](#the-hosted-solve-campaign) |

Swap with a single command:

```bash
pnpm env:local         # default dev loop
pnpm env:prod          # read-only smoke against hosted Supabase
pnpm env:prod-solver   # hosted data + a solver on this machine — see the campaign section
```

All three write `.env.local` (for `astro dev`) and `.dev.vars` (for `wrangler dev`) so the two dev commands stay in sync. Always run `pnpm env:local` afterwards; `mise run solver:hosted` does it for you on exit.

> **Switching a profile requires a rebuild before `pnpm preview`.** `astro build` snapshots the root `.dev.vars` into `dist/server/.dev.vars`, and both `astro preview` and `wrangler dev` read _that copy_. A stale build keeps the previous profile's transport, silently — which is exactly the trap `mise run solver:tier3` sequences around.

`.envs/prod-solver.vars` carries a fourth key the other two do not — `SOLVER_MACHINE_PASSWORD` — because `mise run solver:hosted` reads this file to configure the solver process. It is harmless in `.env.local`/`.dev.vars`: `astro:env` ignores keys its schema does not declare.

> **Values are bare literals, dotenv-style** — no quotes, no shell escaping, and no `#` (an unquoted dotenv value is cut at the first `#`). The file is never executed as shell: `scripts/solver/hosted.sh` reads keys with `sed`, and `.dev.vars` / `.env.local` are parsed as dotenv. Provision the machine user with a password that avoids `#`, quotes and whitespace and every reader agrees on it.

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<hosted publishable key>
SOLVER_URL=http://127.0.0.1:8000
SOLVER_MACHINE_PASSWORD=<hosted machine user password>
```

### Why `prod.vars` has no `SOLVER_URL`

Because the two hosted profiles must stay distinguishable, and the hazard is narrower than "leaking a URL into production". `.envs/*.vars` is copied only to `.env.local` and `.dev.vars` — both gitignored, neither deployed; the Worker's own secrets come from `wrangler secret put`, and production reaches the solver through the container binding regardless. The real risk is the other direction: **a developer running locally against hosted data dispatches production jobs to their own laptop**, and a solve interrupted by a closing lid leaves a production row stuck at `running`.

That mode is legitimate — it is the whole point of the campaign below — but it has to be chosen deliberately rather than inherited from a profile. So `prod.vars` stays the read-only smoke, and the dispatching variant is a separate, louder command.

## Running the solver service (dev)

The daily loop runs the CP-SAT solver as a **native process** — no container, no image, and `pnpm dev` / `pnpm preview` never touch Docker (`dev.enable_containers: false` in `wrangler.jsonc`). Two heavier tiers exist for the things a native process cannot prove. Cross-ecosystem commands go through [mise](https://mise.jdx.dev/) (`mise.toml` pins `uv`); pnpm scripts stay the JS-side canon and never gain a solver step.

| Tier                         | Command                                        | Docker | What only this tier proves                                                      |
| ---------------------------- | ---------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| **1 — native**               | `mise run solver:dev`                          | no     | the daily loop; also what CI's integration lane runs                            |
| **2 — image**                | `mise run solver:image:build` + `:image:smoke` | yes    | the **image** is correct: `contracts/` resolves, uvicorn binds `0.0.0.0`, amd64 |
| **3 — container in workerd** | `mise run solver:tier3`                        | yes    | the **binding** path: `env.SOLVER`, a real container start, `containerFetch`    |

Tiers 1 and 2 both dispatch over a URL, so neither exercises the Durable Object binding at all — that is what tier 3 is for, and why it exists despite being the slowest. Separately, the [hosted-solve campaign](#the-hosted-solve-campaign) points tier 1 at the **hosted** database.

> Every task body lives in `scripts/solver/*.sh`; `mise.toml` is the catalog (a `description`, a `dir` and a one-line `run`). Those scripts are POSIX sh, open with `set -eu`, self-locate to the repo root, and are shellcheck-gated by `mise run solver:check` and CI's `verify` job — shellcheck 0.11.0, pinned in both `mise.toml` and the workflow.

### Tier 1 — native (the default)

One-time, per local database: create the machine Auth user the service signs in as.

```bash
SOLVER_MACHINE_PASSWORD='<strong-password>' node scripts/provision-solver-user.mjs
```

Then, with the Supabase stack up:

```bash
mise run solver:dev     # uvicorn on :8000 — needs the env trio below
mise run solver:test    # pytest (engine + contract + HTTP wrapper)
mise run solver:check   # ruff + mypy --strict + shellcheck on scripts/solver — the same gates CI's solver and verify jobs run
```

`solver:dev` reads three variables from **your shell**, and **none of them is privileged** — no secret key, no service-role key (see [`docs/runbooks/solver-credential.md`](docs/runbooks/solver-credential.md)):

| Variable                  | Value                          |
| ------------------------- | ------------------------------ |
| `SUPABASE_URL`            | `http://127.0.0.1:54321`       |
| `SUPABASE_KEY`            | the **publishable** key        |
| `SOLVER_MACHINE_PASSWORD` | whatever you provisioned above |

Two of the three are already in `.envs/local.vars`, so the usual incantation is:

```bash
set -a; . .envs/local.vars; set +a
export SOLVER_MACHINE_PASSWORD='<what you provisioned>'
mise run solver:dev
```

The task **refuses to start** without all three. That guard lives in the launcher script (`scripts/solver/dev.sh`), not the service, on purpose: the service itself boots happily unconfigured, because `/health` must answer on a bare container before secrets are wired. On a developer's machine that same tolerance is a trap — uvicorn looks healthy, and every dispatch is refused with a **503** (`solve` refuses work on an unconfigured service, so the row is marked `failed` and the clone deleted rather than left wedged at `queued`) — a loud failure, but one that costs a build and a click each time. A correctly configured start logs its effective settings and the credential check:

```
solver service starting: workers=8 max_concurrent_jobs=1 stage_targets=<none> ... credential_configured=True wire_contract=loaded
startup credential check passed: the access token carries role=solver_job_writer
```

That second line is a **fail-closed gate**, not decoration: if the Custom Access Token Hook is off, Auth silently issues `role: authenticated`, which reaches every table. The service refuses to start rather than run with it.

Optional: `SOLVER_WORKERS` (default `8`, pinned for reproducibility — never auto), `SOLVER_MAX_CONCURRENT_JOBS` (default `1`; further dispatches get a 503), `SOLVER_LOG_LEVEL` (default `INFO`) and `SOLVER_STAGE_TARGETS` (default empty).

`SOLVER_STAGE_TARGETS=tier=value[,tier=value]` — e.g. `3=95,6=900` — stops those ladder stages as soon as the objective reaches the value instead of burning the whole budget; the stage records `stoppedBy: "target"`. Tiers outside 2–10 and malformed entries are dropped with a complaint on stderr rather than refusing to start. **Left unset, behaviour is exactly what it was before S-303** — which is why no values ship: measuring the ones worth shipping is S-308's job, and an M-series number must never become a container's budget (see the campaign note below).

Endpoints: `GET /health` (dependency-free) and `POST /jobs/{jobId}/solve`, which takes an unmodified contract `SolveRequest`, answers **202**, and reports the outcome by advancing the `generation_jobs` row — the database is the only status channel. Since S-303 the row advances **per ladder stage**: two `running → running` writes per stage (which tier is running; then the transcript so far plus the incumbent `checkpoint` when the stage solved), each renewing `heartbeat_at`. That is what `/plans` polls to show live progress. To exercise the whole chain end to end:

```bash
# the transport alone (queued → running → succeeded), and the full S-301 slice
# (Generate → solve → server-side oracle → id translation → board on the proposal plan)
SOLVER_URL=http://127.0.0.1:8000 pnpm test:integration src/test/solver-transport.integration.test.ts
SOLVER_URL=http://127.0.0.1:8000 pnpm test:integration src/test/generation-proposal.integration.test.ts
```

> Running the **whole** integration lane against the solver needs the job cap raised, because those
> are two suites that dispatch and vitest runs files in parallel: start the service with
> `SOLVER_MAX_CONCURRENT_JOBS=2` (what CI does) or the loser of the race gets a correct-but-unhelpful 503. Both fixtures solve in about a second.

The **E2E** suite needs a solver too, since S-306: `e2e/specs/generation.spec.ts` presses Generate and
waits for the board to land on the proposal plan. Locally that means `mise run solver:dev` up and
`SOLVER_URL` in `.envs/local.vars` — it already is, so `pnpm env:local` is the whole setup:

```bash
mise run solver:dev                            # in one shell, per the env trio above
pnpm test:e2e e2e/specs/generation.spec.ts     # in another
```

Without a solver the spec fails at the Generate click rather than skipping — the dispatch is refused
as "not configured", which is the honest outcome for a lane whose entire subject is that dispatch.
The `SOLVER_URL` value reaches the preview through `.dev.vars`, so a **rebuild** is required after
switching profiles (the standing `.dev.vars` rule — see [Environment Profiles](#environment-profiles)).

### Tier 2 — the container image

Proves the **image**, which the native process cannot: that the Dockerfile reproduces the repo layout `app.py`'s `parents[4]` anchor needs, that uvicorn binds `0.0.0.0` rather than loopback, and that the result is `linux/amd64` (`wrangler containers push` rejects anything else).

```bash
mise run solver:image:build   # ~394 MB, asserts amd64 itself
SOLVER_MACHINE_PASSWORD='…' mise run solver:image:smoke
```

The smoke POSTs a real golden `SolveRequest` and asserts **202** — probing `/health` would not do, because the contract validator **fails open**: with `contracts/` missing from the image, `/health` still answers 200 while every solve 500s. It runs against your local stack via `host.docker.internal`.

> Docker Desktop must be running. On Apple silicon the amd64 image runs under emulation: fine for correctness, **worthless for timing** — never quote a solve duration measured here.

### Tier 3 — the real container inside workerd

The only tier that exercises the production dispatch path: `getSolverTransport()` choosing the **binding** over a URL, `SolverContainer` starting a real container, and `containerFetch` crossing Workers RPC.

```bash
export SOLVER_MACHINE_PASSWORD='<what you provisioned>'
mise run solver:tier3          # TIER3_PORT=8790 to move it off :8787
```

It rewrites `.dev.vars`, rebuilds, then runs `wrangler dev --enable-containers`. **That order is load-bearing** — see the rebuild note under [Environment Profiles](#environment-profiles). Ctrl-C restores `pnpm env:local`. Generate on a local plan, and the POST appears in the container's `docker logs`.

Three edits go into `.dev.vars`, all before the build — because **`wrangler dev` builds the Worker's `env` from that file, not from your shell**, and `SolverContainer` can only forward what the Worker actually holds:

- **`SOLVER_URL` removed**, so `getSolverTransport()` falls through to the binding. This is the point of the tier.
- **`SOLVER_SUPABASE_URL` added**, pointing at `host.docker.internal`. The Worker and the container need _different_ Supabase URLs: the Worker runs on the host and reaches the stack at `127.0.0.1`, which inside the container is the container's own loopback — every request refused, the startup check kills the process, and `startAndWaitForPorts` times out 45 s later.
- **`SOLVER_MACHINE_PASSWORD` added** from your shell. In production this is a Worker secret (`wrangler secret put`); locally it has nowhere else to come from.

The last two are inert in production — no such Worker secret exists there. Both are dropped again by the exit trap's `pnpm env:local`.

> **The failure this prevents.** Without the password the container still starts: `settings.py` lets an unconfigured service boot so `/health` answers on a bare container, and the credential check _skips itself_. The container then refuses every dispatch with a **503** — the job is marked `failed` and the clone deleted — so tier 3 proves nothing. (Until 2026-08-18 the unconfigured service _accepted_ the job and the row wedged at `queued`; `solve` now refuses work when unconfigured.) The same applies in production if the Worker is missing the `SOLVER_MACHINE_PASSWORD` secret — which is why setting it is a gate in [`docs/runbooks/solver-credential.md`](docs/runbooks/solver-credential.md), not a formality.

> `wrangler dev` reads the generated `dist/server/wrangler.json` through `.wrangler/deploy/config.json`, so it picks up the container config; `--enable-containers` overrides the committed `dev.enable_containers: false` for that session only. No edit to `wrangler.jsonc` is needed, and none should be made.

### The hosted-solve campaign

Local app + **native** solver against the **hosted** database. It exists to compare plan and policy variations against real current data, cheaply and without spending Cloudflare container time.

```bash
mise run solver:hosted         # SOLVER_HOSTED_CONFIRM=yes to skip the prompt
```

It validates `.envs/prod-solver.vars`, prints a confirmation banner, switches the profile, starts the solver under `caffeinate -i`, builds and previews — and on exit stops the solver and restores `pnpm env:local`.

**Prerequisite:** hosted enablement must be done first (the hook enabled and the hosted machine user provisioned — [`docs/runbooks/solver-credential.md`](docs/runbooks/solver-credential.md) § Hosted enablement). Until then, point `.envs/prod-solver.vars` at the local stack to rehearse the command itself.

Know what it costs before running it:

- **It writes to production.** Generation inserts `generation_jobs` rows, calls `clone_plan` (creating real proposal plans that accumulate), and on delivery applies placements **onto the proposal plan** — never onto the source, which a solve does not write to. It is not a smoke test.
- **Do not let the machine sleep.** The claim CAS filters `status=eq.queued`, so a solve interrupted mid-flight leaves a _production_ row stuck at `running`, unclaimable until S-304 widens it — recovery today is manual SQL against hosted. `caffeinate -i` covers idle sleep, not a closed lid or a flat battery.
- **Timing measured here is invalid.** M-series cores plus 8 workers against the container's 4 give a 3–5× wall-clock difference; the PRD forbids M-series-derived budgets reaching S-308. Board **quality** is target-defined and hardware-independent, so policy comparison is legitimate — but worker count changes _which_ equally-good board comes back, so a local board is not what production would emit. `SOLVER_STAGE_TARGETS` may be set in the shell for a comparison run and is genuinely useful here — a target is an objective VALUE, so which board a target yields is hardware-independent — but the wall clock it saves is not, and no number measured on this machine may become a shipped budget.
- **Real names on your machine.** The solver still sees UUIDs only, but the app renders hosted data. Never commit an export.

## Deployment

The app deploys to **Cloudflare Workers**. The full deployment plan is in [`context/deployment/deploy-plan.md`](context/deployment/deploy-plan.md).

- **Production URL:** <https://ib-timetable-planner.dobromir-kropielnicki.workers.dev>
- **Custom domain:** <https://ib-timetable-planner.dev>

Deployment is **automated**: every push to `main` runs the CI pipeline, and once all test jobs pass the `deploy` job applies pending Supabase migrations to the hosted project, then builds and pushes the solver container image and ships the Worker + container in a single `wrangler deploy` (see [CI / CD](#ci--cd)). Merging to `main` is the normal release path — no manual steps required.

> ⚠️ **Do not merge to `main` while a production solve is running.** Every merge deploys, and when the image changes the container rolls out; at `max_instances: 1` the running instance is the one replaced, so a 12–20 minute solve in flight dies and leaves its row stuck at `running`.
>
> `rollout_active_grace_period` is set to 1200 s and does **not** reliably prevent this. Its "active" is **how long the instance has been connected to its Durable Object**, not whether a request is in flight — so a solving container _is_ active by the platform's definition, and the earlier reading of this ("dispatch is 202-and-detach so nothing looks active") was wrong. The conclusion survives for a different reason: the window is measured from connection start, so a warm container whose connection age already exceeds 1200 s gets **zero** protection, and a cold-started 20-minute solve loses its protection exactly as it finishes. And once SIGTERM does land, uvicorn's graceful shutdown does not wait for the daemon thread doing the solve. S-304 owns the real fix (activity renewal + SIGTERM checkpointing + a fail-forward reclaim so a killed solve is recoverable). Until then this rule is the guard.

### Manual deploy (escape hatch)

For out-of-band releases (e.g. CI is unavailable), run the same two steps the `deploy` job runs — schema first, then code:

```bash
pnpm exec supabase db push   # apply pending migrations to the hosted project
pnpm build
pnpm exec wrangler deploy    # ALSO builds + pushes the container image — needs Docker running
```

**`wrangler deploy` needs a Docker daemon**, because `containers[].image` is a Dockerfile path and wrangler builds it locally before pushing. To ship a Worker-only change without touching the container (or from a machine without Docker):

```bash
pnpm exec wrangler deploy --containers-rollout=none
```

The same flag is the only way to make `--dry-run` Docker-free: a plain `wrangler deploy --dry-run` still runs `docker build` (no push).

Production secrets are stored on the Worker via `pnpm exec wrangler secret put`:

| Worker secret             | Used by                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `SUPABASE_URL`            | the Worker, and forwarded to the container                                |
| `SUPABASE_KEY`            | the Worker (publishable), and forwarded to the container                  |
| `SOLVER_MACHINE_PASSWORD` | **the container only** — the Worker is a courier and never uses it itself |

> The Worker gains no new privilege by carrying the third one: a Cloudflare container cannot read Worker secrets on its own (there is no `containers[].configuration.secrets`), so `SolverContainer` reads them and passes them down through `envVars`. **If `SOLVER_MACHINE_PASSWORD` is missing, every generation fails** — the container still boots (`/health` must answer on a bare container, so its credential check skips itself) but `solve` refuses work with a 503, so the row is marked `failed` and the clone deleted. Loud, but every Generate fails until the secret is set — setting it is a gate in [`docs/runbooks/solver-credential.md`](docs/runbooks/solver-credential.md).

### Rollback

**Container deploys are roll-forward-only.** Ship a fix with a new `wrangler deploy`; do not plan around `wrangler rollback`.

Two facts make that the policy rather than a preference:

- **A Durable Object migration between versions blocks `wrangler rollback` outright**, and containers are DO-backed. The `v1` migration that introduces `SolverContainer` is exactly such a change, so rolling back to any pre-container version is refused.
- Even where a rollback is permitted, Cloudflare states that _"resources connected to your Worker will not be changed during a rollback"_ — so it is a Worker-**version** operation, and whether it would restore a previous container image is undocumented. There is no image-rollback command.

The Worker-only rollback below still works between two post-container versions, and is worth knowing for a bad app-code deploy:

```bash
pnpm exec wrangler deployments list
pnpm exec wrangler rollback <deployment-id>
```

> **Operational rule:** never `wrangler containers images delete` an image that is still referenced by a reachable Worker version. Nothing will stop you, and there is no way back.

### Known gaps

- **The container image has no vulnerability scanner.** `verify` runs `pnpm audit` and `solver` runs `uv audit`, but the base image and its OS packages are a third dependency surface with no gate. The base is pinned by tag (`python:3.13-slim`), not by digest, so it also moves under you between builds.
- **Egress is not restricted.** `@cloudflare/containers` exposes `allowedHosts`/`deniedHosts`; pinning outbound traffic to the Supabase host would be a cheap hardening win and is not done.

## CI / CD

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push and PR to `main`. All jobs share the `./.github/actions/setup` step (pnpm + Node + `pnpm install --frozen-lockfile`):

1. **`verify` job** — `shellcheck scripts/solver` → `astro sync` → `check` → `lint` → `steiger` → `pnpm audit --audit-level=high` → `test` → `build`
2. **`integration` job** — boots a trimmed local Supabase stack, provisions the solver machine user with a per-run password, launches the CP-SAT service (with `SOLVER_MAX_CONCURRENT_JOBS=2`, sized to the worker cap below) and waits on its `/health`, then runs `pnpm test:integration --maxWorkers=2` — which includes both solver-touching suites: the `queued → running → succeeded` proof-of-life, and the full S-301 chain from Generate to a verified board on the proposal plan
3. **`e2e` job** — boots the stack, provisions the solver machine user and starts the **native** CP-SAT service (same recipe as `integration`, `SOLVER_MAX_CONCURRENT_JOBS` left at 1), writes `.dev.vars` **including `SOLVER_URL`** — before the build that snapshots it — then boots the workerd preview and runs the Playwright suite (`pnpm test:e2e`). The solver is what lets `generation.spec.ts` press Generate and drive the result to a board; without `SOLVER_URL` the preview would pick the container binding instead and need Docker for no extra coverage
4. **`solver` job** — from `services/solver`: `uv sync --locked` → `ruff check` → `mypy` (strict, src + tests) → `pytest` → `uv audit`
5. **`deploy` job** — on push to `main` only, after `verify` + `integration` + `e2e` + `solver` all pass: applies pending migrations (`supabase db push`), checks the Docker daemon, then builds and pushes the solver container image and ships the Worker + container via `cloudflare/wrangler-action@v4`

**No path filters anywhere in this workflow**, and that is deliberate rather than an oversight. The four test jobs carry no `needs:` between them, so they run in parallel and the critical path is `e2e` at ~426 s (plus the solver boot S-306 added — `uv sync` is cached and the generation fixture solves in ~1 s); the `solver` job is 44 s, so filtering it saves billed minutes and zero wall clock — while requiring a rewrite of `deploy`'s `if:` gate that would switch off the implicit success check on all four needs at once, on the only job that touches production. The accepted cost is that the image build runs on every merge, doc-only merges included. If that becomes a problem the lever is GitHub Actions Docker layer caching (`cache-from`/`cache-to: type=gha`), **never** path filters.

Required **GitHub repository** secrets — exactly the four the `deploy` job reads:

| Secret                  | Read by                                                    |
| ----------------------- | ---------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI access token — `db push` in `deploy`          |
| `SUPABASE_DB_PASSWORD`  | Hosted DB password — `db push` in `deploy`                 |
| `CLOUDFLARE_API_TOKEN`  | Scoped token: **Workers Scripts: Edit + Containers: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier                              |

> Both token permissions are account-scoped, and the second is easy to miss: Cloudflare's own `Edit Cloudflare Workers` **template does not include Containers**, so a token minted from it deploys the Worker and then 403s on the image push. If that happens, `Cloudchamber: Edit` is the next thing to add — wrangler's OAuth flow requests both. Do not add `Cloudflare Images: Edit`; it is an unrelated product.

`SUPABASE_URL` and `SUPABASE_KEY` are **Worker** secrets, not repository secrets — they are set out-of-band with `pnpm exec wrangler secret put` (see [Deployment](#deployment)) and no CI job reads them. The `integration` and `e2e` jobs get their own values from the ephemeral local stack they boot, never from repository secrets: pointing a CI preview at production is exactly what that separation prevents.

## Supabase

### Local development (default)

Requires Docker. The local stack runs Postgres on `54322`, API on `54321`, Studio on `54323`, and Mailpit on `54324`.

```bash
pnpm exec supabase start    # boot the local stack
pnpm exec supabase stop     # shut it down
```

### Hosted project

| Detail      | Value                  |
| ----------- | ---------------------- |
| Project ref | `hwmuiymhjgewtymymbmb` |
| Region      | Central EU (Frankfurt) |

Link the CLI to the hosted project (one-time):

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref hwmuiymhjgewtymymbmb
```

### Database: migrations & seed

Schema lives in `supabase/migrations/`. The dev seed (`supabase/seed.sql`) is a **generated artifact** — `scripts/gen-seed.mjs` transcodes the `data/dp1/` + `data/dp2/` CSV fixtures into inlined SQL. Both the script and its output are committed.

**Local (default loop).** `db reset` recreates the database, applies every migration, then loads the seed:

```bash
pnpm exec supabase db reset            # migrations + seed, from scratch
```

If you changed a fixture under `data/dp1/` or `data/dp2/`, regenerate the seed first, then reset:

```bash
node scripts/gen-seed.mjs > supabase/seed.sql
pnpm exec supabase db reset
```

The generator aborts loudly on data inconsistencies (e.g. phantom courses) and prints row-count stats to stderr. Add a new migration with:

```bash
pnpm exec supabase migration new <descriptive_name>
```

**Hosted.** On merge to `main`, the CI `deploy` job applies pending **migrations only** via `supabase db push` (the seed is dev-only and is never applied to hosted). To push out-of-band — CI unavailable, or to validate before merge:

```bash
pnpm exec supabase db push             # apply pending migrations to the linked project
pnpm exec supabase db diff             # should report clean afterward
```

> Table reachability is pinned explicitly in migrations, not left to Supabase's legacy auto-grant for new `public` tables (the platform is moving to opt-in grants). `authenticated` and `service_role` are granted DML on the public schema — current and future tables, via `alter default privileges` — while `anon` is revoked (least privilege). When adding a `public` table, the default-privilege rules carry these grants forward automatically; if a table is ever unexpectedly unreachable, run `pnpm exec supabase db advisors` and confirm the role holds a grant. RLS controls which rows are visible; grants control whether the table is reachable at all — both must be in place.

**Rollback.** There is no production data to preserve yet. Prefer additive migrations (nullable new columns, no `DROP`); a code rollback does not undo an applied migration. To reset hosted state at this stage, drop and re-push.

### Auth routes

| Route          | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| `/auth/signin` | Email/password sign-in                                          |
| `/dashboard`   | Protected page (redirects to `/auth/signin` if unauthenticated) |

There is no self-service signup: accounts are provisioned manually. See [`docs/runbooks/author-provisioning.md`](docs/runbooks/author-provisioning.md).

The CP-SAT solver reaches the database as a **machine** Auth user whose token carries a narrow Postgres role (`solver_job_writer`, reaching only `generation_jobs`) via a Custom Access Token Hook — it never holds a secret key. Provisioning, rotation, hosted enablement, and the kill-switch drill are in [`docs/runbooks/solver-credential.md`](docs/runbooks/solver-credential.md).

Route protection is deny-by-default in `src/middleware.ts` — every route requires an authenticated session except the sign-in page, the `/api/auth/` endpoints, and static assets.

## License

MIT
