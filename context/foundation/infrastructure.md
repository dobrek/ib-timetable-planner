---
project: ib-timetable-planner
researched_at: 2026-05-22
recommended_platform: cloudflare-workers
runner_up: netlify
context_type: mvp
tech_stack:
  language: typescript
  framework: astro-6
  runtime: cloudflare-workers-workerd
---

## Recommendation

**Deploy on Cloudflare Workers** (Workers + Static Assets, not legacy Pages).

The platform is already a hard match: `tech-stack.md` pins `deployment_target: cloudflare-pages` with `bootstrapper_confidence: first-class`, and the 10x-astro-starter ships the `@astrojs/cloudflare` adapter pre-wired. Cloudflare scores Pass on all five agent-friendly criteria (CLI, managed, agent-readable docs with `llms.txt` + docs MCP, scriptable deploy API, 16 GA MCP servers); the projected load (50–150 users × intermittent drag-drop validation) sits comfortably inside the Workers free tier (100k req/day). The cross-check did not surface a blocker — the load-bearing risks (Supabase region latency against the 200ms validation budget, `nodejs_compat` dep traps, workerd debugging friction) are absorbable with day-one decisions captured in the risk register.

## Platform Comparison

| Platform               | CLI-first | Managed/SLS | Agent docs | Stable deploy API | MCP / Integration | Score                              |
| ---------------------- | --------- | ----------- | ---------- | ----------------- | ----------------- | ---------------------------------- |
| **Cloudflare Workers** | Pass      | Pass        | Pass       | Pass              | Pass              | **5 Pass**                         |
| **Netlify**            | Pass      | Pass        | Pass       | Partial           | Pass              | 4 Pass, 1 Partial                  |
| **Vercel**             | Pass      | Pass        | Pass       | Pass              | Partial           | 4 Pass, 1 Partial                  |
| **Railway**            | Pass      | Pass        | Pass       | Pass              | Partial           | 4 Pass, 1 Partial (stability risk) |
| **Fly.io**             | Pass      | Partial     | Partial    | Pass              | Partial           | 2 Pass, 3 Partial                  |
| **Render**             | Partial   | Pass        | Partial    | Pass              | Pass              | 3 Pass, 2 Partial                  |

Soft weights applied from interview: persistent connections not required (no hard filter), cost/DX roughly equal, no platform familiarity, single region (edge advantage muted), external providers fine (no co-location bonus).

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Tech-stack alignment is total — no adapter swap, no Dockerfile, no runtime delta between local `astro dev` (Astro 6 runs on workerd as of Jan 2026) and production. Wrangler CLI covers deploy, rollback, log tail, and secrets with predictable exit codes and structured output. Documentation is among the most agent-readable on the market: `developers.cloudflare.com/llms.txt`, per-product `llms-full.txt`, content-negotiation via `Accept: text/markdown`, source on GitHub. Cloudflare's MCP ecosystem is GA with 16+ specialized servers including Workers Observability. The free tier of 100k req/day (~3M/mo) covers the projected MVP load with margin to spare. Workers Static Assets is the canonical 2026 path; Pages is supported but in maintenance — Workers is what the scaffold should target.

#### 2. Netlify

Strongest non-Cloudflare option. `@astrojs/netlify` is mature and supports Astro 6 server islands, actions, and middleware via a single adapter that emits both Functions and Edge Functions. Netlify CLI is scriptable (the new `netlify logs` shipped 2026-05-01); rollback is "Publish deploy" in the UI rather than a first-class CLI command (the Partial score). Official MCP server is GA. Docs at `docs.netlify.com/llms.txt`. The trade-offs are real: ~$20/mo Pro is the realistic cost for a school tool, Lambda cold starts on Functions, 50MB zipped function-bundle size discipline required for Astro hybrid output, and an adapter swap away from the current scaffold.

#### 3. Vercel

Solid runner-up. `@astrojs/vercel` supports Astro 6 with Node serverless or Edge targets; for this stack the Node target is the safe default. Vercel CLI is mature with proper `vercel rollback`. Docs at `vercel.com/llms.txt` and `/llms-full.txt`. The MCP server is in Public Beta (the Partial score) — usable, but not yet the GA story Netlify and Cloudflare offer. The Hobby plan is explicitly non-commercial, so a school-deployed timetable tool effectively means Pro at $20/dev/mo. Vendor lock-in via `vercel.json` and per-function billing surprises (Image Optimization, Active CPU, ISR reads/writes) are the standard Vercel watch-items.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **workerd ≠ Node.** Supabase JS SDK requires the `nodejs_compat` flag, and every future dep (CSV parser, date lib, validator helper) must be vetted for workerd compatibility before adoption. Each `pnpm add` carries hidden risk of "works on `astro dev`, fails on `wrangler deploy`."
2. **Single-region user base + Supabase region pinning erases the edge advantage.** PRD requires <200ms validation; if Supabase sits in `us-east-1` and authors are in Europe, the Worker→Postgres round-trip alone can consume 100–150ms before the validator runs. Edge POPs solve geo-latency for static assets, not for DB-bound logic.
3. **Worker size limit (3MB free / 10MB paid, compressed).** The constraint solver + CSV parser + Supabase client can creep up. No graceful "split into multiple processes" — the response is to refactor to multiple Workers or move logic to client-side islands.
4. **Debugging is rougher than Node.** No `node --inspect`, less helpful stack traces, `wrangler tail` is a streaming log not a time-travel debugger. Matters for a non-trivial constraint validator.
5. **No filesystem.** "Write to `/tmp` for cache" patterns don't apply — KV/R2/Cache API are the explicit options. Not obvious from "serverless JS" framing.

### Pre-Mortem — How This Could Fail

Six months in, the team faced a stack of small cuts that compounded. First cut: the Supabase free-tier project landed in `us-east-1`; the school's authors hit the app from Europe, and every drag-drop validation made a round-trip to Postgres adding ~120ms before the validator ran — pushing p95 over the 200ms PRD budget. The fix was migrating Supabase to `eu-central`, but that pushed onto a paid Supabase tier, blowing the "stays in Cloudflare free tier" cost story. Second cut: adding a CSV-parsing dependency that pulled in Node `stream` revealed gaps in `nodejs_compat` — a quick `pnpm add` cost a weekend of workerd debugging that Node-on-Railway would have absorbed silently. Third cut: a Wednesday production incident was reported Friday; Workers Logs retention on the free tier had already evicted the trace. By month six the "free MVP" had become $25/mo with a worse debugging loop than `@astrojs/node` on Railway would have produced for the same money. The platform wasn't wrong — but the team didn't measure the Supabase round-trip on day one.

### Unknown Unknowns

- **Astro 6 on workerd is fresh (Jan 2026, post-Cloudflare acquisition of The Astro Technology Company).** Dev-prod parity is new; framework-level workerd bugs since Jan may not be in either project's docs yet — you're on a recent path.
- **`nodejs_compat` is compatibility-date-flagged.** A future bump (security patch, new feature) can opt you into behavior changes you didn't intend. Each compat-date bump deserves a changelog read.
- **Fork-PR preview behavior is under-documented.** If external contributions ever land, expect secrets to be withheld and previews to fail in ways that aren't well-explained.
- **Cloudflare account-suspension risk.** CF has a documented pattern of opaque TOS enforcement. For a school timetable that's one account-lock away from being unusable, recoverable backups matter: regular `pg_dump` of Supabase, `wrangler.jsonc` and deploy scripts in repo, nothing that lives only in the dashboard.
- **The `@astrojs/cloudflare` adapter has changed shape between major versions.** Blog posts and tutorials predating 2026 often describe Pages-based deployment that's now legacy. Trust only the official adapter README pinned to your version.

## Operational Story

- **Preview deploys**: Per-branch preview URLs auto-provisioned by Workers Git integration (GA since 2025-07); per-commit preview URLs also available via `wrangler versions upload`. Fork-PR previews under-documented — assume secrets are withheld. Use Cloudflare Access if previews need to be private during pre-launch.
- **Secrets**: `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` for production; `.dev.vars` (gitignored, present in `.gitignore` from scaffold) for local. Per-environment via `--env`. GitHub Actions reads `CLOUDFLARE_API_TOKEN` from repo secrets — token scoped to `Workers Scripts: Edit` for this project only, no DNS, no account-level access.
- **Rollback**: `wrangler deployments list` then `wrangler rollback <deployment-id>` — sub-minute revert. Caveat: Supabase migrations don't roll back automatically with the Worker; if a deploy includes a migration, plan a forward fix (additive migration → deploy → backfill) rather than a code rollback.
- **Approval**: Agent may run `wrangler deploy`, `wrangler tail`, `wrangler secret list` (names only), `wrangler deployments list`. Human-only: rotating `SUPABASE_SERVICE_ROLE_KEY`, dropping the Supabase project, changing Cloudflare account billing, deleting the Worker. CI auto-deploys on merge to main per `.github/workflows/` — that's the approval surface, not the agent's CLI.
- **Logs**: `wrangler tail` for streaming (with `--status error --format json` for structured CI parsing), Workers Logs dashboard for retained history. Cloudflare Workers Observability MCP server for agent-side queries when CLI log spelunking gets old.

## Risk Register

| Risk                                                                                 | Source           | Likelihood | Impact | Mitigation                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ---------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase region mismatch with user geography pushes p95 past 200ms validation budget | Pre-mortem       | M          | H      | Pick Supabase region to match author geography on day one (eu-central for a Polish/EU school). Measure round-trip with a no-op query before building the validator. Re-measure after every Supabase tier change. |
| `nodejs_compat` gap surfaces in a new dependency, breaks deploy                      | Devil's advocate | M          | M      | Set rule: every new dep is added on a feature branch, deployed to the branch-preview URL, and validation-tested before merge. Keep [[nodejs-compat-list]] notes for known-incompatible packages.                 |
| Worker bundle size exceeds 10MB compressed limit as the constraint solver grows      | Devil's advocate | L          | M      | Track bundle size in CI (`wrangler deploy --dry-run` reports it). Treat 7MB as a yellow line. Move pure client-side validation logic into React islands where feasible.                                          |
| Workers Logs retention evicts trace before incident triage                           | Pre-mortem       | M          | M      | For a school MVP, accept short retention but pipe critical errors to Supabase or a small Cloudflare KV bucket via `event.waitUntil(logError(...))` for durable error storage.                                    |
| Cloudflare account suspension freezes the timetable mid-school-year                  | Unknown unknowns | L          | H      | Daily `pg_dump` of Supabase to author's machine or external storage. Keep `wrangler.jsonc` and CI workflow in repo so re-deploy to a fresh CF account is one PR. No dashboard-only config.                       |
| Astro 6 + workerd is a new path; framework-level bugs may lack docs                  | Unknown unknowns | M          | L      | Pin Astro and `@astrojs/cloudflare` minor versions in `package.json`. Read CHANGELOG before upgrading. Keep the [[verify]] skill happy as the canary.                                                            |
| Fork-PR preview deploys silently fail (secrets withheld)                             | Unknown unknowns | L          | L      | Document explicitly: external contributors push to fork → maintainer pulls into branch in this repo → preview deploys correctly. Don't accept fork PRs directly until the behavior is verified.                  |
| `nodejs_compat` compat-date bump introduces silent behavior change                   | Unknown unknowns | M          | L      | Treat compat-date bumps in `wrangler.jsonc` as code changes — own PR, own changelog read, own preview-deploy test. Never bundle with feature work.                                                               |
| Supabase JS SDK version-incompatibility with workerd at upgrade                      | Research finding | L          | M      | Pin `@supabase/supabase-js` minor. Read SDK changelog before bumping. Supabase dropped Node 18 in v2.79.0 (Apr 2025) — future Node-version drops may also affect workerd-via-nodejs_compat.                      |

## Getting Started

The 10x-astro-starter scaffold has already wired most of this; these steps assume that scaffold is the current state of the repo.

1. **Install wrangler globally (optional) or use via pnpm**: `pnpm dlx wrangler --version` confirms it's reachable; the scaffold pins it in `devDependencies` so `pnpm exec wrangler ...` always works.
2. **Authenticate once**: `pnpm exec wrangler login` — opens browser, stores OAuth token in `~/.wrangler/`. For CI, generate a scoped API token at `dash.cloudflare.com/profile/api-tokens` with `Workers Scripts: Edit` for this project only.
3. **Pick Supabase region to match user geography NOW**: create the Supabase project in the region nearest the school. The default is `us-east-1`; for an EU school, pick `eu-central-1` or equivalent. This is the single most load-bearing latency decision.
4. **Set production secrets**: `pnpm exec wrangler secret put SUPABASE_URL`, then `SUPABASE_ANON_KEY`, then `SUPABASE_SERVICE_ROLE_KEY`. Copy the same values to `.dev.vars` (gitignored) for local dev.
5. **Verify locally**: `pnpm dev` — Astro 6's dev server runs on workerd directly, so this exercises the same runtime as production. (For binding-specific testing — KV, R2 — fall back to `pnpm exec wrangler dev`; for HTTP-only Supabase work, `pnpm dev` is sufficient.)
6. **First deploy**: `pnpm build && pnpm exec wrangler deploy`. The CI workflow on merge to main does the same. Confirm the deployment URL responds; run `pnpm exec wrangler tail` while exercising the app to verify logs flow.
7. **Establish the daily backup discipline**: cron a `pg_dump` of Supabase to a location outside Cloudflare (local machine, separate cloud storage). Risk register row 5 depends on this.

Do **not** trust generic "deploy Astro to Cloudflare" blog posts from 2024–2025 — they likely describe Pages CLI workflows that have shifted to Workers Static Assets. The current canonical reference is the `@astrojs/cloudflare` README pinned to the version in `package.json` and `developers.cloudflare.com/workers/framework-guides/web-apps/astro/`.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration (Cloudflare Workers doesn't use containers)
- CI/CD pipeline setup (separate from platform decision; the scaffold's `.github/workflows/` is already configured for `pnpm install → astro sync → lint → build` per CLAUDE.md)
- Production-scale architecture: multi-region failover, HA, DR, dedicated support tier
- Cost projections beyond MVP scale (50–150 users); growth beyond ~3M req/mo crosses into Workers Paid territory and warrants re-measurement
