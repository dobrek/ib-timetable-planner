---
date: 2026-11-12T10:56:28+01:00
researcher: Claude (Opus 5.5)
git_commit: 7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9
branch: deactivate-reactivate
repository: dobrek/ib-timetable-planner
topic: "S-408 deactivate-reactivate: is it feasible, and what are the options for building it?"
tags: [research, codebase, s-408, deactivate-reactivate, user-roles, rls, current-app-role, guard-last-admin, access-changes, users-page, middleware]
status: complete
last_updated: 2026-11-12
last_updated_by: Claude (Opus 5.5)
---

# Research: S-408 deactivate-reactivate: feasibility and options

**Date**: 2026-11-12T10:56:28+01:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: [`7e3aae90`](https://github.com/dobrek/ib-timetable-planner/tree/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9)
**Branch**: deactivate-reactivate
**Repository**: dobrek/ib-timetable-planner

## Research Question

How feasible is S-408, and what options are there for building it? The roadmap outcome: "An admin can deactivate and reactivate a user; a deactivated person's data access ends on their next action, and they land on the 'no access yet' notice." PRD FR-407 (nice-to-have) asks for "data access ending immediately". FR-408 (must-have) adds "Admin cannot demote or deactivate the last active admin."

## Summary

**Feasible, with no blocker and no new platform risk.** The fence S-408 needs already exists. Every human-facing policy, RPC and middleware check asks `private.current_app_role()`, live, on every statement. So any condition added to that one function ends data access on the person's next request, whatever their JWT says. S-409 proved the pattern with `must_change_password`. S-408 needs no secret key, no Edge Function, no Deno, no new public route, no new SECURITY DEFINER function and no hosted manual step. The admin writes the flag through their own session, under RLS, as the Users page already does for roles.

**Recommended: Option A, a `deactivated_at` column on `public.user_roles`.** The admin already holds UPDATE on that table. Role upserts never touch the column, so the role survives the deactivation. Reactivating restores it. The person can read their own row, and only admins see anyone else's. The costs are known and covered by tests:

- re-create three SQL functions from their live bodies: `current_app_role()`, `guard_last_admin()` and `record_role_change()`;
- add two `access_change_kind` values;
- add a role-matrix principal;
- add a Users-page action.

The size is small to medium, well under S-406 or S-409.

**The cheap alternative is Option D: no new state.** "Deactivate" would be S-406's existing "No access", which deletes the role row. FR-408's guard and the immediate cut-off already hold for it. Its cost is that the role is lost, and "Deactivated" can't be told apart from "never given access". The PRD weighed "clearing a role already does this" and kept FR-407 anyway (`prd.md:210-212`). The real choice in front of the plan is A or D.

**Platform levers don't fit S-408 itself.** These are a ban, revoking sessions and deleting the account. Each sends the person to the sign-in page, not the notice. None ends PostgREST access before the token expires, and all need the secret key. A ban belongs to S-411, which can pair it with S-408's flag to close its up-to-one-hour window. That pairing is the value the roadmap claims for S-408.

## Detailed Findings

### 1. What S-408 is bound by

- **Outcome and risk:** `roadmap.md:227-237`. "A deactivated admin must stop counting as 'active' for the last-admin rule S-406 introduces."
- **Who has what access:** the capability matrix puts "no role / deactivated" in one column, `prd.md:354-367`. A deactivated person "stays signed in on a 'no access yet — ask your admin' notice", keeps their own account (FR-410) and can sign out. This overrides the October research's "a deactivated user should be signed out" (`context/changes/user-managment-research/research.md:538`).
- **Deferrals that name S-408 as owner:**
  - [`20261028140939_user_roles.sql:14`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/supabase/migrations/20261028140939_user_roles.sql#L14): "No `active` flag — S-408, which changes `private.current_app_role()` alone."
  - [`20261105080343_role_management.sql:44-46`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/supabase/migrations/20261105080343_role_management.sql#L44-L46): "S-408 must change the guard to count only active admins."
  - `:62`: "S-408 … add[s] theirs with `alter type … add value`."
  - S-406 research §5.6 (`context/archive/2026-11-03-users-page-roles/research.md:209`).
- **The second slice re-creates from the live body:** S-410 deliberately left both functions alone "to keep clear of S-408" ([`20261111074135_invitations.sql:28`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/supabase/migrations/20261111074135_invitations.sql#L28)). CLAUDE.md § Edge Functions says "Whichever slice lands second re-creates them from the live body." The live bodies are in [`20261109143000_must_change_password.sql:69-85`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/supabase/migrations/20261109143000_must_change_password.sql#L69-L85) (`current_app_role`) and [`:128-179`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/supabase/migrations/20261109143000_must_change_password.sql#L128-L179) (`guard_last_admin`). `record_role_change()` was never re-created, so its live body is [`20261105080343_role_management.sql:242-280`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/supabase/migrations/20261105080343_role_management.sql#L242-L280). Lesson: "Re-create SQL functions from the latest live definition" (`lessons.md:75-80`).

### 2. Why "data access ends on the next action" comes for free

- **Every path goes through one function.** Every plan-scoped policy calls `private.can_read()` or `private.can_edit()` (`20261028200630_fail_closed_policies.sql:58-101`, pinned by `CAPABILITY_POLICIES`). Every RPC is INVOKER. `can_manage_users()`, `can_stop_any_job()` and `own_app_role()` all wrap `current_app_role()`, which is STABLE and re-evaluated per statement. An unexpired JWT still gets the `authenticated` role, but RLS then returns nothing.
- **The middleware reads the role per request.** It reads it on every gated page and every `/_actions/` call, in parallel with `getUser()` ([`src/middleware.ts:85-95`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/src/middleware.ts#L85-L95)). A null role resolves to `none` ([`resolve-access.ts:22-28`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/src/shared/config/resolve-access.ts#L22-L28)), which `decideRoleGate` turns into the dashboard notice ([`role-gate.ts:25-31`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/src/shared/config/role-gate.ts#L25-L31), `middleware.ts:69-71`).
- **Actions refuse.** `defineDomainAction` → `requireCapability` returns FORBIDDEN with "You don't have permission to do that." The `admin-users` Edge Function's live `requireAdmin` ([`handler.ts:284`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/supabase/functions/admin-users/handler.ts#L284)) refuses a deactivated admin with no change.
- **Paths that don't consult the role, all acceptable:**
  - Own-row access, by FR-410's design: profiles, and the caller's own `user_roles`, `user_directory` and `profiles` rows.
  - `/api/solver/container`: role-exempt and allowlisted by email. It is campaign-only, and a role-less user has the same access today.
  - The solver's `solver_job_writer` policies: a deactivated person's running job keeps solving, and only an admin can stop it (S-407).
  - GoTrue sign-in and refresh, which is intended.
  - Storage and Realtime, which the app doesn't use.

### 3. The options

| | **A. `user_roles.deactivated_at`** | B. column on `user_directory` | C. new table | **D. no new state ("No access")** | E. platform ban / sessions / delete |
|---|---|---|---|---|---|
| Who writes it without the secret key | Admin, through the existing UPDATE policy and table grant | Nobody today: needs a column grant plus a policy, or Edge Function ops | Admin, through new policies | Admin, already shipped | Nobody: Auth Admin API, secret key |
| Data access ends on the next request | Yes | Yes | Yes | Yes | **No.** PostgREST honours the old token until `exp` (≤ 3600 s, `supabase/config.toml:163`) |
| Lands on the "no access yet" notice | Yes | Yes | Yes | Yes | **No.** `getUser()` fails, so the middleware sends them to `/auth/signin` (`middleware.ts:67`) |
| Role kept while deactivated | Yes | Yes | Yes | No (only in `access_changes.old_role`) | n/a |
| `current_app_role()` | Add `and r.deactivated_at is null` | Extend the `not exists` clause | Add a `not exists` on the table | Unchanged | Unchanged |
| `guard_last_admin()` | Re-create: early return and the count | Count, plus a **new trigger on `user_directory`** | Count, plus a new trigger | Fires as today (DELETE) | Not seen: a ban lives in `auth.users` |
| Access record | Re-create `record_role_change()`; 2 enum values | New recorder, or Edge Function records | New recorder | `role_removed` / `role_granted`, as today | Edge Function records |
| Role-matrix catalog / policies | No change | `USER_KEYED_POLICIES`, a column-grant check that `has_table_privilege` can't see | `GRANTS`, `USER_KEY_COLUMN`, reads, policies | None | None |
| Who can see who is deactivated | Admins and the person | **Every role holder** (directory read policy) | Depends on its policies | Can't be told apart from "never granted" | — |
| Main risk | Role writes never reactivate; the guard's early return must change | Third writer of an Auth mirror; visible to viewers | Most new surface; self-deactivation likely refused (inference, below); orphan row after a re-grant | Maybe not FR-407 as written; reactivation means picking a role again | Contradicts the outcome; S-411's tool |

**A. Recommended.** It needs no policy, grant or catalog change. The three functions to re-create are known and covered by tests. Details are in §4.

**B. Rejected.** `user_directory` is an Auth mirror with exactly two writers: the mirror trigger ([`20261111074135_invitations.sql:68-91`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/supabase/migrations/20261111074135_invitations.sql#L68-L91)) and the Edge Function under the secret key. `authenticated` holds SELECT only, and post-conditions assert that for its flag columns. The read policy also exposes every row to any role holder ([`20261105073614_user_directory.sql:74-76`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/supabase/migrations/20261105073614_user_directory.sql#L74-L76)), so viewers would see who is deactivated. S-409 accepted that exposure for one boolean whose writer was already the secret key (`archive/2026-11-08-create-account-fallback/research.md:154-166`). S-408 has no such reason.

**C. Rejected.** Its records would follow the upsert rule, an AFTER INSERT recorder. That recorder's `access_changes` insert would then see the new deactivation row, `can_manage_users()` would read null, and self-deactivation would fail with 42501. *This is an inference; it has not been probed.* C also needs the full user-keyed table kit: four policies, `USER_KEY_COLUMN`, a BEFORE + depth cascade exemption and a fixture row. All that for one timestamp.

**D. The cheap fallback.** S-406 shipped "No access" as a confirmed DELETE of the role row. It is "the only immediate way to cut access until S-408 ships" (`archive/2026-11-03-users-page-roles/plan-brief.md:38`). The existing guard and recorder cover it ([`change-user-role.ts:31-37`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/src/_pages/users/api/change-user-role.ts#L31-L37)).

- **A variant, D′:** a "Reactivate" button that re-grants the `old_role` of the person's latest `role_removed` record. It needs no migration, but it reads the audit trail as state, and every role removal becomes a "deactivation".
- **Against D:** the PRD considered "clearing a role already does this" and kept FR-407 (`prd.md:210-212`). S-406 treated "No access" and deactivation as different things.

**E. Not for S-408.** The platform agent's evidence:

- **No disabled state.** Supabase Auth has no "disabled" or "deactivated" concept. The only levers are `ban_duration` (`'none'` lifts a ban) and delete.
- **A ban leaves existing sessions alone.** "A temporary ban only blocks sign-in for its duration and does not revoke existing sessions" ([docs](https://supabase.com/docs/guides/auth/managing-user-data)).
- **There is no revoke-by-id call.** `auth.admin.signOut(jwt, scope)` takes the *user's* JWT ([GoTrueAdminApi.ts](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/GoTrueAdminApi.ts)), and there is no supported way to revoke another user's sessions by id.
- **Ban and delete send the person to sign-in.** With GoTrue ≥ 2.195, a banned user's `getUser()` returns 403 `user_banned`. A deleted session returns `session_not_found`. Either way the middleware sees no user and redirects to `/auth/signin`, where a banned user can't sign in. That contradicts the S-408 outcome.

### 4. Option A in detail (database)

The migration is additive: one nullable column, two enum values and three re-created functions. Nothing is dropped.

1. **The column.** `alter table public.user_roles add column deactivated_at timestamptz` (null means active). A timestamp gives the Users page "since when" for free. The table's shape is at [`20261028140939_user_roles.sql:49-54`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/supabase/migrations/20261028140939_user_roles.sql#L49-L54).
   - The existing policies already fit. UPDATE "Admins change roles" is `can_manage_users()`, and its WITH CHECK requires a directory row (`role_management.sql:122-128`). SELECT is the caller's own row or an admin's read (`:109-113`).
   - The authenticated UPDATE grant is table-level (`role_management.sql:135`).
2. **`current_app_role()`.** Re-create it from `must_change_password.sql:69-85` and add `and r.deactivated_at is null`.
   - It stays the one DEFINER function, with `search_path = ''` and an owner holding BYPASSRLS. Repeat the post-conditions that S-409 and S-410 each carry (`must_change_password.sql:195-218`).
3. **`guard_last_admin()` — the trap.** Re-create it from `must_change_password.sql:128-179`. Today's early return is `if old.role <> 'admin' or (tg_op = 'UPDATE' and new.role = 'admin')` (`:147`).
   - **Deactivating an admin keeps `role = 'admin'`,** so as written the guard waves the last admin's deactivation through.
   - The re-created guard must compare *active admin* (`role = 'admin' and deactivated_at is null`) on `old` and `new`.
   - Its count (`:159-170`) must add `and r.deactivated_at is null`, beside the pending condition.
   - Keep these unchanged: the 42501 role-move refusal, the BEFORE + depth cascade exemption, advisory lock `406001` and `PT409`.
   - A deactivated admin who is demoted or removed is not an active admin, so no guard is needed for that.
4. **`record_role_change()`.** Re-create it from `role_management.sql:242-280`. It skips an UPDATE that leaves the role as it was (`:257-259`), so a deactivation would go unrecorded.
   - Add `alter type public.access_change_kind add value if not exists 'deactivated'` and `'reactivated'`, the pattern at `must_change_password.sql:51-52`. The values are usable only after commit, so plpgsql bodies may name them but post-conditions may not.
   - Record `deactivated` or `reactivated` when `deactivated_at` flips, with `old_role = new_role = role`. The plan must decide what one UPDATE that changes both role and flag records.
   - The `access_changes` INSERT policy (`pg_trigger_depth() > 0`, actor = `auth.uid()`, `can_manage_users()`, `role_management.sql:223-229`) still holds. The recorder runs BEFORE UPDATE, so even a self-deactivation is judged while the admin is still active.
5. **What stays untouched:**
   - Every role upsert sends only `{user_id, role}`: the Users page ([`change-user-role.ts:21-28`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/src/_pages/users/api/change-user-role.ts#L21-L28)), the Edge Function's grant (`handler.ts:381-397`) and `scripts/assign-role.mjs:88-91`. So **a role change never reactivates anyone** (wanted), and **`assign-role.mjs` cannot reactivate** (a small break-glass gap, softened by the guard: an active admin always exists).
   - "No access" deletes the row, flag included. The stronger state wins, and the deletion is recorded as `role_removed`.
6. **Machine users are out of reach.** They never hold a role row: there is a backfill post-condition, the INSERT/UPDATE target check (`role_management.sql:14-16`) and `assign-role.mjs:82-84`. Option A cannot touch them.
7. **Do not reuse `must_change_password` as the deactivation fence.** `private.clear_must_change_password()` clears it on any password write (`must_change_password.sql:93-110`). A deactivated user changing their password on `/account`, which FR-410/FR-411 allow, would reactivate themselves.

### 5. App changes

**Access routing.** There are two ways to route a deactivated person:

- **Reuse `none`, with zero middleware change.** `current_app_role()` reads null, `must_change_password` is false, so the person resolves to `none`, sees the notice, gets FORBIDDEN on actions and has no Plans entry. This meets the outcome to the letter ("they land on the 'no access yet' notice").
  - The copy is slightly off for someone who *had* access. It reads "No access yet — ask your admin … Your account has not been given access to any plans" (`DashboardPage.astro:33-49`).
- **A `deactivated` state, for tailored copy.** It would touch:
  - the `AccessState` union (`access-state.ts:11-15`);
  - `OwnAccessRead` and `resolveAccess`;
  - a read of the caller's own `user_roles.deactivated_at` when the role is null (the own-row SELECT policy allows it);
  - the `env.d.ts` doc comment.

  **The trap:** [`DashboardPage.astro:9`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/src/_pages/dashboard/ui/DashboardPage.astro#L9) shows the notice only for `status === "none"`. A new status would render an empty tile grid with no notice.
- **Precedence with a pending password.** `resolveAccess` sends a person who is both pending and deactivated to `/account` with the welcome banner. Choosing a password lifts the fence, and they then hit the notice. That is harmless, but simpler if the Users page never offers Deactivate on a pending row.

**Users page** (`src/_pages/users/`):

- **Loader.** `api/loader.ts:21-45` selects `user_roles(user_id, role)` and gains `deactivated_at`.
- **Status.** Add `deactivated` to `UserStatus` ([`user-rows.ts:38-44`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/src/_pages/users/model/user-rows.ts#L38-L44)). In `statusOf` ([`:110-117`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/src/_pages/users/model/user-rows.ts#L110-L117)) it goes after the invitation and pending checks and before the role check. The role stays shown, kept for reactivation.
  - `STATUS_LABELS` is a `Record<UserStatus, …>`, so the compiler forces the label.
  - Add `canDeactivate` (status `active`, not the admin's own row) and `canReactivate` (status `deactivated`) beside the existing `can*` flags (`:46-60`).
- **Write path.** A new `api/set-user-active.ts` (name to be decided), modelled on `change-user-role.ts`: an UPDATE of `deactivated_at` under the admin's session, with `PT409` mapped to CONFLICT and `LAST_ADMIN_MESSAGE`. It gets a schema in `model/schemas.ts`, an entry in `api/actions.ts` (`requires: "manage_users"`), a wrapper in `api/user-client.ts`, and a constant.
- **UI.**
  - A link button in the Status cell (`UserTable.tsx:69-114`).
  - A hook modelled on `use-invitation-actions.ts` (ask, confirm, `report`, `refreshPage()`; FORBIDDEN or NOT_FOUND reloads, CONFLICT toasts).
  - A dialog modelled on `ConfirmRevokeDialog.tsx`, wired in `UsersPage.tsx`.
  - `LastChange.tsx` already renders any record kind as "Changed by".

**Mid-session experience: the same as S-406's role removal today.**

- The next action returns FORBIDDEN. On the board, optimistic writes roll back and a generic error shows (`use-reconcile-executor.ts:139-143`).
- Polls fail silently and keep the old snapshot (`polling-store.ts:107-108`).
- The next navigation lands on the notice. Nothing keeps writing, because `checkPlan` needs `edit`.
- Redirecting to the notice on FORBIDDEN would be optional polish, shared with S-406, and is not needed for correctness.

### 6. Tests a plan must budget

- **Role matrix, red first** (CLAUDE.md § Database & auth). Add a `deactivated` principal, plus `deactivatedAdmin` mirroring `pendingAdmin`, to `Principal` ([`role-matrix-expectations.ts:61`](https://github.com/dobrek/ib-timetable-planner/blob/7e3aae90cddea4a926f3f21823cc71c2d9b3a6a9/src/test/role-matrix-expectations.ts#L61)). The `Record<Principal, …>` cells then force a value everywhere: the shared cells, `USER_KEYED_READS`, `JOB_STOPS`, `SELF_GRANTS` and `PRINCIPAL_NOTES`.
  - Extend `HELD_ROLES`, `ANSWERED_ROLES` and `PENDING_PRINCIPALS` and `signInEveryPrincipal` in `role-matrix.integration.test.ts`.
  - Generalise the "pendingAdmin ≡ noRole" check (`role-matrix-expectations.test.ts:166-176`).
  - **Wrinkle:** a factory option that writes `deactivated_at` errors before the column exists, and an error is not a red cell. The plan needs a red-first cell that fails cleanly on the old schema, for example an admin-only cell "deactivate another user" whose expectation the old schema can't meet.
- **Factory.** Add a `deactivated` option beside `mustChangePassword` (`create-signed-in-user.ts:40-52`, `markPending` at `:69`).
- **Integration:**
  - `last-admin-guard.integration.test.ts`: deactivating the last active admin is refused, and a deactivated admin doesn't count when another admin is demoted.
  - `access-changes.integration.test.ts`: the new kinds, with the actor.
  - `change-user-role.integration.test.ts`: a role change keeps the flag.
  - The role matrix.
- **Unit:** `user-rows.test.ts`, `UserTable.test.tsx`, `UsersPage.test.tsx`, `__fixtures__/user-rows.ts` (every literal gains the new flags), the new action's test and `action-capabilities.test.ts`. If a new access state is added: `resolve-access.test.ts`, `role-gate.test.ts`, `access-state.test.ts` and `load-own-access.test.ts`.
- **E2E.** "Next action" needs a second context in which a throwaway user signs in through the UI. `e2e/CLAUDE.md:58-66` allows that only for `create-account.admin.spec.ts` (S-409), so the plan must extend that recorded exception. Model the spec on `create-account.admin.spec.ts:38-63`.

### 7. Platform facts and how S-408 relates to S-411

- **Local auth is no longer v2.189.0.** `pnpm-lock.yaml:370-371` pins `supabase@2.117.0`, and the running container is `public.ecr.aws/supabase/gotrue:v2.196.0`. The October probe's v2.189.0 came from a since-moved link snapshot in the main checkout.
- **What the newer version changes.** supabase/auth 2.195.0 (2026-07-30) "reject AT from banned users (#2642)" covers **GoTrue endpoints only** (`/user`, `/logout`, factors). PostgREST is untouched, so a pre-ban token still reads data until `exp`.
  - This narrows S-411's Unknown (`roadmap.md:274`) locally. Hosted's version remains unverified.
- **How S-411 can use S-408.** S-411 can set S-408's `deactivated_at` through the admin's session (its Edge Function's `ctx.supabase`) in the same operation as the ban. That ends PostgREST access at once, and the ban ends the session. This is the "closes that gap" value the roadmap gives S-408. It works only if S-408 lands first.
- **Flag-only leaves the refresh token alive.** Refresh tokens "never expire" ([docs](https://supabase.com/docs/guides/auth/sessions)), and no session timebox is set locally (`config.toml:279-283`). That is harmless, because RLS fails closed, and it is why reactivation is instant. Permanent removal is S-411's job.

## Code References

- `supabase/migrations/20261109143000_must_change_password.sql:69-85`: live `private.current_app_role()`, the fence S-408 extends.
- `supabase/migrations/20261109143000_must_change_password.sql:128-179`: live `private.guard_last_admin()`. Its early return at `:147` lets an admin's deactivation through unless re-created.
- `supabase/migrations/20261105080343_role_management.sql:242-280`: live `private.record_role_change()`. It skips an unchanged role at `:257-259`.
- `supabase/migrations/20261105080343_role_management.sql:109-135`: `user_roles` policies and the table-level grant.
- `supabase/migrations/20261105080343_role_management.sql:190-238`: `access_changes`, its enum and the INSERT policy.
- `supabase/migrations/20261028140939_user_roles.sql:14,49-54`: the S-408 deferral and the table shape.
- `supabase/migrations/20261105073614_user_directory.sql:74-76`: the directory read policy (why not B).
- `src/middleware.ts:67-95`: `getUser()` plus the per-request access read, and routing.
- `src/shared/api/load-own-access.ts:11-15`, `src/shared/config/resolve-access.ts:22-28`, `src/shared/config/role-gate.ts:25-40`: access resolution.
- `src/_pages/dashboard/ui/DashboardPage.astro:9,33-49`: the notice and its `status === "none"` test.
- `src/_pages/users/api/change-user-role.ts:17-41`: the template for the write path.
- `src/_pages/users/model/user-rows.ts:38-60,110-117`: statuses, row flags and precedence.
- `src/_pages/users/ui/UserTable.tsx:69-114`, `src/_pages/users/model/use-invitation-actions.ts`, `src/_pages/users/ui/ConfirmRevokeDialog.tsx`: UI templates.
- `src/test/role-matrix-expectations.ts:61`, `src/test/factories/create-signed-in-user.ts:40-72`, `src/test/last-admin-guard.integration.test.ts`: test harness.
- `supabase/functions/admin-users/handler.ts:284`: `requireAdmin`, which already refuses a deactivated admin.
- `e2e/CLAUDE.md:58-66`: the throwaway-sign-in exception S-408 must extend.

## Architecture Insights

- **One fence, many guards.** Access control converges on `private.current_app_role()`. A new lockout state is one condition there, plus the matching condition in `guard_last_admin()`'s notion of "an admin who can act". S-409's pending flag and S-410's invitees already ride it. S-408 is the third rider, which is why the two functions are a shared hotspot that every slice must re-create from the live body.
- **Writes go through the admin's session.** Role writes go through the admin's own session so that RLS judges them and the trigger records them under `auth.uid()`. The secret key is reserved for the Auth Admin API. Deactivation needs nothing from Auth, so it belongs on the session path, not in the Edge Function.
- **Choose a writer for every state.** Each place S-408's state could live comes with a writer: `user_roles` (the admin), `user_directory` (Auth and the secret key) or a new table (new policies). Where an existing writer and read posture already fit, the change is smallest. That is `user_roles`.
- **Watch the triggers' early returns.** `guard_last_admin()` and `record_role_change()` short-circuit on "the role didn't change". Any state stored beside the role breaks that assumption, and the break is silent: the last admin could be deactivated with no record. Tests must pin both.

## Historical Context (from prior changes)

- `context/changes/user-managment-research/research.md:297-304,506,535-538`: the original proposal, "Deactivation = the app-level `active` flag, read live… immediate", in a `user_roles` column. A ban is "a complement for permanent removal". Probe 3 found that a ban doesn't end an issued token, though on v2.189.0. Its "should be signed out" is superseded by PRD `:365`.
- `context/archive/2026-10-28-fail-closed-roles/plan.md:77`: "The `active` / deactivation flag: S-408. It later changes `private.current_app_role()` alone."
- `context/archive/2026-11-03-users-page-roles/research.md:149-159,209,226,391`: the status column grows per slice, and S-408 adds "deactivated (`active`)". The guard must count only active admins. `access_changes.kind` gains `deactivated | reactivated`.
- `context/archive/2026-11-03-users-page-roles/plan-brief.md:38`: "No access" was chosen as "the only immediate way to cut access until S-408 ships".
- `context/archive/2026-11-03-users-page-roles/reviews/impl-review.md:47-70` (F1): the guard's cascade exemption was narrowed after a hypothetical S-408 DELETE showed it could slip the last admin through.
- `context/archive/2026-11-08-create-account-fallback/research.md:154-166` (C2) and `:198-202` (C5): why the pending flag lives on `user_directory`, and that S-409 changed the guard itself because "S-408 is skippable and may never ship".
- `context/archive/2026-11-10-invite-by-email/research.md:183-192,251,262,318-324` and `plan.md:373-377`: invitees reuse the fence. Ideas that "collide with S-408" were rejected. "Revoke by ban" was rejected. The status precedence a `deactivated` state must slot into is recorded there.

## Related Research

- `context/changes/user-managment-research/research.md`: the milestone's founding research, including the ban probe.
- `context/archive/2026-11-03-users-page-roles/research.md`: S-406, roles, the guard and the access record.
- `context/archive/2026-11-08-create-account-fallback/research.md`: S-409, the pending fence.
- `context/archive/2026-11-10-invite-by-email/research.md`: S-410, the invitation states.

## Open Questions

Decisions for `/10x-plan`:

1. **Option A or D.** Build the `deactivated_at` flag, so the role is kept and the state has its own status and record kinds? Or accept "No access" as FR-407's delivery, perhaps with D′'s "restore last role" button? Recommendation: **A**.
2. **The notice copy.** Reuse the "No access yet" notice as is (zero middleware change; meets the outcome to the letter)? Or add a `deactivated` access state with copy like "Your access has been paused — ask your admin" (about six files, plus the `DashboardPage.astro:9` trap)?
3. **Which rows can be deactivated.** Only `active` rows (recommended)? Pending rows too (precedence: pending wins at the middleware)? The admin's own row? The database allows self-deactivation unless the person is the last active admin. The UI could hide it, as "Remove my access" already covers the case.
4. **The role picker on a deactivated row.** Keep it live (a role change keeps the person deactivated) or lock it until reactivation?
5. **An UPDATE that changes both role and flag.** Forbid it, or record two rows?
6. **Break-glass.** Should `scripts/assign-role.mjs` gain a reactivate path, or is the guarantee of one active admin enough?
7. **For S-411, not S-408:** hosted GoTrue's version, and so whether pre-ban tokens are refused at GoTrue endpoints. Also, whether S-411 should set `deactivated_at` alongside a ban, which needs S-408 to land first.
