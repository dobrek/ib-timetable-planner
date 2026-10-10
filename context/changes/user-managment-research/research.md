---
date: 2026-10-09T20:21:55+02:00
researcher: Claude (Opus 5.5)
git_commit: 6eb15692d2dc3db4585742dbf6fbc5cbe7245d20
branch: main
repository: ib-timetable-planner
topic: "Current state of user management, and the feasibility of a dedicated user-management module with a privilege system"
tags: [research, codebase, auth, users, rbac, privileges, rls, grants, supabase-auth, access-token-hook, middleware, astro-actions, fsd, user-managment-research]
status: complete
last_updated: 2026-10-10
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Follow-up: open questions resolved, by local-stack probes (invite with signup off, hook on refresh, ban semantics) and by author decisions (viewer, bootstrap, Edge Function, attribution, SMTP now); corrected the ban claim"
---

# Research: User management today, and the feasibility of a privilege-based user-management module

**Date**: 2026-10-09T20:21:55+02:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: [`6eb1569`](https://github.com/dobrek/ib-timetable-planner/tree/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20)
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

> Check the current state of user management in the application. On top of this, research the
> feasibility of introducing a new module dedicated to managing users in the application, with a
> system of privileges.

Scope agreed with the author before research:

- **Privilege model:** compare the options (global roles vs per-plan sharing vs multi-tenant) and recommend one.
- **In-app capabilities wanted:** all four:
  - invite/create users;
  - assign/change roles;
  - deactivate/delete;
  - self-service profile.
- **Depth:** a full feasibility document.

## Summary

### Current state: authentication only, no authorization

**Who uses the app.** It has exactly one kind of human user: a signed-in **Author**. Authors use email and password, cannot sign themselves up, and are provisioned by hand in the Supabase dashboard. This was locked in the original shaping and is restated in every PRD since ([`prd.md:39-40`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/context/foundation/prd.md#L39-L40), [`:801-807`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/context/foundation/prd.md#L801-L807)).

**What the app checks.** The middleware is deny-by-default. It resolves the user with `getUser()` and stores it in `locals.user`. Every Astro Action then checks *only* that `locals.user` is present.
- No role, claim, `user.id` or ownership is read anywhere in app code.
- The single exception is an env-var email allowlist on one ops route.

**What the database allows.** The database is one **shared workspace**:
- 16 identical `for all to authenticated using (true) with check (true)` policies;
- full DML on every table for `authenticated`;
- no owner, `created_by`, `profiles` or `user_roles` anywhere;
- every RPC is `SECURITY INVOKER`.

**The one role-based mechanism.** It belongs to a *machine* user. The Custom Access Token Hook turns the solver's `role` claim into `solver_job_writer` when `app_metadata.machine_role` is set. Every human passes through as plain `authenticated`.

**The Worker's key.** The Worker holds **only the publishable key**, by an explicit decision of record ([`deploy-plan.md:141`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/context/deployment/deploy-plan.md#L141)). Nothing at runtime can call `auth.admin.*`.

**Missing self-service.** The app has no password change, password reset, profile page, invite flow or email confirmation route. Yet the provisioning runbook tells new authors to "change the password", which no screen allows ([`author-provisioning.md:93-94`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/docs/runbooks/author-provisioning.md#L93-L94)). SMTP is not configured anywhere.

### Feasibility: feasible, with no platform blocker; three cost centres and one real decision

**Two problems that look like one.** The module splits into problems with very different costs:

1. **Authorization: who may do what.** This can be built entirely **without a secret key**:
   - a `public.user_roles` table, written by admins through their own session under RLS;
   - RLS predicates that look the role up live through a small helper in a `private` schema;
   - an action guard and a middleware guard;
   - nav items filtered by role.

   Role assignment and an app-level "deactivated" flag fall out of this for free.
2. **Account lifecycle: invite, create, ban, delete.** These are Supabase **Auth Admin API** calls, and *every one of them requires the secret key*.
   - The repo has rejected that key in the Worker three times, on recorded reasoning.
   - Supabase's documented answer is an **Edge Function** that holds the secret and checks the caller's admin role live. With that, the key never leaves Supabase.
   - Invites also need **custom SMTP**: the built-in mailer refuses non-team addresses and sends 2 emails per hour.

**Which privilege model.** **Model A, global roles within one school (`admin` / `author` / `viewer`)**, fits the product best:
- the stated population is "a few authors at one liceum";
- the shared workspace is deliberate, so authors can work on parallel variants;
- 15 of the 16 tables already partition by `plan_id`, which leaves per-plan sharing (B) open as a later extension.

**Multi-tenancy (C)** is a standing PRD non-goal. It would also force the single solver credential to span tenants.

**Cost centres, largest first:**

1. Rewriting the 16 RLS policies, plus the test harness that does not exist yet. All 36 integration suites bypass RLS with the service-role key.
2. The read-only UX sweep for viewers. This includes the generation delivery that "fires on visit" under the visitor's session.
3. The secret-key/Edge Function decision for lifecycle operations.

**Prerequisites:**
- A PRD/roadmap amendment, because the current PRD locks "single `Author` role, no human-facing access control changes".
- Some auth-config hygiene: `site_url` is still `:3000`, the minimum password length is 6, and there is no SMTP.

**Recommended direction**, detailed in [§ Phasing](#9-phasing-and-sizing):
- Ship secret-free value first: self-service password change, then roles with a viewer, then the admin page for roles and deactivation.
- Add lifecycle operations through an Edge Function as a separate, explicitly decided step.

---

## Detailed Findings, Part 1: the current state

### 1.1 Authentication: session and route protection

- **Allowlist.** [`src/middleware.ts:7-11`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/middleware.ts#L7-L11) leaves only these public:
  - the path `/auth/signin`;
  - the prefixes `/api/auth/` and `/_`;
  - asset extensions ([`:19`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/middleware.ts#L19)).
- **The `/_` prefix also exempts `/_actions/*`.** That is why every action must enforce the session itself ([`require-session.ts:3-7`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/shared/lib/actions/require-session.ts#L3-L7)). **A future role guard therefore cannot live only in the middleware.**
- **Session resolution.** It calls `supabase.auth.getUser()` on every request that reaches the Worker, before the public-path check ([`:24-38`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/middleware.ts#L24-L38)). `getUser()` is a network round-trip to Auth.
  - Per Supabase's SSR guide, it is "the only way to detect that a session ended server-side".
  - Custom JWT claims do **not** appear on the returned `User`.
  - *Corrected 2026-10-10:* it does **not** reliably see a ban. On local auth v2.189.0, an access token issued before the ban still passes `getUser()` (see [Follow-up](#follow-up-research-2026-10-10)).
- **Locals.** The only field is `App.Locals { user: User | null }` ([`src/env.d.ts:1-5`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/env.d.ts#L1-L5)).
- **Auth endpoints:**
  - `POST /api/auth/signin` calls `signInWithPassword` and reads `formData` without Zod. Errors redirect to `?error=` ([`signin.ts:4-20`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/pages/api/auth/signin.ts#L4-L20)).
  - `POST /api/auth/signout` calls `signOut()` with the default *global* scope ([`signout.ts:4-10`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/pages/api/auth/signout.ts#L4-L10)).
  - The sign-in UI is the `src/_pages/sign-in/` slice: a hand-rolled `useState` form that does a native POST.
- **Flows that do not exist.** Grep for `updateUser`, `resetPasswordForEmail`, `exchangeCodeForSession`, `verifyOtp`, `signUp`, `inviteUserByEmail` and `auth/callback` finds nothing. There is no password change or reset, no profile, no invite, no confirm route and no signup (the last by design).

### 1.2 Supabase clients and keys

- **One runtime factory.** `createClient(headers, cookies)` wraps `@supabase/ssr` `createServerClient(SUPABASE_URL, SUPABASE_KEY)` ([`src/shared/api/supabase.ts:6-28`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/shared/api/supabase.ts#L6-L28)). There is **no browser client**: islands reach data only through Astro Actions.
- **Keys the Worker can hold.**
  - The `astro:env` schema declares only `SUPABASE_URL`, `SUPABASE_KEY` and `SOLVER_URL` (`astro.config.mjs:75-88`).
  - `Cloudflare.Env` has no secret key ([`src/cloudflare-env.d.ts:34-59`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/cloudflare-env.d.ts#L34-L59)).
  - `solver-container-env.ts` forwards only the publishable key ([`:4-8`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/solver-container-env.ts#L4-L8)).
- **Where the service-role key lives.** It appears **only in Node-side tooling**:
  - [`scripts/provision-e2e-author.mjs:53`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/scripts/provision-e2e-author.mjs#L53) (`auth.admin.createUser`);
  - `scripts/provision-solver-user.mjs` (`listUsers`/`createUser`/`updateUserById`);
  - the integration tests ([`src/test/load-test-env.ts:29`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/test/load-test-env.ts#L29));
  - the campaign analyzer (`scripts/solver/campaign.sh`).

### 1.3 Authorization in application code

- **The action wrapper.** `defineDomainAction({ input, run })` runs `requireSession` → `requireSupabase` → `runDomain(() => run(supabase, input))` ([`define-domain-action.ts:13-26`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/shared/lib/actions/define-domain-action.ts#L13-L26)).
  - **`run` receives `(supabase, input)` only, never the context or user**, so no domain function *can* use identity today.
  - `requireSession` checks presence only ([`require-session.ts:8-12`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/shared/lib/actions/require-session.ts#L8-L12)).
- **Error codes.** `DomainErrorCode` has no `FORBIDDEN` (or `UNAUTHORIZED`) ([`domain-error.ts:9-14`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/shared/lib/errors/domain-error.ts#L9-L14)).
- **Every action goes through `defineDomainAction`.** Grep finds no raw `defineAction(`, `context.locals` or `requireSession` under `src/_pages`.
  - The composition root is [`src/actions/index.ts:19-28`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/actions/index.ts#L19-L28). It covers about 40 actions across courses, teachers, students, placements, shelf, groupings, plans and generation.
  - It is also the **only** place env-bound dependencies are injected (`createGenerationActions({ getTransport })`, [`:8-18`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/actions/index.ts#L8-L18)).
- **Identity grep across `src/`:** `user.id`, `auth.uid`, `created_by`, `user_id`, `owner`, `app_metadata`, `user_metadata`, `getClaims` and `getSession` give **0 hits** outside generated types.
- **The only privilege check in the app.** `/api/solver/container` compares `locals.user.email` with the `SOLVER_OPS_ALLOWED_EMAILS` Worker secret:
  - when no allowlist is set, it answers 404;
  - when the email is not listed, it answers 403;
  - files: [`src/pages/api/solver/container.ts:18-27`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/pages/api/solver/container.ts#L18-L27), `src/solver-container-allowlist.ts:16-25`.

  It sits at top-level `src/`, outside steiger's view.

### 1.4 Authorization in the database: one shared workspace

- **No identity columns.** No table references `auth.users`. There is no `created_by`, `owner_id` or `user_id`, and no `profiles`, `user_roles`, `memberships` or `schools` table.
  - `plans` is the root ([`minimal_domain_schema.sql:91-97`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260602185012_minimal_domain_schema.sql#L91-L97)).
  - All 15 child tables carry a denormalized `plan_id` that cascades from it ([`plans_as_domain_root.sql:30-123`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260611180006_plans_as_domain_root.sql#L30-L123)).
  - Data is partitioned **by plan, never by user**.
- **RLS.** All 16 live tables have the same policy, `"Authenticated users have full access" … for all to authenticated using (true) with check (true)`. Examples:
  - [`minimal_domain_schema.sql:163-174`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260602185012_minimal_domain_schema.sql#L163-L174);
  - [`generation_jobs.sql:117-118`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260810200122_generation_jobs.sql#L117-L118).

  No policy references `auth.uid()`, `auth.jwt()` or `auth.role()`. The advisor warning `rls_policy_always_true` was **accepted** at F-02 with "revisit if multi-tenant isolation … ever introduced" (`archive/2026-06-01-minimal-domain-schema/plan.md:471-478`).
- **Grants:**
  - `authenticated` has DML on every table, plus `alter default privileges` covering future tables ([`grant_authenticated_table_access.sql:14,16`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260617171048_grant_authenticated_table_access.sql#L14-L16)).
  - `anon` has its four DML verbs revoked ([`revoke_anon_table_access.sql:17,19`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260617205628_revoke_anon_table_access.sql#L17-L19)). It **still holds TRUNCATE/REFERENCES/TRIGGER/MAINTAIN** on every table except `generation_jobs`, which revokes all eight ([`generation_jobs.sql:120-129`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260810200122_generation_jobs.sql#L120-L129)).
  - Function `EXECUTE` is never revoked except on the hook. That is harmless only while every RPC is INVOKER.
- **RPCs.** Every one (`clone_plan`, `place_course`, `shelve_*`, `apply_generated_placements`, `bulk_edit_student_choices`, …) is `security invoker`, `set search_path = ''`.
  - Several carry an explicit "Do NOT switch to DEFINER" comment (e.g. [`apply_generated_placements.sql:19-20`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260711202237_apply_generated_placements.sql#L19-L20)).
  - **Consequence:** RPCs inherit whatever RLS says, so a policy rewrite needs **no RPC rewrite**.

### 1.5 The machine principal: the access-token hook and `solver_job_writer`

This is the in-repo precedent for claims-based roles.

- **The hook.** [`custom_access_token_hook.sql:37-51`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260810200934_custom_access_token_hook.sql#L37-L51) reads `claims.app_metadata.machine_role`. If, and only if, that is exactly `'solver_job_writer'`, it rewrites `claims.role`; otherwise it passes the event through untouched.
  - It is `plpgsql stable`, INVOKER, touches no table, and has execute revoked from `authenticated, anon, public` ([`:53-55`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260810200934_custom_access_token_hook.sql#L53-L55)).
  - It is enabled at [`supabase/config.toml:277-279`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/config.toml#L277-L279). Hosted enablement is a manual dashboard toggle (`docs/runbooks/solver-credential.md:122-176`).
- **How the role switch works.** PostgREST connects as `authenticator` and runs `set role` to the claim's role. This needs `grant solver_job_writer to authenticator` ([`solver_job_writer_role.sql:36-40`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260810200931_solver_job_writer_role.sql#L36-L40)). The role gets column-scoped SELECT and UPDATE on `generation_jobs` only.
- **The failure mode the file owns.** If the hook is disabled, the machine user falls back to `authenticated`, which means "SILENT ESCALATION TO FULL DATABASE READ" ([`:25-30`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260810200934_custom_access_token_hook.sql#L25-L30)). It is mitigated by:
  - the solver's fail-closed `assert_role` at startup (`services/solver/src/cpsat_service/supabase.py:92-109`, `app.py:254-280`);
  - `src/test/solver-credential.integration.test.ts`.
- **Why it matters here.** Two reasons:
  1. Any human RBAC must leave the machine branch first and unchanged.
  2. Every Auth Admin endpoint authorizes on the JWT `role` claim being in `{service_role, supabase_admin}` (GoTrue source). **An admin-controlled value must never be able to flow into `claims.role`**, which the strict allowlist guarantees today.

### 1.6 The account lifecycle today

- **Authors, local.** Created in Studio → Add user ([`author-provisioning.md:26-41`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/docs/runbooks/author-provisioning.md#L26-L41)).
- **Authors, hosted.** Created in the dashboard with **Auto Confirm**, "no SMTP is configured for this project". Credentials are handed over out of band ([`:91-94`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/docs/runbooks/author-provisioning.md#L91-L94)).
- **No signup.** "Do not re-add a signup page … load-bearing for data privacy" ([`:131-135`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/docs/runbooks/author-provisioning.md#L131-L135)).
- **Scripted users:**
  - the e2e author via `scripts/provision-e2e-author.mjs`, run as the `pretest:e2e` hook;
  - the solver machine user via `scripts/provision-solver-user.mjs`;
  - a dedicated calibration-campaign author with no `machine_role` (`docs/runbooks/calibration-campaign.md:23-31`).
- **Deactivate/delete.** Documented **only** for the machine user ("delete or ban", `solver-credential.md:108-110`). There is no runbook for removing an author.
- **Auth config** ([`supabase/config.toml`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/config.toml)):
  - `enable_signup = false` (`:169`).
  - `[auth.email] enable_signup = true` is deliberate: it keeps the email provider alive (`:207`).
  - `enable_confirmations = false` (`:212`), `double_confirm_changes = true` (`:210`), `secure_password_change = false` (`:214`).
  - `minimum_password_length = 6` and `password_requirements = ""` (`:175,178`).
  - `jwt_expiry = 3600` (`:158`).
  - **`site_url = "http://127.0.0.1:3000"` (`:154`), which is wrong for the app's `:4321`** and would break any email link.
  - SMTP is commented out; `email_sent = 2` per hour (`:182`).
  - The `auth` schema is not exposed to the Data API (`schemas = ["public","graphql_public"]`, `:13`), so a user list can't be read through PostgREST.

### 1.7 Where the user surfaces in the UI

- **`SidebarLayout.astro`** reads `Astro.locals.user` ([`:16`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/app/layouts/SidebarLayout.astro#L16)). The footer shows the email, the theme toggle and a native sign-out form ([`:102-122`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/app/layouts/SidebarLayout.astro#L102-L122)). There is no user menu or profile link.
- **The dashboard** says "Signed in as {email}" (`src/_pages/dashboard/ui/DashboardPage.astro:4,11`).
- **Nav.** `NavItem = { href, label, icon }` has **no visibility or role field** ([`src/shared/config/nav.ts:4-17`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/shared/config/nav.ts#L4-L17)). `GLOBAL_NAV_ITEMS` is rendered both in the sidebar *and* as dashboard cards, so any new global item shows up in both places for everyone.

### 1.8 Tests that touch auth

- **Unit.** `define-domain-action.test.ts:46-60,130-137` checks session presence and that the session is checked before the client is resolved.
- **Integration: all 36 suites use the service-role client, which bypasses RLS** ([`load-test-env.ts:28-35`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/test/load-test-env.ts#L28-L35)).
  - The only suite that signs in as a real user is `solver-credential.integration.test.ts:62-98`. It creates a machine user (`admin.createUser`), asserts the JWT role claim and `42501` on `plans`, then calls `admin.deleteUser`.
  - **No test exercises a human `authenticated` session against RLS, or two users or roles.**
  - `src/test/factories/` has no user builder.
- **E2E.** One fixed account, `e2e-author@example.test` (`e2e/author-credentials.mjs:10-11`). The setup project saves its storageState.
  - Projects: `chromium` (signed in) and `chromium-guard` (no cookies).
  - Boundary specs: `auth.spec.ts`, `auth-guard.spec.ts` and `action-unauth.spec.ts` (a no-cookie `POST /_actions/createPlan` returns 401).

---

## Detailed Findings, Part 2: feasibility

### 2. Two problems with very different costs

| | **Authorization** (roles, privileges) | **Account lifecycle** (invite, create, ban, delete) |
|---|---|---|
| Needs Supabase secret key? | **No.** An admin writes `public.user_roles` through their own cookie session; RLS gates it. | **Yes, every call.** `/invite` and all `/admin/*` require `role ∈ {service_role, supabase_admin}`; a publishable key returns 403 `not_admin` (Supabase docs + GoTrue `requireAdminCredentials`). |
| Conflicts with a decision of record? | No | Yes, if the key enters the Worker (`deploy-plan.md:141`, `infrastructure.md:71`, `solver-credential.md:21-25`) |
| Needs SMTP? | No | Invite, reset and email change: yes. Create-with-temporary-password: no. |
| Cost driver | 16-policy RLS rewrite, guard plumbing, test harness, viewer UX sweep | A new trusted component (Edge Function or separate Worker), plus email infrastructure |

Treating these as one module would tie the cheap, valuable half to the expensive, contested half. **They should be separate slices.**

### 3. Privilege model comparison

| | **A: Global roles in one school** (`admin`/`author`/`viewer`) | **B: Per-plan sharing** (owner/editor/viewer per plan) | **C: Multi-tenant schools** |
|---|---|---|---|
| Fit with product | Matches "a few authors at one liceum" and the shared workspace that exists so authors can work on parallel variants | Cuts against the deliberate shared workspace (`archive/2026-06-01-minimal-domain-schema/change.md:17,40`; `archive/2026-06-11-multi-variant-management/research.md:146`) | **PRD non-goal** ([`prd.md:837-840`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/context/foundation/prd.md#L837-L840), [`roadmap.md:321`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/context/foundation/roadmap.md#L321)) |
| New schema | `user_roles` (+ `profiles` mirror) | A + `plans.owner_id` + `plan_members(plan_id, user_id, role)` | B + `schools`, `school_members`, `plans.school_id NOT NULL` |
| RLS rewrite | 16 policies → split read/write (~32) on a role predicate | 16 policies → predicate on `plan_id` membership (one helper serves all, since every child has `plan_id`) | B, keyed through tenant |
| Semantics to decide | What a viewer may trigger (generation, delivery on visit) | Membership of **proposal clones** (generated under the requester's session, `generation-job.ts:79+`); **delivery fires on visit to either plan** under the visitor's session ([`generation-delivery.ts:35`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/_pages/plan-detail/api/generation-delivery.ts#L35)); `clone_plan … returning id` must satisfy the new SELECT policy immediately (the repo has hit this RETURNING-vs-SELECT trap before, `solver_select_column_scope.sql:20-29`) | Platform admin vs school admin. **One solver credential** spans tenants, and a per-tenant predicate is "not expressible" with one machine user ([`solver_select_column_scope.sql:8-14`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260812141459_solver_select_column_scope.sql#L8-L14)). Shared solver capacity (`max_instances: 1`). |
| Backfill of hosted data | Insert a role row for each existing non-machine user, done inside the migration by `select … from auth.users` | Existing plans have no owner: column nullable or "null = legacy shared", plus per-plan member backfill | B + one default school |
| Relative size | **M–L** | **L** on top of A | **XL** plus a PRD reversal |

**Recommendation: A.** It delivers the ask (admin, roles, viewer, user management) at the lowest risk.
- It also revives the **Viewer** role. That role was deferred to "v2" in 2026-06 and then dropped from later PRDs without a recorded decision (§ Historical Context).
- B stays possible later, because the `plan_id` partitioning is already in place and A's helper functions can grow a `plan_id` argument.
- C should stay parked.

### 4. Where roles live: `app_metadata` vs a roles table

- **`raw_app_meta_data`.** Users cannot write it, so it is safe for authorization (Supabase RLS guide). It is already in the JWT, and it is what the machine role uses.
  - **But only the Admin API can write it**, which needs the secret key.
  - **Soft delete wipes it** (GoTrue `SoftDeleteUser`).
- **`user_metadata`.** Users can write it with `updateUser({ data })` using the publishable key. **It must never carry authorization.** It is fine for a display name.
- **`public.user_roles`.** This is Supabase's official RBAC guide pattern. **An admin can write it in-app through their own session under RLS, with no secret key.** It is also auditable, FK-able and live-checkable. **Recommended for human roles.** Keep `machine_role` in `app_metadata`, so the two mechanisms never mix.
- **Design notes:**
  - Make `user_id` the **primary key** (one role per user). The official guide's `unique(user_id, role)` lets the hook pick an arbitrary role.
  - Reference `auth.users(id) on delete cascade`.
  - **Lock the GRANT layer explicitly.** `alter default privileges` hands `authenticated` full DML on every new table ([`grant_authenticated_table_access.sql:16`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260617171048_grant_authenticated_table_access.sql#L16)). Revoke all eight verbs from `anon`, and verify with `has_table_privilege` per the repo lesson.
  - Add a **"cannot remove or demote the last admin"** guard (trigger or constraint).
  - A self-editable `profiles` table (display name, mirrored email) should be **separate**. Column grants are per-role, not per-row, so one table cannot let a user edit their own display name but not their own role.

### 5. Enforcement mechanism for Model A

| | **A1: JWT claim** (Supabase RBAC guide) | **A2: live lookup in RLS** | **A3: Postgres role per app role** (solver precedent) |
|---|---|---|---|
| How | Extend the hook: read `user_roles` and add a `user_role` claim. Policies read `(select auth.jwt()->>'user_role')`. | Policies call `(select private.app_role())`, a `security definer` helper in a non-exposed `private` schema that reads `user_roles` by `auth.uid()` | Hook sets `claims.role = 'app_viewer'` etc.; GRANTs do the enforcing |
| Revocation latency | Up to `jwt_expiry` (3600 s); the hook fires on `token_refresh` | **Immediate** | Up to `jwt_expiry` |
| Hook change | Yes. It starts reading a table; a hook failure then breaks sign-in and refresh for **everyone** (2 s timeout, errors not retryable, hooks still "Beta") | **None.** The hook keeps its "touches no table" property | Yes |
| If hook disabled | Claim missing → must mean least privilege | Not applicable | **Fails open** (viewer → `authenticated` = full write) unless grants are inverted so `authenticated` is the least-privileged role |
| Per-request cost | None (claim) | One PK lookup per *statement* (initPlan-cached when wrapped in `select`) | None |
| Repo rule friction | — | A **scoped exception** to "no SECURITY DEFINER": `private` schema, `search_path=''`, execute revoked from `anon`/`public`. Supabase's own guide also makes `authorize()` DEFINER and warns never to put one in an exposed schema | Docs are ambivalent: the hook schema restricts `role` to `anon`/`authenticated`, though the solver proves overriding it works |

**Recommendation: A2 for enforcement, with policies split into read and write predicates.**
- Name the helpers by **capability** (`private.can_read()`, `private.can_edit()`, `private.is_admin()`), not by role. A `role_permissions` table can then slot in behind them later without rewriting policies. For three roles, a permissions table is YAGNI.
- **A security win comes free with this.** If even the *read* predicate requires a role row, the machine user can no longer fall back to full read. It has no row, so with the hook disabled it degrades to `authenticated` and is denied everything. That **closes the documented "silent escalation to full database read" hazard** ([`custom_access_token_hook.sql:25-30`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260810200934_custom_access_token_hook.sql#L25-L30)).
- **The <200 ms drag-drop budget is safe.** A capability check is one indexed PK lookup per statement, not per row. Policies must use the `(select …)` wrapper and `to authenticated`.
- **RLS alone gives poor errors.** RLS-denied `UPDATE`/`DELETE` affect **0 rows silently**; only `INSERT` raises `42501`. An action-level guard is still needed for clear `FORBIDDEN` errors, with RLS as defence in depth.

### 6. Account lifecycle without putting the secret key in the Worker

| Option | Secret location | Fit |
|---|---|---|
| **Edge Function** (`@supabase/server` `withSupabase({ auth: 'user' })`): verifies caller JWT, live `is_admin` check, then calls `ctx.supabaseAdmin.auth.admin.*` | Supabase platform (auto-injected `SUPABASE_SECRET_KEYS`) | **Supabase's documented path.** The Worker calls it with the user's session. New: Deno runtime + a `supabase functions deploy` step in CI `deploy`. **Requires new API keys and asymmetric JWT signing keys**, because `@supabase/server` rejects legacy HS256 JWTs. The package dates from 2026-03, after the knowledge cutoff, so verify it. |
| Separate admin Worker behind a Cloudflare **service binding** | That Worker's secrets | Not internet-reachable; JWT verification and the admin check are self-implemented; a second Worker to deploy. |
| Secret key as a Worker secret in the app Worker (named `sb_secret_…` key, injected at the `src/actions/index.ts` composition root) | App Worker | Simplest code, but **reverses the decision of record**: any SSRF, log leak or dependency compromise in the app Worker becomes a full BYPASSRLS read of student PII. |
| SECURITY DEFINER SQL | — | Fine for **own tables** (roles, deactivation flag, profiles). Direct inserts into `auth.users` are the documented cause of "Database error saving new user", and send no email. Not viable for create or invite. |
| Management API | PAT/OAuth (account-scoped) | Strictly more powerful than a secret key. Use only from CI for config (SMTP, templates). |
| Dashboard / runbook (today) | Human | Zero code; keep as the fallback. |

**Compromise radius.** With an Edge Function, a compromised app Worker can at worst replay an admin's in-flight JWT while that admin is active. With the secret in the Worker, it can read all data at any time. **Recommendation: an Edge Function**, as a separately decided slice.

**Lifecycle semantics from the docs:**
- **Deactivate.** Two layers:
  - An **app-level `active` flag** in `user_roles`, read by A2. It cuts data access immediately and needs no secret.
  - A **ban** (`updateUserById(id, { ban_duration })`) blocks refresh and sign-in.
    - *Corrected 2026-10-10 by probe:* on local auth v2.189.0, a token issued before the ban **still passes `getUser()` and PostgREST (HTTP 200)** until it expires, up to `jwt_expiry` = 1 h.
    - GoTrue master adds a pre-ban-token rejection (`auth.go:36-38`); whether hosted runs it is unverified.
    - **The ban is therefore not an immediate cut-off.**

  The app-level flag is what makes deactivation immediate. A ban is a complement for permanent removal.
- **Delete.**
  - **Hard delete** cascades `auth.sessions`, and is blocked (`23503`) by any `NO ACTION` FK to `auth.users`. Today no FK exists.
  - Use `on delete cascade` for `user_roles`/`profiles`, and `on delete set null` for any future attribution column on shared data. Deleting a teacher must never delete timetables.
  - **Soft delete** keeps the row, but obfuscates email, wipes `app_metadata` and is irreversible.
  - Prefer deactivation, and keep delete as a rare admin action.
- **Create vs invite.**
  - **Create** is `createUser({ email, password, email_confirm: true })` plus a `must_change_password` flag. It needs **no SMTP**, mirrors today's runbook, and suits v1.
  - **Invite** needs custom SMTP and an invite template linking to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`. PKCE does not cover invites.
  - Invite also needs a new public `/auth/confirm` route, which **widens the middleware allowlist** and needs a recorded reason.
  - Beware **link prefetching**: Microsoft Defender Safe Links can consume one-time links, and a school is likely on M365. Use a confirm page with a POST button, or OTP-code entry.
- **Who appears in the user list.** The **solver machine user and the campaign account are ordinary Auth users**. An admin list must filter `app_metadata.machine_role` out, and lifecycle actions must refuse to touch them. The Edge Function must never accept `app_metadata`/`role` from input.

### 7. Self-service: mostly secret-free

- **Password change.** `updateUser({ password, current_password })` works with the user's own session and the publishable key. `current_password` needs supabase-js ≥2.102; the repo is on `^2.116.0`.
  - Enable "Require current password".
  - "Secure password change" (reauthentication) adds an emailed nonce for sessions older than 24 h, so it needs SMTP.
  - **This closes the runbook gap** ("change the password") and is the cheapest valuable slice.
- **Display name.** Either `updateUser({ data: { display_name } })`, or a `profiles` row. An admin list needs the `profiles` mirror either way, because `auth` is not exposed.
- **Email change.** `double_confirm_changes = true` sends a confirmation to both addresses, so it **needs SMTP** and an `/auth/confirm` route.
- **Forgot password.** `resetPasswordForEmail` plus a recovery template with `token_hash`, then `verifyOtp` in `/auth/confirm`, then `updateUser({ password })`. It needs **SMTP, a correct `site_url` and an allow-listed redirect**. Otherwise `redirectTo` is silently replaced by the Site URL.

### 8. Module shape in the FSD layout (placement)

**Pages and routes:**
- **Admin page.** A new `src/_pages/users/` slice (api/model/ui), modelled on the global `plans-list` slice and the `teachers` CRUD anatomy:
  - RHF + Zod shared schema;
  - shadcn `Table`/`Dialog`/`AlertDialog`;
  - `submitForm` + `callAction`.

  Route: `src/pages/users.astro` or `src/pages/admin/users.astro`. 10 `_pages` slices exist today, against steiger's `excessive-slicing` threshold of 20.
- **Account page.** `src/_pages/account/` plus `src/pages/account.astro`, linked from the sidebar footer next to the email ([`SidebarLayout.astro:102-122`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/app/layouts/SidebarLayout.astro#L102-L122)).

**Plumbing:**
- **Role type and capability predicates** must live in **`shared`** (e.g. `src/shared/lib/auth/`), because the action guard in `shared/lib/actions` cannot import upward from `entities`.
- **Action guard.**
  - Add `requireRole`/`requireCapability` next to `require-session.ts`, plus a `defineDomainAction({ requires })` option. A sibling `defineAdminAction` would also work.
  - Add `FORBIDDEN` to `DomainErrorCode`, and map Postgres `42501` to it.
  - Self-service and admin domain functions need the caller's id, so **`run`'s signature must grow** (e.g. `run(supabase, input, { userId })`). That touches the shared wrapper but none of the ~40 existing call sites.
- **Middleware.** Add a path→capability map after [`middleware.ts:40`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/middleware.ts#L40), and `locals.role` in `src/env.d.ts`.
  - The role read can run **in parallel** with `getUser()` (both use the cookie session), so it adds little wall-clock time.
  - Alternatively, load it lazily only for gated paths and admin actions. Hot-path drag-drop actions can rely on RLS plus error mapping.
- **Nav.** Add `requires?: Capability` to `NavItem`, and filter in **both** `SidebarLayout` and `DashboardPage`.
- **Admin transport.** Inject `createUserAdminActions({ getAdminTransport })` at `src/actions/index.ts`, mirroring `createGenerationActions({ getTransport })`. When unconfigured it returns `null` and the UI degrades to "unavailable", the same as the solver transport.

**Viewer read-only sweep.** Every mutation affordance in `plan-detail` (drag-drop, shelf, generation buttons), the catalog pages and `plans-list` needs a `canEdit` gate.
- `widgets/timetable-board` is already a read-only composition used by the perspective views, which helps.
- **Delivery-on-visit and the S-304 "interrupted" marking write under the visitor's session.** They must be skipped for viewers, or RLS will reject them.

### 8a. Testing implications

- **A new integration harness is needed.** It should sign in real users per role with the publishable key; `solver-credential.integration.test.ts` is the template (`admin.createUser` in `beforeAll`, `admin.deleteUser` in `afterAll`, assert `42501` and `has_table_privilege`). That **also unblocks the deferred test-plan "Phase 2.5 cross-author/IDOR" item** (`context/foundation/test-plan.md:467-473`).
- **`provision-e2e-author.mjs` and CI must assign a role** to the e2e author. Otherwise every e2e spec breaks once policies require a role row.
- Add a second e2e account and storageState (viewer), plus guard specs for `/users` and admin actions.
- `define-domain-action.test.ts` needs cases for the new guard.

### 9. Phasing and sizing

The sizes are relative T-shirt sizes. A user-management initiative is a new PRD generation; by the per-change ID convention, its IDs would be the next series (`FR/US/S/F-4XX`).

| Phase | Content | Needs secret? | Needs SMTP? | Size |
|---|---|---|---|---|
| **P0: hygiene and decisions** | Fix `site_url`/redirects; raise password policy; PRD amendment (roles, Viewer revived); confirm hosted is on new API keys + asymmetric JWT signing keys (legacy keys deprecated end-2026); pick an SMTP provider (shared with S-310 job-completion email) | No | Decide | S |
| **P1: account page** | Password change (`current_password`), display name | No | No | S |
| **P2: roles foundation** | `user_roles` (+`profiles`), grant lockdown, `private` capability helpers (scoped DEFINER exception), backfill existing authors in-migration, rewrite 16 policies (read/write split), `FORBIDDEN` + `42501` mapping, action/middleware guards, `locals.role`, nav gating, role-aware integration harness, e2e roles | No | No | **L** |
| **P3: viewer read-only UX** | `canEdit` sweep across plan-detail/catalog/plans-list; gate delivery-on-visit | No | No | M |
| **P4: admin page, roles and status** | List users (`profiles`), change role, deactivate/reactivate (app flag), last-admin guard, hide machine/campaign accounts | No | No | M |
| **P5: lifecycle operations** | Edge Function: create (temporary password + forced change), ban, delete; CI deploy step; runbook rewrite | **Yes (in Supabase)** | No | M–L |
| **P6: email flows** | Invite, forgot password, email change via `/auth/confirm` (allowlist widening), templates, Safe-Links-safe confirm | Invite: yes | **Yes** | M |
| *(later)* B: per-plan sharing | `owner_id`, `plan_members`, membership-keyed helpers, clone/proposal/delivery semantics | No | No | L |

**Feasibility verdict.** No platform blocker exists. P0–P4 deliver role assignment, deactivation, a viewer and self-service **without changing the key posture**. P5/P6 are where the real decision sits: a new trusted component, SMTP, and widening the public-route allowlist. They should be planned and approved on their own.

---

## Code References

- [`src/middleware.ts:7-11`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/middleware.ts#L7-L11): public allowlist; `/_` exempts `/_actions/*`.
- [`src/middleware.ts:24-42`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/middleware.ts#L24-L42): `getUser()` per request → `locals.user` → redirect.
- [`src/env.d.ts:1-5`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/env.d.ts#L1-L5): `App.Locals` has only `user`.
- [`src/shared/api/supabase.ts:6-28`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/shared/api/supabase.ts#L6-L28): the single (publishable-key) client factory.
- [`src/shared/lib/actions/define-domain-action.ts:13-26`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/shared/lib/actions/define-domain-action.ts#L13-L26): action wrapper; `run(supabase, input)` gets no identity.
- [`src/shared/lib/actions/require-session.ts:3-12`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/shared/lib/actions/require-session.ts#L3-L12): presence-only guard; why actions self-guard.
- [`src/shared/lib/errors/domain-error.ts:9-14`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/shared/lib/errors/domain-error.ts#L9-L14): no `FORBIDDEN` code.
- [`src/actions/index.ts:8-28`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/actions/index.ts#L8-L28): composition root and dependency-injection precedent.
- [`src/shared/config/nav.ts:4-25`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/shared/config/nav.ts#L4-L25): `NavItem` without visibility.
- [`src/app/layouts/SidebarLayout.astro:16,102-122`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/app/layouts/SidebarLayout.astro#L102-L122): user email and sign-out in the shell.
- [`src/pages/api/auth/signin.ts:4-20`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/pages/api/auth/signin.ts#L4-L20) and `signout.ts:4-10`: the only auth endpoints.
- [`src/pages/api/solver/container.ts:18-27`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/pages/api/solver/container.ts#L18-L27) and `src/solver-container-allowlist.ts:16-25`: the only app-level privilege check (email allowlist).
- [`src/_pages/plan-detail/api/generation-delivery.ts:35`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/_pages/plan-detail/api/generation-delivery.ts#L35): delivery triggered by a plan visit, under the visitor's session.
- [`supabase/migrations/20260602185012_minimal_domain_schema.sql:163-174`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260602185012_minimal_domain_schema.sql#L163-L174): the `using (true)` policy template.
- [`supabase/migrations/20260611180006_plans_as_domain_root.sql:30-123`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260611180006_plans_as_domain_root.sql#L30-L123): `plan_id` on every child table.
- [`supabase/migrations/20260617171048_grant_authenticated_table_access.sql:14-16`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260617171048_grant_authenticated_table_access.sql#L14-L16): blanket DML plus default privileges.
- [`supabase/migrations/20260617205628_revoke_anon_table_access.sql:17-19`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260617205628_revoke_anon_table_access.sql#L17-L19): `anon` DML revoke (four verbs only).
- [`supabase/migrations/20260810200122_generation_jobs.sql:117-129`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260810200122_generation_jobs.sql#L117-L129): all eight `anon` verbs revoked; the model for new tables.
- [`supabase/migrations/20260810200931_solver_job_writer_role.sql:36-40`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260810200931_solver_job_writer_role.sql#L36-L40): custom PG role reachable via `authenticator`.
- [`supabase/migrations/20260810200934_custom_access_token_hook.sql:1-55`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260810200934_custom_access_token_hook.sql#L1-L55): hook, allowlist, fail-open warning.
- [`supabase/migrations/20260812141459_solver_select_column_scope.sql:8-29`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260812141459_solver_select_column_scope.sql#L8-L29): a per-dispatch predicate isn't expressible with one machine user; the RETURNING-vs-SELECT trap.
- [`supabase/config.toml:13,154-214,277-279`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/config.toml#L154-L214): auth settings, `site_url`, hook enablement.
- [`scripts/provision-e2e-author.mjs:53`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/scripts/provision-e2e-author.mjs#L53): admin-API user creation (Node, service-role).
- [`src/test/load-test-env.ts:28-35`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/src/test/load-test-env.ts#L28-L35): integration lane requires the service-role key (RLS bypass).
- `src/test/solver-credential.integration.test.ts:62-98`: the only real-sign-in test; the template for a role harness.
- [`docs/runbooks/author-provisioning.md:91-94,131-135`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/docs/runbooks/author-provisioning.md#L91-L94): manual provisioning; "change the password" gap; no-signup rule.
- [`docs/runbooks/solver-credential.md:21-25`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/docs/runbooks/solver-credential.md#L21-L25): the "no secret key" rationale.
- [`context/deployment/deploy-plan.md:141`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/context/deployment/deploy-plan.md#L141): decision of record "Secret key NOT pushed".

## Architecture Insights

- **Authentication and authorization are cleanly separated today, because authorization is absent.** Every gate is presence-only:
  - `requireSession` in actions;
  - `isPublicPath` plus `locals.user` in middleware;
  - `using (true)` in the database.

  Adding privileges means threading identity through a wrapper that was deliberately built **not** to pass it (`run(supabase, input)`). That is a one-file change in `shared`, but it is a contract change.
- **Defence in depth is the house style.** Grants pin reachability, RLS pins rows, and tests prove posture with `has_table_privilege`, not by reading migration text (`lessons.md:47-52`). A privilege system must respect all three layers, and new tables must revoke the auto-granted DML explicitly.
- **"Fail closed" is a repeated, explicit value.** Examples are the hook allowlist, the solver's `assert_role`, and launcher guards. The A2 design (no role row → no access) is consistent with it, and repairs the one place the current design fails open.
- **The secret-key stance is a decision of record, not an accident.** It has been restated in `deploy-plan.md:141`, `infrastructure.md:71`, `solver-credential.md:21-25` and `prd.md:712-728`. It was reconfirmed under pressure during F-301, where five alternatives were rejected. Any lifecycle design should either preserve it (Edge Function) or amend it explicitly.
- **The composition root is the dependency-injection seam.** `src/actions/index.ts` is the one place server-only, env-bound dependencies may be resolved. An admin transport belongs there, injected into a slice factory exactly like `createGenerationActions`.
- **The plan is the natural authorization unit if one is ever needed.** All 15 child tables carry `plan_id`, so per-plan sharing (B) could reuse A's capability helpers with a `plan_id` argument instead of a full redesign.

## Historical Context (from prior changes)

- **Single Author role; Viewer dropped.**
  - `context/foundation/archive/2026-06-18-shape-notes.md:56-63`: "Author — the only role in MVP … A read-only Viewer role was considered and dropped from MVP". No rationale is recorded beyond "Step 4.5".
  - `context/foundation/archive/2026-06-18-prd.md:158-168,182,188`: Access Control. Viewer is a "v2 candidate"; OQ3 asks "what does a Viewer see?".
  - The Viewer role is absent from the 2026-07-16 and current PRD non-goals and roadmaps. **It was dropped without a recorded decision.**
- **FR-001's "per-author identity for plan attribution"** (`archive/2026-06-18-prd.md:85-86`) was never built. No attribution column exists.
- **No self-signup.** `archive/2026-06-18-roadmap.md:66,74,83`: student PII "cannot sit next to open registration". Implemented by `context/archive/2026-05-29-gated-author-provisioning/`. That change chose manual creation over invites or an allowlist table, and **explicitly did not introduce a service-role key** ("avoids an unused high-priv secret", `plan-brief.md:28-36`). Invites, SMTP and the admin key were "deferred — would be v2" (`plan.md:49-56`).
- **Shared workspace.** `context/archive/2026-06-01-minimal-domain-schema/change.md:17,40` overrode the roadmap's "RLS scoped to the authenticated author" with "all authenticated users share all data". The always-true advisor warning was accepted with "revisit if multi-tenant" (`plan.md:471-478`).
- **Accepted risks recorded against the shared model** (all "revisit before opening to multiple school staff"):
  - `archive/2026-06-05-first-valid-drop-with-validation/change.md:16` (placements IDOR);
  - `archive/2026-09-01-stop-and-keep/research.md:130-134` (any user can stop any job);
  - `archive/2026-07-14-comparing-plans/plan.md:62`.
- **Machine credential design.** `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md:231-289,371-404` evaluated options A–F:
  - legacy service_role JWT;
  - a named secret key;
  - a container-signed JWT;
  - a Worker-minted JWT;
  - **machine user + hook → custom PG role (chosen)**;
  - plain `authenticated`.

  Key platform fact (`:254`): secret keys "cannot be scoped to a table, schema, or role". The spike's probe 8 (a hook misfire returns real plan names) is why the guard test is mandatory.
- **Auth-boundary testing.** `context/archive/2026-06-15-testing-auth-actions-boundary-rls/change.md:29-63` covered the unauthenticated half. **Cross-author/IDOR was deferred** as "not meaningfully testable until an ownership column + real per-author RLS land" (candidate Phase 2.5; `context/foundation/test-plan.md:67,467-473`). It also produced the "granting a role is not excluding the others" lesson and `revoke_anon_table_access.sql`.
- **Ops privilege tier.** `context/archive/2026-09-29-automate-production-calibration-campaign/plan.md:213,255-283` introduced the email allowlist `SOLVER_OPS_ALLOWED_EMAILS`: 404 when closed, 403 when denied. Its impl-review notes that it is "keyed on email, which can change" (`reviews/impl-review.md:100`). This is a precedent and a candidate to fold into an `admin` capability later.
- **Roadmap.** No current milestone mentions users, roles or admin.
  - "Multi-school tenancy" is parked ([`roadmap.md:321`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/context/foundation/roadmap.md#L321)).
  - S-310 job-completion-email (proposed, `roadmap.md:281`) needs an email provider and possibly a read-only identity. That **SMTP dependency is shared** with invites and password reset.

## Related Research

- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md`: credential options, hook spike, grant posture.
- `context/archive/2026-06-15-testing-auth-actions-boundary-rls/research.md`: auth-boundary test design; no authenticated non-service-role helper.
- `context/archive/2026-06-07-app-shell/research.md`: the shell carries only "author identity + sign-out" (`:45,87`).
- `context/archive/2026-09-29-automate-production-calibration-campaign/research.md`: dedicated campaign account; global sign-out scope (`:163-166`).
- `context/archive/2026-05-29-gated-author-provisioning/`, `context/archive/2026-06-01-minimal-domain-schema/`, `context/archive/2026-08-15-solver-deploy-lane/`, `context/archive/2026-08-12-first-verified-proposal/` (column-scoped SELECT; row narrowing deferred).

## Stale or inconsistent docs found along the way

These are not fixed in this research; each needs a one-line follow-up.

- [`README.md:459`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/README.md#L459) says "There is no production data to preserve yet", but hosted holds real school data (the README's own hosted-campaign section warns of real names). A roles backfill **must** be additive.
- [`custom_access_token_hook.sql:32-35`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/migrations/20260810200934_custom_access_token_hook.sql#L32-L35) says hosted enablement is "`supabase config push`". The runbook (`solver-credential.md:122-176`) prescribes the dashboard toggle and warns against `config push`.
- `context/foundation/tech-stack.md:73` still says "container secrets live in container config, not the Worker" (amended in `prd.md:722-728`).
- `context/foundation/test-plan.md:234,241` lists an "auth + RLS ownership integration" gate as live, while `:467` defers ownership.
- [`docs/runbooks/author-provisioning.md:94`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/docs/runbooks/author-provisioning.md#L94) asks authors to "change the password", which no screen allows.
- [`supabase/config.toml:154`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/supabase/config.toml#L154) has `site_url` on `:3000`; the app runs on `:4321`.

## Open Questions

> **Status 2026-10-10:** all ten are resolved, either by local-stack probes or by author decision. See [Follow-up Research 2026-10-10](#follow-up-research-2026-10-10). The list below is kept as originally asked.

1. **Product.** Is the Viewer role wanted now? Who are the viewers (school leadership, other teachers), and do they see drafts and proposals or only some plans? (Original OQ3, never answered.)
2. **Bootstrap.** Who is the first admin on hosted, and how are they assigned (a runbook SQL step or script by email)? What role do users created in the dashboard get afterwards: none (fail-closed, admin must assign) or a default?
3. **Backfill default.** Do all existing hosted authors become `author`, or does one become `admin`? The campaign account needs an explicit decision too.
4. **The key decision for P5.** Edge Function (keeps the decision of record) or a named secret key in the Worker (amends it)? Who signs off on amending `deploy-plan.md:141`?
5. **Platform state.** Is the hosted project on the new publishable/secret keys **and asymmetric JWT signing keys**? Is `SUPABASE_SERVICE_ROLE_KEY` in scripts and tests a legacy `eyJ…` key? Legacy keys are deprecated by end of 2026; `@supabase/server` rejects legacy HS256 JWTs.
6. **SMTP.** Which provider, shared with S-310? Until then, is create-with-temporary-password plus forced change acceptable instead of invites?
7. **Revocation SLA.** Is "data access cut immediately (A2), session ends at next refresh" enough for deactivation, or must a ban also be applied (P5)?
8. **Ops allowlist.** Should `SOLVER_OPS_ALLOWED_EMAILS` fold into an `admin` capability, or stay env-keyed so it survives a broken roles table?
9. **Attribution.** Should FR-001's never-built "per-author identity for plan attribution" (`created_by`, `on delete set null`) ride along with P2? It is cheap and is the first step towards B.
10. **To verify on the local stack before planning:**
    - whether `inviteUserByEmail` works with `enable_signup = false` (GoTrue source says yes);
    - whether `secure_password_change` means reauthentication or current password (the docs disagree);
    - whether the hook fires on `token_refresh` (docs say yes; the runbook says "never verified").

---

## Follow-up Research 2026-10-10

The author asked to work through the open questions. Six were settled by evidence, by probes against the running local stack (auth `v2.189.0`, CLI `2.117.0`) and a read of the hosted project's public JWKS. The rest were decided by the author.

### Answers

| # | Question | Answer | Source |
|---|---|---|---|
| 1 | Viewer role? | **Yes.** Roles are `admin` / `author` / `viewer`. A viewer reads **all** plans, including proposals, and edits nothing. | Author decision |
| 2 | Bootstrap | The migration backfills every existing non-machine user (`app_metadata.machine_role` absent) as **`author`**. The **project owner is promoted to `admin`** by a runbook step keyed on email. Users created later have **no role, and so no access**, until an admin assigns one (fail-closed). | Author decision |
| 3 | Backfill default | As in Q2. The calibration-campaign account is an ordinary author, so it becomes `author`, which matches what its runbook needs. The solver machine user gets no row. | Author decision + `calibration-campaign.md:23-31` |
| 4 | Lifecycle mechanism | **Supabase Edge Function** holding the secret, with a live admin check inside. `deploy-plan.md:141` ("Secret key NOT pushed") **stands unchanged**. | Author decision |
| 5 | Platform state | **Hosted signs with an asymmetric key.** Its JWKS (`/auth/v1/.well-known/jwks.json`) publishes exactly one key, `kty: EC`, `crv: P-256`, `alg: ES256`. Local tokens are ES256 too. **No legacy keys in env files.** The author ran the prefix check: `.env.test.local` holds `sb_secret_…`, and `.envs/{local,prod,prod-solver}.vars` hold `sb_publishable_…`. `.envs/campaign.vars` (`ANALYZER_SERVICE_ROLE_KEY`) is absent on this machine. The key used for hosted runs of `provision-solver-user.mjs` comes from a human shell and is not checkable here. | Probe + author's check |
| 6 | SMTP | **Resend, sending domain in eu-west-1**, shared with S-310 (its plan left the mechanism open, `roadmap.md:280`). SES eu-central-1 is the standby. See [§ SMTP provider](#smtp-provider). | Author decision, after comparison |
| 7 | Revocation SLA | **Deactivation = the app-level `active` flag**, read live by the A2 helper. That is immediate for data access. A **ban is not immediate** (see probe 3). It joins the flag in P5 as the "permanent" lever. | Probe + design |
| 8 | Ops allowlist | **Not folded.** `SOLVER_OPS_ALLOWED_EMAILS` stays env-keyed. It was email-keyed only because no roles existed (`automate-production-calibration-campaign/plan.md:255-283`). It is campaign-only, normally unset, and independent of the roles table. | Author decision |
| 9 | Plan attribution | **Yes, in P2.** See [§ Attribution](#attribution-design-notes). | Author decision |
| 10a | Invite with `enable_signup = false`? | **Works.** `inviteUserByEmail` succeeded, and Mailpit received "You have been invited". | Probe 1 |
| 10b | `secure_password_change` meaning? | **The reauthentication nonce, not current-password.** The CLI maps it to `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION`. "Require current password" (`…_REQUIRE_CURRENT_PASSWORD`) is not emitted by the local stack at all, so it is a hosted dashboard toggle and can't be rehearsed locally. | `docker inspect` of the auth container |
| 10c | Hook fires on `token_refresh`? | **Yes, and it reads fresh `app_metadata`.** | Probe 2 |

**Key-type check (done 2026-10-10).** Every env file on this machine already uses the new key format. The only items left to check before the end-2026 legacy-key retirement are the shell-held key for hosted runs of `provision-solver-user.mjs`, and `ANALYZER_SERVICE_ROLE_KEY` if a `campaign.vars` exists elsewhere. Check each when next used.

### Probe evidence

The probe was a throwaway Node script, run with `node --env-file=.env.test.local --env-file=.envs/local.vars`. It refused any URL other than `127.0.0.1:54321`, never printed a key, and deleted both users it created (0 delete failures).

| Probe | Step | Observed |
|---|---|---|
| 1. Invite, signup off | `admin.inviteUserByEmail` | `ok`; 1 message in Mailpit, subject "You have been invited" |
| 2. Hook on refresh | sign in as plain user | token `role: authenticated` (ES256) |
| | set `app_metadata.machine_role = solver_job_writer`, inspect the **old** token | still `authenticated` (claims frozen until refresh) |
| | `refreshSession` | **`role: solver_job_writer`** |
| | clear `machine_role`, `refreshSession` | back to `authenticated` |
| 3. Ban | `updateUserById(id, { ban_duration: '1h' })` | `ok` |
| | `getUser(preBanToken)` | **`ok`**: not rejected on v2.189.0 |
| | PostgREST `GET /plans` with pre-ban token | **HTTP 200** |
| | `refreshSession` | 400 `user_banned`: "Invalid Refresh Token: User Banned" |
| | `signInWithPassword` | 400 `user_banned` |

### Consequences for the design

- **Claim staleness is confirmed exactly.** A role change reaches a JWT claim only at the next refresh, at most `jwt_expiry` (3600 s). This settles A1 vs A2 in A2's favour for enforcement.
- **The `active` flag is load-bearing.** Neither a ban nor a delete ends an already-issued access token (Supabase docs say the same of delete). So:
  - the A2 helper must return "no capability" for `active = false`;
  - **the middleware must read role and active per request**, because `getUser()` still passes for a banned user on v2.189.0;
  - a deactivated user should be signed out and redirected to a notice.
- **The machine user can safely use the refresh grant.** The refresh grant re-runs the hook, so the solver's "re-sign-in rather than refresh" defensive rule (`solver-credential.md:112-118`) rests on a question that is now answered. Keeping the rule is harmless, but its rationale text is stale (added to drift below).
- **Invites need no signup toggle.** `enable_signup = false` and the no-signup runbook rule (`author-provisioning.md:131-135`) both stay intact.
- **The `@supabase/server` prerequisite looks satisfied.** Hosted publishes only an ES256 key. Still confirm in the dashboard that it is the *current* key, not a standby, and that the new API keys are enabled.

### Attribution: design notes

- Column: `plans.created_by uuid null references auth.users(id) on delete set null default auth.uid()`, plus an index if it is ever filtered on.
  - `clone_plan` is INVOKER, so `default auth.uid()` fills the column for UI clones and for **proposal clones**. A proposal is attributed to whoever pressed Generate.
  - Service-role factories, the seed and existing hosted plans get `null`, displayed as "unknown". No backfill is possible or needed.
- **Displaying "Created by"** needs the `profiles` mirror (email/display name), because `auth.users` is not exposed. This ties attribution to P4's mirror, or the column ships in P2 and the display lands with P4.
- Optional, same pattern: `generation_jobs.requested_by`. It is not decided. It is the obvious next attribution column, and S-310 needs a recipient anyway.

### Decided scope (supersedes § 9 where they differ)

| Phase | Content | Change vs § 9 |
|---|---|---|
| **P0: hygiene and decisions** | PRD amendment / new milestone (next ID series, `4XX`); fix `site_url`/redirect allow-list; stronger password policy; confirm in the dashboard that ES256 is the current key (env files are already on new keys); **set up Resend** (eu-west-1 domain, DNS, hosted custom SMTP, explicit email rate limit; local stays Mailpit) | SMTP moved here |
| **P1: account page** | Password change (`current_password`; enable "Require current password" on hosted), display name | — |
| **P2: roles foundation** | As in § 9, **plus `plans.created_by`** | + attribution |
| **P3: viewer read-only UX** | As in § 9 | Confirmed in scope |
| **P4: admin page** | List users (`profiles` mirror), change role, **deactivate/reactivate via `active` flag** (immediate), last-admin guard, hide machine users, "Created by" display | + attribution display |
| **P5: lifecycle via Edge Function** | Create, invite, ban (paired with the flag), delete; CI deploy step; runbook rewrite | Mechanism decided |
| **P6: email flows** | Invite acceptance, forgot password, email change via `/auth/confirm` (allowlist widening), templates, Safe-Links-safe confirm | **Unblocked** by P0's SMTP |
| *Out of scope* | Folding the ops allowlist, per-plan sharing (B), multi-tenant (C) | Decided |

### Additional doc drift found

- [`docs/runbooks/solver-credential.md:108-110`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/docs/runbooks/solver-credential.md#L108-L110) says "**To revoke immediately**: delete or ban the machine user". Neither is immediate: an issued access token survives until `exp` (≤ 1 h). Probe 3 shows this for a ban; the Supabase docs say it for a delete.
- [`docs/runbooks/solver-credential.md:112-118`](https://github.com/dobrek/ib-timetable-planner/blob/6eb15692d2dc3db4585742dbf6fbc5cbe7245d20/docs/runbooks/solver-credential.md#L112-L118) says whether the refresh grant fires the hook "was never verified". Probe 2 now verifies it.

### SMTP provider

Researched 2026-10-10 from current vendor and Supabase docs. One provider should serve both paths:
- **Supabase Auth custom SMTP:** invites, recovery, email change and reauthentication nonces.
- **S-310's job-finished notification:** sent with a plain `fetch` from a Worker or an Edge Function.

| | **Resend** | **AWS SES** (eu-central-1) | Postmark | Brevo | ZeptoMail | Cloudflare Email Service |
|---|---|---|---|---|---|---|
| Cost at < 1k/month | Free 3k/month, **100/day**; Pro $20 | ~$0.10 per 1k (credits model since 2025-07) | Free 100/month only; $15 for 10k | Free 300/day (unverified) | Credit packs | 3k/month included in Workers Paid |
| EU residency | Sends from eu-west-1 (Ireland), but **account data, logs and metadata are stored in the US** (DPA + SCCs + DPF) | **Fully in-region**, same region as Supabase | US only, "no plans" | EU company | EU DC claimed | Not documented |
| Supabase SMTP | `smtp.resend.com:465`, user `resend` | `email-smtp.eu-central-1…:587/465`, IAM SMTP credentials | `:587` server token | yes | yes | beta SMTP |
| Worker/Deno HTTP | plain `fetch` + Bearer | SigV4 signing (`aws4fetch`) | plain `fetch` | plain `fetch` | plain `fetch` | binding |
| Link tracking default | **Off** | Off | Off | **Can't disable for transactional mail: ruled out** (it would rewrite auth links) | Unverified | None |
| Setup effort | **Low**: Cloudflare DNS auto-setup, Supabase guide | **High**: new AWS account, sandbox exit review, IAM | Manual approval | Moderate | Approval risk | Lowest, but **beta; no GA found** |
| Deliverability evidence | No independent tests (it sends through SES) | Good to Outlook/Hotmail (small samples) | Best measured | Mixed | Untested | None |

**Recommendation: Resend**, with the sending domain `mail.ib-timetable-planner.dev` created in **eu-west-1**.
- It meets every hard requirement with the least effort: tracking is off by default, there is a documented Supabase SMTP setup, a fetch-only API works in both the Worker and Deno, and API keys can be scoped to sending on one domain.
- The free tier is about 30× this school's need.
- **The concession is data storage in the US** (under a DPA, SCCs and DPF). That is acceptable for staff emails and plan names, and **no student data is ever emailed**.

**Runner-up: AWS SES in eu-central-1**, if the school's DPO requires EU-only processing *and* storage. It costs more setup: the sandbox review, IAM, and SigV4 signing in the Worker.

Switching later is cheap. Both providers are SMTP for Auth plus a ~20-line HTTP adapter for S-310.

**Watch:** Cloudflare Email Service. It needs no new vendor and includes 3k/month on the existing paid plan, but it has been beta since 2026-04. Revisit it at GA.

**Setup checklist (Resend):**
1. **Account:** use a role mailbox and turn on 2FA.
2. **Domain:** add `mail.ib-timetable-planner.dev` with region **eu-west-1** set at creation. The API default is us-east-1, and it is unconfirmed whether the region can be changed later.
3. **DNS:** the zone is on Cloudflare, and the apex has no MX, SPF or DMARC today. Add DKIM TXT `resend._domainkey.mail`, MX and SPF TXT on `send.mail` (`v=spf1 include:amazonses.com ~all`), and `_dmarc` with `p=none` (tightened to `quarantine` later). Optionally add apex `v=spf1 -all`. Every record is **DNS-only (grey cloud)**.
4. **Keys:** create the API key `supabase-auth-smtp` (sending only, this domain) **by hand**, not through the Supabase integration, whose key scope is unverified. Later, a separate key `worker-notify` for S-310 goes in via `wrangler secret put` and is typed in `src/cloudflare-env.d.ts`.
5. **URL configuration on hosted, first:** set Site URL to `https://ib-timetable-planner.dev`, plus the redirect allow-list.
6. **Hosted SMTP:**
   - sender `no-reply@mail.ib-timetable-planner.dev`, name `IB Timetable Planner`;
   - host `smtp.resend.com:465`, user `resend`, password = the key;
   - set `rate_limit_email_sent` explicitly (custom SMTP lifts the default from 2/h to 30/h).
7. **Templates** for invite, recovery and email change link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…`. That page **verifies only on a POST button**, never on GET, and/or shows `{{ .Token }}` as a code: that is the Safe Links defence.
8. **Template workflow:** keep templates in `supabase/templates/` (local `content_path`). Push them to hosted through the Management API, **never `config push`**.
9. **Local** stays on Mailpit. Leave `[auth.email.smtp]` commented out.
10. **Smoke test** against a real school M365 mailbox: `spf/dkim/dmarc=pass`, and an invite link that survives Safe Links.
11. **Runbook:** name SES as the standby provider.

**Gotchas:**
- **The recovery endpoint is public.** Anyone holding the publishable key can trigger reset emails. At 30/h, that can exhaust the **100/day free cap** and block genuine resets for the day. Mitigate with Supabase Auth CAPTCHA (Turnstile) or the $20 Pro plan.
- **Never enable click or open tracking.** It wraps auth links, and an open pixel is a GDPR concern for staff.
- Deliverability figures come from consumer Outlook/Hotmail seed tests, not M365 school tenants. That is why the smoke test in step 10 exists.

**Unverified:**
- Resend's independent deliverability, and the key scope of its Supabase integration;
- whether a Resend domain's region can be changed;
- Cloudflare Email Service GA date and data location;
- exact hosted dashboard field labels.

Sources: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp) · [Supabase email templates (prefetch)](https://supabase.com/docs/guides/auth/auth-email-templates) · [Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits) · [Resend regions](https://resend.com/docs/dashboard/domains/regions) · [Resend pricing](https://resend.com/pricing) · [Resend + Supabase SMTP](https://resend.com/docs/send-with-supabase-smtp) · [Resend GDPR](https://resend.com/security/gdpr) · [Resend DPF](https://resend.com/changelog/data-privacy-framework-certification) · [AWS SES pricing](https://aws.amazon.com/ses/pricing/) · [SES production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) · [Postmark EU privacy](https://postmarkapp.com/euprivacy) · [Brevo tracking thread](https://community.brevo.com/t/no-way-to-disable-by-option-tracking-in-transactional-e-mail/201) · [Cloudflare Email Service](https://developers.cloudflare.com/email-service/)

**Decision status: DECIDED 2026-10-10. Resend, with the sending domain in eu-west-1.** The author accepted the US-storage trade-off. SES (eu-central-1) is the named standby. The provider is shared with S-310.
