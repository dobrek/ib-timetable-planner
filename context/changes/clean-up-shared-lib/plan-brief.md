# Clean up & re-architect `shared/lib` — Plan Brief

> Full plan: `context/changes/clean-up-shared-lib/plan.md`
> Research: `context/changes/clean-up-shared-lib/research.md`

## What & Why

`shared/lib` sits at exactly the Steiger 15-module cap, blocking the F3 follow-up that wants `grid` + `slot-labels` moved from `config` → `lib`. The cap is a symptom: ~⅓ of `shared/lib` is data-access (`postgrest/`, `load-cohort-courses`) or app-shell config (`config-status.ts`) that accreted there before `shared/api` matured. We relocate those to the segments FSD says they belong, which simultaneously frees the slots, fixes the boundary, and de-poisons the Vitest-unsafe `lib` barrel — then fix 6 verified bugs, dedup pervasive boilerplate, and add unit coverage.

## Starting Point

`shared/lib` = 6 folders + 8 loose files + `index.ts` (15, at the strict `>15` warn threshold). The barrel re-exports `astro:*`-coupled modules, forcing "never import via the barrel" comments to keep tests runnable. `shared/api` already holds loose data-access readers (the destination pattern). Test coverage is 3 files; `config` has none. There is no `entities` layer, so pure cross-slice helpers legitimately live in `shared/lib`.

## Desired End State

`pnpm steiger` clean with `shared/lib` at **13** children (every loose util now a folder), `shared/config` holding only constants/enums/schemas, `shared/api` owning all PostgREST/Supabase data-access, and `config-status` living in `app/`. The `lib` barrel is Vitest-safe; the 6 bugs are fixed and test-locked; the `{data,error}`/`groupBy` duplication is replaced by shared combinators. `lint` / `test` / `build` green.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Bug fixes | All 6, dedicated phase | Modules are open anyway; tests lock each fix while phasing keeps the diff separable | Plan |
| Duplication dedup | Full sweep now | Realizes the "more declarative" research goal in one pass | Plan |
| `catalog-hash` placement | Split: reader → api, compute+types → lib | Pure hash fn sits in `lib`; reader joins `api` where data-access belongs | Plan |
| `config-status` placement | → `app/` | It's shell-specific env state with one importer (`BaseLayout`), not a reusable shared util | Plan |
| Barrel policy | Slim to Vitest-safe; deep-import `defineDomainAction` | Kills the astro-poison footgun and dual import paths | Plan |
| Coverage tooling | Tests only, no `@vitest/coverage-v8` | Keep scope tight; measure later | Plan |
| Module relocation mechanics | `git mv` + per-module repoint | Preserve history; keep each repoint a single path swap | Research |

## Scope

**In scope:** relocate `postgrest/`, `load-cohort-courses`, `assertNoQueryErrors`, `config-status`; regroup loose `lib` files into folders; slim the barrel; move `grid` + `slot-labels` `config → lib`; fix bugs #1–#6 + lower-severity polish; add `unwrapMany`/`groupByInto` and migrate all hand-rolled copies; add Tier-1/Tier-2 unit tests.

**Out of scope:** an `entities` layer; coverage tooling or a coverage CI gate; behavior changes beyond the listed fixes; moving `grid-presets.ts`; rewriting the constraint core.

## Architecture / Approach

`app → _pages → shared`, no `entities`; within `shared`, `lib → config` and `api → lib` edges are legal. Move transport (`postgrest`, the cohort reader, `assertNoQueryErrors`-on-`DomainError`) into `shared/api`; move the env-driven banner into `app/config`; regroup the rest of `lib` into named folders with a Vitest-safe barrel; then pull `grid`/`slot-labels` into `lib`. The `catalog-hash` split keeps the pure SHA fn + types in `lib` and the Supabase reader in `api`, joined by a legal `api → lib` type import.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Relocate transport + config-status | `postgrest`/reader → api, `config-status` → app; lib 15→11 | Mis-repointing one of 19 postgrest / 6 reader sites |
| 2. Regroup lib + slim barrel | Loose files → folders; Vitest-safe barrel; 8 `defineDomainAction` deep-imports | Barrel slim breaking an unnoticed barrel consumer |
| 3. F3: grid + slot-labels → lib | lib lands at 13; config pure; steiger clean | `lib/grid → config/grid-presets` edge tripping steiger |
| 4. Declarative dedup sweep | `unwrapMany`/`groupByInto` + migrate ~15 + ~5 copies | Regression in a migrated multi-row read |
| 5. Bug fixes + tests | Bugs #1–#6 fixed & test-locked; Tier-1/2 coverage | Bug #5/#6 fixes altering load/decoder semantics |

**Prerequisites:** clean `main`; local Supabase for the integration tests that cover the catalog-hash split.
**Estimated effort:** ~4–5 focused sessions (one per phase; Phase 1 is the largest repoint, Phase 5 the most net-new code).

## Open Risks & Assumptions

- Steiger may flag a new `app/config/` segment; fallback is `app/lib/config-status.ts` (noted in Phase 1).
- Bug #5/#6 fixes change `load-cohort-courses`/`unwrapRow` edge semantics — the integration tests must confirm parity.
- The full dedup sweep touches ~15 files outside `shared/`, the widest blast radius in the change; Phase 4 isolates it.

## Success Criteria (Summary)

- `pnpm steiger && pnpm lint && pnpm test && pnpm build` all green; `shared/lib` at 13 children with no `shared-lib-grouping` warning.
- F3 unblocked: `grid` + `slot-labels` live in `lib`; `config` holds only constants/enums/schemas; `shared/api` owns data-access.
- All 6 bugs fixed and locked by tests; no "never import via barrel" comments remain.
