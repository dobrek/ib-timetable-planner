# Repository Guidelines

`ib-timetable-planner` — an interactive IB-school timetable planner. Astro 7 + React 19 islands on Cloudflare Workers (workerd), Supabase (Postgres) for persistence, Tailwind v4, TypeScript v6. Package manager **pnpm 12.9.1**, Node **26.12.1** (`.node-version`). See @README.md for depth.

## Hard rules

- **Workers runtime, both dev and prod.** No Node-only APIs (`fs`, `child_process`, `net`, native modules). Confirm `pnpm build` stays clean.
- **FSD layout is steiger-enforced.** `pnpm steiger` is a CI gate (`--fail-on-warnings`). Respect layer import direction: `app` → `_pages` → `widgets` → `entities` → `shared`; never import upward. Config: @steiger.config.ts.
- **Supabase is the runtime source of truth** for catalog, students, teachers, placements. `data/*.csv` are reference fixtures only — never read at runtime.
- **Placement/constraint validation has a <200ms budget** per drag-drop. The pure two-cohort (dp1/dp2) constraint core lives in `src/entities/timetable/` (shared by the board and the read-only perspective views) — read it before touching constraint logic; don't reinvent it. Editing orchestration (drag state, optimistic placements, hooks) stays in `src/_pages/plan-detail/model/`.
- **Auth is deny-by-default** in `src/middleware.ts`. Don't widen the allowlist without reason.
- Don't bypass `lefthook` with `--no-verify`.

## Post-cutoff platform rules

- **Astro is v7** (not v6) with Vite 8 (Rolldown). Before using Astro/Vite config APIs, verify against current docs — several v6-era idioms changed. The `ssrPrebundleDeps()` workaround in `astro.config.mjs` is deliberate; read its comment before touching dev-SSR or optimizeDeps behavior.
- **Cloudflare Containers went GA 2026-04** — post-cutoff for most models. Never write `wrangler.jsonc` container bindings, lifecycle config (sleepAfter/SIGTERM), rollout fields, or CF API token scopes from memory; fetch current Cloudflare docs first. The platform **does not guarantee that any container instance will run for any set period of time**, so job-aware lifecycle is a correctness requirement (PRD FR-311), owned by S-304. (The older citation for this, containers#162, was closed 2026-05-12 — do not re-cite it as a live hazard.) S-308 lowered `sleepAfter` to `10m` once renewal was proven in production (2026-10-06), and set `rollout_active_grace_period` to the ladder's 38-minute worst case (2280 s). That window counts how long an instance has been connected to its Durable Object, so it protects a cold-started solve but not a warm container older than the window — hence README's rule against merging to `main` mid-solve.
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
- **CP-SAT changes are gated by tests, not review-reading.** Any change to modeling/objective code must keep the objective-parity suite at exact 10/10, pass the oracle on golden fixtures, and keep the regression baseline `tests/test_baseline.py` green (`uv run pytest -m baseline`). Its bounds are re-calibrated **only on the GitHub runner** (a temporary CI matrix, evidence recorded beside the constants), never on M-series. Do not trust generated or-tools code that hasn't run — CP-SAT idiom is easy to confabulate.
- Test at the wrapper level (HTTP surface), not just the core — the untested `cli.py` was the POC's recorded lesson.
- Cross-ecosystem tasks run through **mise**; pnpm scripts remain the JS-side canon. Never add solver steps to `package.json`. `mise.toml` is the **catalog**, not the code: every task body lives in `scripts/solver/*.sh` (POSIX sh, `set -eu` as the first non-comment line, self-locating to the repo root, sourcing `common.sh`), shellcheck-gated by `mise run solver:check` and CI's `verify` job. A new solver task means a new script plus a one-line `run`.

## Database & auth (Supabase)

- **Hosted holds real school data — migrations are additive only.** Never `DROP`, never drop-and-re-push: CI's `deploy` job applies every pending migration to hosted on merge to `main`, so each one must be safe against live data on its own. Recover by rolling forward with a new migration.
- **No `SECURITY DEFINER`.** Every RPC is INVOKER so RLS governs it — no migration defines a DEFINER function today, and several say why in their comments. An exception needs a recorded reason in the migration and the plan that introduces it.
- **The Worker holds no secret key** — only `SUPABASE_KEY` (`sb_publishable_…`), by decision of record (`context/deployment/deploy-plan.md:141`). `sb_secret_…` appears only in Node tooling and tests. Tokens are ES256; don't write legacy `anon`/`service_role` JWT idioms or HS256 assumptions — fetch current Supabase docs (Context7 `/supabase/supabase`, `/supabase/ssr`) before writing Auth code.
- **Hosted auth config (Site URL, redirect allowlist, password policy, SMTP, email templates, hooks) changes by hand** — dashboard or Management API, per `docs/runbooks/`. Never run `supabase config push`: it pushes the whole `supabase/config.toml`, which is the **local development** config (`docs/runbooks/solver-credential.md` lists what it would break).
- The Custom Access Token Hook trusts only `app_metadata.machine_role` (Admin-API-only, never user-writable) and rewrites `claims.role` solely for the exact value `solver_job_writer`. Never let a user- or admin-editable value flow into `claims.role`.
- **The publishable key never reaches the browser.** The password-reset flood guard depends on it: Turnstile in front of `POST /api/auth/forgot` is a gate only while nobody can call GoTrue's `/recover` directly. `postbuild` (`scripts/assert-server-only-supabase.mjs`) fails the build if `dist/client` holds a Supabase key or host. Never `createBrowserClient`, `PUBLIC_SUPABASE_*` or `astro:env/client` for Supabase.
- **Email links** use `{{ .TokenHash }}` → `/auth/confirm`, which renders on every method with no side effects; only a native POST to `/api/auth/confirm` spends the link, because mail scanners GET and HEAD links and run their JavaScript. Never `{{ .ConfirmationURL }}` (GoTrue spends it on GET), never a token in an `href`. A new link type (S-410 `invite`, S-411 `email_change`) joins `EMAIL_LINK_TYPES` in `src/_pages/password-recovery/model/email-link.ts`.
- **Never enable Supabase Auth CAPTCHA.** It also covers the solver's password grant, and its only bypass is the secret key the Worker must not hold. The reset bot check is Turnstile, verified in the Worker.
- **Every public route** in `src/middleware.ts` carries a one-line reason. Everything under `/api/auth/` is public by prefix, so any file placed there must be safe signed out.
- **`redirectTo` must be allow-listed** (hosted `uri_allow_list`, local `additional_redirect_urls`), or Auth silently falls back to the Referer, then the Site URL.
- **`supabase/templates/*`** reach hosted only through the Management API step in `docs/runbooks/hosted-auth-settings.md`, never `config push`. They are Go templates: notes go in `{{/* … */}}` comments, because an action inside an HTML comment is still rendered into the email.
- **Integration suites run as service-role, which bypasses RLS** — they prove behaviour, not access control. An access-control claim needs a client signed in with the publishable key: get one from `createSignedInUser` (`src/test/factories/`), and state the claim as a cell in `src/test/role-matrix-expectations.ts`, which `src/test/role-matrix.integration.test.ts` runs live, rather than in a new suite. Confirm grant posture with `has_table_privilege(...)`, not by reading the migration (see `context/foundation/lessons.md`).
- After a migration that changes a table or column, regenerate `src/shared/api/database.types.ts` with the local stack up: `pnpm db:types` (`scripts/db-types.mjs` — fail-safe: on any error it leaves the committed file untouched, unlike a raw `>` redirect). Check the diff before committing. It is generator output, committed verbatim and prettier-ignored; never hand-edit it.
- CI's Supabase stack (`.github/actions/supabase-stack/action.yml`) starts trimmed: `edge-runtime` is excluded, and `mailpit` is kept because the S-402 suites read reset mail through its API. A suite that needs an Edge Function, or another excluded service, must re-include it there, or it passes locally and fails in CI. The stack runs the lockfile's CLI through `pnpm exec supabase`, and its images are that CLI's defaults. So any change to `supabase`'s resolved version in `pnpm-lock.yaml` changes CI's images in the same commit. A plain `pnpm update` does that too, because `package.json` gives `supabase` a caret (`^`) range and Dependabot covers only GitHub Actions.

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
