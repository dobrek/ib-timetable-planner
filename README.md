# IB Schedule Planner

Interactive timetable planner for IB (International Baccalaureate) programmes. A plan author drags compatible course groupings onto a two-cohort slot grid with live, sub-200 ms constraint validation — replacing the current "algorithm output + manual spreadsheet" workflow.

## Tech Stack

- [Astro](https://astro.build/) v6 — server-first framework with React islands
- [React](https://react.dev/) v19 — interactive UI components (drag-and-drop grid, validation feedback)
- [TypeScript](https://www.typescriptlang.org/) v6 — strict types across the codebase
- [Tailwind CSS](https://tailwindcss.com/) v4 — utility-first styling
- [Supabase](https://supabase.com/) — Postgres persistence + email/password auth
- [Cloudflare Workers](https://workers.cloudflare.com/) — edge deployment runtime (workerd)

## Prerequisites

- Node.js 24.15.0 (see `.node-version`)
- [pnpm](https://pnpm.io/) 10.32.1 (declared in `packageManager`)
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
mkdir -p .env
cat > .env/local.vars <<EOF
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

```
src/
├── pages/          # Astro routes + API endpoints (src/pages/api/)
├── components/     # React + Astro UI components
├── layouts/        # Astro page layouts
├── lib/            # Pure utilities, Supabase client, constraint/validation core
└── styles/         # Global styles
supabase/           # Local Supabase config, migrations
data/               # Reference CSV fixtures (not read at runtime)
context/            # Foundation docs (PRD, tech-stack, infrastructure, deploy plan)
public/             # Static assets
wrangler.jsonc      # Cloudflare Workers configuration
```

## Environment Profiles

The project uses two Supabase targets — **local** (default for development) and **hosted** (production / quick smoke tests). Profile files live in `.env/`:

- `.env/local.vars` — local Supabase (`127.0.0.1:54321`)
- `.env/prod.vars` — hosted Supabase project

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

### Manual deploy

```bash
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

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push and PR to `main`:

1. **`ci` job** — `pnpm install --frozen-lockfile` → `astro sync` → `lint` → `build`
2. **`deploy` job** — on push to `main` only, ships via `cloudflare/wrangler-action@v3`

Required repository secrets:

| Secret                  | Description                            |
| ----------------------- | -------------------------------------- |
| `SUPABASE_URL`          | Hosted Supabase project URL            |
| `SUPABASE_KEY`          | Hosted Supabase Publishable (anon) key |
| `CLOUDFLARE_API_TOKEN`  | Scoped token (Workers Scripts: Edit)   |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier          |

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

### Auth routes

| Route                 | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in                                          |
| `/auth/signup`        | Email/password sign-up                                          |
| `/auth/confirm-email` | Post-signup confirmation page                                   |
| `/dashboard`          | Protected page (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`.

## License

MIT
