---
date: 2026-11-04T08:41:40+01:00
researcher: Claude
git_commit: 28777fc71289fe6de8ced715fc64c8b2ea881204
branch: main
repository: ib-timetable-planner
topic: "S-406 Users page (list users, change roles, last-admin guard, access-change record): feasibility, challenges and options"
tags: [research, codebase, supabase, rls, user-roles, profiles, auth-users, audit, role-matrix, e2e, fsd]
status: complete
last_updated: 2026-11-04
last_updated_by: Claude
---

# Research: S-406 Users page — feasibility, challenges and options

**Date**: 2026-11-04T08:41:40+01:00
**Researcher**: Claude
**Git Commit**: 28777fc71289fe6de8ced715fc64c8b2ea881204
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

Is S-406 ("Users page — list and roles") feasible as specified in the roadmap? What challenges will the implementation face, and what options are there for each?

The slice's scope, from [roadmap.md:202-212](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/context/foundation/roadmap.md#L202-L212):

- An admin lists the school's users: display name beside email, role and status.
- Machine users never appear. The calibration-campaign account appears, labelled as a service account.
- The admin can change anyone's role. The last active admin cannot be demoted.
- Every role change records who made it and when.
- The slice adds an admin e2e account.

PRD refs: FR-405, FR-406, FR-408 and FR-413 ([prd.md:196](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/context/foundation/prd.md#L196), [:200](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/context/foundation/prd.md#L200), [:206](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/context/foundation/prd.md#L206), [:230](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/context/foundation/prd.md#L230)), plus §NFG "access changes traceable".

## Summary

**Verdict: feasible, with no blocker, and secret-free.** Everything S-406 needs can be built with the admin's own session, the publishable key, RLS and INVOKER functions. It needs no new `SECURITY DEFINER` function and no secret key in the Worker. Six local probes against the real schema (rolled-back transactions, [§ Probe evidence](#probe-evidence)) and a source-level check of GoTrue, `supabase/postgres` and Supabase's splinter lints back this up. The hard part is not the page. It is four database decisions, each of which has a recommended answer below.

| #   | Challenge                                                                                                                                                                                                        | Recommended option                                                                                                                                                                                                                                  | Evidence                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | **Emails and the machine flag live only in `auth.users`**, which PostgREST cannot read                                                                                                                           | A system-owned mirror table `public.user_directory`, kept current by an **INVOKER** trigger on `auth.users` (grants and a policy `to supabase_auth_admin`), and backfilled by the migration                                                         | Probe P3; hosted permits triggers on `auth.users` (Supabase discussion #34270)    |
| 2   | **Machine users must never appear; the campaign account must say "service account"**. Nothing in the database marks the campaign account                                                                        | Mirror the `machine_role` flag and filter it in the directory's RLS policy. Mark the campaign account with an `app_metadata` flag set once by an operator, and mirror that too                                                                       | Runbook; GoTrue source                                                           |
| 3   | **Admin-only writes**, while policies may name only capabilities                                                                                                                                                  | A new capability `manage_users` through an INVOKER wrapper `private.can_manage_users()` over the existing DEFINER base                                                                                                                              | Probe P1: no recursion                                                            |
| 4   | **The last active admin cannot be demoted**. The guard must not break account deletion, test teardown or concurrent demotions                                                                                    | A `BEFORE UPDATE OR DELETE` trigger on `user_roles` that refuses the last admin on a direct write, exempts FK-cascade deletes (`pg_trigger_depth() > 1`) and serialises with `pg_advisory_xact_lock`                                                | Probes P2 and P6; the lock is reasoned and still needs a probe                     |
| 5   | **Every role change records who and when**, append-only, under the "one DEFINER" rule                                                                                                                             | `public.access_changes`, written by an INVOKER `AFTER` trigger on `user_roles`. An INSERT policy that only trigger context satisfies (`pg_trigger_depth() > 0`). No UPDATE or DELETE grant                                                          | Probe P5                                                                          |
| 6   | **Where the record is shown** (the roadmap's own Unknown)                                                                                                                                                         | Show "last changed by X, on date" per user on the Users page. The full history stays queryable, and S-408/S-410/S-411 append to the same table                                                                                                      | Design call                                                                       |
| 7   | **Tests**: a global invariant (the last admin), parallel integration files, teardown through the guard, the role matrix's structural checks                                                                       | Generalise the matrix's policy catalog. Test the invariant in one rolled-back `pg` transaction. Add an admin e2e account plus throwaway users                                                                                                       | Test-harness analysis                                                            |

The riskiest new surface is the trigger on `auth.users`. If it raises, Auth refuses to create the user. If an UPDATE trigger raises, sign-in and password recovery fail too. Keep the function trivial and null-safe, restrict its UPDATE trigger to `UPDATE OF email, raw_app_meta_data` with a `WHEN (… IS DISTINCT FROM …)` clause so it stays off the sign-in path, and cover it with an Admin-API integration test.

## Detailed Findings

### 0. Baseline: what S-403 left for S-406

- **`public.user_roles`** ([20261028140939_user_roles.sql](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261028140939_user_roles.sql)):
  - One row per user. The primary key is `user_id`, which references `auth.users` `on delete cascade`.
  - The only policy is "Users read their own role" ([:65](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261028140939_user_roles.sql#L65)).
  - `authenticated` holds SELECT alone ([:72-76](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261028140939_user_roles.sql#L72-L76)).
  - The header lists what was left for S-406: "No write policies, no `is_admin()` and no record of who changed a role or when — S-406" ([:13](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261028140939_user_roles.sql#L13)).
  - S-408 owns `active`, and adds it by changing `current_app_role()` alone ([:14](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261028140939_user_roles.sql#L14)).
- **The DEFINER base** `private.current_app_role()` ([:88-102](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261028140939_user_roles.sql#L88-L102)):
  - Its INVOKER wrappers are `can_read()`, `can_edit()` and `public.own_app_role()` ([:104-132](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261028140939_user_roles.sql#L104-L132)).
  - It was made DEFINER for S-406. The admin-reads-all policy has to ask for the caller's role, and an INVOKER read would recurse through `user_roles`' own policies ([:24-29](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261028140939_user_roles.sql#L24-L29)).
  - The post-conditions assert `prosecdef`, the empty `search_path` and an owner with `bypassrls` ([:180-195](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261028140939_user_roles.sql#L180-L195)).
- **The S-403 backfill** gave every non-machine user `author` and no machine user a role ([:145-150](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261028140939_user_roles.sql#L145-L150)). So **hosted may have no admin at all today**, unless one was assigned by hand with `scripts/assign-role.mjs` (see Open Question U1).
- **`public.profiles`** ([20261017170524_profiles.sql](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261017170524_profiles.sql)):
  - Owned by the user: the user inserts and updates their own row ([:59-65](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261017170524_profiles.sql#L59-L65)).
  - `display_name` is nullable.
  - The header says "No `email` column and no rows for users who never set a name — S-406 adds both" ([:10](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261017170524_profiles.sql#L10)).
  - The read policy is now "own row, or `can_read()`" ([20261028200630_fail_closed_policies.sql:131-133](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261028200630_fail_closed_policies.sql#L131-L133)).
- **App side**:
  - `Capability = "session" | "read" | "edit"` ([capability.ts:8](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/shared/config/capability.ts#L8)), with the map at [:16-20](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/shared/config/capability.ts#L16-L20).
  - `defineDomainAction({ requires })` defaults to `edit` ([define-domain-action.ts:19-27](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/shared/lib/actions/define-domain-action.ts#L19-L27)).
  - The middleware's role gate decides by status only ([middleware.ts:49](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/middleware.ts#L49), [:62](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/middleware.ts#L62); [role-gate.ts:29-31](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/shared/config/role-gate.ts#L29-L31)).
- **Operator tooling**: `scripts/assign-role.mjs` runs with the service-role key. It supports `none`, which deletes the row ([:10-11](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/scripts/assign-role.mjs#L10-L11)). It refuses machine accounts ([:78-79](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/scripts/assign-role.mjs#L78-L79)) and needs `ASSIGN_ROLE_CONFIRM=yes` for a non-local host ([:67](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/scripts/assign-role.mjs#L67)).

### 1. Challenge: the readable user list (email and machine flag live only in `auth.users`)

**Why it is hard.**
- FR-405 needs, for every user, their email, whether they are a machine, and a marker for the campaign account. FR-413 adds the display name beside the email.
- Only `auth.users` holds the first three. The `auth` schema is not exposed to PostgREST, and `authenticated` has no table grant there.
- A view over `auth.users` in an exposed schema is splinter lint 0002 `auth_users_exposed`, which is an ERROR. An invoker view does not help, because `auth.users` has RLS off and `postgres` cannot turn it on.
- `profiles` holds only users who set a name.
- S-407 ("Created by") and every lifecycle slice reuse whatever S-406 builds ([roadmap.md:212](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/context/foundation/roadmap.md#L212)), and non-admin readers need the name and email for "Created by" (FR-413). So the list cannot be an admin-only artefact.

**Options.**

| Option                                                                                         | How                                                                                                                                                                                                                                                                                          | For                                                                                                                                         | Against                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) Mirror table + INVOKER trigger on `auth.users`** (recommended)                           | `public.user_directory(user_id pk → auth.users on delete cascade, email, is_machine, is_service_account, …)`. An `AFTER INSERT` trigger plus `AFTER UPDATE OF email, raw_app_meta_data … WHEN (…distinct…)`. Grants plus a policy `to supabase_auth_admin`. The migration backfills from `auth.users` (it runs as `postgres`). | No DEFINER, no secret, no lint. Works for users who never signed in. Serves S-407's non-admin readers. Changes from the Admin API and the dashboard flow through it (GoTrue writes with plain SQL). | A trigger that raises blocks user creation, and, on UPDATE, sign-in and recovery. It adds a second "who may write" principal (`supabase_auth_admin`). Supabase documents the DEFINER variant for triggers; INVOKER is documented only for Auth hooks, so our use is an inference, proven by probe P3 rather than by docs. |
| (b) DEFINER reader function over `auth.users`                                                  | `private.list_users()` as DEFINER, reached through an INVOKER `public` wrapper                                                                                                                                                                                                               | No trigger on the Auth write path                                                                                                           | A second DEFINER function (a recorded exception). It must gate "admin only" inside the body, which breaks "no gating in RPC bodies". It does not serve S-407 readers without a second shape. Lints 0028/0029 apply if it is ever exposed.                                                                                    |
| (c) Self-registration from the JWT                                                             | On sign-in or page load the user upserts `profiles.email` from `auth.jwt() ->> 'email'`, checked in `WITH CHECK`                                                                                                                                                                              | No trigger, no DEFINER                                                                                                                      | A user who never signed in is invisible, so S-409/S-410 accounts and FR-405 break. The value is stale for up to `jwt_expiry` (3600 s) after an email change, and admin email edits are not seen until the user's next sign-in. It has no machine flag, because a machine never loads a page.                                  |
| (d) The secret-holding Edge Function lists users through the Admin API                         | S-409's component                                                                                                                                                                                                                                                                             | The Auth API is authoritative                                                                                                               | S-409 depends on S-406, so this inverts the order. Every list render becomes a function call. The list is still not joinable in SQL for S-407.                                                                                                                                                                                |
| (e) Secret key in the Worker                                                                   | `auth.admin.listUsers()` from the Worker                                                                                                                                                                                                                                                     | Simplest code                                                                                                                               | **Ruled out** by the decision of record ([deploy-plan.md:141](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/context/deployment/deploy-plan.md#L141); CLAUDE.md).                                                                                                               |

**Sub-decisions inside option (a).**

1. **Where the email lives: a separate system-owned table (recommended) or a new column on `profiles`.**
   - The S-401 plan expected `profiles` ([S-401 plan.md:554](context/archive/2026-10-16-account-self-service/plan.md); [profiles.sql:10](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20261017170524_profiles.sql#L10)).
   - **On `profiles`**, a user-owned table, `email` needs column-level grants so the owner cannot write it. Probe P4 confirmed that today's account-page upsert still works with them, because its payload is `{ display_name }` only, and that an owner writing `email` gets `permission denied`.
   - But PostgREST puts **every payload column** in `ON CONFLICT DO UPDATE SET` (PostgREST `QueryBuilder.hs:154`). Any future upsert that sends `user_id` or `email` therefore fails with 42501. That fails closed, but it is a trap.
   - `profiles` would also need rows for users who never set a name. The role matrix's `GRANTS.profiles` and its table-level privilege catalog check would have to learn column-level grants.
   - **A separate `user_directory`** keeps `profiles` exactly as it is. The list query left-joins `profiles` for the name, and `profileLabel` already handles a null name.
   - Writes to `user_directory` come only from the Auth trigger and the migration backfill. `authenticated` gets SELECT alone.
2. **Machine users: mirror them with `is_machine = true` and hide them in the read policy** (recommended), rather than leaving them out of the table.
   - GoTrue's `createUser` INSERTs `auth.users` with only `{provider, providers}` in `raw_app_meta_data`. Custom `app_metadata`, such as `machine_role`, arrives in a **separate UPDATE in the same transaction** (GoTrue `admin.go` ~L491 then L561, read by agent C at `d7955e9eb5`).
   - An INSERT-only trigger would therefore mirror the solver as a human. "Leave machines out" would need a delete-on-UPDATE branch.
   - "Mirror and flag" is one code path, and it gives the role-write guard (§4) a row to check against.
3. **Trigger shape.**
   - Use `AFTER UPDATE OF email, raw_app_meta_data` with a `WHEN (old.email is distinct from new.email or old.raw_app_meta_data->'machine_role' is distinct from …)` clause.
   - Every new session runs `UPDATE … last_sign_in_at`, and every `/verify` rewrites `raw_app_meta_data` (GoTrue `tokens/service.go:873-906`, `verify.go:174,276`). A column-list trigger alone still fires on any SET that names the column. The `WHEN` clause keeps the function off the sign-in and recovery paths.
   - Null-safety matters. Probe P3's first run failed `NOT NULL` on a null `raw_app_meta_data` (fixed with `coalesce(…, false)`), and in production that failure is "Database error saving new user".
4. **Email changes.**
   - Admin-initiated changes (`updateUserById`) write `email` at once.
   - User-initiated changes write `email` only at final confirmation, with Secure Email Change on (`double_confirm_changes = true`).
   - Either way, the mirror follows `auth.users.email` with no lag. That matters for S-411.
5. **Deletion.** Hard delete (the default) cascades through the FK. Soft delete (`should_soft_delete`) is an UPDATE that obfuscates `email`, which the trigger would mirror. Nothing in the repo uses soft delete, so S-411 should note it.
6. **Where the function lives.**
   - Probe P3 ran the trigger function in `public`. `supabase_auth_admin` already has `USAGE` on `public` ([custom_access_token_hook.sql:53-54](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/supabase/migrations/20260810200934_custom_access_token_hook.sql#L53-L54)), and a function returning `trigger` cannot be called as an RPC.
   - Putting it in `private` would also need `grant usage on schema private to supabase_auth_admin`, which was not probed.
   - Lints 0028/0029 flag only DEFINER functions, so an INVOKER trigger function triggers neither.
7. **Hosted permission (checked).**
   - The restrictions effective 2025-04-21 (Supabase discussion #34270) still allow "RLS policies and database triggers on … auth.users" and foreign keys to it.
   - They block creating tables or functions **in** `auth`, creating indexes on auth tables, and ALTERing them.
   - `postgres` keeps ALL on `auth` tables (`supabase/postgres` `20211115181400`), and `supautils.conf.j2` lists `auth.users` under `policy_grants` and `drop_trigger_grants`.
   - No 2026 change to `auth` was found. The 2026-07-14 lockdown is `realtime`-only.
8. **Explicit grants.** Supabase breaking change #45329 (enforced 2026-10-30) stops auto-granting new `public` tables to the Data API. The repo already pins grants per migration. The new tables must carry explicit grants, checked on hosted with `has_table_privilege`, as `lessons.md` already says.

### 2. Challenge: machine users and the "service account" label

- **Machine users.** `app_metadata.machine_role` is the only marker. It is Admin-API-only and never user-writable, and the Custom Access Token Hook trusts it (CLAUDE.md). Mirror it as `is_machine` (§1.2). The directory's read policy then hides machines from every reader: `not is_machine and (user_id = auth.uid() or (select private.can_read()))`.
- **The campaign account** ([calibration-campaign.md:23-45](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/docs/runbooks/calibration-campaign.md#L23-L45)):
  - It is an ordinary `author` with no `machine_role`.
  - It is identified only by `CAMPAIGN_EMAIL` in the gitignored `.envs/campaign.vars`.
  - **Nothing in the database marks it.** It must keep its role, because it drives production through the app's own actions.

Options for the label:

| Option                                                                                     | For                                                                                                     | Against                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`app_metadata.service_account = true`**, set once by an operator and mirrored as `is_service_account` (recommended) | It travels with the account, it is Admin-API-only like `machine_role`, and the trigger already reads `raw_app_meta_data` | Needs one operator step on hosted, added to the runbook. Its name must never be confused with `machine_role`: the hook must keep ignoring it, so add a test that `claims.role` stays `authenticated` |
| A directory column set by an operator script                                              | No Auth change                                                                                           | A second write path into a table that is otherwise trigger-owned                                                                                                                                    |
| A display-name or email convention                                                         | Zero schema work                                                                                         | Spoofable: any user could name themselves "Service account". FR-405 asks for the product to label it                                                                                              |
| A hard-coded email in the Worker config                                                    | No data change                                                                                           | Leaks operational identity into code, and the campaign email lives in a gitignored file on purpose                                                                                                 |

Check before planning: **does the campaign account still exist on hosted?** The campaign's `cleanup` may have removed it (Open Question U2).

### 3. Challenge: what "status" means before S-408, S-410 and S-411 exist

FR-405 asks for "role and status". At S-406 the only states that exist are **has a role** and **no access** (no `user_roles` row). The later slices each add one:

- S-408: deactivated (`active`);
- S-410: invited or pending;
- S-411: banned.

Options:

- **(Recommended)** Status at S-406 is "Active" or "No access", derived from whether a role row exists. Each later slice adds its own state.
- Add "never signed in" now. The mirror would also track the first `last_sign_in_at`, through a `WHEN (old.last_sign_in_at is null and new.last_sign_in_at is not null)` branch. That puts the trigger on every user's **first** sign-in path, for a state that matters only once invitations exist (S-410). Defer it.

### 4. Challenge: admin-only writes when policies may name only capabilities

- CLAUDE.md:
  - "Policies name capabilities, never roles."
  - "The role → capability map lives only in those two wrappers" (`can_read`, `can_edit`).
- **Recommended:** a third capability, `manage_users`, that only `admin` holds.
  - SQL: `private.can_manage_users()`, `language sql stable`, INVOKER, `search_path = ''`, `select private.current_app_role() = 'admin'`. Execute it as `authenticated` only, like the other helpers.
  - App: add `manage_users` to `Capability` and `CAPABILITIES_BY_ROLE.admin`.
  - CLAUDE.md's wording becomes "those wrappers".
- **No recursion (probe P1).** An admin-reads-all SELECT policy on `user_roles` that calls `can_manage_users()` resolves through the DEFINER base. This is exactly the trap S-403 built the DEFINER for ([S-403 research §2.3](context/archive/2026-10-28-fail-closed-roles/research.md)). The test must still `analyze public.user_roles`, because the recursion only surfaced under a seq scan.
- **Policies on `user_roles`:**
  - SELECT "Admins read every role";
  - INSERT, giving a role to a role-less user (also needed by S-409);
  - UPDATE, changing a role.
  - All three use `(select private.can_manage_users())` and name `to authenticated`.
  - DELETE ("take all access away") is a product question: S-408's deactivation may be the right tool (Open Question P4).
  - Grants: INSERT and UPDATE to `authenticated`, and DELETE only if P4 says so.
- **A hidden machine user is still addressable by UUID.**
  - Even with machines hidden from the list, an admin can POST `user_roles { user_id: <solver uuid>, role: 'admin' }`.
  - The solver's token runs as `solver_job_writer`, not `authenticated`, so human policies would not apply to it. But the row would break the invariant "a machine user never holds a role", which the matrix and `assign-role.mjs` both enforce.
  - **Recommended:** add `exists (select 1 from public.user_directory d where d.user_id = user_roles.user_id)` to the INSERT and UPDATE `WITH CHECK`. Machines are invisible through the directory's policy, so the check fails for them. The alternative is a trigger that reads `is_machine`.
- **RLS denies silently.** A refused UPDATE or DELETE affects 0 rows, and only INSERT raises 42501. The domain function should read the row back (`.select()`, which the admin's SELECT policy allows) and map "0 rows" to NOT_FOUND or FORBIDDEN, and the guard's SQLSTATE to CONFLICT.
- **Self-demotion works and takes effect at once (probe P2 #3).** With a second admin present, an admin demoting themselves succeeds, and `own_app_role()` answers `viewer` in the same transaction. The action's response, and the next request's middleware, must cope with an admin who stops being one mid-session. The UI might also ask for confirmation.

### 5. Challenge: the last-admin guard

**Shape.** A `BEFORE UPDATE OR DELETE` row trigger on `user_roles`, INVOKER. It raises when `old.role = 'admin'`, the row stops being an admin, and no other admin row exists.

The probe findings that shape it:

1. **It binds the operator too (P2 #1).** As the table owner, demoting the only admin was refused. That is right: `assign-role.mjs` (including `none`) can no longer strand the school. The operator's escape hatch is to promote someone else first. Document it in [author-provisioning.md:131-157](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/docs/runbooks/author-provisioning.md#L131-L157).
2. **A naive guard blocks account deletion and test teardown (P2 #2).**
   - Deleting the only admin's `auth.users` row cascades into `user_roles`. The guard fires at `pg_trigger_depth() = 2` as `current_user = postgres` and refuses, so GoTrue answers "Database error deleting user".
   - This would break `teardown()` ([teardown.ts:52-54](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/test/factories/teardown.ts#L52-L54)), which deletes users through `auth.admin.deleteUser`. It would also break S-411's delete.
3. **The cascade exemption needs a signal other than reading `auth.users` (P6).**
   - "Parent row already gone", checked by reading `auth.users`, works inside the cascade (`current_user = postgres`, `parent_gone = t`).
   - But the same INVOKER guard then fails with `permission denied for table users` on a **direct** demotion by `service_role` or `authenticated`.
   - Options, recommended first:
     - **Exempt `tg_op = 'DELETE' and pg_trigger_depth() > 1`.** FK cascades run at depth 2 as the table owner. S-411 then owns "don't delete the last admin" in its secret-holding component, which checks explicitly. FR-408 names demotion and deactivation, not deletion.
     - Exempt on `current_user` being the table owner. That is equivalent today, but it couples to ownership.
     - Bind only human sessions (`auth.uid() is not null`). The operator could then strand the school, which loses finding 1.
4. **Visibility (P2 #4).** An INVOKER guard counts other admins through RLS. An author sees 0 admin rows. Since only `can_manage_users()` holders can write `user_roles`, the guard always runs as an admin (who has admin-reads-all), the service role (BYPASSRLS) or the owner. That coupling deserves a comment beside the policy.
5. **Concurrency: write skew. Reasoned, not probed.**
   - Two admins demoting each other at once, under READ COMMITTED: each guard sees the other still admin, and both commit, leaving zero admins.
   - **Recommended fix:** `perform pg_advisory_xact_lock(<constant key>)` at the start of the guard, before the count. PL/pgSQL takes a fresh snapshot per statement in a VOLATILE function, so the count after the lock sees the other transaction's commit.
   - The alternative, `select … for update` on the admin rows, needs row visibility and an UPDATE policy as the invoker.
   - The plan should include a two-connection probe (see §8).
6. **S-408** must change the guard to count only **active** admins, and apply it to deactivation too. Name that in S-408's prerequisites.

### 6. Challenge: the access-change record ("who made it and when")

**Writer: an INVOKER `AFTER INSERT OR UPDATE OR DELETE` trigger on `user_roles`, inserting into `public.access_changes`.**

- Probe P5: the policy `for insert to authenticated with check (pg_trigger_depth() > 0 and actor_id is not distinct from (select auth.uid()) and (select private.can_manage_users()))` accepted the trigger's insert and refused a direct insert ("new row violates row-level security policy").
- `authenticated` gets SELECT (admins only, by policy) and INSERT. No UPDATE or DELETE grant, so the record is append-only for every API caller.
- Keep immutability in grants, not in a "refuse UPDATE" trigger, so the FK actions below still work.

**Actor.**
- `auth.uid()` from the admin's session.
- Service-role and operator writes (`assign-role.mjs`) have no `auth.uid()`, so the actor is null (P5 #3). Render it as "operator".
- S-409 and S-411 run with the secret key. They must write their own records with an explicit, verified actor, or every lifecycle change will read "operator". Name that in those slices.

**Shape.** Recommended columns:
- `id`, `occurred_at default now()`;
- `kind` (an enum or text with a CHECK: `role_granted | role_changed | role_removed`, extended later by `invited | email_changed | banned | deleted | deactivated | reactivated`);
- `actor_id`, `target_id`, `old_role`, `new_role`;
- optionally `actor_email` and `target_email` snapshots.

**Hazard: a cascaded delete versus an FK on `target_id`. Reasoned, not probed.**
- When S-411 or teardown deletes a user, the `user_roles` row cascades, and the AFTER DELETE audit trigger inserts a row whose `target_id` references the `auth.users` row being deleted. An FK on `target_id` fails that insert. Deferred or not, the parent is gone, so account deletion fails.
- Options:
  - (i) **Skip auditing cascaded deletes** (`pg_trigger_depth() > 1`, the same signal as §5), and let S-411 write its own `deleted` record. Recommended.
  - (ii) Give `target_id` no FK (uuid plus snapshot).
  - (iii) Make the column nullable with `on delete set null`, which still trips on the insert-during-cascade.
- With (i), FKs `on delete set null` on both `actor_id` and `target_id` work. RI actions run as the table owner and bypass RLS (P6 showed `current_user = postgres` in a cascade), and no immutability trigger is there to refuse them.

**Personal data: an EU school (Frankfurt region).** The open choice is between:
- email snapshots, which keep "who" readable after a deletion but retain an ex-staff member's email indefinitely;
- FK-only, which loses "who" once the account is deleted;
- a stated retention period.

This is a user decision (Open Question U3).

**Auth's own audit log is not a substitute.**
- `auth.audit_log_entries` records `user_modified` with only `{user_id, user_email, user_phone}`, with no field diff, and never sees `public.user_roles`.
- It is not exposed, so reading it would need a DEFINER function.
- Its retention on hosted is undocumented.

**Display (the roadmap's Unknown).**
- **Recommended:** each Users-page row shows "role changed by X · date", taken from the latest record per target. That satisfies §NFG ("the product can show who made it and when") without a history UI.
- The full history stays a SQL-queryable table, ready for a later history panel once S-408/S-410/S-411 append to it.
- The alternative, "queryable only", leaves §NFG resting on a developer running SQL, which is weaker than the PRD's wording.

### 7. Challenge: page gating, navigation and the app plumbing

- **Route.** A new `src/pages/users.astro` over a new `_pages/users/` slice (`_pages` has 12 slices against steiger's limit of 20).
  - The route computes `allows(Astro.locals.access, "manage_users")`. A non-admin gets a **404** (recommended: it does not advertise the page) or a 403.
  - `decideRoleGate` stays status-only, and role-less users are already redirected by it.
  - If page gating moves into the middleware, that is new logic in `role-gate.ts` and needs its own tests.
- **Navigation.** The admin's nav gains "Users". `nav.test.ts` currently expects `["Home","Plans"]` for admin.
- **Actions.** `changeUserRole` is `defineDomainAction({ requires: "manage_users", … })`. `run(supabase, input)` receives no caller id, which is fine: the actor comes from `auth.uid()` in the trigger, never from input.
  - Map the guard's SQLSTATE to CONFLICT ("the school must keep at least one admin"), "0 rows" to NOT_FOUND, and 42501 to FORBIDDEN.
- **Unit-test fallout** (from the harness analysis):
  - `capability.test.ts`, `access-state.test.ts`, `require-capability.test.ts` and `action-capabilities.test.ts`. The last two are `Record<Capability, …>`, so they will not compile until updated, which is good.
  - `action-capabilities.test.ts`' `NON_EDIT` set is documented as "declares less than edit". An admin action declares more, so rename or redocument it.
- **Display-name rule.** The S-401 review left U+061C (Arabic Letter Mark) unrefused (follow-up F4 in `context/archive/2026-10-16-account-self-service/follow-ups/review-fixes.md`), and its plan assigned the fix to S-406.
  - Adding it to the `profiles` CHECK can be additive: `add constraint … not valid` plus `validate`. Check hosted for offending rows first.
  - It also belongs in the app-side `FORBIDDEN_NAME` rule.
  - It is optional for S-406's outcome, but recorded as S-406's.

### 8. Challenge: FSD placement

- `src/shared/lib/` holds 15 groups, the limit of steiger's `fsd/shared-lib-grouping`, so a new group there goes red.
  - Put the list loader in the slice's `api/` segment (`_pages/users/api/`), or in `shared/api` if S-407 needs it before an entity exists.
- `profileLabel` lives in `src/app/layouts/profile-label.ts` ([:11](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/app/layouts/profile-label.ts#L11)). `_pages` cannot import from `app`, because that would be upward.
  - Move it down to `shared/ui` or `shared/config`, or duplicate it.
  - Moving it is the better option, because S-407 renders the same label.
- **Don't create `entities/user` yet.** With a single consumer, steiger's `insignificant-slice` fires. S-407 is the second consumer, and the time to extract it.

### 9. Challenge: tests

1. **The role matrix, red first** ([role-matrix-expectations.ts](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/test/role-matrix-expectations.ts)):
   - `GRANTS.user_roles` changes ([:305](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/test/role-matrix-expectations.ts#L305)), and the admin row of `USER_KEYED_READS.user_roles` for other users' rows flips to allowed ([:130](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/test/role-matrix-expectations.ts#L130)).
   - New cells: an admin writing another user's role, and an author or viewer trying to.
   - The `SELF_GRANTS` cells ([:194-215](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/test/role-matrix-expectations.ts#L194-L215)) must be restructured so the matrix never demotes its own admin principal.
   - Add grants and read/write cells for `user_directory` and `access_changes`.
2. **Matrix structure.**
   - The catalog check "every plan-scoped table holds exactly the four capability policies" ([role-matrix.integration.test.ts:212](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/test/role-matrix.integration.test.ts#L212); `CAPABILITY_POLICIES` at [:264](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/test/role-matrix-expectations.ts#L264)) needs a declared-policy map for the non-plan tables: `profiles`, `user_roles` and the two new ones. Neither new table fits the four-policy shape.
   - A policy `to supabase_auth_admin` is new to the catalog. The "no literal `true` for authenticated or PUBLIC" check ([:219](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/test/role-matrix.integration.test.ts#L219)) does not cover it, so declare it explicitly.
   - CLAUDE.md's "Every policy names `to authenticated`" needs a recorded exception for it. The rule's intent, "never PUBLIC", still holds.
   - `PRIVATE_FUNCTIONS` and the executor check ([:261](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/test/role-matrix.integration.test.ts#L261)) gain `can_manage_users`.
   - The "only `current_app_role` is DEFINER" tests ([:232-258](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/src/test/role-matrix.integration.test.ts#L232-L258)) **stay unchanged** under the recommended design. Use that as a tripwire.
   - Add `analyze public.user_roles` in `beforeAll`.
3. **The last-admin invariant is global**, and integration files run in parallel (`--maxWorkers=2` in CI) against a database that may hold the developer's real admin.
   - **Recommended:** one `pg` transaction that always rolls back:
     - `lock table public.user_roles in exclusive mode` with a short `lock_timeout`;
     - demote every admin but one file-owned target;
     - assert the guard's SQLSTATE on a demotion, a multi-row demotion, a `none`-style delete, and a cascaded `delete from auth.users` (expected to pass);
     - `rollback`.
   - Through the Data API, assert only deterministic facts. For example, admin A demotes file-owned admin B, and the record shows A and the time. Never assert a refusal that depends on other files' admins.
   - Concurrency: two `pg` connections, showing that B waits on A's advisory lock (`pg_locks`).
4. **The Auth trigger.** An integration test drives `auth.admin.createUser` (with and without `app_metadata.machine_role`), `updateUserById` (email, then `app_metadata`) and `deleteUser`, and asserts the directory row after each. That proves the INSERT-then-UPDATE sequence from §1.2 against the real GoTrue, which no probe has done (probes simulated the writes in SQL).
5. **Factories and teardown.** `teardown` must survive the guard, which the cascade exemption ensures, and the audit FKs, which §6 option (i) ensures. Add a lifecycle-smoke case where the deleted user is both actor and target of a record. A factory or option for machine users helps the "never listed" assertion.
6. **The solver credential.** Assert that `solver_job_writer` holds nothing on `user_directory` or `access_changes`. Better still, assert that it holds nothing on any `public` table except `generation_jobs`.
7. **e2e.**
   - The admin account arrives with S-406 ([test-plan.md:392-393](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/context/foundation/test-plan.md#L392-L393)).
   - Add `e2e/admin-credentials.mjs`, `admin.setup.ts` and a `chromium-admin` project for `*.admin.spec.ts`, mirroring the viewer wiring ([playwright.config.ts:59-65](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/playwright.config.ts#L59-L65)). CI's e2e job provisions the account.
   - An admin spec changes a **throwaway** user's role, never the admin's own.
   - Viewer and no-role tripwires show `/users` is absent for them.
   - Also update `e2e/CLAUDE.md`, test-plan §4/§6.2/§6.3 and the README.

### 10. Migration and deploy safety (hosted, additive-only, auto-deployed)

Everything recommended is additive:
- two new tables;
- new policies, grants and functions;
- one trigger on `auth.users` and two on `user_roles`;
- a backfill `insert … select from auth.users`.

What to watch:

- **Order inside the migration:** create the directory, then backfill, then create the trigger. Do it in one transaction, so a user created mid-deploy is either backfilled or mirrored.
- **No post-condition that asserts an admin exists.** Hosted may have none (§0), and a failing assertion would fail the deploy job. Bootstrapping the first hosted admin is an operator step (`assign-role.mjs … admin`, U1).
- **The `user_roles` write grants** reverse S-403's "SELECT alone" post-condition. That `DO` block ran once and never re-runs, so the reversal is a new migration's statement plus the matrix's `GRANTS` change.
- **After the migration**, run `pnpm db:types`. Then on hosted, check `has_table_privilege` for `authenticated`, `anon` and `supabase_auth_admin` on the new tables, plus `pnpm exec supabase db advisors`, which should show no new ERROR or WARN.
- **Blast radius of a trigger bug** on hosted: user creation, email change and, through `raw_app_meta_data` writes on `/verify`, link verification. Not every sign-in, if the `WHEN` clause is right.

## Probe evidence

All probes ran on the local stack in transactions that were rolled back. The scripts are in the session scratchpad and are not committed. Each probe can be reproduced from the SQL shapes quoted in its row.

| Probe | Question                                                                                                                       | Result                                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1    | Does an admin-reads-all policy on `user_roles` through an INVOKER `can_manage_users()` recurse?                                 | **No**, because it resolves through the DEFINER `current_app_role()`. The INVOKER-base variant overflows with "stack depth limit exceeded" once the planner picks a seq scan, which confirms why S-403 made the base DEFINER                                                                      |
| P2    | Last-admin guard (naive INVOKER trigger)                                                                                         | (1) The owner demoting the only admin is refused. (2) `delete from auth.users` of the only admin cascades into the guard at depth 2 as `postgres`, and is **refused**, which breaks deletion. (3) With two admins, self-demotion through the session succeeds, and `own_app_role()` answers `viewer` in the same transaction. (4) An author sees 0 admin rows, so the guard's count depends on RLS |
| P3    | Can an INVOKER trigger on `auth.users` maintain a `public` mirror?                                                               | `postgres` can create the trigger (locally). An Auth-style insert as `supabase_auth_admin` with no grants is denied (`permission denied for table probe_directory`). With grants only it is still denied, by RLS. With grants **and** a policy `to supabase_auth_admin` it **works**. A null `raw_app_meta_data` violated `NOT NULL` until `coalesce`d                                       |
| P4    | `email` on `profiles` behind column-level grants                                                                                | Today's upsert shape (`{ display_name }`) still works. The owner setting their own `email` gets `permission denied for table profiles`                                                                                                                                                         |
| P5    | An append-only record without DEFINER                                                                                            | The admin's role change through the session is recorded by the trigger with `actor_id = auth.uid()`. A direct insert is refused by RLS. A service-role write is recorded with a null actor                                                                                                      |
| P6    | How does a guard tell an FK cascade from a direct write?                                                                         | In the cascade: `depth=2 current_user=postgres session_user=supabase_admin parent_gone=t`. A guard that reads `auth.users` fails on a direct demotion as `service_role` (`permission denied for table users`), so the signal must be `pg_trigger_depth()` or ownership, not `auth.users`         |

Platform facts (agent C, source-read 2026-11-03):
- GoTrue HEAD `d7955e9eb5` (release v2.197.0);
- `supabase/postgres` develop `fb647693a1`;
- `supabase/splinter` `fccca4b`;
- PostgREST main;
- postgrest-js 2.116.0 (installed).

Not established:
- which refresh-token algorithm hosted runs;
- whether hosted writes `auth.audit_log_entries` to the database by default;
- the retention period for Auth logs;
- exactly what the 2026-10-30 grant enforcement did to existing default privileges.

## Code References

- `supabase/migrations/20261028140939_user_roles.sql:13-14` — what S-403 deferred to S-406 and S-408
- `supabase/migrations/20261028140939_user_roles.sql:24-29` — why the role read is DEFINER (S-406's admin-reads-all)
- `supabase/migrations/20261028140939_user_roles.sql:65-76` — the own-row policy; `authenticated` holds SELECT alone
- `supabase/migrations/20261028140939_user_roles.sql:88-142` — `current_app_role` (DEFINER), its INVOKER wrappers, and the execute grants
- `supabase/migrations/20261028140939_user_roles.sql:145-150` — the backfill: every non-machine user an author, no admin
- `supabase/migrations/20261028140939_user_roles.sql:180-195` — the DEFINER post-conditions
- `supabase/migrations/20261017170524_profiles.sql:10` — "S-406 adds email and rows for users who never set a name"
- `supabase/migrations/20261017170524_profiles.sql:56-76` — the profile policies and the grant posture
- `supabase/migrations/20261028200630_fail_closed_policies.sql:131-133` — the current profiles read policy
- `supabase/migrations/20260810200934_custom_access_token_hook.sql:53-54` — the precedent for grants to `supabase_auth_admin`
- `src/shared/config/capability.ts:8,16-20` — the app's capability map, which gains `manage_users`
- `src/shared/config/role-gate.ts:29-31` — role-exempt paths (unchanged)
- `src/shared/lib/actions/define-domain-action.ts:19-27` — `requires`, default `edit`
- `src/middleware.ts:49,62` — access resolution and the role gate
- `src/_pages/account/api/update-display-name.ts:14` — the upsert whose payload makes column grants viable
- `src/app/layouts/profile-label.ts:11` — `profileLabel`, which must move below `_pages`
- `src/test/role-matrix-expectations.ts:194-215,264,287-305` — self-grant cells, `CAPABILITY_POLICIES`, `GRANTS`
- `src/test/role-matrix.integration.test.ts:212,219,232-258,261` — the catalog checks S-406 touches
- `src/test/factories/teardown.ts:52-54` — teardown deletes users through the Admin API, so it cascades through the guard
- `scripts/assign-role.mjs:10-11,67,78-79` — the operator tool: `none`, the host confirmation, machine refusal
- `docs/runbooks/calibration-campaign.md:23-45` — the campaign account: an ordinary author, unmarked
- `docs/runbooks/author-provisioning.md:131-157` — role assignment runbook (gains the last-admin note)
- `context/foundation/test-plan.md:392-393` — "the admin account arrives with S-406"
- `playwright.config.ts:59-65` — the per-account project wiring to mirror for admin

## Architecture Insights

- **The DEFINER S-403 built was sized for this slice.** S-406's admin-reads-all policy is exactly what `current_app_role()` exists to make safe (P1). Under the recommended design S-406 adds **zero** DEFINER functions. The roadmap's "needs no secret" claim ([roadmap.md:212](https://github.com/dobrek/ib-timetable-planner/blob/28777fc71289fe6de8ced715fc64c8b2ea881204/context/foundation/roadmap.md#L212)) holds.
- **The trigger context is the repo's tool for system-owned writes without DEFINER.** It shows up twice:
  - `supabase_auth_admin` writing the directory under its own grants and policy;
  - an INSERT policy satisfied only at `pg_trigger_depth() > 0`, which makes the audit table writable only by its trigger.
  Both keep RLS in force and avoid gating inside function bodies.
- **Cascade context is distinguishable, and every guard and recorder on a user-keyed table needs to handle it.** `auth.users` deletion reaches `user_roles` and the two new tables through FK cascades at `pg_trigger_depth() = 2` as the table owner. Guards and recorders on those tables must decide what a cascade means. S-408 and S-411 inherit the convention.
- **Capability, not role.** `manage_users` keeps "policies name capabilities" intact. The cost is a third wrapper, and a CLAUDE.md wording change from "those two wrappers" to "those wrappers".
- **One table, many writers over time.** `access_changes` starts with a single trigger writer, and S-408/S-409/S-410/S-411 append with explicit actors. Its `kind` vocabulary and nullable role columns should be shaped for them now, so later slices stay additive.

## Historical Context (from prior changes)

- `context/changes/user-managment-research/research.md`:
  - the seed research for the user-management milestone: user_roles design and a last-admin guard suggestion (§4);
  - lifecycle, including the `active` flag, and the point that a ban is not immediate (§6);
  - placement (§8);
  - the P4 phase (§9).
- `context/archive/2026-10-16-account-self-service/research.md` (S-401): S-406 must add the `auth.users` reader or mirror, and the role-matrix costs of doing so.
- `context/archive/2026-10-16-account-self-service/plan.md:554`: S-406 adds `email` to `profiles` plus rows for users who never set a name, and should refuse U+061C (follow-up F4). This research recommends revisiting the first half, with a separate `user_directory` (§1.1).
- `context/archive/2026-10-28-fail-closed-roles/research.md` (S-403):
  - §2.3: the recursion probes (C/D) and the `private` USAGE results (G1/G2);
  - §2.4: the profiles own-row clause;
  - §2.5: S-406 adds the write policies, with admin-reads-all going through the DEFINER;
  - Open Question 8: S-406 owns the access-change record.
- `context/archive/2026-10-28-fail-closed-roles/plan.md:58-85`: the scope boundary with S-406.
- `context/archive/2026-10-30-viewer-read-only/` (S-405): the viewer e2e account wiring that the admin account mirrors.

## Related Research

- `context/changes/user-managment-research/research.md`
- `context/archive/2026-10-16-account-self-service/research.md`
- `context/archive/2026-10-28-fail-closed-roles/research.md`

## Open Questions

**For the user (decisions outside the code):**

- **U1 — Hosted's first admin.** Does hosted have an admin today? S-403's backfill made everyone an author. Until someone holds `admin`, the Users page is unreachable on production. Recommendation: assign one with `ASSIGN_ROLE_CONFIRM=yes node scripts/assign-role.mjs <you> admin` after the merge, recorded in the runbook. Do not assert it in the migration.
- **U2 — The campaign account.** Does it still exist on hosted, and should it be labelled through an `app_metadata.service_account` flag (one operator step)? If it was cleaned up, FR-405's label becomes a mechanism with no current instance. It is still worth building, cheaply.
- **U3 — Retention of the access-change record.** Should records keep the actor's and target's email after an account is deleted (readable history, but personal data retained), or only the ids (which go null on deletion)? Is a retention period wanted?

**For `/10x-plan` (recommendations given above):**

- **P1 — User list source.** Mirror table plus INVOKER Auth trigger (recommended), versus a DEFINER reader, versus JWT self-registration (§1).
- **P2 — Email location.** A separate `user_directory` (recommended) or `profiles.email` behind column grants (§1.1).
- **P3 — Status vocabulary at S-406.** "Active" or "No access" only (recommended), or also "never signed in" (§3).
- **P4 — Can an admin remove all access (DELETE a role row)?** Or is that S-408's deactivation? It decides whether `user_roles` gets a DELETE grant and policy (§4).
- **P5 — Cascade exemption signal for the guard and the recorder.** `pg_trigger_depth() > 1` (recommended), versus ownership (§5.3, §6).
- **P6 — 404 or 403 for non-admins on `/users`** (§7).
- **P7 — Record display.** Latest change per user, inline (recommended), versus a history panel now (§6).
- **P8 — Fold U+061C into S-406's migration** or leave it as a standalone follow-up (§7).

**Probes still to run in the plan phase:**

- Two-connection write skew with and without `pg_advisory_xact_lock` (§5.5).
- A cascaded `deleteUser` with the audit trigger and FKs in place: insert-during-cascade versus FK (§6).
- The real GoTrue `createUser` + `app_metadata` sequence through the trigger (§9.4).
- `grant usage on schema private to supabase_auth_admin`, if the trigger function moves to `private` (§1.6).
