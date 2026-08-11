# Repository Guidelines

`ib-timetable-planner` — an interactive IB-school timetable planner. Astro 7 + React 19 islands on Cloudflare Workers (workerd), Supabase (Postgres) for persistence, Tailwind v4, TypeScript v6. Package manager **pnpm 11.9.0**, Node **24.15.0** (`.node-version`). See @README.md for depth.

## Hard rules

- **Workers runtime, both dev and prod.** No Node-only APIs (`fs`, `child_process`, `net`, native modules). Confirm `pnpm build` stays clean.
- **FSD layout is steiger-enforced.** `pnpm steiger` is a CI gate (`--fail-on-warnings`). Respect layer import direction: `app` → `_pages` → `widgets` → `entities` → `shared`; never import upward. Config: @steiger.config.ts.
- **Supabase is the runtime source of truth** for catalog, students, teachers, placements. `data/*.csv` are reference fixtures only — never read at runtime.
- **Placement/constraint validation has a <200ms budget** per drag-drop. The pure two-cohort (dp1/dp2) constraint core lives in `src/entities/timetable/` (shared by the board and the read-only perspective views) — read it before touching constraint logic; don't reinvent it. Editing orchestration (drag state, optimistic placements, hooks) stays in `src/_pages/plan-detail/model/`.
- **Auth is deny-by-default** in `src/middleware.ts`. Don't widen the allowlist without reason.
- Don't bypass `lefthook` with `--no-verify`.

## Post-cutoff platform rules

- **Astro is v7** (not v6) with Vite 8 (Rolldown). Before using Astro/Vite config APIs, verify against current docs — several v6-era idioms changed. The `ssrPrebundleDeps()` workaround in `astro.config.mjs` is deliberate; read its comment before touching dev-SSR or optimizeDeps behavior.
- **Cloudflare Containers went GA 2026-04** — post-cutoff for most models. Never write `wrangler.jsonc` container bindings, lifecycle config (sleepAfter/SIGTERM), or CF API token scopes from memory; fetch current Cloudflare docs first. Known platform issue: containers may sleep mid-job (containers#162) — job-aware lifecycle is a correctness requirement (PRD FR-311).
- React islands compile through the **React Compiler** — keep render-purity discipline; don't hand-add `useMemo`/`useCallback` where the compiler already memoizes.

## Project Structure

FSD layers under `src/`: `app/` (shell, layouts, styles), `_pages/<slice>/` (page slices, underscored to avoid clashing with Astro routing), `widgets/` (composed read-only UI shared across page slices — `timetable-board/`), `entities/` (business-domain slices — `timetable/` holds the pure read-side scheduling core), `shared/` (`api`, `lib`, `config`, `ui`). Each slice splits into `api`, `lib`, `model`, `ui` segments. `src/pages/` is Astro file-routing (+ `src/pages/api/`); `src/actions/` holds Astro Actions. `supabase/` migrations + seed, `context/foundation/` PRD/tech-stack/conventions.

## Commands

- `pnpm dev` — dev server (workerd); `pnpm build` — production build (CI gate).
- `pnpm lint` / `pnpm steiger` — ESLint flat config + FSD structure check.
- `pnpm test` — Vitest unit suite (`pnpm test:watch` to iterate); `pnpm test:integration` — needs local Supabase running.
- `pnpm env:local` / `pnpm env:prod` — swap Supabase target (writes `.env.local` + `.dev.vars`).
- Run the `/verify` skill to mirror the full CI gate locally.

## Solver package (`services/solver/`)

- Python ≥3.13 (`.python-version` pins the interpreter), managed by **uv** (dedicated venv — ortools pins protobuf/numpy tightly; never share a venv). Run tooling via `uv run <cmd>` from the package dir: `uv run pytest`, `uv run ruff check`; vulnerability scan with `uv audit` (uv-native, lockfile-based — not pip-audit).
- **All solver code stays fully type-annotated.** `mypy --strict` is the enforcement gate; it ships with the PRD FR-315 solver CI lane — if you touch solver tooling before then, wire it up rather than skipping it.
- **The wire contract is frozen, and `contracts/generation-wire.schema.json` IS the contract** — `schema.py` and the TS `types.ts` are both projections of it, owned by neither side. Never change one side alone: golden fixtures in `contracts/fixtures/` are byte-gated by BOTH suites (`bench/contract-parity.test.ts`, `services/solver/tests/test_contract.py`), and `formatVersion` on `SolveRequest` gates incompatibility. `contracts/README.md` is normative for the canonical JSON form (sorted keys, declared array sorts, no nulls, integers only in hashed payloads) and the bump policy; the canonicalizers are `src/entities/timetable/model/generation/wire.ts` and `cpsat_engine/wire.py`. Regenerate goldens with `pnpm experiment:goldens` — bilaterally, both suites green in the same commit. `contracts/` is prettier-ignored on purpose (the goldens are canonical bytes).
- **CP-SAT changes are gated by tests, not review-reading.** Any change to modeling/objective code must keep the objective-parity suite at exact 10/10 and pass the oracle on golden fixtures. Do not trust generated or-tools code that hasn't run — CP-SAT idiom is easy to confabulate.
- Test at the wrapper level (HTTP surface), not just the core — the untested `cli.py` was the POC's recorded lesson.
- Cross-ecosystem tasks run through **mise**; pnpm scripts remain the JS-side canon. Never add solver steps to `package.json`.

## Coding Style & Naming

- Use `type` for data shapes; reserve `interface` for behavioral/class contracts. Each function does one thing; never mutate parameters.
- Exported function first, private helpers below (newspaper order). `.tsx` only for JSX; hooks/helpers stay `.ts`.
- Pure domain logic (guards, transitions) goes in `model/`; hooks orchestrate it; Astro Actions stay thin. See @context/foundation/ui-conventions.md.

## Testing

Vitest, tests co-located as `*.test.ts` next to source under each slice's segment. Integration tests use `*.integration.test.ts` (excluded from `pnpm test`, run via `pnpm test:integration`); they build state through the builders in `src/test/factories/` and clean up via `teardown`, rather than asserting against raw seed rows.

## Commit & PR

Commits: lowercase type + optional scope, imperative, no period — `feat(app-shell): …`, `fix(env): …`, `refactor: …`. PRs squash-merge onto `main` with a `(#NN)` suffix. CI must pass: install → `astro sync` → lint → steiger → test → build.

## CLIs in use

For operations beyond the `pnpm` scripts above, reach for these CLIs (run via `pnpm exec <cli>` where applicable). See `README.md` for the canonical command list; use `--help` for anything not documented there.

- `wrangler` — Cloudflare Workers: deploy, secrets, deployments list, rollback, tail.
- `supabase` — local stack (`start`/`stop`) and hosted project link/migrations.
- `gh` — GitHub operations: PRs, issues, CI run status.
- `playwright-cli` - Playwright Cli for manual UI verification, see the playwright-cli skill.
