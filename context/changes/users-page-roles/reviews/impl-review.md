<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-406 Users Page — List Users and Change Roles

- **Plan**: context/changes/users-page-roles/plan.md
- **Scope**: All 5 phases (full plan)
- **Date**: 2026-11-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations
- **Triage (2026-11-06)**: all 10 decided. Fixed: F1 (Fix A), F2, F3, F4, F6, F7, F8, F9, F10. Accepted: F5. After the fixes: lint, steiger and `pnpm check` are clean; unit tests 2572 passed; the integration lane passed 43 files, with the 2 solver files skipped. Still open:
  - before merge, a read-only check on hosted that `has_table_privilege('postgres', 'auth.users', 'SELECT')` is true (F1);
  - post-deploy manual items 5.6–5.8.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Evidence

Automated checks re-run for this review on 2026-11-06, against the local stack with all three migrations applied:

- `pnpm check`: 0 errors, 0 warnings.
- `pnpm lint` and `pnpm steiger`: clean.
- `pnpm test`: 255 files, 2571 tests passed.
- `pnpm build`: clean, and the postbuild Supabase-key assertion passed.
- `prettier --check .`: clean. The only hit is `.claude/settings.local.json`, which is gitignored globally.
- The 7 S-406 integration suites: 381 tests passed. The suites are role matrix, directory, guard, recorder, lifecycle smoke, solver credential and change-user-role.
- Full `pnpm test:integration --maxWorkers=2`: 43 files passed. The 2 skipped files are the solver suites, because no solver was running.
- `supabase db advisors --local`: no issues.
- `pnpm db:types`: no diff in `database.types.ts`.
- Playwright, all 4 setups plus the users admin, viewer and hidden specs, no-access and the full viewer read-only walk: 17 passed.

Not re-run:

- `supabase db reset`: it would wipe the local accounts.
- Full `pnpm test:e2e`: no solver was running, and `generation.spec.ts` needs one.
- Manual items 5.6–5.8 are post-deploy and correctly still pending.

## Findings

### F1 — The cascade exemption is a depth test that silently disables the guard and the recorder

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261105080343_role_management.sql:141 (guard), :229 (recorder)
- **Detail**: Both triggers treat any `DELETE` at `pg_trigger_depth() > 1` as the FK cascade from `auth.users`. In that case the guard skips the last-admin check, and the recorder skips the record.
  - Today nothing else reaches depth 2. The only triggers are the two `auth.users` mirror triggers, the `user_roles` triggers and `moddatetime`. An RPC writes at depth 1.
  - CLAUDE.md:55 now presents this as the pattern for every user-keyed table. The natural next changes would issue exactly such a DELETE: an S-408 deactivation, an S-411 deletion, or a "drop the role when `machine_role` is set" branch in `mirror_auth_user`. Such a DELETE could remove the last admin with no refusal and no record, silently.
  - The migration is not yet on `main`, so it can still be edited in place.
- **Fix A ⭐ Recommended**: Narrow the exemption to "the parent row is already gone": `tg_op = 'DELETE' and pg_trigger_depth() > 1 and not exists (select 1 from auth.users u where u.id = old.user_id)`. Edit it in place in both functions, and add a guard-suite case for a trigger-issued DELETE at depth 2.
  - Strength: The invariant becomes structural instead of a convention. A non-cascade nested DELETE is then guarded and recorded, or fails loudly with 42501 under `authenticated`, instead of slipping through.
  - Tradeoff: Two function bodies change, followed by a local `db reset`, the guard, recorder and lifecycle suites again, and a re-check of the post-conditions.
  - Confidence: MED. The approach rests on two facts: Postgres runs RI cascade actions as the referencing table's owner, and the parent row is no longer visible by then. Neither has been probed here, and P7-style probing is what this repo requires.
  - Blind spot: Whether `postgres` keeps SELECT on `auth.users` on hosted, given Supabase's tightened auth-schema grants. Probe this on local and hosted before relying on it.
- **Fix B**: Keep the SQL. Add the constraint to CLAUDE.md:55 and the migration header: "never write `user_roles` from inside another trigger; the depth test would read it as an account-deletion cascade".
  - Strength: A two-line doc change with no migration churn and no new probe.
  - Tradeoff: The invariant stays a convention. A future slice that misses the line fails silently.
  - Confidence: HIGH, as to what it does.
  - Blind spot: It relies on S-408 and S-411 authors reading CLAUDE.md:55.
- **Decision**: FIXED via Fix A (2026-11-06).
  - **Probe first.** A rolled-back probe against local Postgres showed the current code let a nested DELETE remove the last admin, leaving 0 admins and 0 records. With the fix the same DELETE is refused with PT409, and the cascade is still exempt (`parent_exists = f`). A nested removal of an author is recorded. A nested DELETE under an `authenticated` session fails with 42501. A depth-1 admin removal still works.
  - **Edits.** Both function bodies changed in place, in `20261105080343_role_management.sql`. The check is a nested `IF`, so `auth.users` is read only at depth > 1. The header is updated. A new post-condition asserts that the owner of `user_roles` may SELECT `auth.users`.
  - **Tests.** `last-admin-guard.integration.test.ts` gained the `nestedRemoval` (PT409) and `nestedRemovalRecorded` (1) cases.
  - **Docs.** CLAUDE.md:55 is updated, and change.md has a note.
  - **Local apply.** No reset: the two `create or replace` statements and the full post-condition block were run against local Postgres, and they passed. The S-406 suites (369) and the full lane (43 files) are green.
  - **Pre-merge.** Run a read-only check on hosted: `select has_table_privilege('postgres', 'auth.users', 'SELECT')` must be true, or the new post-condition fails the deploy. CI's integration job is the from-scratch proof of the edited file.

### F2 — A failed action call leaves the row's picker disabled, and a confirm dialog stuck open

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/users/model/use-role-change.ts:42-64
- **Detail**: `save` sets `inFlight` and `saving`, then awaits `changeUserRole`. Neither `callAction` (`src/shared/lib/forms/call-action.ts`) nor Astro's action client catches a `fetch` rejection, such as a network drop or a Worker restart.
  - On a rejection, `inFlight` and `saving` are never cleared, so the row's picker stays disabled.
  - For a confirmed change, `cancel()` refuses to close the dialog while `saving` holds the row, so the admin is trapped until they reload.
  - `void save(...)` turns the rejection into an unhandled promise rejection.
  - `useConfirmAction` has the same gap, but there it only leaves a busy button.
- **Fix**: Wrap the call in `try`/`catch`/`finally`. The `catch` toasts a generic failure message. The `finally` clears `inFlight`, `saving` and `confirmation`, except on the self-success path, which navigates away. Add a `UsersPage.test.tsx` case with a rejecting client.
- **Decision**: FIXED (2026-11-06).
  - **Change.** `changeUserRole(...).catch(() => null)` turns a rejection into `null`. The self-success path still leaves before any state is cleared. A `null` result clears the row and toasts "Role change failed — try again.", with no reload. The docblock gains a matching bullet. This shape was chosen over `finally`, which would have flipped the picker back on the self-success path.
  - **Test.** A new `UsersPage.test.tsx` case uses a rejecting client: the dialog closes, the picker is enabled again and shows "Author", the failure toast appears, and nothing reloads. The case fails against the old hook (deliberate-break check) and passes with the fix. Users tests: 45 passed. `pnpm check` and eslint are clean.
  - **Not changed.** `useConfirmAction` has the same gap. It is outside S-406 and left as is.

### F3 — CLAUDE.md overclaims the last-admin rule, and two convention docs are stale

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: CLAUDE.md:48, CLAUDE.md:49, context/foundation/ui-conventions.md:170
- **Detail**:
  - **CLAUDE.md:48** says "the school always keeps at least one admin (a trigger refuses the last demotion, by every path)". The database does not enforce that:
    - Deleting the last admin's account is exempt by design (role_management.sql:34-39 says so accurately).
    - A concurrent account deletion and demotion can leave zero admins, because the cascade takes no advisory lock.
    - An owner `TRUNCATE` has no trigger.
    - S-411 will rely on this line, which is the overclaim pattern that lessons.md warns about.
  - **CLAUDE.md:49** does not list `access_changes` among the read-policy exceptions. Its read requires `can_manage_users()`, not `can_read()`.
  - **ui-conventions.md:170** still lists `Capability` as `session`, `read` or `edit`, without `manage_users`.
- **Fix**:
  - Reword :48 to: "a trigger refuses the last admin's demotion or removal by any role write; deleting the last admin's account is not refused until S-411".
  - Add `access_changes` (admin read via `can_manage_users()`) to :49.
  - Add `manage_users` to ui-conventions.md:170.
- **Decision**: FIXED (2026-11-06).
  - CLAUDE.md:48 now says: "A trigger refuses any role write that would leave the school without an admin, by every path (the page, `assign-role.mjs`, the service role); deleting the last admin's own account is not refused until S-411."
  - CLAUDE.md:49 names `access_changes` as admin-read via `private.can_manage_users()`.
  - ui-conventions.md:170 lists `manage_users`.

### F4 — The guard is correct only under READ COMMITTED, and nothing says so

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261105080343_role_management.sql:150-156 (and THE GUARD header, :26-30)
- **Detail**: The header explains that "PL/pgSQL's fresh snapshot per statement then sees the first one's commit". That holds only under READ COMMITTED. Under REPEATABLE READ, the `exists` reads the snapshot taken before the lock wait, so two cross-demotions both commit and leave zero admins. Every current writer uses the default (`default_transaction_isolation = read committed`, with no role override). Only an operator in psql could hit this.
- **Fix**: Add one line to THE GUARD header naming the READ COMMITTED assumption. The migration is unmerged, so edit it in place.
- **Decision**: FIXED (2026-11-06). THE GUARD header now names the READ COMMITTED assumption and the REPEATABLE READ failure. This is a comment only, so there was nothing to apply locally.

### F5 — The loader reads all of `access_changes`, under PostgREST's 1000-row cap

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/users/api/loader.ts:24-29; src/_pages/users/model/user-rows.ts:77-81
- **Detail**: The plan accepted "all rows, fine at school scale", and the loader comment notes the `max_rows` cap (`supabase/config.toml:18`, 1000). Once the record outgrows it, users whose latest change is older than the newest 1000 records silently show "—".
  - The `(target_id, occurred_at desc)` index is unused by this read.
  - `buildUserRows` re-filters every change per user, O(U×C). The teachers slice groups once with `groupBy` from `@/shared/lib/collections`.
- **Fix**: No change now. When the history grows, swap the read for a `security_invoker` view (`distinct on (target_id) … order by target_id, occurred_at desc, id desc`). If the model is touched, group once with `groupBy`.
- **Decision**: ACCEPTED (2026-11-06). There is no code change, as the fix proposed. The plan's school-scale assumption stands, and the loader comment already names the `max_rows` cap. The later path, if the record nears 1000 rows, is a `security_invoker` latest-per-target view plus `groupBy` in `buildUserRows`.

### F6 — Small schema-hygiene gaps in the new migrations

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261105080343_role_management.sql:183, :61-64; supabase/migrations/20261105073614_user_directory.sql:145-204
- **Detail**: All of these were verified live against the local stack:
  - `access_changes.actor_id` has no index (`actor_idx=false`), so deleting an account seq-scans the table to null it.
  - `anon` holds USAGE on `public.access_changes_id_seq` (`has_sequence_privilege` = true), from Supabase's default sequence grants. PostgREST cannot reach it, but it falls short of the lessons.md "excluded at the grant layer" rule.
  - The `user_directory` post-conditions do not assert `mirror_auth_user`'s `search_path=""` pin. The function has the pin; S-403's post-conditions (`20261028140939_user_roles.sql:187`) assert theirs.
  - The role-management lock note covers only `user_roles`. The two new FKs also take SHARE ROW EXCLUSIVE on `auth.users`, which stalls sign-ins for the length of that file's transaction.
- **Fix**: These migrations are unmerged, so edit them in place:
  - add an index on `access_changes (actor_id)`;
  - `revoke all on sequence public.access_changes_id_seq from anon`, and add a post-condition;
  - assert the `search_path` pin;
  - extend the lock comment.
- **Decision**: FIXED (2026-11-06). Both unmerged migrations were edited in place.
  - **`role_management.sql`:**
    - a new `access_changes_actor_id` index;
    - `revoke all on sequence public.access_changes_id_seq from anon`, with a post-condition that anon holds none of SELECT, UPDATE or USAGE on it;
    - a post-condition that `can_manage_users`, `guard_last_admin` and `record_role_change` pin `search_path=""`. This was an extra beyond the finding, approved during triage;
    - the lock comment now names the SHARE ROW EXCLUSIVE lock on `auth.users`.
  - **`user_directory.sql`:** a post-condition that `mirror_auth_user` pins `search_path=""`.
  - **Local apply, no reset:** the index, the revoke and both files' full post-condition blocks; all passed. anon's sequence USAGE is now false, while `authenticated` keeps its own, which is outside this fix. The full integration lane is green (602) and the advisors report no issues.

### F7 — The `moveRecorded` assertion cannot fail

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/test/last-admin-guard.integration.test.ts:74, :90
- **Detail**: `moveRecorded` is counted after `sqlstateOf` has already run `rollback to savepoint` (`inSavepoint`, :199-206), so it is always 0. A refused statement could not leave a record anyway, by statement atomicity. The `moveToAnotherUser: INSUFFICIENT_PRIVILEGE` assert carries the case on its own. By contrast, `cascadeRecordsAfterDeletion` (:234-244) correctly counts inside its savepoint.
- **Fix**: Drop `moveRecorded`, `recordsBefore` and `recordsNaming`, or count inside the savepoint the way `cascadeRecordsAfterDeletion` does.
- **Decision**: FIXED (2026-11-06). `moveRecorded`, `recordsBefore` and the `recordsNaming` helper are removed, and the 42501 assert carries the case. The guard suite still passes (3/3), and eslint and prettier are clean.

### F8 — Two justified deviations from the plan are not recorded in change.md

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20261105080343_role_management.sql:94-103; src/test/user-directory.integration.test.ts:122-139
- **Detail**:
  - **The `user_roles` SELECT policy.** The plan asked for a new "Admins read every role" policy. Instead, the migration `alter policy`s S-403's own-row policy to `user_id = auth.uid() or can_manage_users()` and renames it. The reason is that a second permissive policy trips the `multiple_permissive_policies` WARN, which would fail criterion 2.7. `USER_KEYED_POLICIES` pins the new shape.
  - **The directory count.** The plan's global `count(user_directory) = count(auth.users)` check became a per-file check, because the role matrix deletes directory rows in parallel. The migration post-condition still proves the global count.
  - Separately, the plan contradicts itself: Testing Strategy (:795) asks for "every refusal both as owner and as a simulated admin session", while the phase contract (:434) asks to "repeat one case". The code follows the phase contract.
- **Fix**: Add a dated note to `change.md` § Notes recording both deviations, and the plan's simulated-session wording.
- **Decision**: FIXED (2026-11-06). A dated note in `change.md` § Notes records the SELECT-policy widen-and-rename, the per-file directory count, and the plan's simulated-session wording.

### F9 — Test fixtures sit in the `ui/` segment instead of `__fixtures__/`

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/users/ui/fixtures.ts
- **Detail**: This is test-only data in a production segment. Every other slice uses a `__fixtures__/` folder (`_pages/plan-comparison/model/__fixtures__/`, `_pages/plan-detail/api/__fixtures__/`, `entities/timetable/model/__fixtures__/`). This file is the only bare `fixtures.ts` in `src/`.
- **Fix**: Move it to `src/_pages/users/ui/__fixtures__/user-rows.ts`, and update the three test imports.
- **Decision**: FIXED (2026-11-06). The file was moved with `git mv` to `ui/__fixtures__/user-rows.ts`. Its own import and the three test imports are updated. Users tests (45), `pnpm check`, steiger, eslint and prettier are all clean.

### F10 — `connectPostgres` has no loopback guard, and the new guard suite now locks and demotes through it

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/postgres-client.ts:20-21 (used by src/test/last-admin-guard.integration.test.ts)
- **Detail**: The helper predates this branch and reads `SUPABASE_DB_URL ?? LOCAL_DB_URL`. Until now it served catalog reads only. The new guard suite uses it to run `lock table public.user_roles in exclusive mode` and to demote every admin inside a transaction. That transaction always rolls back, but a mis-pointed `SUPABASE_DB_URL` would block every role write on that database while the suite runs. Both the e2e admin client (`e2e/support/admin-api.ts:21-28`) and the provisioner refuse non-loopback hosts. This helper does not.
- **Fix**: In `connectPostgres`, refuse any host other than `127.0.0.1`, `localhost` or `[::1]`, matching `admin-api.ts`. CI's value is local.
- **Decision**: FIXED (2026-11-06).
  - **Change.** `connectPostgres` now reads its URL through `loopbackDbUrl()`, which refuses any host outside `LOOPBACK_HOSTS` (`127.0.0.1`, `localhost`, `[::1]`).
  - **Local URL still accepted.** The four pg-using suites pass (367 tests).
  - **Remote URL refused.** `SUPABASE_DB_URL=…@db.example.com…` fails with `refusing non-loopback SUPABASE_DB_URL host "db.example.com"` before any connection is made.
  - **CI unaffected.** CI's `SUPABASE_DB_URL` comes from `supabase status`, which is loopback.
