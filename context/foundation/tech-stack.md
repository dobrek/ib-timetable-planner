---
starter_id: 10x-astro-starter
package_manager: pnpm
project_name: ib-timetable-planner
hints:
  language_family: js, python
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: true
---

> Updated 2026-07-16 for the post-POC CP-SAT solver-service change
> (`context/foundation/prd.md`), aligned with the two-component
> `context/foundation/stack-assessment.md` of the same date. Originally the
> greenfield hand-off that bootstrapped the repo from 10x-astro-starter; the
> frontmatter keeps that record, with `deployment_target` (Workers, not
> Pages — what `wrangler.jsonc` actually ships) and `has_background_jobs`
> (now true) corrected to current truth.

## Why this stack

Solo author building IB Schedule Planner after-hours. The stack is now
**two components**: the TypeScript app at the repo root and the Python
CP-SAT solver package at `poc/cp-sat/`, promoting to `services/solver/` in
the current change.

**App (repo root, unchanged).** Astro 7 (server-output, Vite 8/Rolldown) with
React 19 islands compiled through the React Compiler; TypeScript 6 strict with
Zod 4 at runtime boundaries; Tailwind v4; Supabase (Postgres + email/password
auth, Frankfurt); Cloudflare Workers (workerd) via `@astrojs/cloudflare`;
pnpm 11.9.0; Vitest 4 (+ Playwright E2E); FSD layout machine-enforced by
steiger. The interactive core — drag-and-drop grid with sub-200 ms client-side
validation — stays in-process and untouched by this change.

**Solver service (new component).** Python ≥3.12 managed by uv (hatchling,
src-layout, dedicated venv — ortools pins protobuf/numpy tightly); or-tools
CP-SAT as the modeling core; an HTTP wrapper (FastAPI per FR-310) is net-new;
pytest 8 + ruff, with mypy `--strict` joining per the stack assessment's one
failed gate. Deploys as a **Cloudflare Container** (GA 2026-04) attached to
the existing Worker: standard-4 instance, EEUR pinned next to Supabase
Frankfurt, linux/amd64 `python:3.12-slim` image, scale-to-zero with job-aware
lifecycle (FR-311), ≈ $7/month at peak. Supabase is reached over HTTPS only
(container outbound is 80/443 — never the Postgres wire protocol).

**Background jobs (flipped from `false`).** The change introduces the app's
first async-job muscle: a durable `generation_jobs` table in Supabase,
polling from the app, per-stage checkpoints, proposal-based delivery. Still
no queues, Durable Objects, or Workflows — one job table plus one container
binding is the whole mechanism; push progress and Workflows are recorded
upgrades, not scope.

**Monorepo posture (locked in shaping).** The Astro app stays at the repo
root; role-named satellites hold the rest (`services/solver/`, tech-neutral
schema artifacts in `contracts/`, `supabase/` as shared infra). No
Turborepo/Nx/pnpm-workspace packages. **mise** provides toolchain pins
(node/python/uv) and cross-ecosystem tasks; pnpm scripts remain the JS-side
canon — solver steps never enter `package.json`.

**CI/CD.** GitHub Actions, auto-deploy on merge to main, extended per FR-315:
a path-filtered solver verify lane (ruff + pytest + mypy) joins the existing
gate, and the deploy job builds/pushes the container image alongside the
Worker. Container secrets live in container config, not the Worker; the CF
API token broadens only as far as Containers deploys require.

**Held constant.** Solo after-hours cadence; auth yes (deny-by-default
middleware, single Author role); payments no; realtime no (polling ships;
push is the acknowledged upgrade if it disappoints); no LLM step. The wire
contract (`GeneratorSnapshot`/`GenerationResult`) is frozen and parity-gated
across both components; the oracle + atomic RPC remain the sole write path
for generated boards.
