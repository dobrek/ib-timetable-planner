# CLAUDE.md

## Project

`ib-timetable-planner` — interactive IB-school timetable planner. Full context in `context/foundation/prd.md` and `context/foundation/tech-stack.md`.

Stack: Astro 6 + React 19 on Cloudflare Workers (workerd), Supabase (Postgres) for persistence, Tailwind. Package manager: **pnpm 10.32.1**. Node: **24.15.0** (see `.node-version`).

## Commands

- `pnpm dev` — Astro dev server (workerd runtime)
- `pnpm build` — production build (CI gate)
- `pnpm lint` / `pnpm lint:fix` — ESLint flat config
- `pnpm format` — Prettier across the tree
- `pnpm exec astro sync` — regenerate Astro content/env types; run before lint if you change content collections or env vars
- `pnpm test` — Vitest unit suite (CI gate; pure, no DB required)
- `pnpm test:watch` — Vitest in watch mode
- `pnpm test:integration` — integration tests (requires local Supabase stack running)

Env profiles live in `.envs/` and are swapped with `pnpm env:local` (default dev loop) / `pnpm env:prod` (smoke against hosted Supabase). Both scripts write `.env.local` (for `astro dev`) and `.dev.vars` (for `wrangler dev`).

## CLIs in use

For operations beyond the `pnpm` scripts above, reach for these CLIs (run via `pnpm exec <cli>` where applicable). See `README.md` for the canonical command list; use `--help` for anything not documented there.

- `wrangler` — Cloudflare Workers: deploy, secrets, deployments list, rollback, tail.
- `supabase` — local stack (`start`/`stop`) and hosted project link/migrations.
- `gh` — GitHub operations: PRs, issues, CI run status.

## Branch and CI

- CI runs: `pnpm install --frozen-lockfile` → `astro sync` → `pnpm lint` → `pnpm steiger` → `pnpm test` → `pnpm build`. Use the `/verify` skill to mirror this locally.
- Commit style (from history): `chore: …`, `feat: …`, `fix: …` — lowercase scope, imperative subject, no period.

## Runtime caveats

Code runs on **Cloudflare Workers (workerd)** in both dev and prod. Do not use Node-only APIs (`fs`, `child_process`, `net`, native modules). Choose edge-compatible libraries.

## Domain

- The validator's hard problem is the **two-cohort (Year 12 / Year 13) cross-cohort constraint model**. Don't reinvent it — read the PRD's placement-validation section and any existing solver under `src/lib/` before adding constraint logic.
- Placement validation has a **<200ms budget** per drag-drop interaction.
- **Supabase is the runtime source of truth** for catalog, students, teachers, and placements.
- `/data/*.csv` are **reference fixtures** — canonical sample inputs for seeding and tests. They are not read at runtime.

## Layout

- `src/pages/` — Astro routes including `api/`
- `src/components/` — React + Astro components
- `src/layouts/` — Astro page layouts
- `src/lib/` — pure utilities, Supabase client, and the constraint/validation core
- `src/middleware.ts` — route protection (auth redirects)
- `supabase/` — local Supabase config and migrations
- `.envs/` — environment profiles (`local.vars`, `prod.vars`); see Commands
- `wrangler.jsonc` — Cloudflare Workers config
- `context/foundation/` — PRD, tech-stack, infrastructure; metadata, not runtime code
- `data/` — reference CSV fixtures

## Pre-commit

`lefthook` runs `eslint --fix` on staged `.ts/.tsx/.astro` and `prettier --write` on `.json/.css/.md`. Do not bypass it with `--no-verify`.
