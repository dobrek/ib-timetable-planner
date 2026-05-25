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

Env profiles live in `.envs/` and are swapped with `pnpm env:local` (default dev loop) / `pnpm env:prod` (smoke against hosted Supabase). Both scripts write `.env.local` (for `astro dev`) and `.dev.vars` (for `wrangler dev`).

No test runner is configured yet. Do not invent `pnpm test`.

## CLIs in use

For operations beyond the `pnpm` scripts above, reach for these CLIs (run via `pnpm exec <cli>` where applicable). See `README.md` for the canonical command list; use `--help` for anything not documented there.

- `wrangler` — Cloudflare Workers: deploy, secrets, deployments list, rollback, tail.
- `supabase` — local stack (`start`/`stop`) and hosted project link/migrations.
- `gh` — GitHub operations: PRs, issues, CI run status.

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

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 1

Move from sprint-zero setup to project orchestration with the **roadmap chain**:

```
(Module 1 foundation docs) -> /10x-roadmap -> backlog-ready roadmap items
```

`/10x-roadmap` is the lesson focus. `/10x-new` is intentionally introduced in Module 2, Lesson 2, when a selected roadmap item becomes an implementation change folder.

### Task Router - Where to start

| Skill                                                                                                                   | Use it when                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Roadmap (lesson focus)**                                                                                              |                                                                                                                                                                                                                                                                                                                                                                                            |
| `/10x-roadmap`                                                                                                          | You have `context/foundation/prd.md` and a scaffolded project baseline, and you need a vertical-first MVP roadmap. The skill reads the PRD, inspects the code baseline, uses available foundation docs such as `tech-stack.md`, `infrastructure.md`, and `deploy-plan.md`, then writes `context/foundation/roadmap.md`. Use it BEFORE creating per-change folders or implementation plans. |
| **Re-run upstream if needed**                                                                                           |                                                                                                                                                                                                                                                                                                                                                                                            |
| `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-infra-research` | Bundled from Module 1 so foundation contracts can be fixed before roadmap sequencing. If roadmap generation exposes a PRD gap, repair the PRD before pretending the backlog is ready.                                                                                                                                                                                                      |

### How the chain hands off

- `/10x-roadmap` bridges product and implementation. It does not choose frameworks, design schemas, or write a per-change implementation plan.
- The output is `context/foundation/roadmap.md`: ordered milestones, vertical slices, bounded foundations, dependencies, unknowns, risk, and backlog handoff fields.
- Roadmap items should receive stable human-readable identifiers in backlog tools. The actual `context/changes/<change-id>/` folder is created in Lesson 2 with `/10x-new`.

### Roadmap boundaries

- Default to vertical slices: user-visible outcomes that cross UI, data, business logic, and integrations.
- Horizontal work is allowed only as a bounded enabler that names the downstream vertical milestone it unlocks.
- Avoid orphan horizontal work such as "build the whole database", "build all API endpoints", or "design the whole UI" before the first user-visible flow.
- Roadmap is not a calendar estimate. Do not invent dates, story points, or sprint velocity unless the user explicitly asks for a separate planning artifact.

### Foundation paths used by this lesson

- `context/foundation/prd.md` - input
- `context/foundation/tech-stack.md` - optional input
- `context/foundation/infrastructure.md` - optional input
- `context/deployment/deploy-plan.md` - optional input
- `context/foundation/roadmap.md` - output
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
