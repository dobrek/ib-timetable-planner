# Test-Data, Isolation & CI Infrastructure — Plan Brief

> Full plan: `context/changes/data-for-e2e-and-integration-tests/plan.md`
> Research: `context/changes/data-for-e2e-and-integration-tests/research.md`

## What & Why

Integration tests pass today only by **silently skipping** in CI, and locally they
couple to the mutable dev seed (look up `"Seed Plan A/B"` by name), so a seed change or
parallel run breaks them. This change makes them **run in CI** against a real Supabase
stack, **isolated** (each test owns its own plan), and **seeded with advanced input +
computed output** via typed factories — plus closes the one untested action boundary.

## Starting Point

8 `*.integration.test.ts` suites hit the local dev Supabase with the `service_role`
key; 3 already own a fresh plan (resilient), 6 are coupled to the named seed (fragile).
CI runs `pnpm test` (unit only) — no Supabase. The seed (`gen-seed.mjs`) emits 7
catalog tables and **zero** output (placements/bundles/availability/groupings). The
action wrapper `defineDomainAction` (the auth-guard + error-translation chokepoint) is
untested.

## Desired End State

`pnpm test:integration` executes and passes in CI against a trimmed, freshly-booted
Supabase stack. Every suite owns and tears down its data; **no suite reads
`"Seed Plan A/B"` by name** (grep-guarded). Typed factories seed the real CSV catalog
per-plan and produce output by driving the real domain functions. The action wrapper
has unit coverage. Playwright e2e (and its auth-user factory) is left as a clean
follow-up the harness here unblocks.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| CI database | `supabase/setup-cli@v2` → trimmed `supabase start` | Official, free, self-hosted in the runner; auth boots regardless so one stack mode | Research |
| Stack trim | `-x studio,imgproxy,inbucket,realtime,storage,vector,analytics,edge-runtime,functions,meta` | Keep db+rest+kong(+auth); cut cold-start; measure before caching | Research |
| Isolation | Plan-rooted ownership + cascade-delete | Smallest delta; the bare-plan suites already prove it; parallel-safe | Research |
| Seeding | `seed.sql` base + typed factories; factory seeds real CSV catalog | Output is computed via real domain fns; CSV oracle for adapter-parity/load must match | Plan |
| Catalog source | Extract `gen-seed.mjs` transcode into a shared module | One source of truth; byte-identical seed guard | Plan |
| Migration scope | All six seed-coupled suites | Fully removes dev-seed coupling — the stated goal | Plan |
| Action tests | Unit-test the wrapper via an `astro:actions` stub | The untested logic is DB-independent; persistence covered by domain suites | Plan |
| Auth users | **Deferred** — `createAuthedUser`/`signInAs` ship with the e2e/RLS follow-up, not here | No suite consumes them in this change; current `service_role` suites self-provision without auth users; the `@supabase/ssr` cookie-auth shape belongs with the consumer | Plan |
| Resilience proof | Green CI run + no-shared-reads grep guard | Concrete and automated; no second stack boot | Plan |
| CI gating | Fail (not skip) when `CI=true` && env missing | Kills the silent-zero-coverage trap; local skip preserved | Research |
| Out of scope | Playwright e2e | Deferred to a focused follow-up change | Plan |

## Scope

**In scope:** CI integration job + fail-gating; plan-rooted isolation; factory harness
+ transcode extraction; migrate all six seed-coupled suites; no-shared-reads guard;
action-wrapper unit tests.

**Out of scope:** Playwright/e2e; RLS / cross-author ownership *tests* **and** the
`createAuthedUser`/`signInAs` auth-user factory (both deferred to the test-plan Phase 3
follow-up that consumes them); template-clone per-worker isolation; perturbed-seed CI
lane; hosted Supabase branching; HTTP-route action integration tests; dp2 board work.

## Architecture / Approach

A new parallel CI `integration` job boots the trimmed stack (`supabase start -x …`),
exports its minted env via `supabase status -o env`, and runs `pnpm test:integration`;
`deploy` gates on `[ci, integration]`. A shared `catalog-transcode.mjs` (extracted from
`gen-seed.mjs`) feeds both the seed generator and a new `src/test/factories/` harness
(`createPlan` → `seedPlanCatalog` → input/output builders → `teardown`). Every
suite owns a plan; output is produced through `insertPlacement` / `insertOverride` /
`computeAndPersistGroupings`, and `teardown` cascade-removes the owned plans. The action
wrapper is unit-tested behind a small `astro:actions` stub. (The auth-user factory and
its `auth`-schema teardown ship with the e2e/RLS follow-up, not here.)

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. CI stack + fail-gating | Integration suite runs green in CI | `supabase start` cold-start time on the runner |
| 2. Factory harness + transcode | Reusable factories; shared CSV transcode | Refactor must keep `seed.sql` byte-identical |
| 3. Migrate six suites | Resilience — no shared-seed reads | adapter-parity/load oracles must match the seeded CSV catalog |
| 4. Action-boundary units | Wrapper coverage (Risk #3) | `astro:actions` stub fidelity under Vitest |

**Prerequisites:** local Supabase stack + `.env.test.local` for local runs; CI needs
no new secrets (the local stack mints its own keys).
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- Cold `supabase start` time in CI is unmeasured; the plan defers caching until a real
  number justifies it.
- The trimmed exclusion set is assumed to still serve `supabase-js` (db+rest+kong+auth);
  Phase 1 verifies.
- Factory catalog seeding must reproduce the CSV-derived catalog faithfully or
  `adapter-parity`/`load-1` oracles fail — mitigated by reusing the extracted transcode.

## Success Criteria (Summary)

- Integration tests **run and pass in CI** (no longer skipped).
- A dev-seed change cannot break a run; no suite reads `"Seed Plan A/B"` by name.
- Factories produce advanced input + computed output, reusable by the future e2e change.
- The action wrapper boundary is unit-covered.
