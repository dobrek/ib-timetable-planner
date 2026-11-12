<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Deactivate and reactivate (S-408)

- **Plan**: context/changes/deactivate-reactivate/plan.md
- **Scope**: All 3 phases (full plan; 3.6, the hosted check after merge, is still open, as planned)
- **Date**: 2026-11-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS. All 17 planned items MATCH; "What We're NOT Doing" is respected |
| Scope Discipline | WARNING (F1) |
| Safety & Quality | PASS (2 observations: F2, F3) |
| Architecture | PASS |
| Pattern Consistency | PASS (2 observations: F4, F5) |
| Success Criteria | PASS (1 observation: F6) |

## Evidence

- **Fence migration**: each of the three function bodies was diffed against its live source: `current_app_role` and `guard_last_admin` from `20261109143000_must_change_password.sql`, `record_role_change` from `20261105080343_role_management.sql`. No earlier amendment was lost: the 42501 role-move refusal, the BEFORE + `pg_trigger_depth() > 1` cascade exemption, advisory lock 406001, PT409, the pending condition, the recorder's cascade skip and the actor derivation are all intact.
- **Post-conditions**: re-ran the fence migration in a rolled-back transaction on the local stack. All `S-408:` post-conditions passed.
- **Live posture**: `current_app_role` is the only DEFINER function. `authenticated` holds UPDATE on `user_roles`; `anon` holds no DML on it.
- **Self-deactivation (safety agent)**: in a rolled-back transaction, an admin deactivating their own row with another admin still active writes, records `deactivated` (admin → admin), and then reads `own_app_role()` as null.
- **Automated checks run**:
  - `pnpm check`: 0 errors.
  - `pnpm lint` and `pnpm steiger`: clean.
  - `pnpm test`: 2823 passed.
  - `pnpm test:integration` (stack keys passed inline): 883 passed, 5 skipped (solver suites, no `SOLVER_URL`).
  - `pnpm build`: clean, with the server-only Supabase assertion passing.
  - `pnpm audit --audit-level=high`: passed.
  - `mise run functions:check`: passed.
  - shellcheck: passed.
  - E2E: `deactivate.admin.spec.ts` 5/5 repeats; `no-access.no-role`, `users.admin` and `create-account.admin` passed (one pre-existing flake, see F6).
- **Not run**: `pnpm exec supabase db reset`, which would wipe the local users and roles. Both migrations are applied on the local stack, and CI's integration job applies them from scratch.

## Findings

### F1 — Unplanned shared helper `report-row-action.ts`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/_pages/users/model/report-row-action.ts:14
- **Detail**:
  - The invitation hook's private `report()` and `REFRESH_ON` were moved, unchanged, into a shared helper that both hooks now use. That was a sound way to meet the plan's "the outcome handling matches `use-invitation-actions.ts`" without copying the code, and invitation behaviour is unchanged.
  - The plan doesn't name the file, though. Two of the paths it now owns for activation have no test: a rejected request (toast `ACCOUNT_UNREACHABLE_MESSAGE`, no reload) and `FORBIDDEN` (reload). `UsersPage.test.tsx` covers activation's success, `NOT_FOUND` and `CONFLICT`. The rejected path is tested only for the role change (`UsersPage.test.tsx:125`).
- **Fix**: Add a one-line addendum to the plan's Phase 2 §3 recording the extraction. Add one `UsersPage.test.tsx` case: a rejected Reactivate toasts the unreachable message and does not reload.
- **Decision**: FIXED. Plan addendum added under Phase 2 §3. A new `UsersPage.test.tsx` case, "frees the row and reloads nothing when a reactivation never completes", checks the unreachable toast, the re-enabled button and no reload; the file passes 31/31.

### F2 — The server accepts deactivating a pending row, and the migration comment says only the service role can

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261112110654_deactivation_fence.sql:45; src/_pages/users/api/set-user-active.ts:38-44
- **Detail**:
  - **Active rows only, in the UI alone.** `deactivate` filters only on `.is("deactivated_at", null)`, and the "active rows only" rule (`canDeactivate`) exists only in the UI.
    - A crafted `setUserActive` call from an admin can deactivate an invited or temporary-password row.
    - That row keeps showing as pending, because `statusOf` checks pending first, and it offers no Reactivate.
    - It is harmless: the person is fenced anyway, and once they choose a password the row reads Deactivated and offers Reactivate.
  - **The comment is wrong.** The header says an INSERT arriving deactivated happens "only [with] the service role". In fact "Admins grant roles" (`role_management.sql:115-120`) puts no condition on the column, so an admin's own session could do it too; no app code path does.
  - **Why it matters.** CLAUDE.md tells S-411 to re-create these functions from this file, so its header should be accurate.
  - **Safe to edit.** The branch is not merged, so the migration can still be edited.
- **Fix**: Correct the comment to "no app path does; the INSERT policy does not constrain the column". Add one line to the plan's "What We're NOT Doing" saying the server does not refuse deactivating a pending row, and why that is harmless.
- **Decision**: FIXED. The comment is corrected in the fence migration's header (comment only, no SQL change), and the same claim is corrected at plan.md § Critical Implementation Details (INSERT). The plan's "What We're NOT Doing" now records the pending-row gap and why it is harmless.

### F3 — The Edge Function's 403 loop leaves out a deactivated admin

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/admin-users.integration.test.ts:128
- **Detail**:
  - The loop over refused principals is `["noRole","viewer","author","pendingAdmin","machine"]`. `admin-users` is the only code that holds the secret key, and a deactivated admin is exactly a role row that must not pass `requireAdmin`.
  - It is correct today: `requireAdmin` reads `own_app_role`, and the role matrix pins that to null for `deactivatedAdmin` (`ANSWERED_ROLES`). But nothing at the function's HTTP surface states it, while `pendingAdmin`, the equivalent fence, is stated there.
- **Fix**: Create a deactivated admin in the suite's `beforeAll` (`createSignedInUser(admin, { role: "admin", deactivated: true })`), add its token to `tokens`, and add `"deactivatedAdmin"` to the loop.
- **Decision**: FIXED. `deactivatedAdmin` is added to the setup, to `tokens`, to the 403 loop and to the suite header's "Who gets in" claim. The suite passes 44/44. Red check: with `and r.deactivated_at is null` dropped from `current_app_role()` on the local stack, the new case fails; the saved definition was then restored and diffed identical.

### F4 — The E2E Reactivate click is not gated on hydration

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/specs/deactivate.admin.spec.ts:68
- **Detail**:
  - After the Deactivate confirm, `refreshPage()` does a full page load. The next admin action is a bare `row.getByRole("button", { name: "Reactivate …" }).click()`.
  - The "Deactivated" text it waited on is SSR output, so it doesn't prove the island is hydrated. A click before hydration is dropped, and line 69 would time out.
  - The three `person` navigations in between make this unlikely: 5/5 repeats passed. Sibling specs do the same (`invite.admin.spec.ts:126`, `create-account.admin.spec.ts:83`). Still, e2e/CLAUDE.md's hydration rule asks for the gate, and F6 shows this class of flake does fire.
- **Fix**: Wrap the click and the "Active" assertion in `expect(async () => { … }).toPass()`, which retries the click until the row reads Active, the way `clickToReveal` does for dialogs.
- **Decision**: FIXED. Reused `clickToReveal(reactivateButton, row's "Active")` from `e2e/support/planner.ts` instead of an inline `toPass`, as e2e/CLAUDE.md asks. The spec passed 5/5 repeats.

### F5 — A doc comment and a test case describe refusals that cannot happen

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/users/api/set-user-active.ts:22; src/_pages/users/api/set-user-active.test.ts:16-29
- **Detail**:
  - **The 42501 bullet.** The JSDoc says "A refused write (`42501`) → `FORBIDDEN`". For an UPDATE, RLS's USING clause hides the row rather than raising, so a non-admin gets 0 rows, which answers `NOT_FOUND`. In practice a non-admin is refused earlier anyway, by the action's `requires: "manage_users"`.
  - **The reactivating CONFLICT case.** The test "reports reactivating refused by the last-admin guard as CONFLICT" covers a path the guard never takes: it returns early when `old.deactivated_at is not null`.
  - Both are harmless, but they tell the next reader that these paths exist. `change-user-role.ts`'s delete path uses the same 42501 wording.
- **Fix**: Reword the 42501 bullet: "RLS hides the row from a non-admin, which answers `NOT_FOUND`; `42501` → `FORBIDDEN` is the mapping's fallback." Reduce the CONFLICT `it.each` to the deactivating direction.
- **Decision**: FIXED. The JSDoc now says only a deactivation meets PT409, that a non-admin lands on `NOT_FOUND` (the UPDATE policy's USING hides every row, checked at `role_management.sql:122-128`), and that 42501 is the WITH CHECK fallback. The CONFLICT case covers deactivating only; 6/6 pass. `change-user-role.ts`'s same wording is left as it is (outside this slice).

### F6 — A pre-existing hydration flake in `create-account.admin.spec.ts` (from S-409, not this change)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: e2e/specs/create-account.admin.spec.ts:96-100
- **Detail**:
  - **What failed.** Criterion 3.2 runs this spec. In this review it failed once ("a lost password is re-issued once…") and then passed 3/3 on rerun.
  - **Why.** The "old password is dead" check fills `/auth/signin` with no hydration gate. The failure snapshot shows the Email field empty with "Email is required", the exact flake that `signInThroughUi`'s doc comment (`e2e/support/sign-in.ts:12-17`) describes and gates against.
  - **Who owns it.** The lines are S-409's (874275c5), and nothing in this diff touches them.
- **Fix**: Add `signInThroughUi`'s toggle gate before the fills, and assert `toHaveValue` after them, in a separate `fix(e2e)` commit rather than inside S-408.
- **Decision**: FIXED. `signInThroughUi`'s goto + hydration gate + fills + `toHaveValue` became an exported `fillSignInForm` in `e2e/support/sign-in.ts`, which `signInThroughUi` builds on, and the dead-password check now uses it. e2e/CLAUDE.md's plumbing list names it. Five specs (create-account, deactivate, no-access, users, invite) passed 3× each: 61 passed, setup projects included. Commit it separately as `fix(e2e): …`, not inside S-408.

## Triage summary

| Decision | Findings |
|----------|----------|
| Fixed | F1, F2, F3, F4, F5, F6 (6) |
| Skipped | none |
| Accepted | none |
