---
date: 2026-09-29T22:23:13+02:00
researcher: Claude (Opus 5.5) for Dobromir Kropielnicki
git_commit: e1714f713cd89274b7dd069b6dd28bea65cd937a
branch: main
repository: dobrek/ib-timetable-planner
topic: "Which steps of the S-308 production calibration campaign can be automated, and with what scripts or small code changes, to minimise manual work?"
tags: [research, codebase, solver, calibration, campaign, automation, generation_jobs, solver-container, cloudflare-containers, workers-observability, astro-actions, bench, mise]
status: complete
last_updated: 2026-09-29
last_updated_by: Claude (Opus 5.5)
---

# Research: Automating the production calibration campaign

**Date**: 2026-09-29T22:23:13+02:00
**Researcher**: Claude (Opus 5.5) for Dobromir Kropielnicki
**Git Commit**: e1714f713cd89274b7dd069b6dd28bea65cd937a
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/e1714f713cd89274b7dd069b6dd28bea65cd937a/`

## Research Question

`production-calibration-campaign` (S-308) has shipped its two code phases (knobs, `pnpm analyze:jobs`). What remains is operational: Phase 3 (lifecycle drills), Phase 4 (twelve ledgered production runs), Phase 5 (ship + true up + clean up), plus the pending manual checks 1.5, 2.3 and 2.4. Which of those steps can be automated so the campaign needs as little manual work as possible?

Scope agreed with the author: everything (Phase 3 drills, the Phase 4 loop, setup and cleanup, Phase 5 analysis); both scripts **and** small code changes are in bounds as levers; aim at an **unattended runner**, not just helper scripts.

## Summary

**Almost the whole campaign can run unattended.** Three kinds of step stay human: a one-time setup, the judgement that picks Cell D and the shipped numbers, and the Phase 5 prose. Everything a human does per run today can be scripted: wait for idle, apply the cell, dispatch, confirm the values, wait, deliver, extract, write the ledger row. Nothing *requires* a code change. The deployed app is fully drivable over HTTP, and the container's stdout is queryable through Cloudflare's Workers Observability Telemetry Query API. Three small code changes would each remove a whole class of fragile step, though.

### Automation map

| # | Step (source) | Today | Scripted via | Code change? |
|---|---|---|---|---|
| 1 | Campaign author account + credentials | — | **stays manual**, one-time (dashboard, runbook § b) | no |
| 2 | Clone the campaign plan (plan 3.1) | UI | `POST /_actions/clonePlan` with `includeBoard:false` (see §8) | no |
| 3 | 1.5: deployed startup line shows 120/300/`<none>` | dashboard log | Telemetry Query API, needle `solver service starting:` | no |
| 4 | 2.3 / 2.4 analyzer checks | commands | one command each; 2.4 needs the S-302 job's **full** id (only the `386b9d35` prefix is recorded) | no |
| 5 | "Nothing running" guard before any deploy | Studio / UI | service-role row query + `isStaleActiveJob` | analyzer mode |
| 6 | Apply a cell | edit + PR/merge + watch CI | (a) scripted commit → push → `gh run watch` → gate on the **Deploy** job; or (b) Worker-secret override via `wrangler secret put` | (a) no; (b) small |
| 7 | Guarantee a cold start on the new values | eyeball the sleep | proxy: telemetry `[solver-container] stopped:` after the last request; reliable: `stopIfIdle` + status RPC route | proxy no; reliable small |
| 8 | Generate | click | `POST /_actions/startGeneration` | no |
| 9 | Attribute the job to its cell | read the startup log | telemetry `solver service starting:` + `job <id> solving with N workers`; or the row records its own config | no; **small, recommended** |
| 10 | Wait for terminal | watch UI | poll `readGenerationJobStatuses({jobIds})` or the row, every 30–60 s | no |
| 11 | Deliver the board | visit the plan | `POST /_actions/checkPlan` (idempotent CAS) | no |
| 12 | Extract + paste ledger row | run analyzer + copy | analyzer ledger mode (JSON + markdown) | analyzer extension |
| 13 | Did the clean fallback fire? | `unaccounted` heuristic | `cleanFallback` recorded on the row (engine already computes it) | small (rides on 9) |
| 14 | Drill: deploy mid-solve at stage ≥ 3 | hand-timed merge | poll `stage_index` → trigger deploy | no, but **timing trap** (§7) |
| 15 | Drill: verify interrupted + checkpoint + label + self-heal | Studio + UI | row poll + `checkPlan` + grep SSR HTML + `startGeneration` | no |
| 16 | Renewal proof + idle-sleep boundary | `wrangler tail` by eye | telemetry lines `sleep declined…`, `idle at sleepAfter…`, `stopped:` | no |
| 17 | The five production numbers | hand arithmetic | computed from row timestamps + telemetry timestamps | no |
| 18 | Cross-cell per-tier comparison | hand | pure formatter over the ledger | analyzer extension |
| 19 | Choose Cell D's budget and the shipped constants | judgement | **stays human**; runner pauses after Cell C | — |
| 20 | S-309 baseline block | hand | pure formatter (+ exact delivered tuple via `scoreCandidate`) | analyzer extension |
| 21 | Ship constants, UI ceiling, grace period, prose | edits | **stays human/agent** (a normal implement phase) | — |
| 22 | Hosted cleanup | UI clicks | `checkPlan` every proposal → `deletePlan` each proposal by id → source last; `wrangler secret delete` if (6b) | no |

### The three code levers, ranked by manual work removed

1. **The job row records its own solver config.** Add a nullable `generation_jobs.solver_config jsonb`, written best-effort by the solver right after `_with_budgets` (§5). The effective values would be `workers, stageBudgetS, modeABudgetS, budgetSource, targets, preset, seed`, plus `cleanFallback` and a host fingerprint.
   - Attribution becomes a fact on the row, instead of a human reading a log line.
   - "Wait for sleep, then verify the startup line" stops being load-bearing: a run on a stale warm container is correctly attributed rather than misfiled.
   - The `unaccounted` heuristic becomes an observation.
   - It stays outside the frozen wire contract.
   - It is image-changing: land it before Phase 3, on an idle container.
2. **A campaign override for the container constants via Worker secrets.** The code change is `env.CALIBRATION_STAGE_BUDGET_S ?? CONTAINER_STAGE_BUDGET_S`, and likewise for workers and Mode A.
   - A cell switch drops from a merge plus ~9.5 min of CI to seconds.
   - It no longer depends on CI being green (5 of the last 8 `main` pushes failed and skipped deploy).
   - It does not roll the container.
   - Cost: production diverges from `main` for the campaign's duration, and the runner must delete the secrets at the end.
3. **`stopIfIdle()` + `status()` on `SolverContainer`,** behind an authenticated, allowlisted API route.
   - Gives a reliable "is the container asleep" answer. `wrangler containers instances` is known to report `running` for a non-executing instance.
   - Lets the runner force the cold start instead of waiting out `sleepAfter`.
   - The natural idle-sleep boundary still has to be observed once, in Phase 3.

### Corrections to the prior plan's premises

These are true today and change the design; each is verified in this research.

1. **Every CI deploy rolls the container, Worker-only merges included.** `e1714f7` touched only `src/shared/api/supabase.ts`, yet its deploy pushed a new image and `EDIT`ed the container application. The image build is not byte-reproducible on fresh runners. `plan.md:33,60` ("every Phase 4 cell is Worker-only") holds only for the source diff, not for the deploy's effect.
2. **"Merged" is not "deployed".** 5 of the last 8 push-to-`main` runs failed before `deploy`:
   - 3 integration flakes;
   - 1 lint failure;
   - 1 new `pnpm audit`/`uv audit` advisory.
   
   The Phase 1–2 merge itself (#127, 2026-09-09 08:56) did not deploy; it went live only with `e1714f7` at 21:29.
3. **`[solver-container] started` is not a cold-start signal.** The SDK calls `onStart()` at the end of *every* `startAndWaitForPorts`, including the warm fast path. Only the container's own `solver service starting:` line proves a cold start.
4. **The startup line cannot be confirmed *before* dispatch** (`plan.md:58`). The cold start happens *on* dispatch. The Phase 4 protocol's order at `plan.md:261` (dispatch, then confirm, then invalidate on mismatch) is the correct one.
5. **Deleting the campaign source plan cascades every campaign job row** (`plan_id … on delete cascade`). That is the ledger's raw data. It does **not** delete proposals (`proposal_plan_id … on delete set null`). Cleanup order must be: extract, deliver, delete proposals by id, then the source.
6. **The drill as specified probably cannot interrupt the solve.** At 120 s stages, the ladder is ~16 min. CI adds ~9.5 min before rollout, and `rollout_active_grace_period: 1200` protects an instance for 20 min from its connection start. The rollout lands after the solve ends (§7).
7. **Cloning the real plan with its board measures a fill-the-gaps solve.** Existing placements are always pins, and `includeBoard` defaults to `true`. `plan.md:195` does not say which. A full-catalog measurement needs `includeBoard:false`.
8. **Putting the hosted service-role key in `.env.test.local`** (`plan-brief.md:51`) would point `pnpm test:integration`'s writes at production. That file feeds the integration config, and the factories have no local-host guard. Pass hosted credentials in the runner's environment only; shell values win over the file.
9. **The sleep clock runs from the last request, and any Durable Object restart re-arms it.** Deploys, secret changes and runtime updates all count. Attaching `wrangler tail` may also trigger a DO replacement (Cloudflare known issue). The idle-sleep measurement must use the Telemetry API, not a live tail.

## Detailed Findings

### 1. The campaign's remaining manual surface

From `context/changes/production-calibration-campaign/plan.md` Progress (`:416-483`), `change.md:65-72`, and `follow-ups/review-fixes.md`:

- **Pending hand checks:**
  - 1.5 — deployed startup line;
  - 2.3 — `analyze:jobs` on a local integration job;
  - 2.4 — `analyze:jobs` on the hosted S-302 job, which should match 14.72 min.
- **Phase 3 (one-shot):**
  - clone a throwaway `Calibration — <name>` plan;
  - the deploy-during-solve drill (`interrupted` + checkpoint → delivered partial board with the stage label → Generate self-heals);
  - `sleepAfter = "10m"`, with the renewal proof and the idle-sleep boundary;
  - the five production numbers;
  - the README advisory and S-304 truing.
- **Phase 4 (the loop):** cells A (120 s), B (60 s), C (240 s) at 4 workers, then D (the chosen budget, 8 workers), 3 runs each. Per run, the cell protocol (`plan.md:257-263`): previous job terminal → container asleep → merge → deploy → dispatch → confirm startup line → record job id → extract → ledger. The follow-ups add recording `unaccounted` per run.
- **Phase 5:** shipped constants, `LADDER_CEILING_MINUTES`, `rollout_active_grace_period`, PRD/roadmap/README/`settings.py` prose, the verdict and S-309 baseline, and hosted cleanup.

Serial solve time is about 3.7 h:

| Cell | Runs | Per run | Subtotal |
|---|---|---|---|
| A | 3 | ~16 min | 48 min |
| B | 3 | ~8.5 min | 26 min |
| C | 3 | ~33 min | 99 min |
| D | 3 | ~16 min (at 120 s) | 48 min |

Today every run needs roughly eight human touches, plus attention during 15–35 min of waiting.

### 2. Driving the deployed app from a script (no browser)

Generate must go through the Worker. Production dispatch uses the `env.SOLVER` Durable Object binding (`src/entities/timetable/api/solver-config.ts:35-43`), which exists only inside the Worker, so the runner cannot dispatch directly to the solver.

**Sign-in.**
- `src/pages/api/auth/signin.ts:4-19` takes **form data**, calls `signInWithPassword`, and returns a 302 to `/dashboard` on success or to `/auth/signin?error=…` on failure. Check `Location`, not the status.
- The session cookie is `sb-hwmuiymhjgewtymymbmb-auth-token`: `base64-` + base64url(JSON), chunked into `.0`/`.1` above 3180 chars (@supabase/ssr 0.12.7; the e2e setup relies on the same chunking, `e2e/auth.setup.ts:45-49`).
- Astro's `security.checkOrigin` is on (default since v5; built manifest `"checkOrigin":true`). A form-encoded POST without an exact matching `Origin` gets **403** (`node_modules/astro/dist/core/app/origin-check.js:8-22`). JSON POSTs pass.
- Two ways in:
  - **(A)** form POST to `/api/auth/signin` with `Origin`, `redirect:'manual'`, keeping the `Set-Cookie`s;
  - **(B)** run `@supabase/ssr` `createServerClient` in Node over an in-memory cookie map and call `signInWithPassword`. This yields byte-identical cookies without touching the Worker. It needs the hosted `SUPABASE_URL`/publishable key, which `.envs/prod.vars` already holds.

**Astro 7 action HTTP contract.** Verified against Context7 `/withastro/docs` and `node_modules/astro` 7.3.2.
- Request: `POST /_actions/<name>`, `Content-Type: application/json`, JSON body, session cookie.
- Success: **200 `application/json+devalue`** (`astro/dist/actions/runtime/server.js:346-368`). The docs: "Actions return a custom data format … using the Devalue library".
- `void` actions: **204** with an empty body.
- Errors: plain JSON `{type:"AstroActionError", code, status, message}`, with CONFLICT→409, UNPROCESSABLE_CONTENT→422, UNAUTHORIZED→401.
- `devalue` is only a transitive dependency (not resolvable under pnpm's strict layout), so the runner needs it as a direct devDependency.
- The middleware lets `/_*` through unauthenticated (`src/middleware.ts:7-11`); actions check the session themselves (`src/shared/lib/actions/require-session.ts:8-12`). Every request's `getUser()` may rotate the token, so the runner must persist every `Set-Cookie` and honour `Max-Age=0` chunk deletions.

**The actions the runner needs** (registered in `src/actions/index.ts`):

| Action | Input → output | Evidence |
|---|---|---|
| `startGeneration` | `{planId, policy?:{preset}}` → `{jobId, proposalPlanId, autoParked[]}`. Clones `Proposal — <name>`, inserts `queued`, dispatches. 409 on an active job (one per source plan, partial unique index); 500 + clone swept if dispatch fails. **Allow ≥ 90 s** (cold start: 45 s start timeout + 15 s dispatch timeout). | `src/_pages/plan-detail/api/generation-job.ts:63-122,148-259`; `solver-binding-transport.ts:36`; `solver-transport.ts:64` |
| `readGenerationJobStatuses` | `{jobIds, planIds}` → status only; never delivers. The cheap poll. | `src/_pages/plans-list/api/generation-status.ts:5-49` |
| `checkPlan` | `{planId}` (source or proposal id) → `GenerationJobView` (`status, stageIndex, stageName, checkpointStageIndex, delivered, error, proposalPlanId, finishedAt`). Runs the stale-row reclaim and **delivery** (CAS, idempotent); keyed by the proposal it also stamps `notified_at`. `GET /plans/<id>` does the same server-side. | `generation-delivery.ts:93-124,182-275,289-369`; `generation-reclaim.ts:38-77`; `src/pages/plans/[id]/index.astro:48-57` |
| `stopGeneration` | `{jobId}` → `{outcome: stopped \| stopping \| already-finished}`. The runner's abort path. | `generation-stop.ts:34,54-115` |
| `clonePlan` | `{sourcePlanId, name, includeBoard}` → `{id}`. | `src/_pages/plans-list/api/actions.ts:18`; `model/schemas.ts:14-19`; `src/shared/api/clone-plan.ts:34-59` |
| `deletePlan` | `{id}` → 204. Guards refuse a live job, or a finished-but-undelivered one. | `src/_pages/plans-list/api/delete-plan.ts:10-26`; `pending-guards.ts:39-120` |

**Gates the server does not enforce.** "Plan complete" and "blocking violations" are client-only (`GenerateButton.tsx:29-31,61-67`). A fully placed board fails with "no placements" (`generation-delivery.ts:309-313`), so the runner must pre-check remaining hours.

**The "kept the board from stage N" label** is `haltedSummary`: "Interrupted — kept the board from stage N of 10." (`src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:185-194`). It renders on the **delivered proposal's** strip and is server-rendered, so the drill can grep it from `GET /plans/<proposalId>` HTML. `checkpointStageIndex` in `checkPlan`'s view carries the same fact.

**Accounts.** Plans and jobs have no owner column. RLS is `"Authenticated users have full access" using (true)` everywhere (`supabase/migrations/20260602185012_minimal_domain_schema.sql:163-174`; `20260810200122_generation_jobs.sql:116-118`), so a dedicated campaign account can see and clone the author's plan.
- A **dedicated account is recommended.** `signout.ts:7` signs out with **global** scope, so if the runner shared the author's account, signing out in a browser would kill the runner's session.
- It must not get a `machine_role` (`20260810200934_custom_access_token_hook.sql:18-21`).
- Credentials belong in a new gitignored `.envs/campaign.vars`, read with the `sed` idiom (`scripts/solver/hosted.sh:117-123`). No `pnpm env:*` script copies that file.

**Playwright reuse is weak.** `playwright.config.ts:21,31,50-52` hard-codes localhost and always builds and previews. `pnpm test:e2e`'s pre-hook provisions an author with the service-role key. Waits are sized for ~1 s fixtures, and name-based selectors are ambiguous across 12 identically named proposals. Plain HTTP is simpler.

### 3. Observing production

**Rows are the job truth.**
- `generation_jobs` status: `queued|running|succeeded|failed|stopped|interrupted` (`20260810200122_generation_jobs.sql:96-97`).
- Per completed stage the solver appends a contract `StageReport` to `stages`, writes `checkpoint` + `checkpoint_stage_index` when the stage solved, and renews `heartbeat_at` every write and every 15 s (`services/solver/src/cpsat_service/runner.py:372-389,532-539`; `supabase.py:164-257`).
- Terminal writes set `finished_at`. `started_at − created_at` is queue→claim, which includes the cold start (one of the five numbers), free from the row.

**Container stdout is queryable: the Workers Observability Telemetry Query API.**
- Container stdout/stderr lands in Workers Logs, kept 7 days on Paid (https://developers.cloudflare.com/containers/faq/).
- `POST /accounts/{id}/workers/observability/telemetry/query` accepts `view:"events"`, `timeframe`, `filters`, `needle`, and `limit` up to 2000 (https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/). The same API returns the DO's `[solver-container]` lines.
- Logpush for container logs is Enterprise-only, and wrangler 4.130 has no log-query command.
- Auth: an API token with Workers Observability permission, or the developer's OAuth via `wrangler auth token` (confirmed present in 4.130).
- **Unverified:** the filter keys for container events (a third-party client uses `$metadata.type = "cf-container"`; S-302's manual export mentions `dataset: containers`) and the ingestion latency. Confirm once with `/telemetry/keys` and `/telemetry/values`.
- S-302's numbers came from a manual dashboard export (`context/archive/2026-08-15-solver-deploy-lane/change.md:53-102`); nothing was scripted.

**Lines the runner reads:**
- **Container** (`services/solver/src/cpsat_service/app.py:181-199,227-240,280`; `runner.py:264,321`):
  - `solver service starting: workers=… max_concurrent_jobs=… stage_targets=… stage_budget_s=… mode_a_budget_s=…`
  - `startup credential check passed…`
  - `job <id> solving with N workers under the <preset> policy` — ties the job to a container lifetime
  - `job <id> succeeded with N placements`
  - the shutdown pair `asked N solve(s) to stop…` / `…wrote its terminal row in X s` — this pair gives SIGTERM→`interrupted` latency on production, where no signal timestamp exists
- **DO** (`src/solver-container.ts:51,89,93,101,106,118,124`):
  - `started` — every dispatch, see correction 3
  - `sleep declined: N solve(s) in flight — activity renewed`
  - `idle at sleepAfter — letting the container stop`
  - `stopped: exitCode=… reason=…`
  - `error`
  - the active-jobs probe lines
  - also the SDK's `Activity expired, signalling container to stop`

**`wrangler tail` is a lossy supplement, not the record.**
- It carries DO events with their `logs[]`, but not container stdout.
- Piped output is multi-line JSON (`JSON.stringify(…, null, 4)`), so pipe it through `jq -c`.
- Sessions expire in ~1 h and delivery silently stops; wrangler retries 5×.
- Enabling tail "requires a software update", which may replace the DO (https://developers.cloudflare.com/durable-objects/platform/known-issues/) and so may re-arm the sleep clock.

**Container state.**
- `wrangler containers instances <APP_ID> --json` exposes `state`, but S-302 observed `running` for a provisioned, non-executing instance (`solver-deploy-lane/change.md:72-80`).
- Reliable options:
  - an RPC `status()` on `SolverContainer` returning `ctx.container.running` + `getState()` (https://developers.cloudflare.com/durable-objects/api/container/); RPC does not renew activity, only `containerFetch` does (`@cloudflare/containers` 0.3.7 `container.js:887-890`);
  - the telemetry proxy: a `stopped:` line newer than the last request.

### 4. Applying a cell and guaranteeing a cold start

**How `envVars` reaches the container.**
- It is a class field (`src/solver-container.ts:42`), evaluated whenever the DO is constructed.
- The SDK reads it only on a real start: `options?.envVars ?? this.envVars` (`container.js:1327`). A warm container never re-reads it.
- The sleep clock is in-memory (`container.js:770-773`) and is re-armed by the constructor (`:355-360`), so any DO restart pushes a warm container's sleep out by a full `sleepAfter`.

The three cell-switch mechanisms:

| Mechanism | Time | Rolls container? | `main` = prod? | Risks |
|---|---|---|---|---|
| (a) **Scripted merge**: edit `src/solver-container-env.ts` + pin test (`solver-container-env.test.ts:30,77-78,86`) → direct push to `main` (precedented; no branch protection, auto-merge disabled) → `gh run watch` → gate on the **Deploy** job's conclusion → `gh run rerun --failed` on integration flakes | ~9.5 min + reruns | **yes, every time** | yes | audit/lint failures need a human; rollout delayed by the 1200 s grace for a recently connected instance, and a dispatch in that window runs the *old* values then gets SIGTERMed |
| (b) **Worker-secret override** (`wrangler secret put CALIBRATION_…`) — "creates a new version of the Worker and deploys it immediately" (https://developers.cloudflare.com/workers/configuration/secrets/); the DO is reset on a new version | seconds | no | no (until secrets deleted) | secrets outlive deploys — the runner must `wrangler secret delete`; needs `Env` keys in `src/cloudflare-env.d.ts` + a test; `""` must mean unset |
| (c) `wrangler deploy --containers-rollout=none` (or `versions upload`/`deploy`) from local | ~1 min | no | no | the next CI deploy reverts it *and* rolls; uses the developer's OAuth |

Deploy-completion and version signals:
- `gh run list -w ci.yml -b main -c <sha>` → `gh run watch --exit-status` → the `Deploy` job's conclusion.
- The live version id is printed as `Current Version ID:` in the deploy log.
- CI passes no `--message`, so versions can't be correlated to a SHA. A one-line `deploy --message "${{ github.sha }}"` fixes that (`.github/workflows/ci.yml:373-378`).
- The 09-09 deploy's container diff started from an image tag that no CI run had set, which suggests an out-of-band deploy happened between 09-03 and 09-09.
- `gh` calls should use `GH_TOKEN=$(gh auth token --user dobrek)` per command rather than switching accounts.

**Forcing the cold start.** `@cloudflare/containers` 0.3.7 exposes `stop(signal)`, `destroy()` and `getState()` as public, RPC-callable methods (`container.js:409,712-723`). The docs show this exact pattern behind an admin route (https://developers.cloudflare.com/containers/reference/container-class/#stop). A `stopIfIdle()` would:
- return early when `!ctx.container.running`, because probing would *start* it (`solver-container.ts:70-76`);
- refuse when `countActiveJobs() > 0`;
- otherwise `stop()` through the S-304 graceful path.

The route stays behind the deny-by-default middleware plus an explicit account allowlist. This adds an authenticated route; it does not widen the unauthenticated allowlist.

### 5. Attribution: making the job row self-describing

Today the row does not say which budgets or worker count produced it (`plan.md:35`). The analyzer even needs `ANALYZE_MODE_A_BUDGET_S` to re-read old rows (`bench/generation-jobs.analyze.ts:18-21`). Options:

**(a) Recommended: new nullable `solver_config jsonb`, solver-written.**

Files touched:
- a migration adding the column, with `grant update (solver_config) … to solver_job_writer`; no SELECT grant needed;
- regenerated `src/shared/api/database.types.ts`;
- the exact-UPDATE-list pin in `src/test/solver-credential.integration.test.ts:222-234` (11 → 12 columns);
- `runner.py`: a pure `_run_record()` helper;
- `supabase.py` docstrings ("11-column grant", `:25,:200`);
- `services/solver/tests/test_service.py`, via the `FakeSupabase.progress_patches` seam (`:98-160`);
- optionally `src/test/solver-transport.integration.test.ts`, asserting non-null (the only real proof the grant permits the write).

Write placement is load-bearing:
- **Not** in the claim CAS: a 42501/PGRST204 there is swallowed and the row wedges at `queued`, `runner.py:212-230`.
- **Not** in `finish`: 42501 is terminal there and the board would be lost.
- Instead, a best-effort `client.progress(job_id, {"solver_config": …})` right after `config = _with_budgets(base, settings)` (`runner.py:286`); `progress` never raises (`supabase.py:3-7`).

Payload:
- the **effective** values, including configured-vs-engine-default (`app.py:244-251`);
- a second best-effort write after `solve_complete` adding `cleanFallback`. The engine already computes it (`services/solver/src/cpsat_engine/solve.py:327`) and discards it in `notes` (`:341-342`).
- `platform.machine()` / `os.cpu_count()` / the ortools version catch a laptop solve against hosted cheaply. `cpu_count` inside the CF VM is unverified.

Gates and rollout:
- guarded by the mypy/ruff/pytest solver lane, the integration credential pin, and `pnpm check`/`lint`/`test`;
- **image-changing** — land it on an idle container, before Phase 3. CI applies the migration before the deploy (`ci.yml:335` → `:373`).
- Old rows stay NULL, so keep the manual override.
- The table header's "slices ship behaviour, not migrations" claim (`20260810200122_generation_jobs.sql:5-7`) needs a dated amendment.

**(b) Not recommended: a field inside `result.diagnostics` / `stages[]`.**
- It touches the **frozen wire contract**: `additionalProperties:false`, `contracts/generation-wire.schema.json:150-177,189-220`.
- It must be bilateral, with goldens.
- The strict TS readers turn an unknown key into `[]` (`stage-report.ts:15`), which breaks the clean label and the analyzer.
- `result` exists only on succeeded rows.
- The contract already rules "config echo" out of scope (`contracts/README.md:68-69`).

**(c) Not recommended: the Worker writes the constants at dispatch.**
- This records intent, not fact: a warm container solves under the *old* cell exactly in the transition window the campaign fears.
- Under URL transport the constants never reach the solver at all.
- Stashing it in `policy` would break `parseStoredPolicy`'s strict object (`policy.ts:23,38-41`).

### 6. Extraction → ledger → analysis → baseline

**Today.** `pnpm analyze:jobs` (`package.json:20` → `vitest.analyze.config.ts`):
- **Credentials:** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` via `createLocalSupabase` (`bench/local-supabase.ts:13-33`), refusing non-local hosts unless `ANALYZE_ALLOW_REMOTE=1`.
- **Env source:** `.env.test.local` through `src/test/load-test-env.ts`, where **shell values win** (`:18`).
- **Projection:** `id, plan_id, status, policy, started_at, finished_at, stages, created_at` (`bench/generation-jobs.analyze.ts:47`).
- **Output** (`bench/generation-jobs-report.ts:40-164`):
  - per job: a clock line with `unaccounted` (end-to-end − Σ `wallClockS`), a flag above `OVERHEAD_ALLOWANCE_S = 30` (`:80`) on succeeded rows, and a tier table;
  - a per-tier summary across the selected jobs.

**Extensions**, all pure and unit-testable in `bench/*-report.ts` under `pnpm test` (`vitest.config.ts:27`):
- **Ledger mode.** A `toLedgerRow(row)`: jobId, cell (from `solver_config`, or `ANALYZE_CELLS=job:cell` for legacy rows), preset, status, the three clocks, **queue→claim s**, end-to-end, Σ, `unaccounted`, `cleanFallback`, and per-tier best/bound/status/stoppedBy.
  - Emitted as JSON merged by jobId into a ledger file, plus markdown rows for `change.md`.
  - The projection adds `solver_config`, `error`, and `proposal_plan_id` (cleanup cross-check).
- **Cross-cell matrix.** Tier × cell: min/median/max `best`, OPTIMAL vs budget counts, median seconds, plus per-cell clock stats. `groupByTier`/`median`/`renderTable` are module-private today and need exporting.
- **S-309 baseline block.** `formatBaseline(rows, cell)`: dated per-tier min/median/max for the shipped cell plus the delivered run's tuple and job ids.
  - Note: `stages[].best` is the stage-end value, and interrupted runs deliver the checkpoint board. The **exact delivered 10-tuple** is computable PII-free with `scoreCandidate(snapshot, result.placements, remainingOf(result))` (`src/entities/timetable/model/generation/objective.ts:98-165`; pattern in `bench/export-snapshot.experiment.ts:117,146-155`). It is the same function the 10/10 parity gate pins, and the better baseline basis.
- **Active-job guard mode** (`ANALYZE_ACTIVE=1`): `status in ('queued','running')` (cheap, since the partial unique index holds exactly those rows), classified with `isStaleActiveJob` (`job-staleness.ts:45-53`). A live row blocks; a stale row is reported.

Constraints:
- `vitest.analyze.config.ts:19` has `testTimeout: 120_000`, so long waits must run **outside** vitest.
- `plan-quality.analyze.ts` prints real course and teacher names (`plan-report.ts:98-113,245-251`); its output must never enter the repo.

### 7. Phase 3 drill and renewal proof: automatable, with one timing trap

**Drill flow a runner can execute:**
1. `startGeneration` on the campaign plan.
2. Poll until `stage_index ≥ 3` and `checkpoint_stage_index` is set.
3. Trigger an image-changing deploy (any CI deploy qualifies, per correction 1).
4. Poll the row to `interrupted` with a checkpoint.
5. Query telemetry for the shutdown pair, which gives the latency.
6. `checkPlan(proposalId)` → `delivered:true`, `checkpointStageIndex:N`.
7. `GET /plans/<proposalId>` and grep "Interrupted — kept the board from stage N of 10."
8. `startGeneration` again → a fresh job (self-heal).

**The trap.**
- `README.md:290-292` and `wrangler.jsonc:44-66`: the grace window is measured from the instance's **connection start**. A cold-started instance is protected for 1200 s.
- At the Phase-1 defaults (300 s Mode A, 120 s stages), a solve is ~16 min.
- A drill commit pushed at stage 3 (~minute 5) deploys at ~minute 14.5. The rollout then waits until minute 20, after the solve ended at ~16, so nothing is interrupted.

Workable designs, for the plan to choose:
- run the drill as a **Cell C (240 s)** run (~33 min ladder; the SIGTERM lands at ~minute 20, around stage 6);
- deploy the drill from local with `wrangler deploy` (Docker, ~2 min) on a **warm** container whose connection age already exceeds 1200 s;
- temporarily lower the grace period (itself a deploy).

**Renewal proof.** After `sleepAfter = "10m"` ships:
- a >10-min solve must show at least one `sleep declined … activity renewed` line;
- the row must reach `succeeded`;
- then `idle at sleepAfter…` and `stopped:` should appear about 10 min after the **last request**, not after the solve's end (the S-302 lesson: 30.002 min from the dispatch).

All three are telemetry timestamps plus row timestamps, so the runner can compute them. It must **not** keep `wrangler tail` attached during the idle measurement (correction 9).

**The five production numbers**, all computable from the row plus telemetry:
- cold start: `started_at − created_at`, cross-checked against the `solver service starting:` timestamp;
- renewal cadence: gaps between `sleep declined` lines;
- idle sleep boundary: `stopped:` minus the last request;
- SIGTERM→`interrupted` latency: the shutdown pair, and `finished_at`;
- the drill's duration and stage reached: from the row.

Revisit `OVERHEAD_ALLOWANCE_S` from the measured `unaccounted` values (follow-up 1).

### 8. Setup and cleanup

**Setup (one-time, human):**
- a dedicated author account (`docs/runbooks/author-provisioning.md` § b, Auto Confirm on);
- `.envs/campaign.vars` holding the base URL (prefer workers.dev; the custom domain's WAF/bot settings are invisible from the repo), the account email/password, and the Cloudflare account id;
- a Cloudflare API token with Workers Observability permission, or reuse of `wrangler auth token`;
- hosted `SUPABASE_URL` + service-role key exported in the runner's environment only (correction 8).

**Campaign plan (scripted):**
- `clonePlan({sourcePlanId: <real plan>, name: "Calibration — <name>", includeBoard: false})`. `includeBoard:false` gives the full catalog, comparable to S-302's 248-placement solve.
- The runner records the id in its state file and pre-checks remaining hours before each dispatch.

**Cleanup (scripted, strict order):**
1. Extract the complete ledger.
2. `checkPlan` every recorded `proposalPlanId`, so halted-with-checkpoint jobs deliver and the delete guards release.
3. `deletePlan` each proposal **by id**. Names are identical (`Proposal — Calibration — <name>`, `generation-job.ts:155`), and `readGenerationJobStatuses` stops surfacing visited proposals (`generation-status.ts:83-102`). The runner's own record is the source of truth, cross-checked by a PostgREST read of `generation_jobs?plan_id=eq.<source>`.
4. `deletePlan` the source, which cascades the job rows.
5. `wrangler secret delete` any campaign overrides.

Each delivered proposal is a full copy of real student data, so cleanup is mandatory. Saved HTML or JSON responses must never be committed (the no-prod-data rule; `.gitignore:76-81,105-110`).

### 9. Where the tooling lives, and its conventions

- **Launcher.** A mise task (e.g. `solver:campaign`), whose body is `scripts/solver/campaign.sh`. Only `scripts/solver/*.sh` gets shellcheck + the `set -eu` check (`scripts/solver/lint.sh:36-60`, CI `verify`); a new `scripts/campaign/` dir would silently escape both. The script follows `hosted.sh`:
  - a boxed WRITES-TO-PRODUCTION banner + typed confirmation, skipped by `SOLVER_CAMPAIGN_CONFIRM=yes` (`:65-91`);
  - fail-closed preflight (`:27-63`);
  - split `EXIT` / `INT` / `TERM` traps (`:103-111`; `tier3.sh:48-63`);
  - `caffeinate -i` on Darwin (`:129-137`);
  - `sed`-read profile values (`:121-123`).
- **Core.** TypeScript. A long-running, resumable orchestrator is awkward in POSIX sh and impossible inside vitest's 120 s timeout. Node 24 runs `.ts` natively (type stripping verified locally on v24.19), but `@/` aliases don't resolve outside vitest and no `tsx` is installed. Two shapes fit:
  - (i) the sh launcher loops over short, one-shot TS steps (dispatch / status / extract), each run as a vitest `*.analyze.ts`-style command;
  - (ii) the launcher `exec`s one Node TS runner that imports nothing through `@/` (the HTTP client needs only `fetch`, `devalue` and `@supabase/ssr`). Its pure logic and formatters stay in `bench/` and are unit-tested there.

  Either way, pure state-machine logic belongs in `bench/campaign-*.ts` with `*.test.ts`. `bench/` has lint, type-check and an ESLint boundary that allows `@/entities/timetable` and `@/solver-container-env` (`eslint.config.*:82-137`).
- **Writes only through the app.** Production writes go through Astro Actions over HTTP, never service-role writes (`lessons.md:19-24`; the bench write path is local-only by rule, `bench/local-supabase.ts:4-34`).
- **State and raw logs** go in a new gitignored directory, with a "never commit" comment in the style of `/pii-scrub/`. Only id/tier/number ledger tables go into `change.md`. Ids are not sensitive: hosted plan ids and job ids are already committed in archives.
- **Scripted commits** pass lefthook normally (`lefthook.yml:1-24`: eslint/steiger/prettier pre-commit, `pnpm check` pre-push); `--no-verify` is forbidden.
- **Unattended survival.** The solve runs server-side, so laptop sleep only kills the observer. The runner must be resumable from its state file, re-read job status from the DB **immediately before** every deploy-triggering action, and detect a pushed-but-unrecorded commit. A double Ctrl-C must not skip cleanup traps.

### 10. What stays human, irreducibly

- One-time setup: account, credentials file, Cloudflare token, a one-time telemetry key check.
- Confirming launch: production writes, the banner.
- Choosing Cell D's budget after A–C. The runner pauses and prints the cross-cell matrix; the plan already frames this as a judgement (`plan.md:282-284`).
- The shipped constants and the verdict prose (Phase 5, items 1–6).
- CI failures other than the known integration flake: audit advisories and lint.
- Watching the first deliberate mid-solve rollout on production live is prudent even though the runner can drive it.

## Code References

- `src/solver-container-env.ts:21-62` — the nine forwarded keys and pinned constants; `src/solver-container-env.test.ts:30,77-86` pins them
- `src/solver-container.ts:34,42,51,59-63,70-76,89,93,101,106,118,124` — `sleepAfter`, `envVars` field, DO log lines, active-jobs probe
- `wrangler.jsonc:17-19,39,43,46-48,66` — observability on, `standard-4`, `max_instances: 1`, EEUR, `rollout_active_grace_period: 1200`
- `.github/workflows/ci.yml:3-8,12-14,318-378` — triggers (incl. `workflow_dispatch`, which never deploys), concurrency, deploy gate, `db push` before `wrangler deploy`
- `src/pages/api/auth/signin.ts:4-19`, `src/middleware.ts:7-44`, `src/shared/api/supabase.ts:6-28` — sign-in, allowlist, SSR cookies
- `src/_pages/plan-detail/api/generation-actions.ts:21-32` — `startGeneration`, `checkPlan`, `stopGeneration`
- `src/_pages/plan-detail/api/generation-job.ts:63-259` — Generate domain function, clone naming (`:155`), 409 reclaim-retry, dispatch failure path
- `src/_pages/plan-detail/api/generation-delivery.ts:93-124,182-369` — `GenerationJobView`, reclaim-then-deliver, delivery CAS
- `src/_pages/plans-list/api/generation-status.ts:5-102` — status-only polling, "surfaced" row filter
- `src/_pages/plans-list/api/delete-plan.ts:10-26`, `pending-guards.ts:39-120` — delete guards
- `src/shared/api/clone-plan.ts:8-59`, `src/_pages/plans-list/model/schemas.ts:14-19` — `includeBoard` (default `true`)
- `src/entities/timetable/model/generation/assemble-snapshot.ts:10`, `types.ts:25` — existing placements are always pins
- `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:185-194` — the halted-board label text
- `supabase/migrations/20260810200122_generation_jobs.sql:5-7,57-118` — columns, cascade/set-null FKs, active-job partial unique index, RLS
- `supabase/migrations/20260810200931…:20-99`, `20260812141459…:66-72`, `20260820075348…:30-33` — `solver_job_writer` column grants and policies
- `services/solver/src/cpsat_service/runner.py:212-230,264,286,291-324,372-389,532-539` — claim, log lines, `_with_budgets` seam, terminal writes, stage progress, heartbeat
- `services/solver/src/cpsat_service/supabase.py:3-7,164-257` — best-effort `progress`, claim CAS, terminal retry
- `services/solver/src/cpsat_engine/solve.py:322-342` — clean fallback computed, kept internal
- `services/solver/src/cpsat_service/app.py:39-43,181-199,227-251,280` — shutdown budget and lines, startup line, credential check
- `bench/generation-jobs.analyze.ts:13-81`, `bench/generation-jobs-report.ts:34-164`, `bench/local-supabase.ts:4-34`, `vitest.analyze.config.ts:18-19` — analyzer, report, hosted guard, timeout
- `src/entities/timetable/model/generation/objective.ts:98-165` — `scoreCandidate`, the exact delivered tuple
- `scripts/solver/hosted.sh:27-137`, `scripts/solver/common.sh:2-67`, `scripts/solver/lint.sh:36-60`, `mise.toml:13-83` — launcher conventions and the lint gate
- `e2e/auth.setup.ts:45-49`, `e2e/specs/generation.spec.ts:48-57,112-115`, `playwright.config.ts:21-52` — reusable pieces and why a prod config would be separate

## Architecture Insights

1. **The row is the campaign's natural bus. Make it complete and most log-reading disappears.** Stages, checkpoints, heartbeats and clocks are already on the row. The missing facts are *which configuration* ran and *whether the fallback fired*, and the solver knows both at `runner.py:286` / `solve.py:327`. Once those are written, the Telemetry API is needed only for the lifecycle phase (sleep, renewal, SIGTERM), not for every run.
2. **Two different clocks govern the container, and neither is the solve.** Env is fixed at cold start; sleep runs from the last request and is re-armed by any DO restart; rollout grace runs from connection start. A runner that reasons from `finished_at` alone will misjudge all three. Correct inputs: DO/container telemetry lines, or a `status()` RPC.
3. **"Every deploy rolls the container" flips the cell-switch trade-off.** The merge path was meant to be a harmless Worker-only change. In practice it is a container roll gated on a CI pipeline that failed 5 of its last 8 `main` runs. The Worker-secret override is the only mechanism that is fast, CI-independent and non-rolling. Its cost, prod ≠ `main` for a few days, is bounded and reversible, and it is visible if the ledger records the override values per cell. The shipped constants still land by merge in Phase 5.
4. **Drive production only through the app's own actions.** Dispatch must, since the DO binding is Worker-only. Delivery, reclaim, stop and delete also carry guards and CAS semantics a direct DB write would bypass. Hosted **reads** via the service-role analyzer stay acceptable (existing precedent). Hosted **writes** stay app-mediated.
5. **Resumability beats speed.** The runner's wall clock (~3.7 h of solving plus cell switches) is dominated by solves it cannot shorten. What it must get right is never deploying while a job is live, never losing a job↔cell mapping, and never deleting the source before extraction. A small on-disk state file with idempotent steps is the core design constraint.

## Historical Context (from prior changes)

- `context/changes/production-calibration-campaign/plan.md:56-62,183-299,416-483` — the cell protocol, drill design and Progress this change automates; `plan-brief.md:51` (the `.env.test.local` credential hint, now a hazard); `follow-ups/review-fixes.md` (`OVERHEAD_ALLOWANCE_S` revisit, record `unaccounted` per run); `reviews/impl-review-phase-1-2.md` F2/F3 (the flag's threshold and the Mode A bound are row-less guesses — exactly what `solver_config` fixes)
- `context/archive/2026-08-20-job-aware-container-lifecycle/plan.md:557-640,756-770` — the drill and renewal proof as designed, all unrun; `change.md:18-43,67-97` — SIGTERM latency method at tiers 1/3, the `sleepAfter = 20s` local trick, idle half unproven
- `context/archive/2026-08-15-solver-deploy-lane/change.md:53-184,315-364` — the one production solve, measured by manual log export; `STATE: running` misread; sleep timed from the last request; succeeded ≠ delivered; rebase-merge SHA remap; wedged rows by hand
- `context/archive/2026-08-19-staged-progress-and-checkpoints/change.md:50-103` — row progress semantics; killing the solver wedged rows twice
- `context/archive/2026-08-31-generation-deletion-integrity/plan.md:6-8` — delivered proposals keep their job row
- `context/foundation/lessons.md` — "Astro Actions are the single transport" (writes through the app); "A Worker forwards only what `.dev.vars` holds" (guard in the launcher)

## Related Research

- `context/changes/production-calibration-campaign/research.md` — the campaign's own research (knob inventory, measurement plumbing, S-304 inheritance)
- `context/archive/2026-08-20-job-aware-container-lifecycle/research.md` — lifecycle numbers and why only production may produce them
- `context/archive/2026-08-15-solver-deploy-lane/research.md` — worker-count trade-off, container cost, branch-protection check

## Open Questions

1. **Cell-switch mechanism.** Choose between the scripted merge (prod = `main`, ~9.5 min, rolls every time, CI-flake exposed) and the Worker-secret override (seconds, non-rolling, prod ≠ `main` until cleanup). Research leans to the override plus `stopIfIdle` for Phase 4, with Phase 5's shipped constants landing by merge. Owner: plan.
2. **Land `solver_config` (+ `cleanFallback`) before Phase 3?** Recommended. It is image-changing, so it must land on an idle container, and it amends the table header's "no migrations" claim. Owner: plan.
3. **Drill timing.** Pick the drill design: a Cell C run, a local warm-container deploy, or a temporary grace change. Also: must a cold-started 16-min solve at 120 s be excluded as a drill vehicle? Owner: plan.
4. **Telemetry specifics to confirm once against the account:** container event filter keys (`$metadata.type`/`service` vs `dataset`), the query permission name (docs list *Write* even for query), ingestion latency, and whether `[solver-container]` DO lines arrive reliably. A 10-minute spike before the runner is built. Owner: plan / first implement phase.
5. **Does `wrangler secret put` restart a *running* container, or only the DO?** Docs imply the DO only; the runner applies cells while idle anyway, but the claim should be observed once. Owner: implement.
6. **Runner shape.** (i) a sh loop over one-shot TS steps, or (ii) a single Node-TS runner without `@/` imports. Both need `devalue` as a direct devDependency. Owner: plan.
7. **Include the exact delivered tuple (`scoreCandidate`) in every ledger row, or only for the baseline cell?** It costs a `snapshot` + `result` read per job. Owner: plan.
8. **Pending check 2.4 needs the full S-302 job id.** Only the `386b9d35` prefix is recorded (`solver-deploy-lane/change.md:55`). Look it up once, or let the analyzer accept a prefix. Owner: implement.
9. **CI version tagging** (`deploy --message "${{ github.sha }}"`): worth adding before the campaign so every live version maps to a SHA, given the out-of-band deploy evidence? Owner: plan.
10. **Where does the runner run?** Local plus `caffeinate` is the precedent and needs no new credentials anywhere. A GitHub Actions or cloud-scheduled runner would put hosted credentials into CI, which the README deliberately avoids. Research recommends local. Owner: author.
