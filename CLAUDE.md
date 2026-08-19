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
- **Cloudflare Containers went GA 2026-04** — post-cutoff for most models. Never write `wrangler.jsonc` container bindings, lifecycle config (sleepAfter/SIGTERM), rollout fields, or CF API token scopes from memory; fetch current Cloudflare docs first. The platform **does not guarantee that any container instance will run for any set period of time**, so job-aware lifecycle is a correctness requirement (PRD FR-311), owned by S-304. (The older citation for this, containers#162, was closed 2026-05-12 — do not re-cite it as a live hazard.) S-302 ships `sleepAfter: 30m` as a stopgap; `rollout_active_grace_period` does **not** protect an in-flight solve, because dispatch is 202-and-detach so nothing looks "active" — hence README's rule against merging to `main` mid-solve.
- **`src/worker.ts` is the Worker entry, and it is project-owned.** It re-exports `@astrojs/cloudflare/handler`'s `handle` plus `SolverContainer`, because a container must be fronted by a Durable Object class exported **by name** from the entry module and the adapter's own entrypoint emits a default export only. Do not repoint `main` back at the adapter: the build stays green and the container silently stops being deployable.
- **Never run `wrangler types`.** Its output shadows DOM globals and breaks React islands (`ExportMenu.tsx`). Cloudflare runtime types are hand-written in `src/cloudflare-env.d.ts` — extend that file instead, and re-run `pnpm check` to confirm 0 errors.
- React islands compile through the **React Compiler** — keep render-purity discipline; don't hand-add `useMemo`/`useCallback` where the compiler already memoizes.

## Project Structure

FSD layers under `src/`: `app/` (shell, layouts, styles), `_pages/<slice>/` (page slices, underscored to avoid clashing with Astro routing), `widgets/` (composed read-only UI shared across page slices — `timetable-board/`), `entities/` (business-domain slices — `timetable/` holds the pure read-side scheduling core), `shared/` (`api`, `lib`, `config`, `ui`). Each slice splits into `api`, `lib`, `model`, `ui` segments. `src/pages/` is Astro file-routing (+ `src/pages/api/`); `src/actions/` holds Astro Actions. `supabase/` migrations + seed, `context/foundation/` PRD/tech-stack/conventions.

## Commands

- `pnpm dev` — dev server (workerd); `pnpm build` — production build (CI gate).
- `pnpm lint` / `pnpm steiger` — ESLint flat config + FSD structure check.
- `pnpm test` — Vitest unit suite (`pnpm test:watch` to iterate); `pnpm test:integration` — needs local Supabase running.
- `pnpm env:local` / `pnpm env:prod` / `pnpm env:prod-solver` — swap Supabase target (writes `.env.local` + `.dev.vars`). **Switching a profile needs a rebuild before `pnpm preview`** — `.dev.vars` is snapshotted into `dist/server/` at build time.
- Run the `/verify` skill to mirror the full CI gate locally.

## Solver package (`services/solver/`)

- Python ≥3.13 (`.python-version` pins the interpreter), managed by **uv** (dedicated venv — ortools pins protobuf/numpy tightly; never share a venv). Run tooling via `uv run <cmd>` from the package dir: `uv run pytest`, `uv run ruff check`; vulnerability scan with `uv audit` (uv-native, lockfile-based — not pip-audit).
- **All solver code stays fully type-annotated.** `mypy --strict` is the enforcement gate over `src/` **and** `tests/` (config-driven — `uv run mypy`, no args), and it runs in the CI solver lane. No new `Any` escapes; a `# type: ignore` needs an inline reason.
- **`contracts/` must be COPYed into the container image**, in its repo-relative position: `app.py` anchors the schema at `Path(__file__).resolve().parents[4]`, so the image keeps `/app/services/solver/src/…` beside `/app/contracts/` and the Docker build context is the **repo root**. This fails OPEN — a wrong layout leaves `/health` green while every solve 500s — which is why `mise run solver:image:smoke` POSTs a real golden `SolveRequest` and asserts 202 rather than probing `/health`.
- **The wire contract is frozen, and `contracts/generation-wire.schema.json` IS the contract** — `schema.py` and the TS wire modules (`types.ts`, `wire.ts`) are both projections of it, owned by neither side. Never change one side alone: golden fixtures in `contracts/fixtures/` are byte-gated by BOTH suites (`bench/contract-parity.test.ts`, `services/solver/tests/test_contract.py`), and `formatVersion` on `SolveRequest` gates incompatibility. `contracts/README.md` is normative for the canonical JSON form (sorted keys, declared array sorts, no nulls, integers only in hashed payloads) and the bump policy; the canonicalizers are `src/entities/timetable/model/generation/wire.ts` and `cpsat_engine/wire.py`. Regenerate goldens with `pnpm experiment:goldens` — bilaterally, both suites green in the same commit. `contracts/` is prettier-ignored on purpose (the goldens are canonical bytes).
- **CP-SAT changes are gated by tests, not review-reading.** Any change to modeling/objective code must keep the objective-parity suite at exact 10/10 and pass the oracle on golden fixtures. Do not trust generated or-tools code that hasn't run — CP-SAT idiom is easy to confabulate.
- Test at the wrapper level (HTTP surface), not just the core — the untested `cli.py` was the POC's recorded lesson.
- Cross-ecosystem tasks run through **mise**; pnpm scripts remain the JS-side canon. Never add solver steps to `package.json`. `mise.toml` is the **catalog**, not the code: every task body lives in `scripts/solver/*.sh` (POSIX sh, `set -eu` as the first non-comment line, self-locating to the repo root, sourcing `common.sh`), shellcheck-gated by `mise run solver:check` and CI's `verify` job. A new solver task means a new script plus a one-line `run`.

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
