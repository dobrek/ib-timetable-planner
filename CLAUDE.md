# Repository Guidelines

`ib-timetable-planner` — an interactive IB-school timetable planner. Astro 6 + React 19 islands on Cloudflare Workers (workerd), Supabase (Postgres) for persistence, Tailwind v4, TypeScript v6. Package manager **pnpm 11.9.0**, Node **24.15.0** (`.node-version`). See @README.md for depth.

## Hard rules

- **Workers runtime, both dev and prod.** No Node-only APIs (`fs`, `child_process`, `net`, native modules). Confirm `pnpm build` stays clean.
- **FSD layout is steiger-enforced.** `pnpm steiger` is a CI gate (`--fail-on-warnings`). Respect layer import direction: `app` → `_pages` → `widgets` → `entities` → `shared`; never import upward. Config: @steiger.config.ts.
- **Supabase is the runtime source of truth** for catalog, students, teachers, placements. `data/*.csv` are reference fixtures only — never read at runtime.
- **Placement/constraint validation has a <200ms budget** per drag-drop. The pure two-cohort (dp1/dp2) constraint core lives in `src/entities/timetable/` (shared by the board and the read-only perspective views) — read it before touching constraint logic; don't reinvent it. Editing orchestration (drag state, optimistic placements, hooks) stays in `src/_pages/plan-detail/model/`.
- **Auth is deny-by-default** in `src/middleware.ts`. Don't widen the allowlist without reason.
- Don't bypass `lefthook` with `--no-verify`.

## Project Structure

FSD layers under `src/`: `app/` (shell, layouts, styles), `_pages/<slice>/` (page slices, underscored to avoid clashing with Astro routing), `widgets/` (composed read-only UI shared across page slices — `timetable-board/`), `entities/` (business-domain slices — `timetable/` holds the pure read-side scheduling core), `shared/` (`api`, `lib`, `config`, `ui`). Each slice splits into `api`, `lib`, `model`, `ui` segments. `src/pages/` is Astro file-routing (+ `src/pages/api/`); `src/actions/` holds Astro Actions. `supabase/` migrations + seed, `context/foundation/` PRD/tech-stack/conventions.

## Commands

- `pnpm dev` — dev server (workerd); `pnpm build` — production build (CI gate).
- `pnpm lint` / `pnpm steiger` — ESLint flat config + FSD structure check.
- `pnpm test` — Vitest unit suite (`pnpm test:watch` to iterate); `pnpm test:integration` — needs local Supabase running.
- `pnpm env:local` / `pnpm env:prod` — swap Supabase target (writes `.env.local` + `.dev.vars`).
- Run the `/verify` skill to mirror the full CI gate locally.

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
