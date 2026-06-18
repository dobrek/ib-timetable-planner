---
date: 2026-06-18T15:04:49+0200
researcher: Dobromir Kropielnicki
git_commit: 6167740fd6b8874058d46381bbfb17183137d008
branch: main
repository: dobrek/ib-timetable-planner
topic: "CI pipeline cleanup — cleaner, less repetitive, faster"
tags: [research, ci, github-actions, performance, dry, playwright, supabase]
status: complete
last_updated: 2026-06-18
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Added naming-convention fix (workflow 'CI' vs job 'ci' collision → rename job to 'verify', add display names; no branch protection so safe). Earlier follow-ups: action-version audit (node20 deprecation → wrangler-action@v4, upload-artifact@v7) and the wrangler-deploy rebuild question (build ~6.3s, artifact reuse not worth it)."
---

# Research: CI pipeline cleanup — cleaner, less repetitive, faster

**Date**: 2026-06-18T15:04:49+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 6167740fd6b8874058d46381bbfb17183137d008
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

The CI pipeline now has all the stages we wanted — build, unit test, integration test, end-to-end test, deploy. Time for a second look at its **structure**: where can it be cleaner, less repetitive, and faster? Specifically evaluate (1) DRY via composite actions, (2) caching & concurrency, (3) job-topology changes, (4) reusable workflows, and (5) whether running Playwright from its official Docker image (instead of `playwright install`) makes sense. Scope: the workflow file itself ([`.github/workflows/ci.yml`](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml)); balanced goal (clean code ↔ speed).

## Summary

The pipeline is **already well-architected for speed** — the three gate jobs (`ci`, `integration`, `e2e`) run in parallel, deps are cached via `setup-node`'s `cache: "pnpm"`, the Supabase stack is already trimmed with `-x`, and image-caching was *measured and consciously deferred*. So the headline is: **most of the available win is clean-code/DRY and runner-cost efficiency, not dramatic wall-clock reduction.** The critical-path long pole (the `e2e` job) is largely irreducible given its real constraints (host-Docker Supabase + workerd preview + version-matched browsers).

Verdicts per lever (balanced ranking, highest payoff-to-risk first):

| Lever | Verdict | Primary benefit | Risk |
|---|---|---|---|
| **`concurrency` + cancel-in-progress** | ✅ **Do it** | Cancels superseded PR/branch runs → saves runner minutes & queue time | Low (guard `main` so deploys aren't cancelled) |
| **Composite action for the setup preamble** | ✅ **Do it** | Removes 4× duplication; one place to change | Low |
| **Composite action for the Supabase block** | ✅ **Do it** (one input toggles the anon-key export) | Removes 2× duplication; rationale lives in one place | Low — must preserve job-scoped env isolation |
| **Merge `integration` + `e2e` into one job** | ⚖️ **Optional** | Boots Supabase once instead of twice; fewer runner minutes | Couples two pass/fail signals; gate wall-clock ~unchanged |
| **Share build artifact `ci` → `deploy`** | ❌ **Skip (settled — see follow-up)** | — | `wrangler deploy` *does* consume a prebuilt `dist`, but the build is only **~6.3s** — the artifact round-trip costs as much or more |
| **Reusable workflow (`workflow_call`)** | ❌ **Skip** | — | Wrong tool: it replaces whole jobs and breaks the `$GITHUB_ENV` hand-off the Supabase jobs depend on |
| **Playwright Docker `container:` image** | ❌ **Skip** | — | **Disqualifying**: a `container:` job cannot reach the host-Docker Supabase stack on `127.0.0.1` (documented [supabase/cli#1603](https://github.com/supabase/cli/issues/1603)) |
| **Playwright browser caching** | ❌ **Skip** | — | Official docs: cache-restore ≈ re-download, and the apt system-deps step isn't cacheable → ~wash |
| **Manual pnpm-store / Supabase-image caching** | ❌ **Skip** | — | Already optimal / measured-not-worth-it on GitHub-hosted runners |
| **Bump `wrangler-action@v3→v4` + `upload-artifact@v4→v7`** | ✅ **Do it** | Clears the Node-20-deprecation warnings (both pinned at `node20`); stays on supported runtimes | Low — breaking changes are minor for this repo (see 2nd follow-up) |

**The two unambiguous wins are `concurrency` and the composite-action extraction.** Everything else is either a measured-trade-off (merge, build artifact) or a confirmation that the current setup is already best-practice (pnpm cache, image cache, browser cache, no container).

---

## Detailed Findings

### A. Current-state map: where the repetition actually is

The workflow defines **4 jobs** ([ci.yml](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml)): `ci` (L10), `integration` (L34), `e2e` (L79), `deploy` (L144, `needs: [ci, integration, e2e]`, push-to-main only).

**Repeated block #1 — the setup preamble (×4, all jobs).** checkout + `pnpm/action-setup@v6` + `actions/setup-node@v6 (node-version-file + cache:pnpm)` + `pnpm install --frozen-lockfile`:
- `ci`: [L13–L24](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L13)
- `integration`: [L37–L48](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L37)
- `e2e`: [L82–L93](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L82)
- `deploy`: [L149–L160](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L149)

**Repeated block #2 — the Supabase bootstrap (×2, integration + e2e).** install Supabase CLI + `node scripts/gen-seed.mjs > supabase/seed.sql` + `supabase start -x <10-service exclusion list>` + `supabase status -o env … | sed 's/"//g' >> "$GITHUB_ENV"`:
- `integration`: [L50–L68](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L50)
- `e2e`: [L95–L120](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L95)
- The **only** difference is the export: `integration` exports `SUPABASE_URL` + `service_role_key`; `e2e` additionally exports `auth.anon_key=SUPABASE_KEY` ([L120](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L120)) and then writes `.dev.vars` ([L122–L127](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L122)). One composite action with a boolean `export-anon-key` input covers both.

**Repeated block #3 — `astro sync` + `build` + hosted-secret env (×2, ci + deploy).**
- `ci`: `pnpx astro sync` ([L25](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L25)) + build with `secrets.SUPABASE_*` ([L29–L32](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L29))
- `deploy`: same `pnpx astro sync` + build ([L161–L165](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L161))

**The build runs 3×, and (correction — see follow-up) all three outputs are env-agnostic:**
1. `ci` — `astro build` (gate check).
2. `e2e` — `astro build` driven *implicitly* by Playwright's `webServer.command = "pnpm build && pnpm preview"` (`playwright.config.ts`).
3. `deploy` — `astro build` (the production bundle).

`SUPABASE_URL`/`SUPABASE_KEY` are `envField` `access: "secret"` ([astro.config.mjs:44-45](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/astro.config.mjs#L44)) → **not part of the bundle** (per Astro docs). So all three `dist/` outputs are byte-equivalent regardless of which secrets were present at build time; the per-environment difference is entirely at **runtime** (`.dev.vars` for the e2e workerd preview vs. Cloudflare secret bindings for prod). The build is *not* keyed to the Supabase target — see the follow-up section for what this means for artifact reuse.

**Minor clean-code nits:** `pnpx astro sync` (L25, L161) uses the deprecated `pnpx` alias rather than `pnpm exec`/`pnpm dlx` used elsewhere; the `SUPABASE_URL/KEY` hosted-secret env block is duplicated at L29–L32 and L163–L165.

### B. Performance / critical-path analysis

Topology: `ci ∥ integration ∥ e2e` (parallel), then `deploy` (post-gate, push-to-main only). **Gate wall-clock = max(ci, integration, e2e).**

Rough costs (from recorded measurements + structure):
- **Supabase boot ≈ 82s** (incl. cold image pull) — measured in CI run 27549794933 (`data-for-e2e-and-integration-tests/change.md:14`).
- `test:integration` step itself ≈ **5s** (same source).
- `e2e` is the **long pole**: install + Supabase CLI + gen-seed + **boot (~82s)** + export + `.dev.vars` + **`playwright install --with-deps` (~tens of s, mostly the apt system-deps)** + `pnpm test:e2e` (which itself does `pnpm build && pnpm preview` + browser tests).

Consequences:
- **`pnpm install` ×4 is not removable** without merging jobs — each parallel job gets a fresh runner and legitimately must install (the `cache: "pnpm"` store already softens this).
- **Supabase boots ×2** (integration + e2e). Removable only by merging those jobs (see C).
- **Build ×3.** `e2e`'s is distinct; `ci`'s and `deploy`'s are identical → `deploy` could reuse `ci`'s artifact, shortening the *post-gate* phase (not the gate).
- The `e2e` long pole is **mostly irreducible**: boot (~82s) is image-caching-deferred, browser install caching is a wash, and the build inside `webServer` already runs only once per job.

**Net:** the pipeline parallelizes well; the wall-clock floor is set by `e2e`. The realistic speed lever is **not single-run wall-clock** but **runner-minutes / queue time** (concurrency cancel, optional job merge) plus a marginal **post-gate** save (deploy artifact reuse).

### C. Lever 1+4 — composite actions vs reusable workflows

**Use composite actions; do NOT use a reusable workflow here.** A reusable workflow (`workflow_call`) replaces *whole jobs*, so you can't append each job's distinct steps (lint/test/build vs. integration vs. e2e) after it — and, decisively, it runs as a *separate job* where **`$GITHUB_ENV` does not hand off** to the caller's later steps. The Supabase jobs mint ephemeral keys and `>> "$GITHUB_ENV"` them precisely so subsequent steps (`test:integration`, `.dev.vars` write, `test:e2e`) can read them. A **composite action runs in the caller job's context, so its `$GITHUB_ENV` writes persist** — exactly what's needed.

Two composite actions cover all the duplication:

`.github/actions/setup/action.yml` (preamble; checkout stays first in each job because a local `uses: ./...` needs the repo already checked out):
```yaml
name: "Setup (pnpm + node + install)"
runs:
  using: "composite"
  steps:
    - uses: pnpm/action-setup@v6
    - uses: actions/setup-node@v6
      with: { node-version-file: .node-version, cache: "pnpm" }
    - run: pnpm install --frozen-lockfile
      shell: bash      # REQUIRED on every composite run step
```

`.github/actions/supabase-stack/action.yml` (boot + env export; one input toggles the anon key):
```yaml
name: "Start trimmed Supabase stack + export env"
inputs:
  export-anon-key: { required: false, default: "false" }
runs:
  using: "composite"
  steps:
    - uses: supabase/setup-cli@v2
    - run: node scripts/gen-seed.mjs > supabase/seed.sql
      shell: bash
    - run: supabase start -x studio,imgproxy,mailpit,realtime,storage-api,vector,logflare,edge-runtime,postgres-meta,supavisor
      shell: bash
    - shell: bash
      run: |
        EXTRA=""
        [ "${{ inputs.export-anon-key }}" = "true" ] && EXTRA="--override-name auth.anon_key=SUPABASE_KEY"
        supabase status -o env \
          --override-name api.url=SUPABASE_URL $EXTRA \
          --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
          | sed 's/"//g' >> "$GITHUB_ENV"
```

**Gotchas:** every `run:` in a composite action needs an explicit `shell:`; inputs are strings only; secrets/inputs are not auto-inherited (pass via `with:`). **Isolation preserved:** a composite action's `$GITHUB_ENV` is still scoped to the calling job — it does not leak across jobs — so the heavily-documented e2e↔deploy prod-safety guard stays intact (keep `SUPABASE_*` out of any workflow-level `env:`). Sources: [GitHub Docs — composite actions](https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action), [Reusing workflow configurations](https://docs.github.com/en/actions/concepts/workflows-and-actions/reusing-workflow-configurations).

### D. Lever 2 — concurrency & caching

**`concurrency` — add it (highest payoff-to-risk).** Cancel superseded runs on the same ref, but **guard `main`** so an in-flight deploy is never cancelled:
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```
Mirrors the docs' own expression example. If you later want strictly serialized, never-cancelled deploys, put a separate `concurrency: { group: production-deploy, cancel-in-progress: false }` on the `deploy` job. Source: [GitHub Docs — control workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

**pnpm caching — already optimal.** `setup-node@v6` with `cache: "pnpm"` caches the pnpm store keyed on the lockfile; a manual `actions/cache` for the store is redundant and caching `node_modules` directly is an anti-pattern. Ordering is already correct (pnpm-setup before node-setup, required so `setup-node` can find the store).

**Supabase image caching — skip.** `docker save`/`load` + `actions/cache` yields no meaningful speedup on GitHub-hosted runners (cache transfer ≈ fresh GHCR pull) — confirmed by the Supabase maintainer and community tests ([supabase discussion #20081](https://github.com/orgs/supabase/discussions/20081), [setup-cli #88](https://github.com/supabase/setup-cli/issues/88)). The `-x` exclusion list is already the recommended lever. Revisit only if moving to self-hosted/persistent-disk runners.

### E. Lever 2 — build-once / artifact reuse `ci` → `deploy` — **settled: skip**

Both questions that gated this lever are now answered (see the **Follow-up Research** section for the evidence):
1. **Does `wrangler deploy` rebuild?** **No** — it consumes the prebuilt `dist/`. So artifact reuse is *feasible*.
2. **Is the build slow enough to be worth it?** **No** — `pnpm run build` is **~6.3s** (+ `astro sync` ~2.6s). An `upload-artifact`→`download-artifact` round-trip for a `dist/` of many small files (51 server chunks + client `_astro`) costs comparable time, and the upload tax hits *every* `ci` run (incl. PRs that never deploy) unless gated. Net: complexity for ≈ zero saving.

**Verdict: leave the duplicate build in `deploy`.** Revisit only if the build grows substantially (tens of seconds).

### F. Lever 3 — job-topology change: merge `integration` + `e2e`

The biggest structural option. Both jobs boot an identical trimmed stack; merging boots it **once**. The combined job would: setup → boot → export the **superset** env (url + anon + service_role) → run `test:integration` (~5s, still `--maxWorkers=2`) → write `.dev.vars` + install Playwright → run `test:e2e`.

**Trade-off (this is a cost/cleanliness win, not a wall-clock win):**
- ✅ One fewer Supabase boot (~82s of runner time) + one fewer install/checkout/gen-seed; less duplication; a single ephemeral stack.
- ❌ Couples two pass/fail signals (an integration flake now also fails e2e; no independent retry).
- ➖ Gate wall-clock is ~unchanged: `e2e` is already the long pole, and merging appends only the ~5s integration suite to it. What you save is the *separate* integration job's runner minutes, not the critical path.

There is **no recorded rationale rejecting a combined job** — the separation was authored for "feedback parallelism" and as a deliberate *mirror* of the integration template, not a costed decision. So merging is genuinely on the table; decide on the signal-independence trade-off, not on speed.

**Topology options that are NOT worth it:** splitting `build` into its own upstream job would *serialize* what's currently parallel and can't share its output into `e2e` (different keys) or speed up lint/test — likely a net slowdown.

### G. Lever 5 — Playwright Docker `container:` image — **do not adopt**

Running the `e2e` job inside `mcr.microsoft.com/playwright:vX-noble` would skip the browser install, but it is **disqualified by a hard compatibility conflict**, not a preference:

- A `container:` job runs **all steps inside that container**. `supabase start` launches its Postgres/Kong/GoTrue containers via the host Docker daemon as **siblings**, publishing ports on the **host's** `localhost`. From inside the job container (separate network namespace), `127.0.0.1:54321/54322` is **unreachable** — breaking both `supabase start`'s own readiness probe and the workerd preview's `signInWithPassword` against the minted `SUPABASE_URL=http://127.0.0.1:54321`. This is a **documented, reproduced failure**: [supabase/cli#1603](https://github.com/supabase/cli/issues/1603) (`dial tcp [::1]:54322: connect: connection refused`). Workarounds (`host.docker.internal`, shared user-defined networks) fight the CLI and the `status -o env`→`.dev.vars` flow this job is built around.
- Even setting that aside, the image's benefit is small (the browser download is tens of MB; the apt system-deps install dominates) and it adds a **version-pinning burden**: the image tag must be kept in lockstep with `@playwright/test` or you get cryptic "browser not found" errors ([Playwright Docker docs](https://playwright.dev/docs/docker)). The current `pnpm exec playwright install --with-deps chromium` **auto-matches** the installed dep version — zero drift.
- (Note: the image now ships Node 24, so the older Node-version conflict is gone — but that doesn't rescue the Supabase networking blocker.)

**Browser caching (the lighter alternative) is also a wash:** the official CI docs explicitly advise against caching browser binaries ("time to restore ≈ download new, and OS deps aren't cacheable") ([Playwright CI docs](https://playwright.dev/docs/ci)). Keep `ubuntu-latest` + `--with-deps`.

> The `container:` image only becomes attractive if the browser-running part is ever split into a *separate* job that talks to a *remote* Supabase (no host-Docker stack). Not the case today.

---

## Code References

- `.github/workflows/ci.yml:10` — `ci` job (lint/steiger/test/build)
- `.github/workflows/ci.yml:13-24` — setup preamble (repeat #1, instance 1/4)
- `.github/workflows/ci.yml:25,29-32` — `astro sync` + build with hosted secrets (repeat #3)
- `.github/workflows/ci.yml:34` — `integration` job
- `.github/workflows/ci.yml:50-68` — Supabase bootstrap (repeat #2, instance 1/2) + the `-x` trim and `sed` quote-strip rationale
- `.github/workflows/ci.yml:77` — `pnpm test:integration --maxWorkers=2` (resource cap, not data isolation)
- `.github/workflows/ci.yml:79` — `e2e` job
- `.github/workflows/ci.yml:95-127` — Supabase bootstrap (instance 2/2) + anon-key export + `.dev.vars` write
- `.github/workflows/ci.yml:113-118` — the e2e↔deploy env-isolation guard (do not undo)
- `.github/workflows/ci.yml:130` — `pnpm exec playwright install --with-deps chromium`
- `.github/workflows/ci.yml:134` — `pnpm test:e2e` (its `webServer` does `pnpm build && pnpm preview`)
- `.github/workflows/ci.yml:144-146` — `deploy` job: `needs: [ci, integration, e2e]`, push-to-main only
- `.github/workflows/ci.yml:161-165` — `deploy` rebuild (artifact-reuse candidate)
- `playwright.config.ts:50-55` — `webServer.command = "pnpm build && pnpm preview"` (the implicit e2e build, keyed to ephemeral keys)
- `package.json:5-22` — pipeline scripts (`build=astro build`, `test=vitest run`, `test:integration`, `pretest:e2e=node scripts/provision-e2e-author.mjs`, `test:e2e=playwright test`)

## Architecture Insights — what NOT to undo during cleanup

From the history mining (heavily-documented, deliberate decisions):

1. **e2e↔deploy env isolation** ([ci.yml:113-118](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L113)) — e2e's Supabase vars come *solely* from its own ephemeral stack via job-scoped `$GITHUB_ENV`; never reference `secrets.SUPABASE_*` in e2e and never promote `SUPABASE_*` to a workflow-level `env:` (would aim the workerd preview, and a real `signInWithPassword`, at production). Composite-action extraction must preserve this.
2. **`sed 's/"//g'` quote-strip** and the explicit **`.dev.vars` write** are bug fixes for real CI failures (commit `106c4c3`), not redundancy — the CI stack mints its own anon key that won't match the fixed local publishable key.
3. **Trimmed `-x` list uses the CLI's own container labels** (mailpit/storage-api/logflare/postgres-meta), not the docs' aliases (which the CLI silently ignores). **gotrue must stay** (e2e sign-in).
4. **`--maxWorkers=2`** is a stack-resource hedge against transient Kong/PostgREST 502s under nine concurrent suites (commit `f2ee0ac`), *not* data isolation — don't remove it.
5. **`load-test-env` fail-gate** (`src/test/load-test-env.ts`) throws when `CI=true` and Supabase env is missing — so the `$GITHUB_ENV` export is load-bearing (no silent zero-coverage).
6. **Supabase image caching was measured (~82s) and consciously deferred** — re-raising it is in scope but it was a decision, not an oversight.

## Historical Context (from prior changes)

- `context/changes/data-for-e2e-and-integration-tests/change.md:14` — trimmed boot measured ~82s; Docker-image caching judged "not painful" → not pursued.
- `context/changes/data-for-e2e-and-integration-tests/plan.md:104-108` — db+rest+kong(+auth) are the live minimum; auth always boots.
- `context/archive/2026-06-15-testing-auth-actions-boundary-rls/plan.md:20,244,246` — the `e2e` job was authored to *mirror* `integration` and gate deploy; the env-isolation guard is "defense-in-depth plus a signpost for the next editor."
- `context/deployment/deploy-plan.md:178-182` — the `deploy` job was added to "keep CI a single workflow that gates AND deploys, in that order"; no recorded rationale for *why deploy rebuilds* rather than reusing `ci`'s artifact.
- `context/changes/test-plan-refresh-2026-06-15/research.md:66-67` — `load-test-env` fail-loud gate + the `--maxWorkers=2` reasoning.
- **None** of the five cleanup levers (composite actions, reusable workflows, build-artifact sharing, concurrency, Playwright caching/container) were ever discussed in any context doc — this is greenfield cleanup territory.

## Open Questions

1. ~~**Does `wrangler deploy` consume the prebuilt `dist/` or run its own build?**~~ **RESOLVED** (follow-up): consumes the prebuilt `dist/`; does not re-run `astro build`.
2. ~~**What is the actual `pnpm run build` wall-time in CI?**~~ **RESOLVED** (follow-up): ~6.3s locally → artifact reuse not worth it.
3. **Signal-independence appetite:** is coupling `integration` + `e2e` into one job (lever F) acceptable, given it trades a separate failure signal for one fewer Supabase boot? A product/process decision, not a technical one.
4. **Concurrency on `main`:** prefer the simple `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` guard, or a dedicated never-cancel `concurrency` block on the `deploy` job? (Both are valid; the former is simpler.)

## Follow-up Research 2026-06-18T15:13:00+0200 — settling the `wrangler deploy` rebuild question

**Question:** does `wrangler deploy` re-run the Astro build, or consume the prebuilt `dist/`? This decided lever E (build-artifact reuse `ci`→`deploy`).

**Answer: `wrangler deploy` consumes the prebuilt `dist/`. It does NOT run `astro build`.** Evidence from the live config:

- [`wrangler.jsonc`](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/wrangler.jsonc): `"main": "@astrojs/cloudflare/entrypoints/server"` (the adapter's entrypoint inside `node_modules`, **not** a path into `dist/`) and `"assets": { "directory": "./dist" }`.
- The adapter entrypoint `node_modules/@astrojs/cloudflare/dist/entrypoints/server.js` is a 6-line shim: `import { handle } from "../utils/handler.js"; export default { fetch: handle }`. The handler loads the **prebuilt** app from `dist/server/` (`entry.mjs`, `chunks/`, `virtual_astro_middleware.mjs`, and an adapter-generated `dist/server/wrangler.json`).
- So `wrangler deploy` runs *its own fast esbuild bundling of `main`* and uploads the worker + `dist/` assets — it requires `dist/` to **already exist** (produced by `astro build`). It never regenerates it. (Versions: `@astrojs/cloudflare@13.5.4`, `wrangler@4.94.0`.)

**Therefore artifact reuse is *feasible*** — `deploy` could `download-artifact` `ci`'s `dist/`, skip `astro sync` + `pnpm run build`, and let `wrangler deploy` bundle/upload it. But the **build is too cheap to bother**:

- `pnpm run build` = **6.3s** wall (`astro build`, "Server built in 5.08s"); `astro sync` = **2.6s**. Measured locally on this commit.
- An `upload-artifact`/`download-artifact` round-trip for a `dist/` of many small files (51 entries in `dist/server/chunks/` plus `dist/client/_astro`) costs comparable wall-time and adds an upload tax to *every* `ci` run (including PRs that never deploy) unless gated to push-to-main. Net saving ≈ 0, with added complexity and a new failure surface.

**Bonus correction (env-agnostic build):** while confirming the above I verified that `SUPABASE_URL`/`SUPABASE_KEY` are `envField` `access: "secret"` ([astro.config.mjs:42-47](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/astro.config.mjs#L42)). Astro docs (`/withastro/docs`, environment-variables guide): *"Secret server variables are not part of the final bundle."* So:
- The Supabase secrets are **not inlined** into `dist/` — they're read at **runtime** (Cloudflare secret bindings in prod, set via `wrangler secret put`; `.dev.vars` for the e2e workerd preview).
- All three builds (`ci`, `e2e`, `deploy`) produce **byte-equivalent `dist/`**, regardless of which secrets were present. My original Section A claim that the e2e build "is keyed to different inputs and must not be shared" was **wrong about the mechanism** — the *build* is env-independent. (The reason still not to share `dist/` into `e2e` is orchestration, not correctness: the e2e build is wrapped inside Playwright's `webServer` and the adapter copies `.dev.vars` into `dist/server/` — fiddly to bypass for a ~6s save.)
- The `SUPABASE_*` `env:` blocks on the `ci`/`deploy` build steps ([ci.yml:29-32](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L29), [163-165](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L163)) therefore **do not affect build output** and (given `optional: true`) aren't required for the build to pass — a *possible* minor cleanup, but verify nothing else in the build reads them before removing.
- **The runtime env-isolation guard (Section A.D / "what NOT to undo" #1) is unaffected** — it governs the *runtime* `.dev.vars`/secrets the preview reads, not the build bytes. Keep it.

## Follow-up Research 2026-06-18T15:16:00+0200 — action-version currency & the Node 20 deprecation

**Trigger:** CI emits *"Node.js 20 is deprecated… `cloudflare/wrangler-action@v3` … forced to run on Node.js 24"* ([GitHub changelog, 2025-09-19](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)). Audited every pinned action against its latest release and the Node runtime declared in its manifest (`gh api` against each repo, this commit).

| Action | Pinned | Pinned runtime | Latest release | Latest runtime | Status |
|---|---|---|---|---|---|
| `actions/checkout` | `@v6` | node24 | v6.0.3 | node24 | ✅ current (latest major) |
| `actions/setup-node` | `@v6` | node24 | v6.4.0 | node24 | ✅ current |
| `pnpm/action-setup` | `@v6` | node24 | v6.0.9 | node24 | ✅ current |
| `supabase/setup-cli` | `@v2` | **composite** | v2.1.1 | composite | ✅ current (composite → no node-runtime deprecation of its own) |
| `actions/upload-artifact` | **`@v4`** | **node20** ⚠️ | **v7.0.1** | node24 | ⚠️ 3 majors behind + node20 |
| `cloudflare/wrangler-action` | **`@v3`** | **node20** ⚠️ | **v4.0.0** | node24 | ⚠️ 1 major behind + node20 (the warning) |

**Root cause of the asymmetry:** the repo pins floating *major* tags (`@v6`, `@v4`, …). Actions pinned at the **current** major (`checkout`, `setup-node`, `pnpm/action-setup`, `supabase/setup-cli`) auto-track patches and already moved to `node24`. The two pinned at an **old** major (`wrangler-action@v3`, `upload-artifact@v4`) can't cross the major boundary on their own, so they're stranded on the deprecated `node20`. The fix is bumping the major tag — there is no other config involved.

### Why only `wrangler-action` shows in the log (not `upload-artifact`)
`upload-artifact@v4` (`v4.6.2`) is **also** `node20`, but it runs `if: failure()` in the `e2e` job ([ci.yml:136-142](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L136)) — it only executes (and only then warns) when a Playwright test fails. `wrangler-action@v3` runs on every push-to-main deploy, so it warns every time. Both need the bump; `upload-artifact` is just a latent version of the same problem.

### Migration 1 — `cloudflare/wrangler-action@v3` → `@v4` (low risk)
The **only** breaking change in v4.0.0 (per its release notes): *"Update default Wrangler version to v4 (`latest`)… Users can still pin to v3 by setting `wranglerVersion: '3.90.0'`."* It changes the **default Wrangler CLI** the action installs (v3→v4), **not the action's API** (`command: deploy` is unchanged).
- **This repo is already a Wrangler-v4 project** (`wrangler@4.94.0` devDependency; `wrangler.jsonc` `compatibility_date: 2026-05-08`). So v4's new default *aligns* the action with the project — arguably a correctness improvement, not just a runtime bump.
- **Recommended hardening:** pin `wranglerVersion: "4.94.0"` (matching the devDependency) on the deploy step so the action and the project never drift. Without it, `@v4` floats to the latest Wrangler at run time.

### Migration 2 — `actions/upload-artifact@v4` → `@v7` (drop-in here)
Cumulative changes across the majors (release notes): **v5** = preliminary node24 + `@actions/artifact` v4; **v6** = node24 *by default*, **requires Actions runner ≥ 2.327.1**; **v7** = internal ESM rewrite + a new optional `archive: false` direct-upload param. The disruptive upload-artifact break (immutable artifacts, unique-name requirement) was the old **v3→v4** jump, which this repo is **already past**.
- For this repo's simple usage (`name` + `path` + `retention-days`, [ci.yml:138-142](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L138)), `@v4→@v7` is **drop-in** — no input changes.
- The runner-version floor (≥2.327.1) is a **self-hosted** concern only; `ubuntu-latest` (GitHub-hosted) always satisfies it. Pinning `@v7` (vs `@v6`) only adds the optional direct-upload feature; either clears node20.

### Not affected
`checkout`, `setup-node`, `pnpm/action-setup` are at the latest major and on `node24` — leave them. `supabase/setup-cli@v2` is a **composite** action (latest v2.1.1) — it has no node-runtime of its own to deprecate; current. Floating-major pinning is fine to keep; if the project later wants supply-chain hardening, pin actions to full commit SHAs (optional, out of scope here).

### Net
Two one-line tag bumps clear all Node-20 deprecation warnings and are low-risk for this repo: `cloudflare/wrangler-action@v3` → `@v4` (optionally + `wranglerVersion: "4.94.0"`) and `actions/upload-artifact@v4` → `@v7`. This is independent of the structural levers and can ship on its own.

## Follow-up Research 2026-06-18T15:20:00+0200 — naming convention (workflow vs job collision)

**Problem:** the workflow is `name: CI` ([ci.yml:1](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L1)) and one of its four jobs is keyed `ci` ([ci.yml:10](https://github.com/dobrek/ib-timetable-planner/blob/6167740fd6b8874058d46381bbfb17183137d008/.github/workflows/ci.yml#L10)). In the Actions UI the check renders as **`CI / ci`** — the same word at two levels. Worse, the `ci` job is *not* "the CI": it's only the lint + steiger + unit + build lane; `integration`, `e2e`, and `deploy` are equally part of CI. None of the four jobs declare a display `name:`, so the UI shows the raw job ids (`CI / integration`, `CI / e2e`, …).

**Blast radius — none.** `main` has **no branch protection** (`gh api …/branches/main/protection` → 404), so no required status check references the `ci` job name. Renaming the job is safe with **no branch-protection migration**. (For the future: if branch protection is ever added, required checks reference the *job name/id*, so rename before configuring it, not after.)

**Constraint from prior decisions:** do **not** split deploy into a separate workflow file — the deploy plan deliberately keeps "CI a single workflow that gates AND deploys, in that order" (`context/deployment/deploy-plan.md:178`). The fix is renaming within the one workflow, not restructuring it.

**Recommended scheme** (rename the misleading job; keep the workflow as the umbrella; add human-readable display names to all jobs):

```yaml
name: CI                       # umbrella stays "CI" (or "CI / CD" to acknowledge deploy)

jobs:
  verify:                      # was `ci` — lint + steiger + unit tests + build
    name: Lint, unit & build
    # ...
  integration:
    name: Integration tests
    # ...
  e2e:
    name: E2E tests
    # ...
  deploy:
    name: Deploy
    needs: [verify, integration, e2e]   # update the needs: list to the new id
    # ...
```

Result in the UI: `CI / Lint, unit & build`, `CI / Integration tests`, `CI / E2E tests`, `CI / Deploy` — no more `CI / ci`.

**Job-id options for the renamed `ci` job** (it bundles lint + steiger + unit + build, so avoid `unit-tests`, which under-describes it):

| New id | Why | Note |
|---|---|---|
| `verify` *(recommended)* | Echoes the repo's own `/verify` skill ("mirror the full CI gate locally") — vocabulary consistency | Slightly abstract |
| `build-and-test` | Literal, conventional | Doesn't signal lint/steiger |
| `lint-unit-build` | Most explicit | Verbose |

**Two cheap, independent wins:**
1. **Rename `ci` → `verify`** (+ update `needs:`). Removes the collision.
2. **Add `name:` to every job** — readable checks regardless of the id rename; this alone resolves most of the confusion even if the id stays.

Optional: rename the workflow `name: CI` → `CI / CD` since it also deploys (purely cosmetic; doesn't change check contexts, which are per-job). This is the lowest-priority of the cleanup items — pure readability, zero runtime effect — but it's also near-zero-risk given no branch protection.

## Related Research

- `context/changes/data-for-e2e-and-integration-tests/research.md` — original integration/e2e lane design (trimmed stack, isolation).
- `context/changes/test-plan-refresh-2026-06-15/research.md` — test-plan refresh that set `--maxWorkers=2` and the fail-loud gate.
- `context/deployment/deploy-plan.md` — deploy job origin.
