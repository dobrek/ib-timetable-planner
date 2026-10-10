---
change_id: user-managment-research
title: User managment research
status: preparing
created: 2026-10-09
updated: 2026-10-10
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Tasks gathered (2026-10-10)

Collected from the stack assessment and health check run against the PRD
(`context/foundation/stack-assessment.md`, `context/foundation/health-check.md`, cited as "HC Fix N"
below). Nothing here has been applied yet: this session adjusted documentation only. Grouped by when
each task should land, so `/10x-roadmap` and `/10x-plan` can place them.

**Before planning**

- [ ] **Decide the email-link lifetime.** Supabase has one Email OTP Expiration for invite,
  recovery and email-change links, so "invite 72 h, reset 1 h" cannot both hold. The finding and
  options (a)/(b)/(c) are recorded under PRD Open Question 2. HC Fix 5.

**Any time (small, no dependency)**

- [ ] **Local auth config** in `supabase/config.toml`:
  - `site_url = "http://localhost:4321"`;
  - `additional_redirect_urls = ["http://localhost:4321/**", "http://127.0.0.1:4321/**"]`
    (globs are supported);
  - `minimum_password_length = 15`;
  - rename the deprecated `[inbucket]` section to `[local_smtp]` (same keys);
  - then restart the local stack.

  In the same commit, update the `config push` table in `docs/runbooks/solver-credential.md`,
  which quotes the current values. Every test password in the repo is already 15+ characters (e2e
  author 19, CI solver user 48, guard-test user 36). A developer's own `SOLVER_MACHINE_PASSWORD`
  under 15 characters would be refused on re-provisioning. HC Fix 4.
- [ ] **`pnpm db:types` script.** Make it fail-safe: write to a temp file and `mv` it into place
  only on success, because `supabase gen types … > file` empties the file when the command fails.
  Then swap the raw command in `CLAUDE.md` for it, and add it to README's script table and to the
  migration steps in § Database. HC Fix 8.
- [ ] **`.editorconfig`.** It covers Python, TOML, YAML and Deno files, which Prettier doesn't
  format. Carried over from July. HC Fix 10.

**First phase, before any policy changes**

- [ ] **Role-test harness.** Add a factory in `src/test/factories/` that:
  1. creates a user;
  2. assigns a role (admin / author / viewer / none);
  3. returns a publishable-key client signed in as that user;
  4. is registered with `teardown`.

  The precedent is `src/test/solver-credential.integration.test.ts`. Add a role-matrix suite that
  includes "no role reads nothing", and land it before the policy migration so its first red run
  proves it can fail. HC Fix 1.
- [ ] **SQL lint gate.** Add `supabase db lint --schema public --level error --fail-on error` to
  the CI `integration` job. First handle the false positive on `public.clone_plan`, whose temp
  tables are created at runtime (`20260711174905_clone_plan_include_board.sql:41`). HC Fix 7.

**Same PR as the fail-closed migration**

- [ ] **Role-aware e2e accounts.** `scripts/provision-e2e-author.mjs` upserts an `author` row into
  `user_roles`, on the `email_exists` path too. In CI the author is created after migrations run,
  so the backfill never sees it; without this, `e2e` goes red and blocks `deploy`. Add viewer and
  admin accounts, as separate Playwright projects, when their specs arrive. The solver machine user
  stays role-less. HC Fix 2.
- [ ] **`CLAUDE.md` role rules.** Text is in stack-assessment.md → Recommended Instruction File
  Additions, "Database & auth rules". The rules:
  - `public.user_roles` with `user_id` as primary key;
  - the `private` role helper as the single `SECURITY DEFINER` exception (`search_path = ''`,
    execute revoked from `anon`/`public`), which also means amending the current "No
    `SECURITY DEFINER`" bullet;
  - live role reads, never JWT claims;
  - fail-closed access;
  - machine accounts excluded from user management;
  - role checks kept out of `src/entities/timetable/`.

**With the invite / reset flows**

- [ ] **`CLAUDE.md` email-flow rules:**
  - `token_hash` + `verifyOtp` on a confirm page that needs a deliberate click (PKCE doesn't cover
    invites);
  - `redirectTo` must be allow-listed, or Auth silently uses the Site URL;
  - each new public route in `src/middleware.ts` carries a one-line reason comment.
- [ ] **CI mail capture.** Drop `mailpit` from the `-x` list in
  `.github/actions/supabase-stack/action.yml:28`, and extend the trimming comment on line 23.
  HC Fix 6.

**With the Edge Function phase**

- [ ] **Toolchain boundary, before the first function file:**
  - `tsconfig.json` `"exclude": ["dist", "supabase/functions"]`;
  - an ESLint global ignore for `supabase/functions/**`;
  - Deno pinned in `mise.toml`, plus a script and mise task running `deno check` / `deno lint`;
  - that task wired into CI `verify`.

  HC Fix 6.
- [ ] **CI for functions.** Drop `edge-runtime` from the `-x` list, and add
  `supabase functions deploy <name>` to `deploy` after `db push`. Fetch current CLI docs first.
  HC Fix 6.
- [ ] **`CLAUDE.md` Edge Function section.** Text is in stack-assessment.md. It covers:
  - doc-first `@supabase/server` (published 2026-03);
  - `withSupabase({ auth: 'user' })` with `verify_jwt = false`;
  - a live admin check before `ctx.supabaseAdmin`;
  - fixed operations with Zod validation;
  - never accepting `app_metadata` or `role` from input;
  - a separate runtime with no imports from `src/`.

**After this change**

- [ ] **One-major bumps, one per PR:** `@astrojs/react` 7, `vitest` 5, `jsdom` 30, `typescript` 7,
  `@testing-library/jest-dom` 7, `prettier-plugin-astro` 1, `devalue` 6. Minor drift is fine any
  time, outside a production solve. HC Fix 9.
- [ ] **Dependency upkeep.**
  - Drop the `GHSA-vfj7-8cjw-p6xm` ignore (braces, via steiger) once upstream ships a fix.
  - Prune any of the 19 `pnpm-workspace.yaml` overrides that upstream versions now satisfy.
  - Consider Dependabot security updates for `npm` and `uv`; today it covers actions only.

  HC Fix 10.

**Done this session (documentation only)**

- [x] README § Database → Rollback now says migrations are additive only; hosted holds real data.
- [x] `supabase/config.toml` hook comment: "enabled by hand in the dashboard, never via
  `config push`" (it previously prescribed `config push`).
- [x] `CLAUDE.md` gained "Database & auth (Supabase)", containing only rules that are true today.
- [x] PRD Open Question 2 records the email-link lifetime finding and options.

**Known drift left in place on purpose:** the applied migration
`20260810200934_custom_access_token_hook.sql:32-35` still says hosted enablement is
"`supabase config push`". Applied migrations are not edited. `CLAUDE.md` and the runbook override
it.
