# S-406 Users Page — List Users and Change Roles Implementation Plan

## Overview

Add an admin-only `/users` page. It lists every human user of the school with:

- display name beside email;
- role and status;
- a "Service account" label where it applies;
- who changed their role last, and when.

From the same page an admin can give, change or remove anyone's role.

Everything runs under the admin's own session, with RLS deciding. The database adds three things:

- a trigger-maintained **user directory**, because emails and the machine flag live only in `auth.users`;
- a **last-admin guard**, so the school can never be left without an admin;
- an append-only **access-change record**.

S-406 adds no new `SECURITY DEFINER` function and no secret key. It also brings the admin e2e account.

PRD refs: FR-405, FR-406, FR-408, FR-413, §NFG (access changes traceable). Roadmap: S-406.

## Current State Analysis

**What S-403 left for S-406.**

`public.user_roles` (`supabase/migrations/20261028140939_user_roles.sql`):

- It holds one row per human, with `user_id` as the PK, cascading from `auth.users`.
- Its only policy is own-row SELECT. `authenticated` holds SELECT alone (`:65-76`).
- Its header defers "write policies, no `is_admin()` and no record of who changed a role or when" to S-406 (`:13`).

`private.current_app_role()` is the one DEFINER function. It was made DEFINER for this slice's admin-reads-all policy (`:24-29`). Its INVOKER wrappers are `can_read()`, `can_edit()` and `public.own_app_role()` (`:104-132`).

`public.profiles` holds only users who set a display name. Its read policy is "own row, or `can_read()`" (`20261028200630_fail_closed_policies.sql:131-133`).

**App side.**

- `Capability = "session" | "read" | "edit"` (`src/shared/config/capability.ts:8`). Admin and author hold the same set (`:16-20`).
- `defineDomainAction({ requires })` defaults to `edit` (`src/shared/lib/actions/define-domain-action.ts:19-27`).
- The nav already filters by capability: `NavItem.requires` plus `visibleNavItems` (`src/shared/config/nav.ts:12,37`). The dashboard tiles use the same list (`src/_pages/dashboard/ui/DashboardPage.astro:6`).
- `profileLabel` lives in `src/app/layouts/profile-label.ts:11`. A `_pages` slice cannot import from `app`.
- `src/shared/lib/` is at steiger's 15-group cap.

**Hosted.** The user confirmed that hosted already holds an admin. The calibration-campaign account no longer exists on hosted.

**Problem framing.** The upstream research (`research.md`) settled the problem framing and the architecture. Six probes ran during research (P1–P6). Planning ran five more against the local stack (P7–P11, scripts in the session scratchpad, all rolled back or cleaned up). Two of them **correct the research**:

| Probe | Question                                                                 | Result                                                                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P7    | `pg_trigger_depth()` inside a cascade from `delete from auth.users`      | A **BEFORE** trigger on `user_roles` sees depth **2**. An **AFTER** trigger sees depth **1**, because RI cascades run with `fire_triggers = false` and the AFTER event is deferred to the outer statement. So research §6's "skip cascaded deletes at depth > 1" **fails in an AFTER recorder**: the audit insert hits the FK and the account deletion aborts. It only works in a BEFORE trigger. |
| P8    | Recorder timing under upsert (`assign-role.mjs` and e2e provisioning both upsert) | A **BEFORE INSERT** recorder fires for the proposed row even when it conflicts and becomes an UPDATE, which leaves a spurious `role_granted`. **Split shape, verified:** grants are recorded `AFTER INSERT`; changes and removals are recorded `BEFORE UPDATE OR DELETE`. The recorder skips no-ops and cascaded deletes. The FKs `on delete set null` null the target on account deletion. |
| P9    | Write skew between two admins demoting each other                        | Without a lock, both commit and **zero admins** remain. With `pg_advisory_xact_lock` taken before the count, the second waits and is refused.                                                                                                                                                                  |
| P10   | INVOKER mirror trigger on `auth.users` against **real GoTrue** (Admin API) | It works with the function in `private`. `supabase_auth_admin` has no USAGE on `private` and needs none. `createUser` with `app_metadata` is INSERT then UPDATE: the second fire sets `is_machine`. Sign-in does not fire it (the `WHEN` clause works). Email and `service_account` changes mirror. A non-boolean flag never raises. `deleteUser` cascades. |
| P11   | Trigger functions with EXECUTE revoked from every API role               | They still fire. EXECUTE is checked at `CREATE TRIGGER`, not at fire time.                                                                                                                                                                                                                                     |

PostgREST maps `P0*` SQLSTATEs to HTTP 500, but `PTxyz` to status `xyz`, with the SQLSTATE in the body's `code` (PostgREST docs, via Context7). That is why the guard raises **`PT409`**.

## Desired End State

**For an admin:**

- The sidebar and dashboard show **Users**.
- `/users` lists every non-machine user, sorted by label. Each row shows:
  - the display name with the email beneath it, or the email alone;
  - "You" on their own row, and "Service account" when flagged;
  - a role picker (Admin / Author / Viewer / No access);
  - status ("Active" / "No access");
  - "Changed by \<name or email | Operator | Deleted user\> · \<date\>" from the latest record.
- Choosing a new role saves it at once. Two choices ask for confirmation first: changing **your own** role, and choosing **No access**.
- Demoting the last admin, by any path including the operator script, is refused with "The school must keep at least one admin." The concurrent version of that race is refused too.
- After a successful self-demotion the page sends the admin to `/dashboard`.

**For everyone else:**

- An author or viewer sees no Users item, and `/users` answers 404.
- A role-less user is sent to the "no access yet" notice, as today.
- Machine users appear nowhere, to anyone.
- The service role and the migration owner still see them.

**Every role write is recorded** in `public.access_changes`, whatever path it takes: the page, the operator script or the factories. A write made outside a session is recorded as the operator.

**Verify:**

- `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test` and `pnpm build` are green.
- `pnpm test:integration` is green (role matrix, directory, guard, recorder).
- `pnpm test:e2e` is green with the new `chromium-admin` project.
- The manual hosted checks in Phase 5 pass.

### Key Discoveries:

- A trigger on `auth.users` is allowed on hosted (research §1.7), and `supabase_auth_admin` writes the mirror only under its own grants and policy (P3, P10). If the function raises, user creation fails ("Database error saving new user"). So it must be null-safe and kept off the sign-in path.
- `scripts/assign-role.mjs:84-87` and `scripts/provision-e2e-author.mjs:92-97` upsert, or delete for `none`. Both run as the service role, so the guard binds them, and the recorder records them as operator writes.
- `teardown` (`src/test/factories/teardown.ts:33-58`) deletes users through `auth.admin.deleteUser`. Every guard and recorder must let that cascade through (P7).
- The role matrix's `SELF_GRANTS` loop aims at the **shared admin principal's own row** (`src/test/role-matrix.integration.test.ts:355-370`). It stays intact today only because every cell is denied. Once admin writes are allowed it would demote or delete its own principal mid-file.
- `UserKeyedTable` is a hard-coded literal (`src/test/access-probe.ts:39`), and `PlanScopedTable = Exclude<PublicTable, UserKeyedTable>`. So a new table counts as plan-scoped, and fails the four-policy check, until it is declared user-keyed.
- SSR runs on workerd in UTC, so a local date must be filled in after hydration. Precedent: `useHydrated` (`src/shared/lib/use-hydrated/use-hydrated.ts`) and `PlanIndicatorsCell.tsx:95`.
- UI patterns to reuse:
  - `useConfirmAction` (busy state, refresh on codes) and the `AlertDialog` contract (`DeleteTeacherDialog.tsx:26-63`);
  - a per-row inline `Select`, closest precedent `CourseOverlaps.tsx:105-116`;
  - typed action clients (`teacher-client.ts`) over `callAction`.
- The display-name rule has two copies: SQL in `20261017170524_profiles.sql:41`, and the app's `FORBIDDEN_NAME_CHARACTERS` in `src/_pages/account/model/schemas.ts:33`. S-401 left U+061C to S-406 (follow-up F4).

## What We're NOT Doing

- **Deactivation, invitations, account creation, ban/delete and email change.** Those are S-408, S-410, S-409 and S-411. "Status" here is only "Active" or "No access", and each later slice adds its own state.
- **A full history UI.** The page shows the latest change per user. Older records stay queryable in SQL.
- **Email snapshots in the record.** Records keep ids only, nulled when an account is deleted, and a deleted actor renders as "Deleted user". There is no retention job.
- **Guarding account deletion.** Deleting the last admin's `auth.users` row is deliberately let through, because the cascade exemption is what keeps teardown and S-411 working. FR-408 names demotion and deactivation. S-411's secret-holding component owns the "don't delete the last admin" check.
- **Actors for secret-key writers.** The trigger cannot see a verified actor behind a secret-key write, so it records `operator`. S-409 and S-411 must write their own records with an explicit actor. This is noted in the roadmap at Phase 5.
- **Locking the service account's role.** It gets a label only, and its role stays changeable.
- **Setting the `service_account` flag on hosted.** No campaign account exists there today. The runbook gains the step for the next campaign.
- **An `entities/user` slice.** S-407 is the second consumer and the right time to extract one.
- **Changing the middleware's role gate.** `/users` gating is one route-level check.
- **"Never signed in" status.** That would put the Auth trigger on every user's first sign-in, for a state that only matters once invitations exist.

## Implementation Approach

The work goes database-first, in three migrations (directory and display-name rule in Phase 1, role management in Phase 2), each proven by the role matrix before any UI exists.

**Phase 1** builds the read side. The `user_directory` mirror needs only the Auth trigger and a backfill, so it ships and is proven before anything writes roles.

**Phase 2** adds the write side as one unit, because each piece needs the others to be safe:

- the `manage_users` capability wrapper;
- the admin policies and grants on `user_roles`;
- the last-admin guard;
- the access-change record.

The matrix diff is shown red first, per CLAUDE.md.

**Phases 3–4** add the app plumbing (capability, loader, action), then the page.

**Phase 5** adds the admin e2e account, the specs and the documentation that the new rules touch.

All schema changes are additive, one transaction per migration file, and safe against live data on their own. No post-condition asserts that an admin exists.

## Critical Implementation Details

**Trigger timing on `user_roles` is load-bearing (P7, P8).** The triggers are:

- the guard, `BEFORE UPDATE OR DELETE`;
- the recorder, as two triggers on one function: `AFTER INSERT` for grants, and `BEFORE UPDATE OR DELETE` for changes and removals.

Both exempt `tg_op = 'DELETE' and pg_trigger_depth() > 1`, the FK cascade from `auth.users`, which only a BEFORE trigger can detect. The recorder also skips an UPDATE that leaves the role unchanged.

Name the triggers so the guard sorts before the recorder (Postgres fires them alphabetically). Any refusal still rolls back the whole statement either way.

**The Auth trigger must never raise.**

- Derive `is_machine` exactly as S-403's backfill does: `raw_app_meta_data->>'machine_role' is not null`.
- Derive `is_service_account` as `coalesce(raw_app_meta_data->'service_account' = 'true'::jsonb, false)`, never a `::boolean` cast.
- Upsert, because GoTrue's INSERT arrives without the custom `app_metadata`, and the UPDATE that follows brings it.
- The UPDATE trigger names the column list `email, raw_app_meta_data` **and** a `WHEN` clause that compares `email` and the two specific keys. Sign-in and `/verify` rewrite other fields, and must stay off this path.

**Migration order.** Inside migration A, create the table, its policies and grants, then the function, then the triggers, then the backfill, all in the one file's transaction. `CREATE TRIGGER` takes a SHARE ROW EXCLUSIVE lock on `auth.users` and holds it until commit. So every GoTrue write committed before it is visible to the backfill, and none can land after it until the migration commits. A user created or changed mid-deploy is then either backfilled or mirrored, never missed. (Backfilling first would leave a gap between the backfill's snapshot and the trigger. The count post-condition would catch a missed insert, but nothing would catch a missed email or flag change.)

**Guard: lock before count.** `perform pg_advisory_xact_lock(<documented constant>)` must come before the "other admins" check. PL/pgSQL takes a fresh snapshot per statement, so after the wait the count sees the other transaction's commit (P9).

**The guard counts admins through RLS, as the invoker.** That is correct only because writers are limited to `can_manage_users()` holders (who read every role), the service role (BYPASSRLS) and the owner. Say so in a comment beside the policies.

**Self-demotion navigation.** On a successful change to the caller's own role, the island must `window.location.assign("/dashboard")` instead of the usual `refreshPage()`. A refresh would land on the 404 that the caller has just earned.

**Dates.** "Changed … · date" renders `<time dateTime={iso}>` and fills in the readable local date only after `useHydrated()` (precedent `PlanIndicatorsCell.tsx`). Formatting on the server would show the reader a UTC date.

**Escapes in tool inputs.** Write U+061C as `\x061C` in the Postgres regex and `\u{061C}` in the JS regex, never as a bare `\u` plus 4 hex digits (memory: unicode-escape decoding).

---

## Phase 1: User Directory (read side)

### Overview

This phase makes the school's users readable through the Data API: emails, the machine flag and the service-account flag, without exposing `auth.users`. Machines are hidden from every reader. The role matrix proves the posture, and a real-GoTrue integration test proves the trigger.

### Changes Required:

#### 1. Directory migration

**File**: `supabase/migrations/<ts>_user_directory.sql` (via `pnpm exec supabase migration new user_directory`)

**Intent**: Create a system-owned mirror of `auth.users`, written only by the Auth trigger and the backfill, and readable by humans under the same rule as `profiles`, never showing a machine. The header comment records:

- why this is a separate table, not `profiles.email` (research §1.1);
- the Auth-path blast radius;
- the `to supabase_auth_admin` exception to "every policy names `to authenticated`".

**Contract**:

- Table `public.user_directory`:
  - `user_id uuid primary key references auth.users (id) on delete cascade`;
  - `email text` (nullable, as in `auth.users`);
  - `is_machine boolean not null default false`;
  - `is_service_account boolean not null default false`.
- RLS on. Policies:
  - `"Readers read the directory"`: `for select to authenticated using (not is_machine and (user_id = (select auth.uid()) or (select private.can_read())))`.
  - `"Auth mirrors users"`: `for all to supabase_auth_admin using (true) with check (true)`. This is the probed shape (P3/P10). The upsert needs its SELECT, INSERT and UPDATE parts, and the grant layer is what withholds DELETE.
- Grants:
  - `revoke all … from anon`;
  - `authenticated`: SELECT only (revoke the other seven);
  - `grant select, insert, update … to supabase_auth_admin`;
  - `service_role` keeps its defaults;
  - `solver_job_writer` gets nothing.
- Function `private.mirror_auth_user() returns trigger`:
  - `plpgsql`, INVOKER, `set search_path = ''`;
  - upserts `(id, email, is_machine, is_service_account)` from `new`, with the null-safe derivations above, and returns `null`;
  - `revoke execute … from public, anon, authenticated` (P11).
- Triggers on `auth.users`:
  - `user_directory_mirror_insert`: `after insert … for each row`;
  - `user_directory_mirror_update`: `after update of email, raw_app_meta_data … for each row when (old.email is distinct from new.email or old.raw_app_meta_data->'machine_role' is distinct from new.raw_app_meta_data->'machine_role' or old.raw_app_meta_data->'service_account' is distinct from new.raw_app_meta_data->'service_account')`.
- Backfill, **after** the triggers (see Critical Implementation Details › Migration order): `insert into public.user_directory … select … from auth.users` (it runs as the owner).
- Post-conditions `DO` block. Each failure aborts the file:
  - directory row count = `auth.users` count;
  - no row whose `is_machine` disagrees with `raw_app_meta_data`;
  - `private.mirror_auth_user()` is not `prosecdef`;
  - the only DEFINER function in `public` and `private` is still `private.current_app_role()`;
  - anon holds no privilege on the table;
  - authenticated holds exactly `SELECT`;
  - anon cannot execute the function.

#### 2. Display-name rule: refuse U+061C

**File**: `supabase/migrations/<ts>_display_name_arabic_letter_mark.sql`; `src/_pages/account/model/schemas.ts`; `src/_pages/account/model/schemas.test.ts`

**Intent**: Close S-401 follow-up F4 by refusing the Arabic Letter Mark, the one invisible directional mark both copies of the rule still accept. The change is additive: a second constraint, with nothing dropped.

**Contract**:

- SQL: `alter table public.profiles add constraint profiles_display_name_no_letter_mark check (display_name !~ '\x061C') not valid;` then `validate constraint` in the same file.
- App: `FORBIDDEN_NAME_CHARACTERS` gains `\u{061C}`, and its comment list and the "keep the two in step" note mention the second constraint.
- Add one schema test case.

#### 3. Role matrix: declare the directory (red before the migration)

**File**: `src/test/access-probe.ts`; `src/test/role-matrix-expectations.ts`; `src/test/role-matrix-expectations.test.ts`; `src/test/role-matrix.integration.test.ts`; `src/test/factories/create-auth-user.ts`

**Intent**: State the directory's access spec as matrix cells before the migration exists, and run them red. Then replace the "user-keyed tables are exempt from the structural check" gap with a declared policy shape per user-keyed table, so the `supabase_auth_admin` policy is pinned explicitly rather than unchecked.

**Contract**:

- `UserKeyedTable` gains `"user_directory"`, and `isUserKeyed` and `fixtureKey` follow.
- `GRANTS.user_directory = { anon: NONE, authenticated: READ_ONLY }`.
- New `USER_KEYED_POLICIES: Record<UserKeyedTable, readonly PolicyShape[]>`:
  - it declares today's `profiles` and `user_roles` policies exactly as `pg_policies` deparses them;
  - it adds the two directory policies.
  - The structural check compares live policies on user-keyed tables against it, including non-`authenticated` roles, but still excluding `{solver_job_writer}`.
- Read cells for `user_directory`:
  - own row: anon denied, everyone else allowed;
  - others' rows: allowed only for viewer, author and admin;
  - **a machine user's row**: denied to every principal. This is a new cell, against a machine fixture.
- Write cells for `user_directory`: INSERT, UPDATE and DELETE are denied to every principal.
- `createAuthUser` gains an optional `appMetadata`, so a file can create a machine fixture that `teardown` removes.
- `PRIVATE_FUNCTIONS` and the executor check gain `mirror_auth_user`, with no executor.
- The DEFINER-only check stays **unchanged**, as a tripwire.
- `src/test/solver-credential.integration.test.ts:193-195`: `solver_job_writer` holds nothing on `public.user_directory`.

#### 4. Auth-trigger integration test

**File**: `src/test/user-directory.integration.test.ts` (new)

**Intent**: Prove the trigger against the real GoTrue write sequence through the Admin API, which simulated SQL cannot prove. Also pin the structural facts that keep it off the sign-in path.

**Contract**: Each case reads back as the service role:

- `createUser` (human) leaves a row with `is_machine = false`.
- `createUser` with `app_metadata.machine_role` leaves `is_machine = true`.
- `updateUserById`:
  - an email change is mirrored;
  - `app_metadata.service_account: true` sets the flag;
  - a non-boolean value leaves it `false` and returns 200.
- Signing in as a flagged user yields JWT `claims.role === "authenticated"`: the hook ignores the flag.
- `deleteUser` removes the row.
- `pg_trigger` shows the UPDATE trigger with a column list and a `WHEN` qualifier.
- `count(user_directory) = count(auth.users)`.
- Users are created through the factories, so `teardown` cleans up.

#### 5. Generated types

**File**: `src/shared/api/database.types.ts`

**Intent**: Regenerate the types with `pnpm db:types` after both migrations, and check the diff (new table; no profiles column change).

### Success Criteria:

#### Automated Verification:

- [x] The matrix diff for `user_directory` runs red against the pre-migration schema (deny drill), then green after: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- [x] Migrations apply cleanly from scratch: `pnpm exec supabase db reset`
- [x] The directory integration test passes: `pnpm test:integration src/test/user-directory.integration.test.ts`
- [x] The solver credential suite stays green: `pnpm test:integration src/test/solver-credential.integration.test.ts`
- [x] Type checking passes: `pnpm check`
- [x] Unit tests pass (schema case for U+061C): `pnpm test`
- [x] Lint and FSD pass: `pnpm lint && pnpm steiger`
- [x] The advisors show no new ERROR or WARN locally: `pnpm exec supabase db advisors`

#### Manual Verification:

- [x] Create a user in local Studio (**Authentication → Users → Add user**). Their `user_directory` row appears. Signing in as them leaves the row untouched. Deleting them removes it.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Role Writes, Last-Admin Guard and Access Record (write side)

### Overview

This phase lets a `manage_users` holder (admin) read every role and give, change or remove one, never for a machine user. The school can never be left without an admin. Every role write is recorded with who made it and when. It is proven by the matrix flip, a rolled-back guard transaction, a lock-wait test and Data-API recorder tests.

### Changes Required:

#### 1. Role-management migration

**File**: `supabase/migrations/<ts>_role_management.sql`

**Intent**: Add the third capability wrapper and the admin write path on `user_roles`, with the guard and the record shaped per P7–P9. The header records:

- why the guard binds the operator too (P2 #1);
- the cascade exemption and the S-411 hand-off;
- the INVOKER-count coupling;
- why the record is append-only by grants rather than by an immutability trigger.

**Contract**:

- `private.can_manage_users() returns boolean`:
  - `language sql stable`, INVOKER, `search_path = ''`;
  - body `select private.current_app_role() = 'admin'`;
  - EXECUTE revoked from `public, anon` and granted to `authenticated`.
- `user_roles` policies, all `to authenticated`, all calling helpers wrapped in `(select …)`:
  - `"Admins read every role"`: SELECT, using `can_manage_users()`.
  - `"Admins grant roles"`: INSERT, with check `can_manage_users() and exists (select 1 from public.user_directory d where d.user_id = user_roles.user_id)`. A machine is invisible through the directory policy, so the check refuses it.
  - `"Admins change roles"`: UPDATE, using `can_manage_users()`, with check the same as INSERT.
  - `"Admins remove roles"`: DELETE, using `can_manage_users()`.
- Grant `insert, update, delete on public.user_roles to authenticated`. Nothing beyond DML.
- `comment on table public.user_roles` is replaced. S-403's "A user reads only their own row; only the service role writes." becomes: a user reads their own row, an admin reads and writes every row, and the last admin is guarded.
- `private.guard_last_admin() returns trigger`:
  - plpgsql, INVOKER, `search_path = ''`;
  - first, on UPDATE, raises `using errcode = '42501', message = 'A role cannot move to another user.'` when `new.user_id is distinct from old.user_id`. The UPDATE grant is table-level, so without this check an admin could move a row from Y to X: the pass-throughs below would let it by, the recorder would skip it as "role unchanged", and nothing would record it. A column-level grant won't do, because PostgREST's merge-duplicates upsert sets every column in the payload, `user_id` included, to the same value;
  - passes through when `old.role <> 'admin'`, when an UPDATE keeps `admin`, or when `tg_op = 'DELETE' and pg_trigger_depth() > 1`;
  - otherwise `perform pg_advisory_xact_lock(<constant>)`, then raises `using errcode = 'PT409', message = 'The school must keep at least one admin.'` if no other `admin` row exists.
  - Trigger `user_roles_guard_last_admin`: `before update or delete … for each row`.
- `create type public.access_change_kind as enum ('role_granted', 'role_changed', 'role_removed')`. It is an enum so later slices extend it additively (`alter type … add value`).
- `create type public.access_actor_kind as enum ('user', 'operator')`.
- Table `public.access_changes`:
  - `id bigint generated always as identity primary key`;
  - `occurred_at timestamptz not null default now()`;
  - `kind public.access_change_kind not null`;
  - `actor_kind public.access_actor_kind not null`;
  - `actor_id uuid references auth.users (id) on delete set null`;
  - `target_id uuid references auth.users (id) on delete set null`;
  - `old_role public.app_role`, `new_role public.app_role`.
  - Index on `(target_id, occurred_at desc)`.
- `access_changes` RLS:
  - `"Admins read access changes"`: SELECT, using `can_manage_users()`.
  - `"Role triggers record changes"`: INSERT, with check `pg_trigger_depth() > 0 and actor_id is not distinct from (select auth.uid()) and (select private.can_manage_users())`. This is the P5 shape. The service role and owner bypass it.
- `access_changes` grants:
  - `revoke all … from anon`;
  - `authenticated`: SELECT and INSERT only, with no UPDATE or DELETE grant. That is what makes the record append-only.
- `private.record_role_change() returns trigger`:
  - plpgsql, INVOKER, `search_path = ''`;
  - returns `old`/`new` as appropriate, and skips cascaded DELETEs and no-op UPDATEs;
  - inserts `kind` from `tg_op`, `actor_kind = case when auth.uid() is null then 'operator' else 'user' end`, `actor_id = auth.uid()`, `target_id`, `old_role` (null on INSERT) and `new_role` (null on DELETE).
  - Triggers: `user_roles_record_grant` (`after insert`) and `user_roles_record_change` (`before update or delete`).
- All three trigger functions revoke EXECUTE from `public, anon, authenticated`.
- Post-conditions `DO` block:
  - DEFINER functions are still exactly `private.current_app_role()`;
  - `can_manage_users`, `guard_last_admin` and `record_role_change` are INVOKER;
  - `authenticated` on `user_roles` holds exactly `DELETE, INSERT, SELECT, UPDATE`;
  - on `access_changes`, exactly `INSERT, SELECT`;
  - anon holds nothing on either table;
  - anon cannot execute `can_manage_users`.
  - S-403's "SELECT alone" post-condition ran once, is not re-run, and is superseded here.

#### 2. Role matrix: the admin write path (red first)

**File**: `src/test/role-matrix-expectations.ts`; `src/test/role-matrix-expectations.test.ts`; `src/test/role-matrix.integration.test.ts`; `src/test/access-probe.ts`

**Intent**: Flip the cells that S-406 changes, as a reviewable diff, and run them red against Phase 1's schema before the migration turns them green. Restructure the self-grant cells so the suite never demotes or deletes its own admin principal.

**Contract**:

- `UserKeyedTable` gains `"access_changes"`. It has no `user_id`, and the probe's user-keyed path is hard-wired to that column (`access-probe.ts:138,173,177`; `role-matrix.integration.test.ts:757-764`, all through untyped clients, so only a runtime run would catch it). So:
  - add `USER_KEY_COLUMN: Record<UserKeyedTable, "user_id" | "target_id">`, with `access_changes: "target_id"` and the other three `"user_id"`;
  - `fixtureKey`, `probeUserRowRead` and `hasUserRow`/`requireUserRow` read their column from it, and `isUserKeyed` is derived from its keys instead of a literal;
  - "own row" means `target_id = principal`. Every principal with a role gets an operator record from its factory insert; noRole gets none, so its own `access_changes` cell is `no-row`, and the exact no-row list guard (`role-matrix-expectations.test.ts:80-82`) gains `"noRole reading the own access_changes row"`.
- Grants:
  - `GRANTS.user_roles.authenticated = ["DELETE", "INSERT", "SELECT", "UPDATE"]`;
  - `GRANTS.access_changes = { anon: NONE, authenticated: ["INSERT", "SELECT"] }`.
- Reads:
  - `USER_KEYED_READS.user_roles.others.admin` becomes `allowed`;
  - `access_changes` reads are allowed for admin only, both own and others.
- New write cells against **throwaway targets**: give a role to a role-less user; change a user's role; remove a user's role. Admin is allowed; every other principal is denied.
- Machine-target cells: an admin giving a role to the machine fixture is **denied**, and so is every other principal.
- `access_changes` direct INSERT, UPDATE and DELETE are denied to every principal, admin included.
- `SELF_GRANTS`:
  - it keeps its non-admin cells, which stay denied;
  - it no longer probes the shared admin principal's own row;
  - admin self-change moves to the guard and recorder tests on a throwaway admin.
  - The shape guards (`role-matrix-expectations.test.ts:68,80-82`) are updated to match.
- Policies:
  - `USER_KEYED_POLICIES.user_roles` gains the four new policies;
  - `access_changes` declares its two.
- `PRIVATE_FUNCTIONS` and the executor check:
  - `can_manage_users` is executable by `authenticated` only;
  - the two trigger functions have no executor.
- Add `analyze public.user_roles` to `beforeAll`: P1's recursion surfaces only under a seq scan.
- `solver-credential.integration.test.ts`: `solver_job_writer` holds nothing on `public.access_changes`.

#### 3. Guard, lock and recorder integration tests

**File**: `src/test/last-admin-guard.integration.test.ts` (new); `src/test/access-changes.integration.test.ts` (new); `src/test/factories/lifecycle.smoke.integration.test.ts`

**Intent**: Prove the global invariant without depending on, or disturbing, other files' admins or the developer's real admin. Prove the record through the real session path.

**Contract**:

- **Ground rules for the `pg` tests.** These are the repo's first transactional `pg` tests. Today `connectPostgres()` (`src/test/postgres-client.ts:20-24`) serves catalog reads only. The precedents are S-403's research probes (`BEGIN … ROLLBACK` with `set local role authenticated` plus `request.jwt.claims`, `context/archive/2026-10-28-fail-closed-roles/research.md`) and `lock_timeout` in `20261028200630_fail_closed_policies.sql:56`. The planning probes ran as `supabase_admin` through docker psql, but the suite connects as `postgres`, locally and in CI (`SUPABASE_DB_URL`). So:
  - each test uses its own `Client` and awaits queries one at a time;
  - a first case proves, in a rolled-back transaction, that `postgres` may `set local role authenticated` and `delete from auth.users`;
  - the `exclusive` lock stalls every parallel file's `user_roles` writes and teardown cascades while it is held, and the lane is already flaky under `--maxWorkers=2`. Keep only the asserts inside the locked section, with no fixture creation or sign-ins.
- **Guard, in one `pg` transaction that always rolls back.** Setup:
  - `set local lock_timeout = '5s'`;
  - `lock table public.user_roles in exclusive mode`;
  - demote every admin except one file-owned target.

  Then, using savepoints between cases, assert SQLSTATE `PT409` for:
  - a single demotion;
  - a multi-row demotion;
  - a "No access" delete.

  Also assert SQLSTATE `42501` for an UPDATE that changes `user_id`, from an author row to a role-less user, with no `access_changes` row written.

  Repeat one case as that admin's simulated session (`set local role authenticated` plus `request.jwt.claims`), so the RLS-counted path is proven too. Then assert that `delete from auth.users` of that only admin **succeeds** (cascade exempt) and writes no `access_changes` row. Finally, `rollback`.
- **Lock.** Use two `pg` connections and two committed throwaway admins.
  - Connection 1 begins and demotes A1.
  - Connection 2 begins and demotes A2.
  - A third query sees connection 2's pid waiting on an ungranted `advisory` lock in `pg_locks`.
  - Both roll back.
- **Recorder, through the Data API** (throwaway users, deterministic). Admin A, a signed-in throwaway admin, with a second throwaway admin present:
  - changing B's role records `role_changed` with A as actor and the old and new roles;
  - giving role-less C a role records `role_granted`;
  - removing B's role records `role_removed`;
  - upserting B to the same role records nothing;
  - A demoting themselves is allowed and recorded, and `own_app_role()` then answers the new role.
- **Operator writes.** A service-role write records `actor_kind = 'operator'` with a null `actor_id`.
- **Lifecycle smoke.** Deleting a user who is both actor and target of records succeeds. Their records survive with `actor_id` and `target_id` nulled and `actor_kind` still `user`.

#### 4. Operator tooling and runbook

**File**: `scripts/assign-role.mjs`; `docs/runbooks/author-provisioning.md` (§ b-bis)

**Intent**: The operator script is now bound by the guard. Give it a clear message instead of a raw error, and document the escape hatch.

**Contract**:

- On SQLSTATE `PT409` the script exits non-zero with: "refused: the school must keep at least one admin — promote another admin first".
- Its header (`:14-15`, "no write policy") is rewritten: admins now write roles through the Users page, the script is the operator path, and the guard binds it.
- The runbook states:
  - the Users page is the normal path;
  - the script stays for bootstrap and recovery;
  - its writes are recorded as "Operator";
  - the last admin cannot be demoted or set to `none`.

### Success Criteria:

#### Automated Verification:

- [x] The matrix flip runs red against Phase 1's schema (deny drill), then green after the migration: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- [x] Migrations apply cleanly from scratch: `pnpm exec supabase db reset`
- [x] The guard and lock tests pass: `pnpm test:integration src/test/last-admin-guard.integration.test.ts`
- [x] The recorder tests pass: `pnpm test:integration src/test/access-changes.integration.test.ts`
- [x] The lifecycle smoke and the full integration lane pass (teardown survives the guard and the FKs): `pnpm test:integration`
- [x] Types regenerate cleanly: `pnpm db:types`, then `pnpm check`
- [x] The advisors show no new ERROR or WARN: `pnpm exec supabase db advisors`

#### Manual Verification:

- [x] Locally, with yourself the only admin, `node scripts/assign-role.mjs <you> author` is refused with the last-admin message, and your role is unchanged.
- [x] `select * from public.access_changes order by occurred_at desc limit 5` in Studio shows the factories' and the script's writes as `operator`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: App Capability, Loader and Action

### Overview

This phase makes the app speak `manage_users`, moves `profileLabel` where a page slice can reach it, and adds the `_pages/users` slice's data and write path. There is no page yet.

### Changes Required:

#### 1. The `manage_users` capability

**File**: `src/shared/config/capability.ts`, `capability.test.ts`, `access-state.test.ts`; `src/shared/lib/actions/require-capability.test.ts`; `src/actions/action-capabilities.test.ts`

**Intent**: Mirror `private.can_manage_users()` in the app's capability map, so routes, nav and actions can say "no" clearly before RLS does.

**Contract**:

- `Capability = "session" | "read" | "edit" | "manage_users"`, and only `CAPABILITIES_BY_ROLE.admin` gains it. The doc comment names the third SQL wrapper.
- The `Record<Capability, …>` tables in the tests gain their rows.
- `action-capabilities.test.ts`'s `NON_EDIT` set is renamed and redocumented to "actions declaring a capability other than `edit`", and includes `changeUserRole: "manage_users"`.

#### 2. Move `profileLabel` down to `shared/ui`

**File**: `src/app/layouts/profile-label.ts` and its test → `src/shared/ui/profile-label.ts` and its test; `src/shared/ui/index.ts`; `src/app/layouts/SidebarLayout.astro`; `src/app/layouts/SidebarAccountLink.astro`

**Intent**: The sidebar and the Users page must name a person the same way (FR-413). `shared/lib` is at steiger's cap, and `shared/ui` already holds cross-layer presentational helpers.

**Contract**:

- `profileLabel({ displayName, email }): ProfileLabel` is unchanged, and exported from the `@/shared/ui` barrel.
- Both layout importers switch to it.
- Behaviour is identical.

#### 3. SQLSTATE constant

**File**: `src/shared/api/postgrest/sqlstates.ts`, and its barrel

**Intent**: Name the custom-status SQLSTATE that the guard raises.

**Contract**: `RAISED_CONFLICT = "PT409"`, with a doc comment: PostgREST's `PTxyz` convention answers HTTP 409, and the last-admin guard raises it. Export it beside the other SQLSTATEs from `shared/api/postgrest/index.ts` and `@/shared/api`. It is the first custom errcode in the repo.

#### 4. The `_pages/users` slice: loader, model, action

**File**: `src/_pages/users/` — `index.ts`; `api/{index.ts, actions.ts, constants.ts, loader.ts, change-user-role.ts, user-client.ts}`; `model/{user-rows.ts, user-rows.test.ts, schemas.ts, schemas.test.ts}`; `src/actions/index.ts`

**Intent**: Load the list from the four tables, join and sort it in a pure, unit-tested model, and expose one thin admin-only action. The action never takes the actor from input: the trigger reads `auth.uid()`.

**Contract**:

- `loadUserDirectory(supabase): Promise<LoaderResult<UserRow[]>>`:
  - follows the `withSupabase` and `assertNoQueryErrors` pattern (`src/_pages/teachers/api/loader.ts`);
  - runs parallel selects of:
    - `user_directory (user_id, email, is_service_account)`;
    - `profiles (user_id, display_name)`;
    - `user_roles (user_id, role)`;
    - `access_changes (id, target_id, actor_id, actor_kind, occurred_at)`, `not target_id is null`, ordered `occurred_at desc, id desc`. `occurred_at` is `now()`, the transaction's start, so two records in one transaction tie, and `id` breaks the tie.
  - It loads all rows of each, which is fine at school scale.
- `buildUserRows(input): UserRow[]` returns, per user:
  - `{ userId, label: ProfileLabel, role: AppRole | null, status: "active" | "no_access", isServiceAccount, lastChange: { by: { kind: "user"; label: ProfileLabel } | { kind: "deleted" } | { kind: "operator" }; at: string } | null }`.
  - The latest record per target wins: the greatest `occurred_at`, then the greatest `id` on a tie. It does not rely on the loader's order.
  - Sorted by `label.primary` (case-insensitive `localeCompare`, `sensitivity: "base"`), then by email.
  - It never mutates its input, and uses declarative `filter`/`map`/`find` (lessons).
- `changeUserRoleInput = z.object({ userId: z.uuid(), role: z.enum(<app roles>).nullable() })`. `null` means "No access".
- `changeUserRole(supabase, input)`:
  - `role === null` runs `.delete().eq("user_id", …).select("user_id")`. 0 rows maps to `NOT_FOUND`.
  - Otherwise it runs `.upsert({ user_id, role }, { onConflict: "user_id" }).select("user_id, role").single()`.
  - It checks `error.code === RAISED_CONFLICT` first and throws `CONFLICT` with the last-admin message. Otherwise it hands the result to `unwrapRow(result, { failure })` (upsert) or `unwrapMany(result, failure)` (delete). Those are the public way in: `toDomainError` is not exported from `@/shared/api`. They bring `42501` → `FORBIDDEN` unconditionally, and that covers the guard's `user_id`-move refusal too.
  - Messages live in `api/constants.ts`.
- `userActions = { changeUserRole: defineDomainAction({ input, run, requires: "manage_users" }) }`, composed into `server` in `src/actions/index.ts`.
- `user-client.ts` exposes `changeUserRole(values)` over `callAction`, so the UI never imports `astro:actions`.
- Integration test `src/_pages/users/api/change-user-role.integration.test.ts`, run through signed-in clients with throwaway targets:
  - an admin gives, changes and removes a role successfully;
  - an author is refused with `FORBIDDEN`;
  - removing a role-less user's role is `NOT_FOUND`;
  - targeting the machine fixture is `FORBIDDEN`.

### Success Criteria:

#### Automated Verification:

- [x] Type checking passes (every `Record<Capability, …>` filled): `pnpm check`
- [x] Unit tests pass (capability, access-state, require-capability, action-capabilities, user-rows, schemas, profile-label): `pnpm test`
- [x] The action integration test passes: `pnpm test:integration src/_pages/users/api/change-user-role.integration.test.ts`
- [x] Lint and FSD pass (no upward import; `shared/lib` stays at 15): `pnpm lint && pnpm steiger`
- [x] The build is clean: `pnpm build`

#### Manual Verification:

- [x] The sidebar footer still shows the display name with the email beneath it, or the email alone: `pnpm build && pnpm preview`, as an author.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Users Page

### Overview

This phase delivers the admin-facing page: the route with its 404 gate, the nav item and tile, and the table with the per-row role picker, confirmations, badges and the latest-change line.

### Changes Required:

#### 1. Nav item

**File**: `src/shared/config/nav.ts`; `src/shared/config/nav.test.ts`

**Intent**: Show **Users** to `manage_users` holders only, in the sidebar and the dashboard tiles alike.

**Contract**:

- `GLOBAL_NAV_ITEMS` gains `{ href: "/users", label: "Users", icon: <a lucide icon distinct from Students' "Users", e.g. UserCog>, requires: "manage_users" }`.
- `nav.test.ts` splits:
  - admin sees `["Home", "Plans", "Users"]`;
  - author and viewer see `["Home", "Plans"]`.

#### 2. Route

**File**: `src/pages/users.astro` (new)

**Intent**: The route decides access once and passes data down. A non-admin gets a 404, and the middleware's role gate is unchanged.

**Contract**:

- If `!allows(Astro.locals.access, "manage_users")`, set `Astro.response.status = 404` and render a minimal "Page not found" body inside `AppShellLayout`, with a link to `/dashboard`.
- Otherwise: `createClient`, then `loadUserDirectory`. A missing client or a failed load renders the existing 503 idiom.
- On success, render `<UsersPage rows={…} currentUserId={Astro.locals.user.id} client:load />`.
- Page title "Users".

#### 3. Page island and components

**File**: `src/_pages/users/ui/{UsersPage.tsx, UserTable.tsx, UserTable.test.tsx, RoleSelect.tsx, ConfirmRoleChangeDialog.tsx, ConfirmRoleChangeDialog.test.tsx, LastChange.tsx}`; `src/_pages/users/model/{use-role-change.ts, needs-confirmation.ts, needs-confirmation.test.ts}`; `src/_pages/users/index.ts`

**Intent**: A thin orchestrator over the table. A role change saves immediately, except for self-changes and "No access", which confirm first. Results follow the repo's toast-and-refresh conventions.

**Contract**:

- `UsersPage` mounts `<Toaster />` and owns `use-role-change`.
- `UserTable` uses the shadcn `Table`. Columns:
  - **User**: `label.primary`, with `label.secondary` beneath, plus badges for "You" (`userId === currentUserId`) and "Service account";
  - **Role**: `RoleSelect`;
  - **Status**: "Active" / "No access";
  - **Last change**: `LastChange`, or "—".
- `RoleSelect` is a shadcn `Select` with Admin / Author / Viewer / No access. Its accessible name is "Role for \<primary\>". It is disabled while that row's change is in flight.
- `needsConfirmation({ targetIsSelf, newRole }): "self" | "remove" | null` is pure and unit-tested.
- `ConfirmRoleChangeDialog`:
  - follows the `AlertDialog` / `onClose` contract;
  - "self" copy explains that you will lose admin access, or all access;
  - "remove" copy explains that \<primary\> will lose access to every plan.
- `use-role-change`:
  - success on another user: toast "Role changed", then `refreshPage()`;
  - success on yourself: `window.location.assign("/dashboard")`;
  - `CONFLICT`, `NOT_FOUND` or `FORBIDDEN`: toast the server message, then `refreshPage()`, so the picker shows the real value again.
- `LastChange`: "Changed by \<label.primary | Operator | Deleted user\> · \<time\>", with `<time dateTime>` filled in after `useHydrated()`.
- Semantic tokens only. Detokenize any newly added shadcn output (lessons).
- Component tests:
  - the table renders name and email, and the badges;
  - choosing another role on your own row, or "No access" on any row, opens the dialog;
  - choosing a role for another user calls the client without a dialog.

### Success Criteria:

#### Automated Verification:

- [x] Unit and component tests pass: `pnpm test`
- [x] Type checking passes: `pnpm check`
- [x] Lint and FSD pass: `pnpm lint && pnpm steiger`
- [x] The build is clean: `pnpm build`

#### Manual Verification:

- [x] As an admin (`pnpm build && pnpm preview`):
  - **Users** shows in the sidebar and as a dashboard tile, and the list shows display names with emails beneath;
  - a role-less user reads "No access";
  - the latest-change line shows a local date.
- [x] Change another user's role: you get a toast, the row updates, and "Changed by \<you\>" appears.
- [x] Choose **No access**: a confirm appears, and on confirm the status reads "No access".
- [x] With a second admin present, demote yourself: a confirm appears, then you land on `/dashboard` with no Users item.
- [x] As the only admin, demote yourself: the toast reads "The school must keep at least one admin", and the picker reverts.
- [x] As an author: there is no Users item, and `/users` shows the 404 body.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Admin E2E Account, Specs and Documentation

### Overview

This phase adds the admin e2e principal and specs, the cross-role tripwires, and every document whose rules S-406 changes. It ends with the hosted post-deploy checks.

### Changes Required:

#### 1. Admin e2e account and project

**File**: `e2e/admin-credentials.mjs` (new); `e2e/admin.setup.ts` (new); `playwright.config.ts`; `scripts/provision-e2e-author.mjs`; `.github/workflows/ci.yml` (comment at `:276-277` only)

**Intent**: Give e2e a fixed admin account, provisioned on every run like the viewer, with its own project for `*.admin.spec.ts`.

**Contract**:

- `e2e-admin@example.test` with a fixed password literal (`viewer-credentials.mjs` pattern).
- `ACCOUNTS` gains `{ …admin, role: "admin" }`, reset on every run.
- `admin.setup.ts` writes `e2e/.auth/admin.json`.
- New project `chromium-admin` uses that storageState and runs only `*.admin.spec.ts`. `chromium` ignores `*.admin.spec.ts`.
- CI needs no new step (`pretest:e2e` provisions). Only the comment listing the accounts is updated.

#### 2. Specs

**File**: `e2e/specs/users.admin.spec.ts` (new); `e2e/specs/read-only.viewer.spec.ts` or a new `users.viewer.spec.ts`; `e2e/specs/no-access.no-role.spec.ts`; `e2e/specs/users-hidden.spec.ts` (new, author)

**Intent**: Prove the page end to end as the admin, without ever touching the admin's own role. Prove its absence for every other principal, each absence paired with the admin-side presence.

**Contract**:

- `users.admin.spec.ts`:
  - It creates a throwaway user through the service-role Admin API and deletes it in a `finally`, refusing a non-loopback `SUPABASE_URL` first.
  - It asserts the Users nav item and tile.
  - It asserts that the list shows `e2e-viewer@example.test` as Viewer and `e2e-no-role@example.test` as "No access".
  - It gives the throwaway user Author: a toast, then Author / Active and "Changed by e2e-admin…".
  - It sets the throwaway user to No access: a confirm, then "No access".
  - It asserts that the admin's own row shows "You".
- Viewer: no Users link, and `/users` returns 404.
- Author (`users-hidden.spec.ts`): the same two checks.
- No-role: `/users` lands on the `/dashboard` notice.
- Specs select by role and accessible name (ui-conventions § Role + ARIA).

#### 3. Documentation and conventions

**File**: `CLAUDE.md`; `e2e/CLAUDE.md`; `README.md`; `context/foundation/test-plan.md`; `docs/runbooks/calibration-campaign.md`; `context/foundation/roadmap.md` (S-409 and S-411 risk lines only); `context/foundation/lessons.md` (via `/10x-lesson`)

**Intent**: Keep every stated rule true after this slice (lessons: "a convention that cites a code mechanism is coupled to it").

**Contract**:

- `CLAUDE.md` § Database & auth:
  - The DEFINER bullet (`:47`): "Its wrappers (`private.can_read()`, `private.can_edit()`, `public.own_app_role()`) stay INVOKER" gains `private.can_manage_users()`.
  - `:49`: the own-account-rows exception "(`profiles`, `user_roles`)" gains `user_directory`. "Writes require `private.can_edit()`" gains "except `user_roles`, which requires `private.can_manage_users()`; `access_changes` is written only by its trigger".
  - "The role → capability map lives only in those two wrappers" becomes "in those wrappers (`can_read`, `can_edit`, `can_manage_users`)".
  - "Every policy names `to authenticated`" gains the recorded exception: `user_directory`'s mirror policy names `to supabase_auth_admin`, the Auth trigger's writer, and never PUBLIC.
  - A new bullet: triggers on user-keyed tables exempt FK cascades only in **BEFORE** triggers (`pg_trigger_depth() > 1`, because AFTER cascade events run at depth 1), and record grants `AFTER INSERT`, because an upsert fires BEFORE INSERT for conflicting rows.
  - "A new human table gets the four capability policies" notes that user-keyed tables declare theirs in `USER_KEYED_POLICIES`.
- `e2e/CLAUDE.md`:
  - the project list and naming gain `chromium-admin` and `*.admin.spec.ts`;
  - "four setup files";
  - an admin rule: its role, password and session are never changed;
  - the throwaway-user exception is extended to admin specs;
  - the spec count is updated.
- `README.md`:
  - the Auth-routes paragraph names `/users` and the last-admin rule;
  - the role note says the Users page is the normal path, and `assign-role.mjs` stays for bootstrap and recovery;
  - the § Database grants note (`:495`), "(`private.can_read()` to read, `private.can_edit()` to write)", names `can_manage_users()` for `user_roles` writes.
- `test-plan.md`:
  - §4 gains the admin project and setup file;
  - §6.2 gains the user-keyed policy map and the rolled-back invariant test;
  - §6.3 replaces "the admin account arrives with S-406".
- `calibration-campaign.md` § 1: when creating the campaign account, set `app_metadata.service_account = true` through the Admin API (`PUT /auth/v1/admin/users/<id>`, secret key, from the operator's shell).
- `roadmap.md`:
  - S-409 and S-411 must write their own `access_changes` records with an explicit actor;
  - S-411 must refuse deleting the last admin itself.
  - Status fields are untouched, since `/10x-implement` and `/10x-archive` own them.
- `lessons.md`: one entry, captured with `/10x-lesson`, on the BEFORE/AFTER trigger depth in cascades and BEFORE INSERT under upsert.

### Success Criteria:

#### Automated Verification:

- [x] The full e2e suite passes, including `chromium-admin`: `pnpm test:e2e`
- [x] The full local CI gate passes: run the `/verify` skill (install → astro sync → check → lint → steiger → audit → test → build)
- [x] The integration lane passes: `pnpm test:integration`
- [x] Formatting is clean: `pnpm format` leaves no diff

#### Manual Verification:

- [x] Pre-merge, on hosted, read-only: `select count(*) from public.profiles where display_name ~ '\x061C'` returns 0, so migration B's `validate` cannot fail the deploy.
- [ ] Post-deploy on hosted:
  - `has_table_privilege` shows anon with nothing, and authenticated with exactly SELECT on `user_directory` and exactly INSERT and SELECT on `access_changes`;
  - `supabase_auth_admin` holds SELECT, INSERT and UPDATE on `user_directory`;
  - `pnpm exec supabase db advisors` shows no new ERROR or WARN.
- [ ] Post-deploy on hosted: the `user_directory` row count equals `auth.users`; your account holds `admin`; `/users` opens and lists the school's staff with no machine user.
- [ ] Post-deploy on hosted: promote the DP coordinator in-app (the PRD's bootstrap step). Their row shows "Changed by \<you\>".

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful. Merge only when no production solve is running (README rule).

---

## Testing Strategy

### Unit Tests:

- `buildUserRows`:
  - a missing profile falls back to the email;
  - the latest record per target wins, with a tie on `occurred_at` broken by the greater `id`;
  - the actor renders as user, operator or deleted;
  - a role-less user reads `no_access`;
  - sorting is case-insensitive, with ties broken by email;
  - the input is never mutated.
- `needsConfirmation`: self, remove, and neither.
- The capability map and access state for `manage_users`. `require-capability` and `action-capabilities` cover every `Capability`.
- The display-name schema refuses U+061C. `profileLabel` is unchanged after the move.
- `UserTable`, `RoleSelect` and `ConfirmRoleChangeDialog` component behaviour.

### Integration Tests:

- **Role matrix.**
  - The directory is readable as specified, and machines are hidden from all principals.
  - Only admins write `user_roles`, and never for a machine.
  - `access_changes` is admin-read only and never directly writable.
  - Every user-keyed table's policies match `USER_KEYED_POLICIES`.
  - The DEFINER tripwire is unchanged.
- **Directory.** The real GoTrue create, update and delete sequence is mirrored. The hook ignores `service_account`. The trigger stays off sign-in, which the structural check proves.
- **Guard.** In a rolled-back transaction, a single demotion, a multi-row demotion and a "No access" delete are each refused, both as the owner and as a simulated admin session. Account deletion of the last admin passes.
- **Lock.** A two-connection advisory-lock wait.
- **Recorder.** Grant, change, removal and self-demotion are recorded with the right actor. No-op upserts are not recorded. Operator writes carry `actor_kind = 'operator'`. A deleted actor or target is nulled.
- **Action.** Through signed-in clients: the admin's paths succeed, and author, role-less and machine targets are refused with the right `DomainError`.

### Manual Testing Steps:

1. As the only local admin, try demoting yourself in the page and via `assign-role.mjs`. Both are refused with the last-admin message.
2. Promote a second local user to admin, demote yourself, confirm, and land on `/dashboard`. Sign in as the second admin and see "Changed by \<you\>".
3. Set a user to No access. They land on the "no access yet" notice on their next request, and their row reads "No access".
4. Flag a user with `app_metadata.service_account = true` through the Admin API, and see the "Service account" badge.

## Performance Considerations

- The page runs four parallel selects, and `access_changes` is read whole and reduced in the model. At school scale (tens of users, a handful of records each) that is a few KB. The `(target_id, occurred_at desc)` index keeps a later per-user query cheap if the history grows.
- The guard's advisory lock serialises only demotions of admins, a rare admin action. It is irrelevant to the <200 ms drag-drop budget, which touches no `user_roles` write.
- The `auth.users` trigger fires on user creation and on email or flag changes only, never on sign-in or token refresh.

## Migration Notes

- Three additive migrations: directory, display-name constraint and role management. Each file is one transaction, and each is safe against live data on its own. Nothing is dropped.
- Hosted already holds an admin (confirmed by the user). The migrations still assert no admin count, so a bootstrap state cannot fail the deploy.
- The campaign account no longer exists on hosted, so there is no flag step now. The runbook carries it for the next campaign.
- Recovery is roll-forward only. A trigger bug on `auth.users` blocks user creation and email links on hosted. The fix is a new migration that replaces the function body, copied from its **latest live definition** (lessons).
- Merge only when no production solve is running (README).

## References

- Research: `context/changes/users-page-roles/research.md` (probes P1–P6, options per challenge)
- Roadmap item: `context/foundation/roadmap.md` § S-406; PRD FR-405/406/408/413, § Access Control Changes
- The DEFINER base and its wrappers: `supabase/migrations/20261028140939_user_roles.sql:88-142`
- The capability map: `src/shared/config/capability.ts:8,16-20`; nav seam `src/shared/config/nav.ts:12,37`
- Role matrix: `src/test/role-matrix-expectations.ts:205-208,264-306`; `src/test/role-matrix.integration.test.ts:203-277,355-370,459-461`
- A comparable slice: `src/_pages/teachers/` (loader, client, table, confirm dialog)
- The SSR-safe time precedent: `src/shared/lib/use-hydrated/use-hydrated.ts`, `src/_pages/plans-list/ui/PlanIndicatorsCell.tsx:95`
- Prior changes: `context/archive/2026-10-28-fail-closed-roles/`, `context/archive/2026-10-30-viewer-read-only/`, `context/archive/2026-10-16-account-self-service/` (F4)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: User Directory (read side)

#### Automated

- [x] 1.1 The matrix diff for `user_directory` runs red against the pre-migration schema (deny drill), then green after — 2224da5
- [x] 1.2 Migrations apply cleanly from scratch: `pnpm exec supabase db reset` — dc32c4a
- [x] 1.3 The directory integration test passes — 2224da5
- [x] 1.4 The solver credential suite stays green — 2224da5
- [x] 1.5 Type checking passes: `pnpm check` — 2224da5
- [x] 1.6 Unit tests pass (schema case for U+061C): `pnpm test` — 2224da5
- [x] 1.7 Lint and FSD pass: `pnpm lint && pnpm steiger` — 2224da5
- [x] 1.8 The advisors show no new ERROR or WARN locally — 2224da5

#### Manual

- [x] 1.9 A local Studio user is mirrored, untouched by sign-in, and removed on delete — 2224da5

### Phase 2: Role Writes, Last-Admin Guard and Access Record (write side)

#### Automated

- [x] 2.1 The matrix flip runs red against Phase 1's schema (deny drill), then green after the migration — dc32c4a
- [x] 2.2 Migrations apply cleanly from scratch: `pnpm exec supabase db reset` — dc32c4a
- [x] 2.3 The guard and lock tests pass — dc32c4a
- [x] 2.4 The recorder tests pass — dc32c4a
- [x] 2.5 The lifecycle smoke and the full integration lane pass — dc32c4a
- [x] 2.6 Types regenerate cleanly, then `pnpm check` — dc32c4a
- [x] 2.7 The advisors show no new ERROR or WARN — dc32c4a

#### Manual

- [x] 2.8 `assign-role.mjs` demoting the only local admin is refused with the last-admin message — dc32c4a
- [x] 2.9 `access_changes` shows the factories' and the script's writes as `operator` — dc32c4a

### Phase 3: App Capability, Loader and Action

#### Automated

- [x] 3.1 Type checking passes (every `Record<Capability, …>` filled): `pnpm check` — f30a6b3
- [x] 3.2 Unit tests pass: `pnpm test` — f30a6b3
- [x] 3.3 The action integration test passes — f30a6b3
- [x] 3.4 Lint and FSD pass (no upward import; `shared/lib` stays at 15) — f30a6b3
- [x] 3.5 The build is clean: `pnpm build` — f30a6b3

#### Manual

- [x] 3.6 The sidebar footer label is unchanged after the `profileLabel` move — f30a6b3

### Phase 4: Users Page

#### Automated

- [x] 4.1 Unit and component tests pass: `pnpm test` — a9c3acd
- [x] 4.2 Type checking passes: `pnpm check` — a9c3acd
- [x] 4.3 Lint and FSD pass: `pnpm lint && pnpm steiger` — a9c3acd
- [x] 4.4 The build is clean: `pnpm build` — a9c3acd

#### Manual

- [x] 4.5 Admin sees the Users item and tile, the list with labels, "No access" and local dates — a9c3acd
- [x] 4.6 Changing another user's role toasts, updates the row and shows "Changed by \<you\>" — a9c3acd
- [x] 4.7 No access confirms and updates the status — a9c3acd
- [x] 4.8 Self-demotion with a second admin confirms and lands on `/dashboard` — a9c3acd
- [x] 4.9 Self-demotion as the only admin is refused and the picker reverts — a9c3acd
- [x] 4.10 An author sees no Users item, and `/users` is 404 — a9c3acd

### Phase 5: Admin E2E Account, Specs and Documentation

#### Automated

- [x] 5.1 The full e2e suite passes, including `chromium-admin`: `pnpm test:e2e` — e5d99ef
- [x] 5.2 The full local CI gate passes (`/verify`) — e5d99ef
- [x] 5.3 The integration lane passes: `pnpm test:integration` — e5d99ef
- [x] 5.4 Formatting is clean: `pnpm format` leaves no diff — e5d99ef

#### Manual

- [x] 5.5 Pre-merge hosted check: no display name contains U+061C — e5d99ef
- [ ] 5.6 Post-deploy hosted grants and advisors are as specified
- [ ] 5.7 Post-deploy hosted directory count matches, you hold admin, and `/users` lists staff with no machine
- [ ] 5.8 Post-deploy: the DP coordinator is promoted in-app, and the row shows "Changed by \<you\>"
