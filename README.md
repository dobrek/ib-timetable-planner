# IB Schedule Planner

Interactive timetable planner for IB (International Baccalaureate) programmes. A plan author drags compatible course groupings onto a two-cohort slot grid with live, sub-200 ms constraint validation — replacing the current "algorithm output + manual spreadsheet" workflow.

## Tech Stack

- [Astro](https://astro.build/) v7 — server-first framework with React islands
- [React](https://react.dev/) v19 — interactive UI components (drag-and-drop grid, validation feedback)
- [TypeScript](https://www.typescriptlang.org/) v6 — strict types across the codebase
- [Tailwind CSS](https://tailwindcss.com/) v4 — utility-first styling
- [Supabase](https://supabase.com/) — Postgres persistence + email/password auth
- [Cloudflare Workers](https://workers.cloudflare.com/) — edge deployment runtime (workerd)

## Prerequisites

- Node.js 24.15.0 (see `.node-version`)
- [pnpm](https://pnpm.io/) 11.9.0 (declared in `packageManager`)
- [Docker Desktop](https://www.docker.com/) — required by the local Supabase stack

## Getting Started

1. Install dependencies:

```bash
pnpm install
```

2. Start the local Supabase stack (first run pulls Docker images):

```bash
pnpm exec supabase start
```

3. Copy the **Publishable** key printed by the CLI and create your env files:

```bash
mkdir -p .envs
cat > .envs/local.vars <<EOF
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<Publishable key from supabase start>
EOF
```

4. Activate the local environment profile:

```bash
pnpm env:local
```

5. Run the dev server:

```bash
pnpm dev
```

The app is served at `http://localhost:4321`. Local Supabase Studio is at `http://127.0.0.1:54323` and Mailpit (email capture) at `http://127.0.0.1:54324`.

## Available Scripts

| Script           | Description                                             |
| ---------------- | ------------------------------------------------------- |
| `pnpm dev`       | Start the Astro dev server (Cloudflare workerd runtime) |
| `pnpm build`     | Production build                                        |
| `pnpm preview`   | Preview the production build locally                    |
| `pnpm lint`      | ESLint (flat config, type-checked)                      |
| `pnpm lint:fix`  | Auto-fix lint issues                                    |
| `pnpm format`    | Prettier across the tree                                |
| `pnpm env:local` | Switch `.env.local` + `.dev.vars` to local Supabase     |
| `pnpm env:prod`  | Switch `.env.local` + `.dev.vars` to hosted Supabase    |

## Project Structure

The codebase follows [Feature-Sliced Design](https://feature-sliced.design/) (enforced by `pnpm steiger`). Layers import downward only: `app` → `_pages` → `widgets` → `entities` → `shared`.

```
src/
├── app/            # App shell, layouts, global styles
├── _pages/         # FSD page slices (e.g. plan-detail/, courses/, teachers/)
│   └── <slice>/    #   api/ (Supabase), model/ (domain logic + hooks), lib/, ui/
├── widgets/        # Composed read-only UI shared across page slices (timetable-board)
├── entities/       # Business-domain slices (timetable/ — pure read-side scheduling core)
├── shared/         # Reused across slices: api/ (Supabase client), lib/, config/, ui/
├── actions/        # Astro Actions (thin; logic lives in slice model/api)
├── pages/          # Astro file-routing — routes + API endpoints (src/pages/api/)
└── middleware.ts   # Deny-by-default route protection
supabase/           # Local Supabase config, migrations, generated seed.sql
data/               # Reference CSV fixtures (not read at runtime)
context/            # Foundation docs (PRD, tech-stack, infrastructure, deploy plan)
public/             # Static assets
wrangler.jsonc      # Cloudflare Workers configuration
```

> The pure two-cohort (dp1/dp2) constraint/validation core lives in `src/entities/timetable/` (shared by the editing board and the read-only perspective views). Editing orchestration (drag state, optimistic placements, hooks) stays in `src/_pages/plan-detail/model/`.

## Environment Profiles

The project uses two Supabase targets — **local** (default for development) and **hosted** (production / quick smoke tests). Profile files live in `.envs/`:

- `.envs/local.vars` — local Supabase (`127.0.0.1:54321`)
- `.envs/prod.vars` — hosted Supabase project

Swap with a single command:

```bash
pnpm env:local   # default dev loop
pnpm env:prod    # read-only smoke against hosted Supabase
```

Both scripts write `.env.local` (for `astro dev`) and `.dev.vars` (for `wrangler dev`) so the two dev commands stay in sync. Always run `pnpm env:local` after a prod smoke test.

## Deployment

The app deploys to **Cloudflare Workers**. The full deployment plan is in [`context/changes/deployment/deploy-plan.md`](context/changes/deployment/deploy-plan.md).

- **Production URL:** <https://ib-timetable-planner.dobromir-kropielnicki.workers.dev>
- **Custom domain:** <https://ib-timetable-planner.dev>

Deployment is **automated**: every push to `main` runs the CI pipeline, and once all test jobs pass the `deploy` job applies pending Supabase migrations to the hosted project and ships the Worker (see [CI / CD](#ci--cd)). Merging to `main` is the normal release path — no manual steps required.

### Manual deploy (escape hatch)

For out-of-band releases (e.g. CI is unavailable), run the same two steps the `deploy` job runs — schema first, then code:

```bash
pnpm exec supabase db push   # apply pending migrations to the hosted project
pnpm build
pnpm exec wrangler deploy
```

Production secrets (`SUPABASE_URL`, `SUPABASE_KEY`) are stored on the Worker via `pnpm exec wrangler secret put`.

### Rollback

```bash
pnpm exec wrangler deployments list
pnpm exec wrangler rollback <deployment-id>
```

## CI / CD

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push and PR to `main`. All jobs share the `./.github/actions/setup` step (pnpm + Node + `pnpm install --frozen-lockfile`):

1. **`verify` job** — `astro sync` → `lint` → `steiger` → `pnpm audit --audit-level=high` → `test` → `build`
2. **`integration` job** — boots a trimmed local Supabase stack, runs `pnpm test:integration --maxWorkers=2`
3. **`e2e` job** — boots the stack + workerd preview, runs the Playwright suite (`pnpm test:e2e`)
4. **`deploy` job** — on push to `main` only, after `verify` + `integration` + `e2e` all pass: applies pending migrations (`supabase db push`), then ships via `cloudflare/wrangler-action@v4`

Required repository secrets:

| Secret                  | Description                                       |
| ----------------------- | ------------------------------------------------- |
| `SUPABASE_URL`          | Hosted Supabase project URL                       |
| `SUPABASE_KEY`          | Hosted Supabase Publishable (anon) key            |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI access token — `db push` in `deploy` |
| `SUPABASE_DB_PASSWORD`  | Hosted DB password — `db push` in `deploy`        |
| `CLOUDFLARE_API_TOKEN`  | Scoped token (Workers Scripts: Edit)              |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier                     |

## Supabase

### Local development (default)

Requires Docker. The local stack runs Postgres on `54322`, API on `54321`, Studio on `54323`, and Mailpit on `54324`.

```bash
pnpm exec supabase start    # boot the local stack
pnpm exec supabase stop     # shut it down
```

### Hosted project

| Detail      | Value                  |
| ----------- | ---------------------- |
| Project ref | `hwmuiymhjgewtymymbmb` |
| Region      | Central EU (Frankfurt) |

Link the CLI to the hosted project (one-time):

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref hwmuiymhjgewtymymbmb
```

### Database: migrations & seed

Schema lives in `supabase/migrations/`. The dev seed (`supabase/seed.sql`) is a **generated artifact** — `scripts/gen-seed.mjs` transcodes the `data/dp1/` + `data/dp2/` CSV fixtures into inlined SQL. Both the script and its output are committed.

**Local (default loop).** `db reset` recreates the database, applies every migration, then loads the seed:

```bash
pnpm exec supabase db reset            # migrations + seed, from scratch
```

If you changed a fixture under `data/dp1/` or `data/dp2/`, regenerate the seed first, then reset:

```bash
node scripts/gen-seed.mjs > supabase/seed.sql
pnpm exec supabase db reset
```

The generator aborts loudly on data inconsistencies (e.g. phantom courses) and prints row-count stats to stderr. Add a new migration with:

```bash
pnpm exec supabase migration new <descriptive_name>
```

**Hosted.** On merge to `main`, the CI `deploy` job applies pending **migrations only** via `supabase db push` (the seed is dev-only and is never applied to hosted). To push out-of-band — CI unavailable, or to validate before merge:

```bash
pnpm exec supabase db push             # apply pending migrations to the linked project
pnpm exec supabase db diff             # should report clean afterward
```

> Table reachability is pinned explicitly in migrations, not left to Supabase's legacy auto-grant for new `public` tables (the platform is moving to opt-in grants). `authenticated` and `service_role` are granted DML on the public schema — current and future tables, via `alter default privileges` — while `anon` is revoked (least privilege). When adding a `public` table, the default-privilege rules carry these grants forward automatically; if a table is ever unexpectedly unreachable, run `pnpm exec supabase db advisors` and confirm the role holds a grant. RLS controls which rows are visible; grants control whether the table is reachable at all — both must be in place.

**Rollback.** There is no production data to preserve yet. Prefer additive migrations (nullable new columns, no `DROP`); a code rollback does not undo an applied migration. To reset hosted state at this stage, drop and re-push.

### Auth routes

| Route          | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| `/auth/signin` | Email/password sign-in                                          |
| `/dashboard`   | Protected page (redirects to `/auth/signin` if unauthenticated) |

There is no self-service signup: accounts are provisioned manually. See [`docs/runbooks/author-provisioning.md`](docs/runbooks/author-provisioning.md).

Route protection is deny-by-default in `src/middleware.ts` — every route requires an authenticated session except the sign-in page, the `/api/auth/` endpoints, and static assets.

## License

MIT
