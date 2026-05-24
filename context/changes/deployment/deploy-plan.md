# Integration & Deployment Plan — ib-schedule-planner

## Context

The scaffold is in place: Astro 6 + React 19 on Cloudflare Workers (workerd), `@astrojs/cloudflare` adapter, `wrangler.jsonc` with `nodejs_compat` and compatibility date `2026-05-08`, Supabase SSR client at [src/lib/supabase.ts](src/lib/supabase.ts), auth endpoints under [src/pages/api/auth/](src/pages/api/auth/), and a CI workflow that gates on `astro sync → lint → build` but does not deploy.

[context/foundation/infrastructure.md](context/foundation/infrastructure.md) recommends Cloudflare Workers (Workers + Static Assets) and flags load-bearing day-one decisions: Supabase region must match author geography (EU for a Polish school), `nodejs_compat` dep traps, daily `pg_dump` discipline, scoped Cloudflare API token. [context/foundation/tech-stack.md](context/foundation/tech-stack.md) pins pnpm 10.32.1 / Node 24.15.0 and `ci_default_flow: auto-deploy-on-merge`.

Goal of this plan: take the scaffold from "builds locally" to "running in production on Cloudflare Workers, talking to a hosted Supabase project, with a first manual deploy verified by hand and a CI auto-deploy lane added in a follow-up phase". An empty hosted Supabase project already exists — Phase 1 includes verification steps to confirm its region and access before we wire it up. **Local Supabase is the primary dev path**; production Supabase is reachable via an env-swap for quick smoke testing.

## Prerequisites — CLI & Supabase setup

Do this once before Phase 0. None of these mutate the hosted project or the production Worker.

- [x] **P.1 Node + pnpm.** Confirm `node --version` ≈ `v24.15.0` (matching [.node-version](.node-version)) and `pnpm --version` ≈ `10.32.1` (matching `packageManager` in [package.json](package.json)). If using `nvm` / `fnm` / `volta`, run their respective `use` commands inside the repo so the right Node is active.
- [x] **P.2 Wrangler CLI.** Already pinned in `devDependencies`. Sanity-check: `pnpm exec wrangler --version`. Do **not** install wrangler globally — always go through `pnpm exec` so the version matches the repo.
- [x] **P.3 Supabase CLI.** Already pinned in `devDependencies` (`"supabase": "^2.101.0"`). Do **not** install globally — always go through `pnpm exec` so the version matches the repo. Sanity-check: `pnpm exec supabase --version`.
- [x] **P.4 Docker Desktop running.** Required by `pnpm exec supabase start` (the local stack runs in containers). Confirm `docker info` returns without error.
- [x] **P.5 Start local Supabase.** From repo root: `pnpm exec supabase start`. This boots Postgres on `54322`, API on `54321`, Studio on `54323`, Mailpit on `54324` (per [supabase/config.toml](supabase/config.toml)). First run pulls images — give it a few minutes. The command prints two keys — **Publishable** (the client-safe key, equivalent to old `anon key`) and **Secret** (the admin key, equivalent to old `service_role key`). Copy the Publishable key.
- [x] **P.6 Wire local Supabase keys into the app.**
  - `.env.local` currently points at the **hosted** project (`hwmuiymhjgewtymymbmb.supabase.co`). For local dev, overwrite with:
    ```
    SUPABASE_URL=http://127.0.0.1:54321
    SUPABASE_KEY=<Publishable key from P.5>
    ```
  - **Important:** the `SUPABASE_URL` value must be the base URL only (no trailing `/rest/v1/`). The `@supabase/ssr` `createServerClient` appends paths itself.
  - Create `.dev.vars` with the same two lines (so `wrangler dev` sees them too). This file does not exist yet.
  - Both files are already gitignored (`.env*` and `.dev.vars` patterns in [.gitignore](.gitignore)).
- [ ] **P.7 Verify local round-trip.** `pnpm dev` → open `http://localhost:4321` → exercise signup with a throwaway email → confirm it appears in local Studio (`http://127.0.0.1:54323` → Auth → Users) and Mailpit (`http://127.0.0.1:54324`) for any confirmation mail.
- [x] **P.8 Cloudflare account access.** Confirm you can log into `dash.cloudflare.com` for the target account. `pnpm exec wrangler login` (one-time, opens browser). `pnpm exec wrangler whoami` to confirm.
- [x] **P.9 Supabase CLI auth + link.** `pnpm exec supabase login` (one-time) and `pnpm exec supabase link --project-ref hwmuiymhjgewtymymbmb`. Linking enables `supabase db push` / `db pull` against the hosted project from this repo.

**Prereq gate:** `pnpm dev` against local Supabase completes signup; `pnpm exec wrangler whoami` and `pnpm exec supabase --version` both succeed.

## Phase tracker (overview)

- [ ] **Phase 0** — Secret hygiene & repo audit
- [ ] **Phase 1** — Supabase project verification (prerequisite gate)
- [ ] **Phase 2** — Local dev parity & env-swap to production
- [ ] **Phase 3** — Supabase schema baseline (initial migration)
- [ ] **Phase 4** — Cloudflare account & API token setup
- [ ] **Phase 5** — Production secrets via `wrangler secret put`
- [ ] **Phase 6** — First **manual** deploy + smoke verification
- [ ] **Phase 7** — Automate deploy in CI (gated on Phase 6 success)
- [ ] **Phase 8** — Backup discipline & observability
- [ ] **Phase 9** — Documentation & handoff

---

## Phase 0 — Secret hygiene & repo audit

The Explore agent reported `.env.local` contains real Cloudflare + Supabase credentials. Confirm they have never reached git.

- [x] 0.1 Confirm `.env.local` and `.dev.vars` are both in `.gitignore`. ✓ Already covered by `.env*` (line 34) and `.dev.vars` (line 58) in [.gitignore](.gitignore).
- [ ] 0.2 `git log --all --full-history -- .env.local .dev.vars .env` to confirm neither file was ever committed.
- [ ] 0.3 If any secret-bearing file shows up in history: rotate the affected token/key immediately (Cloudflare API token at `dash.cloudflare.com/profile/api-tokens`, Supabase keys via project settings → API) before continuing.
- [ ] 0.4 Verify `lefthook.yml` runs Prettier/ESLint; no change needed, just confirmation.

**Gate:** no real secret is reachable in git history; `.env.local` and `.dev.vars` are gitignored.

---

## Phase 1 — Supabase project verification (prerequisite gate)

An empty hosted project exists. Before wiring it up, confirm it's the right shape — region especially is load-bearing per the infrastructure.md pre-mortem.

- [ ] 1.1 Project ref is **`hwmuiymhjgewtymymbmb`** (was in the original `.env.local` before P.6 overwrote it with local values; confirm via Supabase dashboard → Project Settings → General).
- [ ] 1.2 **Verify region.** Project Settings → General → Region. Must be `eu-central-1` (Frankfurt) or another EU region for a Polish school. If it is in `us-east-1` or similar, **stop**: either re-create the project in EU now (data loss is fine — it's empty) or accept the latency hit and document it in the risk register. Do not proceed to Phase 5 without a clear answer.
- [ ] 1.3 Project Settings → API: copy `Project URL`, `anon` / Publishable key, and `service_role` / Secret key to a scratchpad (not the repo). These become `SUPABASE_URL`, `SUPABASE_KEY` (Publishable), and `SUPABASE_SERVICE_ROLE_KEY` (Secret) later.
- [ ] 1.4 Project Settings → Database → Connection string: confirm direct connection works from your machine (`psql "<conn-string>" -c "select 1;"`). If the network blocks 5432, note it — you'll need the pooler URL for migrations.
- [ ] 1.5 Auth → Providers: confirm Email is enabled. Auth → URL Configuration: leave Site URL blank for now; you'll set it to the Workers URL after the first deploy (Phase 6.6).
- [ ] 1.6 Record the project ref, region, and pooler/direct connection strings in a local note (not committed).

**Gate:** project ref known, region is EU (or risk explicitly accepted), three API keys captured locally, DB reachable.

**Edge case:** if the empty project is on the free tier and you anticipate inactivity, Supabase will pause it after 7 days idle. Document the project ref somewhere durable so you can un-pause it.

---

## Phase 2 — Local dev parity & env-swap to production

The primary dev path is **local Supabase** (set up in P.5–P.7). This phase formalises the env-swap so you can point `pnpm dev` at the hosted project for a quick smoke test without breaking the default local flow.

- [ ] 2.1 Create an `.env/` directory at the repo root with two profile files:
  - `.env/local.vars` → `SUPABASE_URL=http://127.0.0.1:54321` + local Publishable key.
  - `.env/prod.vars` → hosted `SUPABASE_URL` (base URL, no `/rest/v1/`) + hosted Publishable key (from Phase 1.3).
  - **First**, add an explicit `.env/` line to [.gitignore](.gitignore) (do this before creating the directory, not after). The `.env*` glob _may_ cover it, but directory matching is implementation-dependent — the explicit entry removes all doubt. Verify with `git check-ignore .env/prod.vars` after adding.
- [ ] 2.2 Add two scripts to [package.json](package.json) for ergonomics (they only copy files — no secrets in the script body):
  ```json
  "env:local": "cp .env/local.vars .env.local && cp .env/local.vars .dev.vars",
  "env:prod":  "cp .env/prod.vars  .env.local && cp .env/prod.vars  .dev.vars"
  ```
- [ ] 2.3 `pnpm env:local && pnpm dev` → run the smoke test (signup → dashboard → signout) against local Supabase. This is the default loop.
- [ ] 2.4 `pnpm env:prod && pnpm dev` → repeat the smoke test against hosted Supabase. **Use a throwaway email** and delete the test user in Supabase Studio afterwards. **Rule:** read-only smoke only; never run destructive operations against production via env-swap.
- [ ] 2.5 Run `pnpm env:local` again after the prod smoke test so you don't accidentally develop against production.
- [ ] 2.6 If signup fails on either env with a workerd/Node compat error, capture the stack and check against the infrastructure.md `nodejs_compat` risk row before adding workarounds.

**Gate:** both env modes work; default state is local; switching takes a single command.

**Edge case:** Astro 6 + `@astrojs/cloudflare` reads `.env.local` for `astro dev` and `.dev.vars` for `wrangler dev`. The env-swap scripts write both so either dev command stays in sync.

---

## Phase 3 — Supabase schema baseline

`supabase/config.toml` exists but `schema_paths` is empty. Establish the migration discipline now while the schema is small.

- [ ] 3.1 If you skipped P.9 earlier, run it now: `pnpm exec supabase login` + `pnpm exec supabase link --project-ref hwmuiymhjgewtymymbmb`.
- [ ] 3.2 Decide scope of the first migration. Minimum needed is **none** if only `auth.users` is used. If catalog tables (courses, teachers, students, placements, plans, variants) are ready to be defined per [context/foundation/prd.md](context/foundation/prd.md), create them now via `pnpm exec supabase migration new initial_catalog`.
- [ ] 3.3 Recommendation: ship a minimal first migration that adds RLS-enabled empty tables for `courses`, `teachers`, `students`, `placements`, `plans`, `variants` — schemas can evolve, but RLS-from-day-one prevents accidental open data later.
- [ ] 3.4 `pnpm exec supabase db push` to apply migrations to the **hosted** project (whichever ref is linked — confirm with `pnpm exec supabase projects list` and check for the `LINKED` marker next to `hwmuiymhjgewtymymbmb`). Verify tables appear in hosted Studio.
- [ ] 3.5 Add `supabase/migrations/` to the repo. Do **not** commit `.branches/` or `.temp/` (already covered by [supabase/.gitignore](supabase/.gitignore)).

**Gate:** hosted project has the same schema as the repo's migrations directory; `pnpm exec supabase db diff` returns clean.

**Edge case:** if you'd rather defer schema work, skip 3.2–3.4 and just confirm `auth.users` is reachable. Mark Phase 3 as deferred and revisit before the first feature that needs persistence.

---

## Phase 4 — Cloudflare account & API token

- [ ] 4.1 `pnpm exec wrangler login` (already done in P.8 — re-confirm with `pnpm exec wrangler whoami`).
- [ ] 4.2 Create a scoped API token at `dash.cloudflare.com/profile/api-tokens` → "Create Token" → custom token with:
  - Permissions: `Account → Workers Scripts → Edit`, `Account → Workers KV Storage → Edit` (only if KV bindings are added later), `Account → Account Settings → Read`.
  - Account Resources: include only this account.
  - Zone Resources: none (no DNS scope).
  - TTL: leave default; rotate annually.
- [ ] 4.3 Save the token value securely (password manager). It's shown once. **Do not** put it in `.env.local`.
- [ ] 4.4 Record the **Cloudflare Account ID** (visible in any dashboard URL or in `wrangler whoami` output). You'll need it for CI.

**Gate:** scoped CI token generated and stored outside the repo; account ID captured.

---

## Phase 5 — Production secrets via `wrangler secret put`

> **⚠ Source of truth:** paste values from the **hosted Supabase dashboard** (captured in step 1.3), NOT from `.env.local` or `.dev.vars` — those currently hold **local** stack credentials (`127.0.0.1:54321`). If in doubt, re-open Project Settings → API for project `hwmuiymhjgewtymymbmb` and copy fresh.

- [ ] 5.1 `pnpm exec wrangler secret put SUPABASE_URL` → paste the hosted project's URL from 1.3 (looks like `https://hwmuiymhjgewtymymbmb.supabase.co`).
- [ ] 5.2 `pnpm exec wrangler secret put SUPABASE_KEY` → paste the hosted project's Publishable (anon) key from 1.3.
- [ ] 5.3 Decide: does any server code path need the **Secret** (service role) key? Currently [src/lib/supabase.ts](src/lib/supabase.ts) uses only the Publishable key + cookie session. If not needed, do **not** push the Secret key to Workers — keeps blast radius small. If needed (e.g., admin API route), `pnpm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY` and gate its usage carefully.
- [ ] 5.4 `pnpm exec wrangler secret list` → confirm names (values never displayed).

**Gate:** production Worker has exactly the secrets it needs, no more.

---

## Phase 6 — First **manual** deploy + smoke verification

This is the human-gated first push. Don't automate yet — we want to see it work once by hand.

- [ ] 6.1 `pnpm install --frozen-lockfile` → `pnpm exec astro sync` → `pnpm lint` → `pnpm build`. Same gates as CI. Use the `/verify` skill to drive this.
- [ ] 6.2 Inspect bundle size. `pnpm exec wrangler deploy --dry-run` reports it. The Worker bundle itself must stay under 3 MB compressed (free) or 10 MB (paid). Treat 7 MB as a yellow line.
- [ ] 6.3 `pnpm exec wrangler deploy`. Capture the deployment URL printed at the end (`https://<name>.<subdomain>.workers.dev`).
- [ ] 6.4 In a second terminal: `pnpm exec wrangler tail` while exercising the deployed URL.
- [ ] 6.5 Smoke test in a browser:
  - GET `/` → renders.
  - Sign up a throwaway test user → success; user appears in Supabase Auth → Users.
  - Sign in → redirected to `/dashboard`.
  - Sign out → session cleared.
  - Hit `/dashboard` unauthenticated → middleware redirects.
  - **Note:** if the project has email confirmation enabled, the confirmation link in the email will point to the wrong URL until 6.6 is done. Options: (a) temporarily disable email confirmation in Auth → Providers → Email before this test, (b) accept the broken link and just verify the user row is created, or (c) swap the order and do 6.6 first (safe — the Workers URL already exists from 6.3).
- [ ] 6.6 Supabase Auth → URL Configuration → Site URL: set to the Workers URL from 6.3. Add it to "Redirect URLs" too if email confirmation is enabled. **Do this immediately after 6.3 if you want confirmation emails to work during 6.5.**
- [ ] 6.7 `pnpm exec wrangler deployments list` → confirm the deployment is recorded. Note the deployment ID — that's your rollback target if 6.5 reveals a regression.

**Gate:** the deployed app passes the same smoke test path as local dev, end-to-end against the hosted Supabase project.

**Edge case (workerd-specific):** if signup works locally but fails in production with a `nodejs_compat` error, the deploy bundle has a runtime gap that didn't surface in `pnpm dev`. Resolution: check `wrangler tail` for the missing module, identify which dep dragged it in, consider swapping for an edge-native alternative. Do **not** disable `nodejs_compat` — Supabase JS needs it.

**Edge case (CORS / cookies):** if signin returns 200 but the session cookie isn't set on the production domain, verify the cookie's `Secure` flag is on (it must be for HTTPS) and `SameSite` is appropriate. [src/lib/supabase.ts](src/lib/supabase.ts) is the right place to inspect — don't paper over it in middleware.

**Edge case (Site URL drift):** if signup emails contain `localhost` links, you forgot 6.6. Fix and re-test.

---

## Phase 7 — Automate deploy in CI

Only after Phase 6 succeeds. The goal is to keep CI a single workflow that gates AND deploys, in that order.

- [ ] 7.1 In GitHub → repo Settings → Secrets and variables → Actions, add (or verify existing):
  - `CLOUDFLARE_API_TOKEN` (from 4.2)
  - `CLOUDFLARE_ACCOUNT_ID` (from 4.4)
  - `SUPABASE_URL` — must be the **hosted** project URL (`https://hwmuiymhjgewtymymbmb.supabase.co`), not `127.0.0.1`. If this secret doesn't exist yet, create it now. If it does exist, verify its value matches the hosted URL from 1.3.
  - `SUPABASE_KEY` — must be the **hosted** project's Publishable (anon) key, not the local stack key. Same rule: create or verify.
- [ ] 7.2 Extend [.github/workflows/ci.yml](.github/workflows/ci.yml): add a `deploy` job that:
  - `needs: [<existing build job name>]`
  - Runs only on `push` to `main` (not on PRs).
  - Uses `cloudflare/wrangler-action@v3` with the API token and account ID secrets.
  - Command: `deploy` (no `--env` flag unless multi-env is added later).
- [ ] 7.3 Merge a no-op PR to main → watch the Action → confirm deploy job runs and the Worker is updated. Verify with `wrangler deployments list`.
- [ ] 7.4 Document the rollback: `pnpm exec wrangler rollback <deployment-id>` is the panic button. Add a one-line note to [README.md](README.md) or [AGENTS.md](AGENTS.md).

**Gate:** merge-to-main produces a fresh production deploy without manual steps.

**Edge case (Supabase migrations + rollback):** the infrastructure.md operational story flags this — code rollback doesn't undo a DB migration. Convention to adopt: every migration must be additive (new columns nullable, no `DROP`). If a destructive change is unavoidable, deploy it as code that handles both shapes first, migrate second, clean up third.

**Edge case (fork-PR previews):** Workers Git integration previews are under-documented for forks; secrets are withheld. Don't accept fork PRs directly until the behavior is verified — pull the fork's branch into this repo first.

---

## Phase 8 — Backup discipline & observability

These are the infrastructure.md risk-register items that the deploy itself doesn't cover.

- [ ] 8.1 **Daily Supabase backup.** Supabase Pro includes daily PITR; free tier does not. For free tier, set up a local cron / GitHub Action that runs `pg_dump` against the pooler connection and stores the dump outside Cloudflare (local machine, Backblaze, S3, anywhere). Risk-register row 5 depends on this — without it, an account-suspension event is catastrophic.
- [ ] 8.2 **Workers Logs retention.** Free tier retention is short. For now, accept it; the pre-mortem flags this. If/when an incident is missed because of eviction, add a `event.waitUntil(...)` error-forwarding stub to Supabase or KV.
- [ ] 8.3 **Bundle size monitor.** Add `wrangler deploy --dry-run` output capture to CI as an informational step. Treat 7 MB compressed as a yellow line.
- [ ] 8.4 **Compatibility date hygiene.** When bumping `compatibility_date` in [wrangler.jsonc](wrangler.jsonc), do it in its own PR with its own preview deploy — never bundle with feature work.

**Gate:** at least daily Supabase backup verified by a successful restore-rehearsal (restore to a scratch DB and confirm row count matches).

---

## Phase 9 — Documentation & handoff

- [ ] 9.1 Update [README.md](README.md) with the production URL, the manual-deploy command, and the rollback command.
- [ ] 9.2 Fill in the resolved values at the bottom of this file (project ref, Workers URL, deployment cadence) so downstream milestone-planning skills can read ground truth.
- [ ] 9.3 Mark all phase boxes complete in this file.

---

## Critical files touched

- [.github/workflows/ci.yml](.github/workflows/ci.yml) — add deploy job (Phase 7).
- [wrangler.jsonc](wrangler.jsonc) — confirmation only; no changes expected in Phases 0–6.
- [.gitignore](.gitignore) — explicit `.env/` entry added alongside existing `.env*` and `.dev.vars` patterns.
- [package.json](package.json) — add `env:local` / `env:prod` scripts (Phase 2).
- [supabase/migrations/](supabase/migrations/) — new directory with initial migration (Phase 3).
- [README.md](README.md) — deploy/rollback documentation (Phase 9).

## End-to-end verification (after Phase 7)

1. Make a trivial visible change (e.g., edit a copy string on the landing page).
2. Open a PR → CI gates pass (lint + build) → merge to main.
3. CI deploy job runs → wrangler reports new deployment ID.
4. Open the production URL → confirm the copy change is live.
5. `pnpm exec wrangler tail` → exercise signup with a throwaway email → confirm logs flow and user appears in hosted Supabase.
6. `pnpm exec wrangler rollback <previous-id>` → confirm the previous version is restored within a minute.
7. Roll forward to current (`wrangler deployments list` → `wrangler rollback <new-id>`).

---

## Resolved values (fill during execution)

- Supabase project ref: `hwmuiymhjgewtymymbmb`
- Supabase region: `…`
- Cloudflare account ID: `…`
- Workers production URL: `…`
- First deploy ID: `…`
- Date of first production deploy: `…`
