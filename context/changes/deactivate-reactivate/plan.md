# Deactivate and reactivate (S-408) Implementation Plan

## Overview

An admin can deactivate a colleague from the Users page and reactivate them later. A deactivated person's data access ends on their next request, whatever their unexpired JWT says. They land on the "no access yet" notice, keep their own account (FR-410), and keep their role for when they come back. The school can never be left without an active admin (FR-408). This is roadmap slice S-408 (PRD FR-407, nice-to-have; FR-408's "or deactivate").

The state is one nullable column, `public.user_roles.deactivated_at`. The fence is one extra condition in `private.current_app_role()`, which every policy, RPC and middleware read already goes through. Two more functions learn the new state: the last-admin guard and the access record. The Users page gains a status and two row actions. The break-glass script learns to reactivate. There is no new table, policy, grant, SECURITY DEFINER function, Edge Function operation, public route, secret or hosted manual step.

## Current State Analysis

The research (`context/changes/deactivate-reactivate/research.md`) is the codebase baseline. In short:

- **One fence.** Every human-facing policy calls `private.can_read()` / `can_edit()` / `can_manage_users()`, and all of them wrap `private.current_app_role()`, which is STABLE and read per statement. The live body is `supabase/migrations/20261109143000_must_change_password.sql:69-85`. It already reads null for a pending user (S-409), and an invitee rides the same fence (S-410).
- **The middleware reads the role on every request** (`src/middleware.ts:85-95`). A null role with no pending flag resolves to `none` (`src/shared/config/resolve-access.ts:22-28`). `decideRoleGate` then sends every gated page to `/dashboard`, which shows the notice when `access.status === "none"` (`src/_pages/dashboard/ui/DashboardPage.astro:9,36-49`). Actions answer FORBIDDEN through `defineDomainAction`'s `requires`.
- **The guard lets a deactivation through as written.** The live `private.guard_last_admin()` (`must_change_password.sql:128-179`) returns early when `old.role <> 'admin' or (tg_op = 'UPDATE' and new.role = 'admin')` (`:147`). Deactivating an admin keeps `role = 'admin'`, so the last admin could be deactivated. Its count (`:159-170`) excludes pending admins but would count a deactivated one.
- **The recorder skips the write.** The live `private.record_role_change()` (`supabase/migrations/20261105080343_role_management.sql:242-280`; never re-created) returns early on an UPDATE whose role is unchanged (`:257-259`), so a deactivation would go unrecorded. `access_change_kind` has `role_granted | role_changed | role_removed`, plus S-409's and S-410's values.
- **The table already fits.** `user_roles` UPDATE is "Admins change roles", gated by `can_manage_users()`. Its WITH CHECK requires a directory row. SELECT is the caller's own row, or every row for an admin. The authenticated UPDATE grant is table-level (`role_management.sql:109-135`). Both BEFORE triggers fire on UPDATE and DELETE: `user_roles_guard_last_admin` runs before `user_roles_record_change` (alphabetical), and grants are recorded AFTER INSERT (`:184-186, 286-292`).
- **Every role write sends only `{user_id, role}`.** That covers the Users page (`src/_pages/users/api/change-user-role.ts:21-28`), the Edge Function (`supabase/functions/admin-users/handler.ts:381-397`, invitees only), `scripts/assign-role.mjs:88-91` and the e2e provisioner (`scripts/provision-e2e-author.mjs:99`, `pretest:e2e`). PostgREST's upsert updates only the columns it is sent.
- **The Users page** derives `UserStatus` with "first match wins": invitation, then pending, then role (`src/_pages/users/model/user-rows.ts:105-117`). The page carries per-row `can*` flags. Row actions sit in the Status cell (`ui/UserTable.tsx:69-114`), and confirm dialogs are wired in `ui/UsersPage.tsx`. `LastChange.tsx` renders any record kind as "Changed by … · when".
- **The role matrix** has a `pendingAdmin` principal: an admin role row, fenced by the pending flag (`src/test/role-matrix-expectations.ts:61`). The invariant test pins it equal to `noRole` on every cell except the own-row ones (`role-matrix-expectations.test.ts:166-176`). S-409 showed its red by temporarily skipping the factory's flag write, because writing a missing column throws `PGRST204` in setup (`context/archive/2026-11-08-create-account-fallback/plan.md:489`).
- **E2E** allows a UI sign-in in a test only for `create-account.admin.spec.ts`'s throwaway (`e2e/CLAUDE.md:58-66`). Service-role throwaway users are sanctioned separately (`:97-104`, `e2e/support/admin-api.ts`).

## Desired End State

- On `/users`, every other user's **Active** row offers **Deactivate**. It asks first, then the row reads **Deactivated**, still showing its role, with **Reactivate**. Reactivate saves at once, and the row reads **Active** with the role it holds. The admin's own row never offers Deactivate.
- The deactivated person's next request reads nothing: every page sends them to `/dashboard`, where the notice heading still says "No access yet — ask your admin". The paragraph now reads true both for someone never given access and for someone deactivated. `/account` stays open. Any action answers FORBIDDEN. Reactivating restores their access on their next request, with no new sign-in.
- The role picker stays live on a deactivated row. Changing the role keeps the person deactivated, and reactivation restores whatever role the row then holds. "No access" deletes the row and its flag.
- The last active admin cannot be deactivated, by any path (`PT409`, "The school must keep at least one admin."). A deactivated admin does not count as active, so demoting the only active admin is refused even while a deactivated admin exists.
- `access_changes` records `deactivated` and `reactivated`, with the actor, and `old_role = new_role =` the held role. "Last change" shows who did it and when.
- `node scripts/assign-role.mjs <email> <role>` on a deactivated person reactivates them, prints `(reactivated)` and is recorded as the Operator.
- Verified by the role matrix (`deactivatedAdmin` principal, `ROLE_DEACTIVATIONS` cells), the guard and access-record suites, a domain integration test proving that an already signed-in session loses access and regains it, unit tests, the new two-context E2E spec, and `/verify`.

### Key Discoveries:

- Adding the column in its **own migration first** gives an honest red: the factory's write succeeds, and the fence is absent, so `deactivatedAdmin` behaves as an admin. Then the guard lets the last admin's deactivation through and the recorder writes nothing. The fence migration then turns all three green. This avoids S-409's "skip the write" workaround.
- The test factory must write `deactivated_at` inside `assignRole`'s INSERT, not as a later UPDATE. An UPDATE fires the widened guard, which can raise `PT409` while `signInEveryPrincipal` creates principals concurrently on a fresh stack. An UPDATE with no role row also matches nothing, silently (`src/test/factories/create-signed-in-user.ts:51-66`).
- The recorder runs BEFORE UPDATE, so even a self-deactivation is recorded while the admin still holds `can_manage_users()`. The `access_changes` INSERT policy (`role_management.sql:223-229`) still holds.
- `ALTER TYPE … ADD VALUE` values are usable only after commit. Plpgsql bodies may name them, but post-conditions must check `pg_enum` by label text, never by casting (`must_change_password.sql:51-52`).
- Do not reuse `user_directory.must_change_password` as the fence: any password write clears it (`must_change_password.sql:93-110`), so a deactivated user changing their password on `/account` would reactivate themselves (research §4.7).

## What We're NOT Doing

- **A dedicated `deactivated` access state or middleware read.** The person resolves to `none` and sees the existing notice. Only its paragraph is reworded.
- **Redirecting to the notice on FORBIDDEN mid-session.** This keeps parity with S-406's role removal: a refused write rolls back with a generic error, polls keep the old snapshot, and the notice appears on the next navigation.
- **Deactivating pending rows** (invited, invitation expired, invitation accepted, temporary password) or **the admin's own row**. Revoke covers invitations, and "No access" on your own row covers self-lockout. The database still allows self-deactivation unless the admin is the last active one, which is the guard's job.
- **Locking the role picker** on a deactivated row.
- **A "deactivated since" date in the Status cell.** "Last change" already shows when.
- **Signing the person out, banning them, or revoking their sessions.** Those are S-411's tools, and they send people to sign-in rather than to the notice. A deactivated person's refresh token stays alive, which is harmless (RLS fails closed) and is why reactivation is instant.
- **Stopping a deactivated person's running generation job.** It keeps solving, and only an admin can stop it (S-407).
- **Any Edge Function change.** `requireAdmin` already refuses a deactivated admin through `own_app_role`, and the function writes role rows only for invitees.
- **S-411's pairing** (setting `deactivated_at` alongside a ban). That belongs to S-411's plan.

## Implementation Approach

Database first, red-first, because the slice is an access-control change (CLAUDE.md § Database & auth):

1. A column-only migration.
2. The matrix, factory and guard/record test diffs, run red.
3. The fence migration that turns them green.

Then the Users page consumes the new column through its loader, model, one action and one hook. Last come the operator path (the script) and the browser proof (a second context whose live session hits the notice and comes back).

Every write goes through the admin's own session, so RLS judges it and the trigger records it under `auth.uid()`. Nothing needs the secret key.

## Critical Implementation Details

- **Re-create from the live bodies (lessons.md).** Use `current_app_role()` and `guard_last_admin()` from `20261109143000_must_change_password.sql:69-85` and `:128-179`, and `record_role_change()` from `20261105080343_role_management.sql:242-280`. Name those sources in the migration header, as S-409's migration does (`must_change_password.sql:31-41`).
- **Guard semantics.** "Active admin" means `role = 'admin' and deactivated_at is null`.
  - **Early return:** skip the check when `old` is not an active admin, or when an UPDATE leaves `new` an active admin.
  - **Count:** count the other admins who are not pending and not deactivated.
  - **Unchanged:** the 42501 role-move refusal, the BEFORE + `pg_trigger_depth() > 1` cascade exemption with its nested `auth.users` read, advisory lock `406001` and `PT409`.
  - **Do not touch** the pending condition's position, for an `old` row that is pending. That is today's behaviour, and this slice does not change it.
- **Recorder semantics.**
  - **UPDATE:** record `role_changed` when the role differs. Separately, record `deactivated` when `deactivated_at` goes from null to set, or `reactivated` when it goes from set to null. One UPDATE that does both writes both records, role first. Moving one timestamp to another records nothing.
  - **The flag records' roles:** `deactivated` and `reactivated` carry `new.role` as both `old_role` and `new_role`, the role held after the write. So in a combined write, `role_changed` reads old → new, and the flag record reads new → new.
  - **INSERT:** records `role_granted`, plus `deactivated` when the row arrives deactivated, which only the service role does.
  - **DELETE:** records `role_removed`, as today, deactivated or not.
  - Keep the cascade skip and the `actor_kind` derivation from `auth.uid()`.
- **Lock budget.** Open both migrations with `set local lock_timeout = '5s'`, as S-409 did. `add column` takes a brief ACCESS EXCLUSIVE lock on `user_roles`, which every request reads.

## Phase 1: The fence (database, red-first)

### Overview

Add the column, write the access-control claims and show them red, then add the fence that turns them green. After this phase a deactivated person has no data access, the guard and the record handle the new state, and the generated types carry the column and the two kinds.

### Changes Required:

#### 1. Column-only migration

**File**: `supabase/migrations/<ts>_user_roles_deactivated_at.sql` (via `pnpm exec supabase migration new user_roles_deactivated_at`)

**Intent**: Add the state with no behaviour, so the tests that follow can write it and fail for the right reason.

**Contract**: `alter table public.user_roles add column deactivated_at timestamptz` (nullable, no default; null means active). Add a column comment naming S-408 and "null = active". Post-conditions: the column exists, is nullable, and no existing row has it set. Header comment: this file is deliberately inert, and the fence follows in the next migration.

#### 2. Generated types (first pass)

**File**: `src/shared/api/database.types.ts`

**Intent**: Let the factory and tests type-check against the new column.

**Contract**: `pnpm db:types` with the stack up; review the diff (one column on `user_roles`).

#### 3. Factory option

**File**: `src/test/factories/create-signed-in-user.ts`

**Intent**: Create a signed-in user whose role row arrives deactivated, before the first sign-in.

**Contract**: A new option, `deactivated?: boolean`, beside `mustChangePassword`. When it is set, `assignRole`'s INSERT carries `deactivated_at: new Date().toISOString()` in the same write. `deactivated` without `role` throws. Update the doc comment.

#### 4. Role-matrix expectations (red-first diff)

**File**: `src/test/role-matrix-expectations.ts`

**Intent**: State the claims: a deactivated admin holds exactly what a pending admin holds, and only an admin can deactivate or reactivate another user.

**Contract**:
- `Principal` gains `deactivatedAdmin` (`:61`), with its doc comment (`:57-60`) and a `PRINCIPAL_NOTES` entry (`:124-132`). The note also orders the describes.
- The shared cell sets (`NOBODY` / `SIGNED_IN` / `ANY_ROLE` / `EDITORS` / `ADMIN_ONLY`, `:136-175`) take `pendingAdmin`'s values.
- Literal cells take `pendingAdmin`'s values:
  - `USER_KEYED_READS.access_changes.own`: denied;
  - `user_roles.own`: allowed;
  - `JOB_STOPS.own`: denied for both writes;
  - `SELF_GRANTS`: denied for both.
- Extend the `OwnRowOutcome` doc (`:109-115`).
- A new cell table, `ROLE_DEACTIVATIONS: Record<"deactivate" | "reactivate", Record<Principal, Outcome>>`, set to `ADMIN_ONLY`. It covers a write of another user's `deactivated_at`, read back. This pins who may deactivate. Being an admin's UPDATE of `user_roles`, it is already green once the column exists; the red comes from the `deactivatedAdmin` cells.

**File**: `src/test/role-matrix-expectations.test.ts`

**Intent**: Pin the new principal's posture structurally.

**Contract**: Add an invariant that `deactivatedAdmin` equals `pendingAdmin` on every cell, beside the `pendingAdmin ≡ noRole` check (`:166-176`). Add `ROLE_DEACTIVATIONS` to `writeRows` (`:53-58`). Keep the no-row list (`:132-138`) unchanged: `deactivatedAdmin` holds a row.

**File**: `src/test/role-matrix.integration.test.ts`

**Intent**: Run the new principal and the new cells live.

**Contract**:
- Registries: `HELD_ROLES.deactivatedAdmin = "admin"` (`:123-129`), `ANSWERED_ROLES.deactivatedAdmin = null` (`:135`), and a `DEACTIVATED_PRINCIPALS` set beside `PENDING_PRINCIPALS` (`:138`).
- Wiring: the `principals` literal (`:224-231`), and `signInEveryPrincipal` passing `deactivated` (`:576-590`).
- A `ROLE_DEACTIVATIONS` probe, modelled on `ROLE_WRITE_PROBES` / `freshRoleTarget` (`:1110-1145`). It deactivates, or reactivates a pre-deactivated, fresh target and reads `deactivated_at` back as the service role.

#### 5. Guard and record suites (red-first cases)

**File**: `src/test/last-admin-guard.integration.test.ts`

**Intent**: Pin FR-408's "or deactivate" and "active" admin semantics.

**Contract**: A new case beside the pending-admin case (`:119-167`), with the same setup inside `inRolledBackTransaction`, one outcomes object and `toEqual`. Its outcomes:
- deactivating the last active admin is refused (`PT409`), whether as that admin's own session or as the service role;
- with another admin deactivated, demoting or removing the only active admin is refused;
- a deactivated admin may be demoted or removed;
- deactivating an admin while another active admin exists passes;
- once reactivated, the other admin counts again, and the demotion passes.

**File**: `src/test/access-changes.integration.test.ts`

**Intent**: Pin the two new kinds and the combined-write rule.

**Contract**: New cases using `recordsNaming` / `byAdmin` / `operatorGrant` (`:116-158`). Place them above the file's last case, which demotes the shared admin (`:105`, "Last: the admin is no longer one afterwards").

Red before the fence (new behaviour):
- an admin's deactivation records `deactivated` (actor the admin, `old_role = new_role` the held role);
- reactivation records `reactivated`;
- a service-role UPDATE of both role and flag records `role_changed` (old → new) then `deactivated` (new → new), in id order.

Green before and after (preserved behaviour, pinned so the re-created recorder keeps it):
- a role change on a deactivated row records only `role_changed`;
- moving the timestamp to another value records nothing.

**File**: `src/_pages/users/api/change-user-role.integration.test.ts`

**Intent**: Pin that a role change never reactivates.

**Contract**: A case where `changeUserRole` on a deactivated target leaves `deactivated_at` set and the role changed. This one is green before and after; it pins the upsert's column set.

#### 6. The fence migration

**File**: `supabase/migrations/<ts>_deactivation_fence.sql`

**Intent**: Make the claims hold: the fence, the guard, the record and the two kinds.

**Contract**:
- `alter type public.access_change_kind add value if not exists 'deactivated'`, and the same for `'reactivated'`.
- Re-create `private.current_app_role()` from its live body, adding `and r.deactivated_at is null`. It stays SECURITY DEFINER, `search_path = ''`, STABLE.
- Re-create `private.guard_last_admin()` and `private.record_role_change()` from their live bodies, with the semantics under Critical Implementation Details. Both stay INVOKER, `search_path = ''`, with EXECUTE revoked from the API roles, restated so the file stands alone.
- Update the three function comments (S-408).
- Header: why the column is on `user_roles` (the admin's existing writer and read posture, research §3). Also: why not reuse `must_change_password`, and which live bodies each function came from.
- Post-conditions, each message prefixed `S-408:`:
  - exactly one DEFINER function across public/private;
  - `current_app_role` has `search_path=""` and an owner with `rolbypassrls`;
  - both trigger functions are INVOKER with an empty `search_path` and no API EXECUTE;
  - both enum labels are present in `pg_enum`, by text;
  - no existing row has `deactivated_at` set.

#### 7. Generated types (second pass) and repo rules

**File**: `src/shared/api/database.types.ts`

**Intent**: Carry the two new `access_change_kind` values.

**Contract**: `pnpm db:types`; the diff adds the two enum labels only.

**File**: `CLAUDE.md`

**Intent**: Keep the database rules true. The S-408 note at `:87` describes a future that is now past.

**Contract**:
- § Database & auth gains an S-408 sub-bullet under Roles: a deactivated user's `user_roles.deactivated_at` makes `current_app_role()` read null; `guard_last_admin()` counts only admins who are neither pending nor deactivated; the role is kept; role writes never reactivate, except `assign-role.mjs`. Cite the fence migration.
- Replace § Edge Functions' "S-408 touches the same functions" bullet. The new text says the three functions now carry both the pending and the deactivation conditions, and the next slice to touch them (S-411) re-creates them from the S-408 migration.

### Success Criteria:

#### Automated Verification:

- [ ] Column migration applies cleanly from scratch: `pnpm exec supabase db reset`
- [ ] Red before the fence: the role-matrix lane fails only on `deactivatedAdmin` cells, with no setup errors. The new guard case and the three new-behaviour access-record cases (deactivated, reactivated, combined write) fail on their assertions, and the two preserved-behaviour cases pass (`pnpm test:integration src/test/role-matrix.integration.test.ts src/test/last-admin-guard.integration.test.ts src/test/access-changes.integration.test.ts`). Record the red counts in this plan's Progress note. The matrix count is lower than every cell that differs from `admin`: before the fence, `deactivatedAdmin`'s "drop own role" cell really deletes its row, so its later RPC cells pass as noRole.
- [ ] Fence migration applies cleanly from scratch, and its post-conditions pass: `pnpm exec supabase db reset`
- [ ] Green after the fence: the same three suites plus `src/_pages/users/api/change-user-role.integration.test.ts` pass
- [ ] Whole integration lane passes: `pnpm test:integration`
- [ ] Unit suite passes, including `role-matrix-expectations.test.ts`: `pnpm test`
- [ ] Types regenerated with a reviewed diff, and type check passes: `pnpm db:types && pnpm check`
- [ ] Lint and FSD structure pass: `pnpm lint && pnpm steiger`

#### Manual Verification:

- [ ] Grant posture is unchanged: `has_table_privilege('authenticated','public.user_roles','UPDATE')` is true and `anon` holds no DML on `user_roles` (lessons.md: check the live posture, not the text)
- [ ] With the local stack, deactivating an author by SQL as the service role makes their open browser session land on the notice at the next navigation, and clearing it restores access with no new sign-in

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Users page

### Overview

Show the state, and give the admin the two actions. After this phase an admin can deactivate and reactivate from `/users`, and the notice reads true for a deactivated person.

### Changes Required:

#### 1. Loader and model

**File**: `src/_pages/users/api/loader.ts`, `src/_pages/users/model/user-rows.ts`, `src/_pages/users/model/status-labels.ts`

**Intent**: Derive the new status and the two row flags from data the admin can already read.

**Contract**:
- The loader's `user_roles` select gains `deactivated_at`, and `UserDirectoryInput.roles` picks it.
- `UserStatus` gains `deactivated`. `statusOf` checks it after the invitation and pending checks and before the role check: a held role with `deactivated_at` set is `deactivated`. The row still carries `role`.
- `UserRow` gains `canDeactivate` (status `active`) and `canReactivate` (status `deactivated`), documented like the existing `can*` flags.
- `STATUS_LABELS.deactivated = "Deactivated"`. The `Record` forces this.
- The table and the hook withhold Deactivate on the admin's own row (`currentUserId` lives at the island, as `needsConfirmation`'s `targetIsSelf` does), so `buildUserRows` keeps its signature.

#### 2. Write path

**File**: `src/_pages/users/api/set-user-active.ts` (new), `src/_pages/users/model/schemas.ts`, `src/_pages/users/api/constants.ts`, `src/_pages/users/api/actions.ts`, `src/_pages/users/api/user-client.ts`, `src/actions/action-capabilities.test.ts`

**Intent**: One domain function and one action, modelled on `changeUserRole`. The write runs under the admin's session, RLS decides, and the trigger records it.

**Contract**:
- Input: `setUserActiveInput = z.object({ userId: z.uuid(), active: z.boolean() })`.
- `setUserActive(supabase, { userId, active })`:
  - Deactivate: `update({ deactivated_at: <now ISO> })` filtered by `user_id` and `deactivated_at is null`.
  - Reactivate: `update({ deactivated_at: null })` filtered by `user_id` and `deactivated_at is not null`.
  - Both `.select("user_id")`.
- Errors:
  - `PT409` → `CONFLICT` with `LAST_ADMIN_MESSAGE`, checked first, as in `refuseLastAdmin`;
  - `42501` → `FORBIDDEN` via `unwrapMany`;
  - zero rows → `NOT_FOUND` with a new `ACCESS_ALREADY_CHANGED_MESSAGE` ("That person's access has already changed."). Zero rows means already in that state, no role, or a stale page.
- New failure constants `DEACTIVATE_FAILURE` and `REACTIVATE_FAILURE`.
- Register `setUserActive` in `userActions` with `requires: "manage_users"`, plus a wrapper in `user-client.ts` (via `callAction`) and an entry in `action-capabilities.test.ts`.

#### 3. Hook and dialog

**File**: `src/_pages/users/model/use-activation-actions.ts` (new), `src/_pages/users/ui/ConfirmDeactivateDialog.tsx` (new)

**Intent**: Deactivate asks first, because it takes access away. Reactivate goes at once, like Re-send, since it only restores what the admin set. The outcome handling matches `use-invitation-actions.ts`.

**Contract**:
- The hook takes `currentUserId` and returns `{ reactivating, reactivate, deactivateTarget, isDeactivating, askDeactivate, cancelDeactivate, confirmDeactivate }`.
- In-flight refs prevent a double submit.
- Success: toast ("<email> deactivated" / "<email> reactivated"), then `refreshPage()`.
- Refusals: `NOT_FOUND` and `FORBIDDEN` reload; `CONFLICT` toasts without a reload. A rejected request toasts `ACCOUNT_UNREACHABLE_MESSAGE`.
- `askDeactivate` ignores the admin's own row and any row without `canDeactivate`.
- The dialog is modelled on `ConfirmRevokeDialog.tsx`. Title: "Deactivate <email>?". Body: they lose access to every plan from their next page load, and their role (<role label>) is kept, so reactivating restores it. Destructive action button: "Deactivate".

#### 4. Table and page wiring

**File**: `src/_pages/users/ui/UserTable.tsx`, `src/_pages/users/ui/UsersPage.tsx`

**Intent**: Put the two actions in the Status cell, beside the existing row actions.

**Contract**:
- `UserTable` gains `onDeactivate`, `reactivating: ReadonlySet<string>` and `onReactivate` props.
- A link button labelled `Deactivate <primary>` shows when `canDeactivate` and the row is not the admin's own. `Reactivate <primary>` shows when `canReactivate`, disabled while in flight.
- The role picker stays live on every row.
- `UsersPage` wires the hook and mounts `ConfirmDeactivateDialog`.
- Update both components' doc comments.

#### 5. Notice copy and access docs

**File**: `src/_pages/dashboard/ui/DashboardPage.astro`, `src/shared/config/access-state.ts`, `src/shared/config/resolve-access.ts`

**Intent**: Make the notice true for a person who had access, with no new access state.

**Contract**:
- The heading stays "No access yet — ask your admin". `no-access.no-role.spec.ts` asserts it, and it is the PRD's wording.
- The paragraph is reworded neutrally, along the lines of "Your account has no access to any plans right now. You can still manage your account.", keeping the `/account` link.
- The comment above `noAccess` names S-408.
- The `none` doc comments in `access-state.ts` and `resolveAccess` add "or deactivated (S-408)".

#### 6. Unit tests and fixtures

**File**: `src/_pages/users/model/user-rows.test.ts`, `src/_pages/users/ui/__fixtures__/user-rows.ts`, `src/_pages/users/ui/UserTable.test.tsx`, `src/_pages/users/ui/UsersPage.test.tsx`, `src/_pages/users/api/set-user-active.test.ts` (new)

**Intent**: Pin the precedence, the flags, the buttons and the error mapping.

**Contract**:
- `user-rows`: a deactivated role row reads `deactivated`, keeps its role, and flags `canReactivate`. An `active` row flags `canDeactivate`. A pending row that also carries `deactivated_at` stays pending, because pending wins. A row with no role is `no_access` with neither flag.
- Fixtures: every literal gains both flags.
- `UserTable`: Deactivate on an active other row, absent on your own row and on pending, no-access and deactivated rows. Reactivate only on deactivated rows, disabled while in `reactivating`. The picker is enabled on a deactivated row.
- `UsersPage`: Deactivate opens the dialog, and confirming calls the action.
- `set-user-active`: stubbed `PT409` → `CONFLICT`, `42501` → `FORBIDDEN`, zero rows → `NOT_FOUND`, and each direction filters on the current state. This follows `change-user-role.test.ts`.

#### 7. Domain integration test

**File**: `src/_pages/users/api/set-user-active.integration.test.ts` (new)

**Intent**: Prove the slice's core claim on a session that already exists. This is the gap the matrix leaves, since the matrix sets the flag before sign-in.

**Contract**: Use `createSignedInUser` for an admin and an author, both signed in first.
- The author reads plans.
- The admin's `setUserActive({ active: false })` succeeds.
- The author's same client, with the same unexpired token, now reads zero plans, `own_app_role` null, and a write refused.
- A second deactivation answers `NOT_FOUND`.
- `setUserActive({ active: true })` restores the author's reads on the same client.
- The record holds `deactivated` then `reactivated`, by the admin.

#### 8. README

**File**: `README.md`

**Intent**: Document the new admin capability where the Users page is described.

**Contract**: Two edits:
- the `/users` row of § Auth routes gains "deactivate or reactivate a person";
- the roles paragraph below it gains one sentence: a deactivated person keeps their role and account, loses data access on their next request, and sees the no-access notice until reactivated.

### Success Criteria:

#### Automated Verification:

- [ ] Unit suite passes: `pnpm test`
- [ ] Domain integration test passes: `pnpm test:integration src/_pages/users/api/set-user-active.integration.test.ts`
- [ ] Type check passes: `pnpm check`
- [ ] Lint and FSD structure pass: `pnpm lint && pnpm steiger`
- [ ] Production build stays clean: `pnpm build`

#### Manual Verification:

- [ ] On `pnpm build && pnpm preview`, as the local admin: Deactivate on another user's active row asks, then the row reads Deactivated with its role and a Reactivate button; Reactivate returns it to Active
- [ ] Your own row offers no Deactivate; pending and no-access rows offer none either
- [ ] Changing a deactivated row's role keeps it Deactivated; "No access" on it removes the row's role and the status reads No access
- [ ] The deactivated person, already signed in, lands on the reworded notice on their next navigation, and their account page stays open
- [ ] "Last change" shows the admin as the actor for both actions

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Break-glass and end-to-end proof

### Overview

Close the operator trap, and prove the outcome sentence in a browser. After this phase the script reactivates, and a spec shows a live session losing and regaining access.

### Changes Required:

#### 1. The role script reactivates

**File**: `scripts/assign-role.mjs`

**Intent**: The script's purpose is recovery, "give this person this access now". It must never report success while the person stays locked out.

**Contract**:
- A role write upserts `{ user_id, role, deactivated_at: null }`. `none` still deletes.
- `roleOf` reads `role, deactivated_at`, so the before state can read `<role> (deactivated)`.
- The read-back requires the role and `deactivated_at` null.
- The report appends ` (reactivated)` when the person was deactivated before.
- The last-admin and machine-account refusals are unchanged.
- The header comment states that, unlike the Users page, a role write here also reactivates, and that it is recorded as the Operator (`reactivated`, plus `role_changed` when the role differs).

**File**: `scripts/provision-e2e-author.mjs`

**Intent**: Keep the e2e accounts' reset true. The local `/users` page lists e2e-author, e2e-viewer and e2e-admin. One deactivated during manual testing would stay deactivated on every later run, and e2e/CLAUDE.md's "the provisioner resets it" would no longer hold.

**Contract**: `setRole`'s upsert sends `{ user_id, role, deactivated_at: null }`. The delete path for the no-role account is unchanged.

**File**: `docs/runbooks/author-provisioning.md`

**Intent**: Keep the recovery runbook true.

**Contract**:
- § b-bis gains a bullet: a role write reactivates a deactivated person, and the output says so.
- The opening paragraph's "gives, changes or removes anyone's role" gains "or deactivates and reactivates them (S-408)".

#### 2. The two-context E2E spec

**File**: `e2e/specs/deactivate.admin.spec.ts` (new)

**Intent**: Demonstrate S-408's outcome end to end, on real workerd and cookie SSR: an admin deactivates, the person's live session lands on the notice at its next request, reactivation restores access, and no new sign-in is needed.

**Contract**: Runs in `chromium-admin`. It creates a throwaway author through `adminClient()`: a confirmed user with a known password plus a `user_roles` row. It deletes the throwaway in a `finally`. In a `withFreshContext` person context, signed in with `signInThroughUi(…, "**/dashboard")`:
1. The person opens `/plans`.
2. The admin's `page` opens `/users` and clicks `Deactivate <email>`. It confirms in the alertdialog. The row reads Deactivated, and the picker still reads Author.
3. The person's `/plans` lands on `/dashboard` with the "No access yet — ask your admin" heading. `/account` opens.
4. The admin clicks `Reactivate <email>`, and the row reads Active.
5. The person's `/plans` opens again, with "New plan" present, because they are an author.

In the same test, before step 2's click, the admin's own row shows no `Deactivate` button while the throwaway's row shows one. An absence is checked beside its presence, so a drifted locator fails rather than passing on nothing. No toast is asserted (`users.admin.spec.ts`'s rule), and the admin's own role, password and session are never touched.

**File**: `e2e/CLAUDE.md`, `e2e/support/sign-in.ts`

**Intent**: Sanction the second UI sign-in.

**Contract**:
- The "Authenticate via storageState" rule (`:58-66`) names `deactivate.admin.spec.ts` (S-408) as a second sanctioned exception. It signs in, in a fresh context, as a service-role throwaway it creates, because a live session meeting the deactivation is the behaviour under test. The throwaway-user rule (`:97-104`) lists the spec too.
- `signInThroughUi`'s doc comment (`sign-in.ts:3-8`) says the same, since it names "one sanctioned exception".

### Success Criteria:

#### Automated Verification:

- [ ] The new spec passes against a fresh preview: `pnpm build && pnpm test:e2e e2e/specs/deactivate.admin.spec.ts`
- [ ] The no-role and Users specs still pass with the reworded notice: `pnpm test:e2e e2e/specs/no-access.no-role.spec.ts e2e/specs/users.admin.spec.ts e2e/specs/create-account.admin.spec.ts`
- [ ] Full local CI gate passes: `/verify`

#### Manual Verification:

- [ ] Locally: deactivate a user on `/users`, then run `node scripts/assign-role.mjs <email> author`. It prints `… → author (reactivated)`, the person regains access, and "Last change" reads Operator
- [ ] Locally: `node scripts/assign-role.mjs <email> none` on a deactivated person removes the row and is recorded as `role_removed`
- [ ] After merge (migrations auto-apply), on hosted: deactivate and reactivate a non-admin test account from `/users`, and confirm both "Last change" entries. The deploy job's migration step was green

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before closing the slice.

---

## Testing Strategy

### Unit Tests:

- `user-rows.test.ts`: status precedence (invitation > pending > deactivated > role > no access), and both flags.
- `set-user-active.test.ts`: error mapping, and the state filter in each direction.
- `UserTable.test.tsx` / `UsersPage.test.tsx`: which rows show which button, the self-row exclusion, the live picker on a deactivated row, the dialog flow.
- `role-matrix-expectations.test.ts`: `deactivatedAdmin ≡ pendingAdmin` on every cell; `ROLE_DEACTIVATIONS` is complete.
- `action-capabilities.test.ts`: `setUserActive` requires `manage_users`.

### Integration Tests:

- **Role matrix** (red-first): `deactivatedAdmin` in every cell; `ROLE_DEACTIVATIONS` admin-only.
- **Last-admin guard**: the last active admin cannot be deactivated; a deactivated admin doesn't count; a reactivated one counts again; a deactivated admin can be demoted or removed.
- **Access record**: `deactivated` / `reactivated` with the actor; the combined write gives two rows; a role change on a deactivated row gives `role_changed` only; a timestamp move gives nothing.
- **`change-user-role`**: a role change keeps the flag.
- **`set-user-active`**: an already signed-in session loses access and regains it, on the same token.

### Manual Testing Steps:

1. Sign in as the local admin and as an author in two browsers. Deactivate the author on `/users`. In the author's browser, navigate: you land on the notice, and `/account` works.
2. Drag a card on a board in the author's browser before navigating. The write is refused, and the card snaps back (the accepted S-406 parity).
3. Reactivate, then navigate in the author's browser: access is back with no new sign-in.
4. With two admins, deactivate the other one. Then try to demote yourself: refused, "The school must keep at least one admin."
5. Run the break-glass script on a deactivated person: reactivated, recorded as Operator.

## Performance Considerations

`current_app_role()` gains one predicate on a primary-key lookup, still evaluated once per statement through `(select …)`. The guard's count gains one predicate over a table of tens of rows. Neither needs an index. The middleware does no extra read: a deactivated person resolves to `none` through the reads it already makes. Nothing touches the <200 ms placement-validation path.

## Migration Notes

- Both migrations are additive: one nullable column, two enum values and three `create or replace` bodies. Nothing is dropped. They apply in order on merge through CI's `deploy` job. The column-only file is inert without the second, and both ship in the same merge.
- Rollback is roll-forward. To disable the feature, a new migration re-creates the three functions without the deactivation conditions. The column can stay.
- Existing rows all start active (null). A post-condition asserts it.
- **For S-411:** these three bodies are now the live definitions to re-create from. S-411 can set `deactivated_at` through the admin's session alongside a ban, to close the ban's up-to-one-hour window (research §7).

## References

- Research: `context/changes/deactivate-reactivate/research.md`
- Roadmap: `context/foundation/roadmap.md` § S-408; PRD FR-407, FR-408, FR-410 and the capability matrix (`context/foundation/prd.md:210-213, 354-367`)
- Live function bodies: `supabase/migrations/20261109143000_must_change_password.sql:69-85, 128-179`; `supabase/migrations/20261105080343_role_management.sql:242-280`
- Post-condition pattern: `supabase/migrations/20261109143000_must_change_password.sql:185-260`, `supabase/migrations/20261111074135_invitations.sql:149-211`
- Write-path template: `src/_pages/users/api/change-user-role.ts`; hook/dialog templates: `src/_pages/users/model/use-invitation-actions.ts`, `src/_pages/users/ui/ConfirmRevokeDialog.tsx`
- Red-first precedent: `context/archive/2026-11-08-create-account-fallback/plan.md:174-225, 489`
- E2E template: `e2e/specs/create-account.admin.spec.ts`, `e2e/specs/users.admin.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The fence (database, red-first)

#### Automated

- [x] 1.1 Column migration applies cleanly from scratch — f2ff26c6
- [x] 1.2 Red before the fence: matrix fails only on `deactivatedAdmin` cells; new guard case and new-behaviour record cases fail on assertions — f2ff26c6
- [x] 1.3 Fence migration applies cleanly from scratch, post-conditions pass — f2ff26c6
- [x] 1.4 Green after the fence: matrix, guard, record and change-user-role suites pass — f2ff26c6
- [x] 1.5 Whole integration lane passes — f2ff26c6
- [x] 1.6 Unit suite passes, including role-matrix-expectations.test.ts — f2ff26c6
- [x] 1.7 Types regenerated with a reviewed diff, type check passes — f2ff26c6
- [x] 1.8 Lint and FSD structure pass — f2ff26c6

> Red run (column only, 2026-11-12): 54 failed / 515 passed across the four suites, with no setup errors. Matrix: 50 cells, every one `deactivatedAdmin`. Its "drop own role" really deleted its row, so its later RPC cells passed as noRole. Guard: the S-408 case, on 5 outcomes (`lastActiveDeactivated` ×3 paths, `deactivatedAdminIsNotCounted`, `deactivatedAdminRemovalNotCounted`). Record: the 3 new-behaviour cases. The 2 preserved-behaviour record cases and the change-user-role case passed. After the fence: 569/569. Whole lane: 882 passed; 5 skipped tests in the 2 solver suites, which need `SOLVER_URL`.

#### Manual

- [x] 1.9 Grant posture unchanged (`has_table_privilege` on `user_roles`) — f2ff26c6
- [x] 1.10 Service-role SQL deactivation sends a live session to the notice; clearing restores it — f2ff26c6

### Phase 2: Users page

#### Automated

- [x] 2.1 Unit suite passes — dc7fa2e3
- [x] 2.2 Domain integration test passes — dc7fa2e3
- [x] 2.3 Type check passes — dc7fa2e3
- [x] 2.4 Lint and FSD structure pass — dc7fa2e3
- [x] 2.5 Production build stays clean — dc7fa2e3

#### Manual

- [x] 2.6 Deactivate asks, row reads Deactivated with role and Reactivate; Reactivate returns it to Active — dc7fa2e3
- [x] 2.7 No Deactivate on your own, pending or no-access rows — dc7fa2e3
- [x] 2.8 Role change keeps a row Deactivated; No access removes it — dc7fa2e3
- [x] 2.9 A signed-in deactivated person lands on the reworded notice; account page open — dc7fa2e3
- [x] 2.10 Last change shows the admin for both actions — dc7fa2e3

### Phase 3: Break-glass and end-to-end proof

#### Automated

- [x] 3.1 New deactivate spec passes against a fresh preview
- [x] 3.2 No-role, Users and create-account specs still pass
- [x] 3.3 Full local CI gate passes (`/verify`)

#### Manual

- [x] 3.4 Script reactivates a deactivated person and is recorded as Operator
- [x] 3.5 Script `none` on a deactivated person records `role_removed`
- [ ] 3.6 Hosted: deactivate and reactivate a non-admin test account after merge
