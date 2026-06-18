# CI Pipeline Cleanup — Plan Brief

> Full plan: `context/changes/ci-piepline-cleanup/plan.md`
> Research: `context/changes/ci-piepline-cleanup/research.md`

## What & Why

The CI pipeline has every stage we want and is already well-architected for speed — the win here is **structure, not wall-clock**. We remove repetition (a setup preamble duplicated ×4, a Supabase bootstrap ×2), cut wasted runner minutes (cancel superseded runs), clear the Node-20 deprecation warning, and fix a confusing `CI / ci` check-name collision — all without changing what CI verifies or deploys.

## Starting Point

`.github/workflows/ci.yml` has 4 jobs: `ci` ∥ `integration` ∥ `e2e` run in parallel, then `deploy` (push-to-main, gated on all three). The setup preamble repeats in all four jobs; the trimmed-Supabase bootstrap repeats in `integration` and `e2e`; `astro sync`+build repeats in `ci` and `deploy`. Two pinned actions (`wrangler-action@v3`, `upload-artifact@v4`) are stranded on the deprecated `node20`.

## Desired End State

The workflow reads cleanly: each job's preamble is one `uses: ./.github/actions/setup` line, the two Supabase jobs share `uses: ./.github/actions/supabase-stack`, and a guarded `concurrency` block cancels superseded non-`main` runs. In the Actions UI it shows as **`CI / CD`** with readable checks (`Lint, unit & build`, `Integration tests`, `E2E tests`, `Deploy`) and no `CI / ci` collision. Deploy emits no Node-20 warning and still ships only after all three gates pass.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| DRY mechanism | Two composite actions | Composite runs in the caller job's context, so `$GITHUB_ENV` hands off — a reusable workflow wouldn't | Research |
| Merge integration + e2e? | Keep separate | Preserve two independent pass/fail signals; gate wall-clock is unchanged either way | Plan |
| Concurrency style | Single guarded block | `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` protects in-flight deploys with one block | Plan |
| Wrangler version | Bump `@v4` + pin `4.94.0` | Matches the repo's `wrangler@4.94.0` devDependency so CI and local never drift | Plan |
| Naming | Rename `ci`→`verify`, names on all jobs, workflow→`CI / CD` | Removes the misleading `CI / ci` collision; safe (no branch protection) | Plan |
| Dead build env blocks | Remove (verified) | `SUPABASE_*` are secret/optional envFields, never inlined, no prerender reads them at build | Research + Plan |
| Build-artifact reuse `ci`→`deploy` | Skip | Build is ~6.3s; artifact round-trip costs as much | Research |
| Playwright Docker container | Skip | A `container:` job can't reach the host-Docker Supabase on `127.0.0.1` (documented blocker) | Research |

## Scope

**In scope:** two composite actions; rewire all 4 jobs; `concurrency` block; bump `wrangler-action@v4` (+ pin) and `upload-artifact@v7`; rename `ci`→`verify` + display names + workflow→`CI / CD`; `pnpx`→`pnpm exec`; remove dead `SUPABASE_*` build env blocks.

**Out of scope:** merging integration+e2e; build-artifact reuse; Playwright container/browser caching; Supabase image caching; reusable workflows; splitting `build` or `deploy` into separate jobs/files; changing the `-x` trim, `sed` strip, `--maxWorkers=2`, or `load-test-env` gate.

## Architecture / Approach

Two net-new files under `.github/actions/` — `setup/action.yml` (pnpm + node + install) and `supabase-stack/action.yml` (setup-cli + gen-seed + trimmed `start` + `$GITHUB_ENV` export, with an `export-anon-key` input for the e2e-only anon key). Each job keeps `checkout` first (local actions need the repo checked out), then composes. The e2e-specific `.dev.vars` write and `--maxWorkers=2` stay in their jobs. Phase 2 layers in workflow-level metadata and version bumps once the refactor is proven green.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract composite actions | Two composites + all 4 jobs rewired; duplication gone | Breaking the `$GITHUB_ENV` hand-off or the e2e↔deploy env isolation — mitigated by shipping this alone and proving a green run |
| 2. Workflow polish | concurrency, version bumps, naming fix, dead-config removal | Version-bump breaking changes (both verified minor for this repo) |

**Prerequisites:** none — `.github/actions/` is net-new; verification of the dead build env blocks is already done.
**Estimated effort:** ~1 session across 2 phases, each gated on one CI run.

## Open Risks & Assumptions

- Composite-action `$GITHUB_ENV` writes persist to later steps in the same job (well-documented; the load-bearing assumption behind the Supabase composite). Verified by a green `Integration tests` / `E2E tests` run.
- Every `run:` in a composite needs an explicit `shell: bash` — easy to forget; would fail fast if missed.
- The two action version bumps are drop-in for this repo's usage (research-confirmed), but the real proof is a clean push-to-main deploy.

## Success Criteria (Summary)

- A PR run is fully green with the new check names and no `CI / ci` collision; a second push cancels the first run.
- A push-to-main deploy runs with **no Node-20 deprecation warning**, applies migrations, and ships — still gated on all three checks.
- The workflow file is materially shorter, with setup and Supabase bootstrap each defined in exactly one place.
