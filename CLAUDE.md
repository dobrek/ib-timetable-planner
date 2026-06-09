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

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill                          | Use it when                                                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code review (lesson focus)** |                                                                                                                                                                                                                                         |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome**   |                                                                                                                                                                                                                                         |
| `/10x-lesson`                  | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note.                                                                             |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
