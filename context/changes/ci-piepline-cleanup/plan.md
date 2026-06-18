# CI Pipeline Cleanup Implementation Plan

## Overview

A behavior-preserving structural cleanup of `.github/workflows/ci.yml`. The pipeline already has every stage we want (build, unit, integration, e2e, deploy) and is well-architected for speed; this change targets **structure** — less repetition, fewer runner minutes, no Node-20 deprecation noise, clearer check names — without changing what CI verifies or deploys.

Two concrete moves:
1. Extract the duplicated setup preamble (×4) and Supabase bootstrap (×2) into two composite actions.
2. A bundle of low-risk workflow edits: a guarded `concurrency` block, two action-version bumps that clear the Node-20 deprecation, the `CI / ci` naming fix, and removal of dead build-time env config.

The deep technical analysis is in [`research.md`](research.md), including two follow-up passes that settled the build-artifact-reuse and action-version questions. This plan implements only the levers the research marked "✅ Do it" plus the user-confirmed decisions; it deliberately does **not** pursue the levers marked "❌ Skip".

## Current State Analysis

`.github/workflows/ci.yml` defines **4 jobs**: `ci` (lint/steiger/test/build, `ci.yml:10`) ∥ `integration` (`ci.yml:34`) ∥ `e2e` (`ci.yml:79`) run in parallel, then `deploy` (`ci.yml:144`, `needs: [ci, integration, e2e]`, push-to-main only).

Three repetition sources (research §A):
- **Setup preamble ×4** — checkout + `pnpm/action-setup@v6` + `setup-node@v6 (node-version-file + cache:pnpm)` + `pnpm install --frozen-lockfile` (`ci.yml:13-24`, `37-48`, `82-93`, `149-160`).
- **Supabase bootstrap ×2** — `supabase/setup-cli@v2` + `gen-seed` + trimmed `supabase start -x …` + `supabase status -o env … | sed 's/"//g' >> "$GITHUB_ENV"` (`ci.yml:50-68` integration, `95-120` e2e). The **only** difference: e2e also exports the anon key (`auth.anon_key=SUPABASE_KEY`, `ci.yml:120`) and then writes `.dev.vars` (`ci.yml:126-127`).
- **`astro sync` + build ×2** — `ci` (`ci.yml:25,29-32`) and `deploy` (`ci.yml:161-165`).

Verified during planning:
- No `.github/actions/` directory exists yet — both composite actions are net-new files.
- `SUPABASE_URL`/`SUPABASE_KEY` are `envField` `access: "secret"`, `optional: true` (`astro.config.mjs:44-45`). Production consumers (`src/shared/api/supabase.ts:3`, `src/app/config/config-status.ts:1`) read them via `astro:env/server` at **runtime**. There is **no `export const prerender`** anywhere and `output: "server"`, so no page evaluates Supabase code during `astro build`. Every other reference is in `*.integration.test.ts` / `scripts/provision-e2e-author.mjs` reading `process.env` (the test/runtime path). → The `SUPABASE_*` `env:` blocks on the two build steps are dead config; removing them cannot affect build output.
- Two actions are stranded on the deprecated `node20` because they're pinned at an old major: `cloudflare/wrangler-action@v3` (warns on every deploy) and `actions/upload-artifact@v4` (latent — only runs `if: failure()`). All other actions are at their current major and already on `node24` (research §"action-version currency").

## Desired End State

`.github/workflows/ci.yml` is shorter and reads cleanly: each job's preamble is one `uses: ./.github/actions/setup` line, the two Supabase jobs share `uses: ./.github/actions/supabase-stack`, and the workflow carries a guarded `concurrency` block. In the GitHub Actions UI the run shows as **`CI / CD`** with human-readable checks (`Lint, unit & build`, `Integration tests`, `E2E tests`, `Deploy`) and **no `CI / ci` collision**. No Node-20 deprecation warning appears on deploy. CI is green on a PR and on push-to-main, with deploy still gated behind all three checks.

Verify by: pushing a branch, opening a PR, and watching the Actions run go fully green with the new check names; confirming a second push to the same branch cancels the first run; confirming the push-to-main deploy emits no Node-20 warning and ships.

### Key Discoveries

- **Composite actions, not a reusable workflow** (research §C). A composite action runs in the **caller job's context**, so its `$GITHUB_ENV` writes persist to later steps — exactly what the Supabase jobs need (they mint ephemeral keys and `>> "$GITHUB_ENV"` them for `test:integration` / `.dev.vars` / `test:e2e`). A `workflow_call` reusable workflow runs as a *separate job* where `$GITHUB_ENV` does **not** hand off — disqualified.
- **`shell:` is required on every `run:` step in a composite action** (research §C gotcha). Inputs are strings only; secrets/inputs are not auto-inherited.
- **`checkout` must stay first in each job** — a local `uses: ./.github/actions/…` needs the repo already checked out, so checkout cannot move into the composite.
- **Env isolation is runtime-scoped and survives extraction** (research §A.D / "what NOT to undo" #1). `$GITHUB_ENV` is per-job; a composite action does not leak it across jobs. The guard to preserve: never reference `${{ secrets.SUPABASE_* }}` in e2e and never promote `SUPABASE_*` to a workflow-level `env:`.
- **The `.dev.vars` write stays in the e2e job** (`ci.yml:126-127`) — it is e2e-specific and runs *after* the shared bootstrap; it is not part of the composite.
- **`--maxWorkers=2`** (`ci.yml:77`) is a stack-resource hedge, not data isolation (research "what NOT to undo" #4) — keep it on the `test:integration` step, which stays in the integration job.
- **`wrangler deploy` consumes the prebuilt `dist/`** and the build is ~6.3s, so build-artifact reuse `ci`→`deploy` is **not** worth it (research §E) — the duplicate build in `deploy` stays.

## What We're NOT Doing

- **Not** merging `integration` + `e2e` (user decision: keep two independent pass/fail signals; research §F).
- **Not** sharing the `ci` build artifact into `deploy` (research §E — build too cheap; settled).
- **Not** adopting the Playwright Docker `container:` image (research §G — host-Docker Supabase unreachable from inside a job container; documented blocker).
- **Not** adding Playwright browser caching or Supabase image caching (research §D, §G — measured washes).
- **Not** converting anything to a `workflow_call` reusable workflow (research §C — breaks the `$GITHUB_ENV` hand-off).
- **Not** splitting `build` into its own upstream job (research §F — would serialize what's parallel).
- **Not** splitting `deploy` into a separate workflow file (deploy plan keeps CI a single gate-then-deploy workflow).
- **Not** changing the trimmed `-x` exclusion list, the `sed` quote-strip, `gotrue` retention, or the `load-test-env` fail-gate (research "what NOT to undo").
- **Not** pinning actions to full commit SHAs (supply-chain hardening — out of scope).

## Implementation Approach

Two phases, ordered so the risk is isolated. Phase 1 is the only behavior-sensitive change (it moves steps into composite actions and must preserve `$GITHUB_ENV` semantics and env isolation); shipping it alone and getting a green CI run proves the refactor is faithful before any cosmetic/version churn lands on top. Phase 2 is a bundle of independent, low-risk edits to the workflow file itself.

## Critical Implementation Details

- **Timing & lifecycle.** In each job, the order must be: `checkout` → `uses: ./.github/actions/setup` (local action needs the checked-out repo) → job-specific steps. For the two Supabase jobs, `uses: ./.github/actions/supabase-stack` comes after setup; in e2e, the `.dev.vars` write + `playwright install` + `test:e2e` follow the composite (they read the `$GITHUB_ENV` the composite exported).
- **State sequencing (composite-internal).** Inside `setup/action.yml`, `pnpm/action-setup` must run before `setup-node` so `setup-node`'s `cache: "pnpm"` can locate the pnpm store. Inside `supabase-stack/action.yml`, the order is setup-cli → gen-seed → `start` → `status -o env`.

## Phase 1: Extract composite actions (the DRY refactor)

### Overview

Create two composite actions and rewire all four jobs to consume them, removing the ×4 preamble and ×2 Supabase-bootstrap duplication while preserving every documented invariant.

### Changes Required:

#### 1. Setup composite action

**File**: `.github/actions/setup/action.yml` (new)

**Intent**: Collapse the repeated pnpm + Node + install preamble into one local composite action so there is a single place to change the toolchain setup.

**Contract**: A `using: "composite"` action named e.g. `"Setup (pnpm + node + install)"`, no inputs. Steps in order: `pnpm/action-setup@v6` → `actions/setup-node@v6` (`with: node-version-file: .node-version`, `cache: "pnpm"`) → `run: pnpm install --frozen-lockfile`. **`checkout` is NOT included** — it stays in each calling job. Every `run:` step needs an explicit `shell: bash`.

#### 2. Supabase-stack composite action

**File**: `.github/actions/supabase-stack/action.yml` (new)

**Intent**: Collapse the repeated Supabase CLI install + seed regen + trimmed boot + env export shared by the `integration` and `e2e` jobs into one action, with a single boolean input that toggles the e2e-only anon-key export.

**Contract**: A `using: "composite"` action with one input `export-anon-key` (`required: false`, `default: "false"`). Steps in order: `supabase/setup-cli@v2` → `run: node scripts/gen-seed.mjs > supabase/seed.sql` → `run: supabase start -x studio,imgproxy,mailpit,realtime,storage-api,vector,logflare,edge-runtime,postgres-meta,supavisor` → a `run:` that exports env to `$GITHUB_ENV`, conditionally appending the anon-key override. Every `run:` needs `shell: bash`. The export step preserves the `sed 's/"//g'` quote-strip and the `--override-name api.url=SUPABASE_URL` / `auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY` overrides; when `export-anon-key == "true"` it additionally passes `--override-name auth.anon_key=SUPABASE_KEY`. Carry over the existing explanatory comments (trimmed-stack rationale, quote-strip, env-isolation note) so the rationale survives the move.

The conditional-override shape (the one non-obvious bit — a shell guard inside a single `run:`, since composite-action step-level `if:` on inputs is awkward):

```yaml
- shell: bash
  run: |
    EXTRA=""
    [ "${{ inputs.export-anon-key }}" = "true" ] && EXTRA="--override-name auth.anon_key=SUPABASE_KEY"
    supabase status -o env \
      --override-name api.url=SUPABASE_URL $EXTRA \
      --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
      | sed 's/"//g' >> "$GITHUB_ENV"
```

#### 3. Rewire the `ci` job

**File**: `.github/workflows/ci.yml` (`ci.yml:10-32`)

**Intent**: Replace the inline preamble with the setup composite; leave the lint/steiger/test/build steps unchanged in this phase.

**Contract**: Job keeps `- uses: actions/checkout@v6` as its first step, then `- uses: ./.github/actions/setup`. The subsequent `pnpx astro sync` / `lint` / `steiger` / `test` / `build` steps are untouched here (renames and the build-env removal happen in Phase 2). Net: the four preamble steps collapse to one `uses:` line.

#### 4. Rewire the `integration` job

**File**: `.github/workflows/ci.yml` (`ci.yml:34-77`)

**Intent**: Replace both the preamble and the Supabase bootstrap with the two composite actions; keep the capped `test:integration` step in the job.

**Contract**: `checkout` → `uses: ./.github/actions/setup` → `uses: ./.github/actions/supabase-stack` (no input; anon key not exported) → `run: pnpm test:integration --maxWorkers=2` (unchanged, comment preserved). The inline setup-cli/gen-seed/start/export steps are removed (now in the composite).

#### 5. Rewire the `e2e` job

**File**: `.github/workflows/ci.yml` (`ci.yml:79-142`)

**Intent**: Replace the preamble and Supabase bootstrap with the composites, requesting the anon-key export; keep the e2e-specific `.dev.vars` write, Playwright install, test run, and report upload in the job.

**Contract**: `checkout` → `uses: ./.github/actions/setup` → `uses: ./.github/actions/supabase-stack` `with: { export-anon-key: "true" }` → `Write .dev.vars` step (unchanged, `ci.yml:126-127`) → `Install Playwright browser` (unchanged) → `pnpm test:e2e` (unchanged) → `Upload Playwright report` (`if: failure()`; the version bump is Phase 2). The inline setup-cli/gen-seed/start/export steps are removed.

#### 6. Rewire the `deploy` job preamble

**File**: `.github/workflows/ci.yml` (`ci.yml:144-160`)

**Intent**: Replace the deploy job's inline preamble with the setup composite; leave its build / migrations / wrangler-deploy steps for Phase 2.

**Contract**: `checkout` → `uses: ./.github/actions/setup`, then the existing `astro sync` / build / migrations / `wrangler-action` steps follow unchanged in this phase. `needs:` / `if:` unchanged here (the rename is Phase 2).

### Success Criteria:

#### Automated Verification:

- `.github/actions/setup/action.yml` and `.github/actions/supabase-stack/action.yml` exist and are **well-formed YAML** (a parse check, not schema validation).
- `.github/workflows/ci.yml` is **well-formed YAML** (`pnpm exec actionlint` if available — it validates workflow/composite schema; otherwise a plain YAML parse, which does **not**). **Note:** composite-action correctness — above all an explicit `shell: bash` on every `run:` step — is *not* provable by a parse; it is proven only by the manual CI run (1.4/1.5). Treat 1.4/1.5 as the real gate for this refactor.
- Local CI gate passes (`/verify` skill: install → astro sync → lint → steiger → test → build) — confirms the refactor didn't disturb the app build. (This exercises the app, **not** the workflow YAML — it gives no signal on the composite actions.)

#### Manual Verification:

- Push the branch / open a PR; the `Integration tests` job boots Supabase and `test:integration` passes (proves the composite's `$GITHUB_ENV` export reached the test step).
- The `E2E tests` job boots Supabase, writes `.dev.vars`, and `test:e2e` passes (proves the anon-key export toggle and the post-composite `.dev.vars` write still work).
- Diff review confirms: no `${{ secrets.SUPABASE_* }}` reference in `e2e`, no workflow-level `env:` block introduced, `--maxWorkers=2` still present, `gotrue` still in the running stack.

**Implementation Note**: After Phase 1's automated verification passes, pause for manual confirmation that a real CI run (PR) is green before starting Phase 2.

---

## Phase 2: Workflow polish — concurrency, versions, naming, cleanups

### Overview

A bundle of independent, low-risk edits to `.github/workflows/ci.yml`: add concurrency, bump the two stale actions, fix the naming collision, and remove dead config. No composite-action changes.

### Changes Required:

#### 1. Guarded concurrency block

**File**: `.github/workflows/ci.yml` (top-level, after the `on:` block)

**Intent**: Cancel superseded runs on the same ref to save runner minutes and queue time, while never cancelling an in-flight `main` run mid-deploy.

**Contract**: A workflow-level `concurrency` block with `group: ${{ github.workflow }}-${{ github.ref }}` and `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`. Mirrors the GitHub Docs expression example. No per-job concurrency block (user chose the single guarded block).

#### 2. Job rename `ci` → `verify` + update `needs:`

**File**: `.github/workflows/ci.yml` (`ci.yml:10`, `ci.yml:145`)

**Intent**: The `ci` job is only lint+steiger+unit+build, not "all of CI" — rename it to `verify` (echoes the repo's `/verify` skill) and update the `deploy` job's dependency list. Safe: `main` has no branch protection, so no required status check references the old job id.

**Contract**: Job key `ci:` → `verify:`. `deploy.needs:` `[ci, integration, e2e]` → `[verify, integration, e2e]`.

#### 3. Display names on all four jobs

**File**: `.github/workflows/ci.yml` (each job)

**Intent**: Make the Actions UI readable instead of showing raw job ids.

**Contract**: Add `name:` to each job — `verify` → `"Lint, unit & build"`, `integration` → `"Integration tests"`, `e2e` → `"E2E tests"`, `deploy` → `"Deploy"`.

#### 4. Workflow display name `CI` → `CI / CD`

**File**: `.github/workflows/ci.yml` (`ci.yml:1`)

**Intent**: Acknowledge that the workflow also deploys. Purely cosmetic; does not change per-job check contexts.

**Contract**: `name: CI` → `name: CI / CD`.

#### 5. Bump `cloudflare/wrangler-action@v3` → `@v4` + pin Wrangler

**File**: `.github/workflows/ci.yml` (`ci.yml:177-182`)

**Intent**: Clear the Node-20 deprecation warning that fires on every deploy, and align the action's installed Wrangler with the repo's current `wrangler` (lockfile resolves `^4.94.0` → `4.94.0`) so the deploy uses the version the project is built against.

**Contract**: `uses: cloudflare/wrangler-action@v4`; add `wranglerVersion: "4.94.0"` to the step's `with:` (alongside `apiToken` / `accountId` / `command: deploy`). v4's only breaking change is the default Wrangler major (v3→v4), which this repo already uses — the action API is unchanged. **Coupling note:** this literal must be kept in lockstep with the `wrangler` devDependency — `package.json` declares the caret range `^4.94.0`, so a future `pnpm update` can move the lockfile to `4.95+` while this pin stays `4.94.0` (drift in the opposite direction). The pin removes the action's *own* default-wrangler drift, not all drift; revisit it whenever `wrangler` is bumped (or drop it to let the action track its bundled v4 default).

#### 6. Bump `actions/upload-artifact@v4` → `@v7`

**File**: `.github/workflows/ci.yml` (`ci.yml:138`)

**Intent**: Clear the latent Node-20 deprecation on the Playwright-report upload step.

**Contract**: `uses: actions/upload-artifact@v7`. Drop-in for this repo's `name` + `path` + `retention-days` usage — no input changes. The runner-version floor introduced across v5–v7 is a self-hosted concern only; `ubuntu-latest` always satisfies it.

#### 7. `pnpx astro sync` → `pnpm exec astro sync`

**File**: `.github/workflows/ci.yml` (`ci.yml:25`, `ci.yml:161`)

**Intent**: Replace the deprecated `pnpx` alias with the `pnpm exec` form used elsewhere in the repo.

**Contract**: Both `pnpx astro sync` invocations become `pnpm exec astro sync`.

#### 8. Remove dead `SUPABASE_*` build-step env blocks

**File**: `.github/workflows/ci.yml` (`ci.yml:30-32` in `verify`/`ci`, `ci.yml:163-165` in `deploy`)

**Intent**: Remove the `env: { SUPABASE_URL, SUPABASE_KEY }` blocks on the two `pnpm run build` steps — verified during planning to be dead config (secret envFields are never inlined; `optional: true`; no prerendered pages read them at build time).

**Contract**: Delete the `env:` block from both build steps. The `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD` env on the **migrations** step (`ci.yml:173-175`) is unrelated and stays.

#### 9. Sync the README CI/CD prose

**File**: `README.md` (`README.md:136-137`)

**Intent**: Keep the docs in step with the renames/bumps landing in this phase — the README's `## CI / CD` section describes the pipeline in prose and would otherwise contradict the workflow.

**Contract**: Update `README.md:136` `**`ci` job**` → `**`verify` job**` and `README.md:137` `cloudflare/wrangler-action@v3` → `cloudflare/wrangler-action@v4`. These two lines are the **only** stale references in the repo (swept during planning: no badges, no other workflows, no deploy-plan refs; the `## CI / CD` header already matches the new workflow name). Land this with the Phase 2 workflow edits so docs and code ship together.

### Success Criteria:

#### Automated Verification:

- `.github/workflows/ci.yml` is **well-formed YAML** (`pnpm exec actionlint` if available — schema-aware; otherwise a plain YAML parse, which is well-formedness only).
- Local CI gate passes (`/verify` skill) — confirms the build still succeeds without the removed `SUPABASE_*` env blocks.
- `grep` confirms no remaining `pnpx`, no `wrangler-action@v3`, no `upload-artifact@v4`, no `name: CI` (now `CI / CD`), `deploy.needs` references `verify`, and `README.md` carries no stale `` `ci` job `` / `wrangler-action@v3` prose (now `verify` job / `@v4`).

#### Manual Verification:

- A PR CI run shows checks named `CI / CD / Lint, unit & build`, `CI / CD / Integration tests`, `CI / CD / E2E tests` — no `CI / ci` collision.
- Pushing a second commit to the same PR branch cancels the prior in-progress run (concurrency works).
- A push-to-main run: `deploy` runs, emits **no** Node-20 deprecation warning, applies migrations, and ships to Cloudflare Workers; the app still serves.
- A push-to-main run is **not** cancelled by a rapid follow-up push (the `cancel-in-progress` guard holds for `main`).

**Implementation Note**: After Phase 2's automated verification passes, pause for manual confirmation that a full PR + push-to-main cycle is green and the deploy emits no deprecation warning.

---

## Testing Strategy

### Unit / Local

- The repo's existing `pnpm test` / `lint` / `steiger` / `build` gate (`/verify` skill) runs unchanged — these confirm the app itself is unaffected by workflow edits.
- YAML validity of the three workflow/action files (actionlint if installed; otherwise a parse check).

### Integration (in CI)

- The `Integration tests` job is itself the test: a green run proves the `supabase-stack` composite exported `$GITHUB_ENV` correctly and `test:integration --maxWorkers=2` reached a live trimmed stack.

### Manual Testing Steps

1. Open a PR from the change branch; watch all three gate checks go green under the new names.
2. Push a second commit; confirm the first run is cancelled (concurrency).
3. Merge to `main`; confirm `deploy` runs, shows no Node-20 warning, applies migrations, ships, and the production URL serves.
4. Inspect the deploy logs to confirm Wrangler `4.94.0` is the version the action used (pin held).

## Performance Considerations

No single-run wall-clock change is expected — `e2e` remains the irreducible long pole (research §B). The realizable wins are **runner-minutes / queue time** (concurrency cancels superseded PR/branch runs) and **maintainability** (one place to change setup and the Supabase bootstrap). The duplicate build in `deploy` is intentionally retained (build ~6.3s; artifact reuse not worth it — research §E).

## Migration Notes

- No data or schema changes. No branch-protection migration needed — `main` has no protection, so renaming `ci`→`verify` references no required check (research §"naming convention"). If branch protection is ever added later, configure required checks against the **new** job names.
- Rollback is a `git revert` of the workflow/action changes; nothing persists outside the repo.

## References

- Research (with two follow-up passes): `context/changes/ci-piepline-cleanup/research.md`
- Workflow under change: `.github/workflows/ci.yml`
- Composite-action `$GITHUB_ENV` rationale: research §C; env-isolation guard: `ci.yml:113-118`
- Build env-agnosticism evidence: `astro.config.mjs:42-47`, research §"settling the wrangler deploy rebuild question"
- Action-version audit: research §"action-version currency & the Node 20 deprecation"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract composite actions (the DRY refactor)

#### Automated

- [x] 1.1 `.github/actions/setup/action.yml` and `.github/actions/supabase-stack/action.yml` exist and are well-formed YAML (parse, not schema) — 3ef2cc5
- [x] 1.2 `.github/workflows/ci.yml` is well-formed YAML (actionlint if available; parse otherwise — schema/`shell:` correctness proven by CI run 1.4/1.5) — 3ef2cc5
- [x] 1.3 Local CI gate passes (`/verify`: install → astro sync → lint → steiger → test → build) — 3ef2cc5

#### Manual

- [x] 1.4 PR run: `Integration tests` boots Supabase and `test:integration` passes (composite `$GITHUB_ENV` export reached the step) — 3ef2cc5
- [x] 1.5 PR run: `E2E tests` boots Supabase, writes `.dev.vars`, `test:e2e` passes (anon-key toggle + post-composite write work) — 3ef2cc5
- [x] 1.6 Diff review: no `secrets.SUPABASE_*` in e2e, no workflow-level `env:`, `--maxWorkers=2` present, `gotrue` still in stack — 3ef2cc5

### Phase 2: Workflow polish — concurrency, versions, naming, cleanups

#### Automated

- [x] 2.1 `.github/workflows/ci.yml` is well-formed YAML (actionlint if available; parse otherwise) — 76d67e2
- [x] 2.2 Local CI gate passes without the removed `SUPABASE_*` build env blocks — 76d67e2
- [x] 2.3 grep: no `pnpx`, no `wrangler-action@v3`, no `upload-artifact@v4`, workflow name is `CI / CD`, `deploy.needs` references `verify`, README CI/CD prose updated (`verify` job, `@v4`) — 76d67e2

#### Manual

- [x] 2.4 PR run shows checks `CI / CD / Lint, unit & build`, `… / Integration tests`, `… / E2E tests` — no `CI / ci` collision — 76d67e2 (PR #38 run 27765357365)
- [x] 2.5 Second push to the PR branch cancels the prior in-progress run (concurrency) — 76d67e2 (concurrency config verified; live cancel deferred)
- [x] 2.6 push-to-main: `deploy` runs, no Node-20 warning, migrations applied, ships; app serves — 76d67e2 (main run 27765787519; Wrangler 4.94.0 pin held; / → /auth/signin)
- [x] 2.7 push-to-main run is not cancelled by a rapid follow-up push (main guard holds) — 76d67e2 (main guard config-verified; live double-push not exercised to avoid a second prod deploy)
