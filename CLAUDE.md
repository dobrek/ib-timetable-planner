# CLAUDE.md

## Project

`ib-schedule-planner` — interactive IB-school timetable planner. Full context in @context/foundation/prd.md and @context/foundation/tech-stack.md.

Stack: Astro 6 + React 19 on Cloudflare Workers (workerd), Supabase (Postgres) for persistence, Tailwind. Package manager: **pnpm 10.32.1**. Node: **22.14.0** (see `.node-version`).

## Commands

- `pnpm dev` — Astro dev server (workerd runtime)
- `pnpm build` — production build (CI gate)
- `pnpm lint` / `pnpm lint:fix` — ESLint flat config
- `pnpm format` — Prettier across the tree
- `pnpm exec astro sync` — regenerate Astro content/env types; run before lint if you change content collections or env vars

No test runner is configured yet. Do not invent `pnpm test`.

## Branch and CI

- CI runs: `pnpm install --frozen-lockfile` → `astro sync` → `pnpm lint` → `pnpm build`. No deploy, no tests. Use the `/verify` skill to mirror this locally.
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
- `src/lib/` — pure utilities and the constraint/validation core
- `supabase/` — local Supabase config and migrations
- `context/foundation/` — PRD, tech-stack, shape-notes; consumed by `/10x-*` skills, not by runtime code
- `data/` — reference CSV fixtures

## Pre-commit

`lefthook` runs `eslint --fix` on staged `.ts/.tsx/.astro` and `prettier --write` on `.json/.css/.md`. Do not bypass it with `--no-verify`.
