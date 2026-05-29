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

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill                                  | Use it when                                                                                                                                                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Change setup (lesson focus)**        |                                                                                                                                                                                                                                                                      |
| `/10x-new <change-id>`                 | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`.               |
| **Planning (lesson focus)**            |                                                                                                                                                                                                                                                                      |
| `/10x-plan <change-id>`                | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)**      |                                                                                                                                                                                                                                                                      |
| `/10x-plan-review <change-id>`         | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin.                                                                          |
| **Implementation (lesson focus)**      |                                                                                                                                                                                                                                                                      |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`.                                                                                                                          |
| **Lifecycle closure**                  |                                                                                                                                                                                                                                                                      |
| `/10x-archive <change-id>`             | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state.                                                                                                                                                             |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
