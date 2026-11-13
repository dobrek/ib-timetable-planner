<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Remove and Correct Accounts

- **Plan**: context/changes/remove-and-correct-accounts/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-11-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Automated verification (run during review)

| Command | Result |
|---|---|
| `pnpm exec vitest run` on the 7 unit files named in 1.3, 3.1, 4.1 | pass: 185 tests |
| `mise run functions:check` | pass: deno check, lint, 22 tests |
| `pnpm check` | pass: 0 errors |
| `pnpm steiger` | pass |
| `pnpm test:integration` on `admin-users`, `set-user-active`, `change-user-role` (edge runtime restarted; stack serves this worktree) | pass: 62 tests, none skipped |
| `pnpm test:integration src/test/role-matrix.integration.test.ts` (extra) | pass: 547 tests |
| `pnpm lint` (extra) | pass |
| `pnpm test` (extra) | one failure in `bench/campaign/main.test.ts` under the parallel run; passes alone; the branch does not touch `bench/` |

## Findings

### F1 — Ban goes ahead when its pause write matches no row

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/functions/admin-users/handler.ts:287-307 (`setPause` at :433-443)
- **Detail**:
  - **The cause.** `setPause` returns `"unchanged"` when the update touches no row, and `ban` then carries on: it writes `banned_at` with the secret key and bans in GoTrue. Under the "Admins change roles" policy (`using ((select private.can_manage_users()))`, `20261105080343_role_management.sql:122-124`), an admin who has lost that capability since `requireAdmin` ran gets 0 rows, not `PT409`.
  - **The race.** Admins A and B ban each other. A's pause of B commits first. B's pause of A then matches 0 rows, yet B's request still bans A. Both admins are locked out, and A still holds an active role. The plan relies on this write to serialise two admins (plan.md:65).
  - **The same pattern in two other places.**
    - `writeBannedAt` writes whether or not `banned_at` is already set. Two concurrent bans of one person overwrite `banned_at`, and a later Unban leaves the pause in place because the two timestamps no longer match.
    - The rollback clears `banned_at` without filtering on this call's timestamp, and discards errors from both undo writes.
- **Fix**:
  - When `setPause` reports `"unchanged"`, re-read the target's `deactivated_at` with the admin client, and refuse with 409 unless it is now set.
  - Write `banned_at` with `.is("banned_at", null).select()`, and refuse when no row matches.
  - Undo with `.eq("banned_at", timestamp)`, and log both undo results.
  - Strength: Restores the serialisation the plan describes and closes the double-ban drift, using the same timestamp filter `clearPause` already uses.
  - Tradeoff: A few lines, but the race is hard to provoke in an integration test. It probably needs a stubbed or unit-level test.
  - Confidence: HIGH — an RLS UPDATE whose USING is false returns 0 rows with no error; policy verified.
  - Blind spot: The mutual-ban race was not reproduced live.
- **Decision**: FIXED. Ban now claims `banned_at` with a conditional write (`markBanned`, which refuses 409 `not_allowed` when no row matches) before the pause. A pause that matches no row re-reads the target and refuses unless it is already paused. Every undo goes through `undoBan`: filtered on this call's timestamp, logged, and keeping the pause when the record could not be cleared. Unban clears `banned_at` filtered on the value it read. New integration case: "refuses the ban, and writes nothing, when the session's pause reaches no row" (a `BEFORE UPDATE` trigger returning NULL stands in for RLS). The order differs from plan.md:65, which is queued in follow-ups/review-fixes.md.

### F2 — A banned row whose role is removed has no working action

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/_pages/users/model/user-rows.ts:112-128 · supabase/functions/admin-users/handler.ts:397-401
- **Detail**:
  - **How to reach it.** The role picker stays enabled on Banned rows (`UserTable.tsx:83-90`; the plan says "The role picker is unchanged"). Choosing No access deletes the role row (`change-user-role.ts` `removeRole`). The guard allows that, because a paused admin does not count.
  - **The stuck state.** The row still says Banned and offers Unban, Delete and Change email. `cannotTouch` refuses all three, because the role is null and the account is not on a temporary password, so each answers "That account cannot be changed that way."
  - **The data-access hole.** The only way out is to grant a role again. That inserts a role row with `deactivated_at` null, so the banned person regains data access through any unexpired token (up to an hour) while GoTrue still bans them. Closing that gap is why the ban pauses the account, and it is the case `set-user-active.ts:36` now refuses for Reactivate.
  - **Plan gap.** The plan did not consider the role picker on a banned row.
- **Fix A ⭐ Recommended**: Refuse role writes while `banned_at` is set. `change-user-role` reads `user_directory.banned_at` first and refuses with the "already changed" outcome, as `set-user-active` does, and the picker is disabled on Banned rows.
  - Strength: One rule for both ways back in (Reactivate and a role grant), with the same shape as `set-user-active.ts:36`. It closes both the stuck state and the re-grant hole.
  - Tradeoff: An admin must Unban before changing a banned person's role. This reverses the plan's "role picker unchanged", so the plan needs an addendum.
  - Confidence: HIGH — the same read-then-refuse step already ships in this slice.
  - Blind spot: Have not checked the e2e specs that use the role picker on every row.
- **Fix B**: Let `cannotTouch` accept any row with `banned_at` set for unban, delete and change_email, whatever its role.
  - Strength: A change to the function only, and the role picker stays unchanged as planned.
  - Tradeoff: The re-grant path stays open: a role granted to a banned person without a role row is not paused.
  - Confidence: MED — fixes the stuck state, not the access gap.
  - Blind spot: None significant (unban of a row with no role has no pause to clear).
- **Decision**: FIXED via Fix A. `changeUserRole` reads `banned_at` through the new shared `api/ban-holds.ts` (which `set-user-active` now uses as well) and refuses both role changes and removals with `NOT_FOUND` / "already changed", writing nothing. `UserRow.canChangeRole` (false on Banned) disables the picker. Tests: two unit cases in `change-user-role.test.ts`; the integration case now asserts the refusal for both a change and a removal; the `user-rows` ban projection; and a `UserTable` test that the banned row's picker is disabled. The e2e specs use the picker only on rows that are not banned. A plan addendum is queued in follow-ups/review-fixes.md.

### F3 — The last-admin test commits a demotion of every other admin while other files run

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/test/admin-users.integration.test.ts:714-731
- **Detail**:
  - **What the test does.** It demotes every other counted admin with a committed `update`, makes two HTTP calls, then restores them in `finally`.
  - **How the sibling suites do it.** `last-admin-guard.integration.test.ts:68-72` and `invitation-acceptance.integration.test.ts:124-126` demote inside a rolled-back transaction that holds `lock table public.user_roles in exclusive mode`, so no parallel file ever sees the change.
  - **What can go wrong here.** Under `--maxWorkers=2`, other files' admins read as authors during the window and pick up `role_changed` records. An admin that another file creates during the window turns the expected `last_admin` into `not_allowed`. This lane is already flaky in parallel.
  - **Why the safe pattern doesn't fit.** The commit is needed because the function runs in another session, which cannot see a rolled-back transaction.
- **Fix**: Prove the predicate with a Deno unit test of a pure version of `lastActiveAdmin` (the role row and the directory rows go in, the verdict comes out), and remove the committed demotion from the integration suite.
  - Strength: Removes the cross-file interference and keeps every predicate case. It sits beside the function's existing Deno tests (`request.test.ts`).
  - Tradeoff: There is no longer an HTTP-level proof of the 409. The case it covered, the caller banning themselves, is reachable only by a direct API call anyway (see F4).
  - Confidence: MED — depends on cleanly separating the predicate from its two queries.
  - Blind spot: Have not checked whether `functions:check`'s Deno tests can import handler helpers without the Supabase client.
- **Decision**: FIXED. The rule now lives in a pure module, `supabase/functions/admin-users/last-admin.ts` (`isLastActiveAdmin`, `countsAsActiveAdmin`), following the `password.ts` / `request.ts` pattern. `last-admin.test.ts` adds 4 Deno cases: sole counting admin; another counting admin; paused, pending and non-admin others; and targets that do not count. The handler's `lastActiveAdmin` only reads the rows and delegates. The committed-demotion case and its `countingAdminsExcept` helper are gone from the integration suite. The "caller, while another admin remains" HTTP case still runs the predicate end to end. Plan criterion 2.2's wording is queued in follow-ups/review-fixes.md.

### F4 — Manual checks 3.5–3.10 were ticked with the code, and 3.9 cannot be done from the page

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/remove-and-correct-accounts/plan.md:398-403
- **Detail**:
  - **Timing.** All six manual rows were ticked in the Phase 3 commit itself (6a6ab95e, 15:23), and Phase 4 followed four minutes later. The plan says to pause for the manual pass before Phase 4, and nothing in the diff records that the pass happened.
  - **3.9 is impossible as written.** `requireAdmin` admits only an active admin, and that admin always counts. So banning anyone else never meets the last-admin rule, and the table hides Ban on the caller's own row (`UserTable.tsx:152`).
  - **What is reachable.** The function checks for the last admin before checking for self (`handler.ts:282-285`), so only a direct API self-ban returns `last_admin`. The integration suite covers that case.
- **Fix**: Untick 3.5–3.10 and run the manual pass on `pnpm build && pnpm preview`. Reword 3.9 to a step that can actually be done, or mark it as covered by the integration case.
- **Decision**: FIXED. In plan.md Progress, 3.5–3.8 and 3.10 are unticked with their sha removed, so the manual pass is owed and should run against the F1 and F2 fixes. 3.9 keeps its title, as the progress convention requires, and is marked covered by `last-admin.test.ts`, with the reason it cannot be reached from the page.

### F5 — The integration suite leaves several of the plan's invariants unchecked

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/test/admin-users.integration.test.ts:670-681, :945-948
- **Detail**:
  - **The expired invitation is never expired.** `pastCooldown` moves the invitee back only 2 minutes. That clears the 60-second resend cooldown but not the 24 h link lifetime, so "Invitation expired" is never exercised, although the plan asks for "each invitation state".
  - **The rollback test misses one invariant.** The GoTrue-failure test checks the timestamps but not that no `account_banned` row was written, which plan.md:69 names.
  - **Four outcomes are never asserted:**
    - the `account_banned` history row;
    - the `account_unbanned` history row;
    - `not_allowed` when banning an account that is already banned;
    - `not_allowed` when unbanning one that is not.
- **Fix**:
  - Backdate the expired invitee past `EMAIL_LINK_LIFETIME`.
  - Assert that no `account_banned` row exists after the rollback.
  - Assert the two history rows in the ban and unban cases.
  - Add the two `not_allowed` cases.
- **Decision**: FIXED. A new `pastLifetime` helper backdates `invited_at` by `EMAIL_LINK_LIFETIME_MS` plus 1 minute, and the refusal loop's expired invitee uses it. The rollback case asserts no `account_banned` row. The ban-and-unban case asserts the `account_banned` and `account_unbanned` rows (actor: the calling admin), a 409 `not_allowed` for a second ban and for a second unban, and that the refused second ban wrote no second record.

### F6 — Delete's last-admin rule only ever applies to the caller

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/functions/admin-users/handler.ts:357-365 · CLAUDE.md:48 · docs/runbooks/author-provisioning.md:217
- **Detail**:
  - **The rule only fires for self.** The caller is always a counted active admin, so the predicate is true only when the target is the caller. That case is already `not_allowed` whenever another admin exists.
  - **Any other target is unprotected.** The caller's own active status is the only protection, so two admins deleting each other both pass and the school is left with no admin.
  - **The docs overstate it.** The plan accepted that race (plan.md:65). But CLAUDE.md:48 and the runbook now say the function refuses deleting the last active admin.
- **Fix A ⭐ Recommended**: Before `deleteUser`, pause the target through the admin's session. That takes advisory lock 406001 and maps `PT409` to `last_admin`. Undo the pause if `deleteUser` fails.
  - Strength: Delete is serialised the same way ban is, so the docs become true. It adds no trigger on `auth.users`, which respects the plan's constraint.
  - Tradeoff: A `deactivated` history row comes before `account_deleted`. This is only safe once F1's handling of a 0-row pause is in place.
  - Confidence: MED — the guard's lock and `PT409` are already proven on the ban path.
  - Blind spot: Have not checked how the extra record reads in history (the row disappears from the page anyway).
- **Fix B**: Keep the accepted race, and reword CLAUDE.md:48 and author-provisioning.md:217: the refusal covers the caller's own account, and two admins deleting each other is an accepted race.
  - Strength: Docs only, and it matches the plan's decision.
  - Tradeoff: The "school always keeps an admin" rule has a known hole for delete.
  - Confidence: HIGH — a wording change.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A. Ban's pause step is now a shared `pauseTarget`: it pauses through the session, maps `PT409` to `last_admin`, and refuses a 0-row pause unless the target is already paused. `removeAccount` runs it before the record and `deleteUser`, and clears the pause again through `undoPause` if either fails. Ban no longer reassigns `let ownsPause`. New integration case: "refuses the delete, and keeps the account, when the session's pause reaches no row". CLAUDE.md:48 and author-provisioning.md:217 now hold as written. The plan wording is queued in follow-ups/review-fixes.md.

### F7 — Change email lets one admin take over another admin's account

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/functions/admin-users/handler.ts:370-388
- **Detail**:
  - **The path.** `change_email` with `email_confirm: true` works on any human account, other admins included, and no link goes to the old address. An admin, or a stolen admin session, can move a colleague admin's address to one they control, then use the public password reset to sign in as that colleague.
  - **What it bypasses.** GoTrue's own email-change flow normally stops this.
  - **Mitigations.**
    - The plan chose an immediate change with no link.
    - The `email_changed` row names the actor.
    - An admin can already create another admin, so what this adds is impersonation, not extra access.
- **Fix A ⭐ Recommended**: Accept the risk and record the reason in the plan: the history names the actor, and admins are trusted with accounts.
  - Strength: Keeps the planned scope; the audit trail already exists.
  - Tradeoff: The impersonation path stays.
  - Confidence: HIGH — a documented decision.
  - Blind spot: Whether hosted Auth sends an "email changed" notice to the old address was not checked.
- **Fix B**: Refuse `change_email` on another admin's row (409 `not_allowed`), and hide the control there.
  - Strength: Closes the admin-to-admin takeover.
  - Tradeoff: An admin cannot correct a colleague admin's mistyped address; that colleague has to do it themselves.
  - Confidence: MED — adds one condition to `cannotTouch` and one to the row flags.
  - Blind spot: An admin's own row must still be allowed (in scope by plan).
- **Decision**: ACCEPTED via Fix A. Admins are trusted with accounts, the `email_changed` row names the actor, and an admin can already create another admin, so the path adds impersonation, not access. The reason is queued for the plan addendum in follow-ups/review-fixes.md.

### F8 — The change-email submit skips the input-error mapping

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/users/model/use-account-actions.ts:76-94
- **Detail**: `submitCreateAccount` sends an `isInputError` result through `applyActionFieldErrors`, as lessons.md asks of forms. `submitEmail` has no such step, so a server-side input error falls through to `reportRowAction`'s toast instead of reaching the field.
- **Fix**: Add the `isInputError` → `applyActionFieldErrors` branch, as `submit-create-account.ts:30` does.
- **Decision**: FIXED. `submitEmail` now routes `isInputError` results through `applyActionFieldErrors` before the CONFLICT branch, matching `submit-create-account.ts`.

### F9 — A 500 after the Auth change landed tells the admin to "Try again"

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/users/api/constants.ts:42-45
- **Detail**:
  - **When it happens.** Ban, unban and change_email return 500 when the history insert, or unban's pause clear, fails after GoTrue has already changed the account (`handler.ts:309-310`, `:329-339`, `:385-386`).
  - **The wording.** `BAN_FAILURE`, `UNBAN_FAILURE` and `CHANGE_EMAIL_FAILURE` all say "Try again".
  - **The result.** The list is not reloaded, so the retry answers `not_allowed` or `email_exists`.
  - **The precedent.** Delete and revoke already say "Check the list before trying again."
- **Fix**: Use the "Check the list before trying again." wording for all three, as `DELETE_ACCOUNT_FAILURE` does.
- **Decision**: FIXED. `BAN_FAILURE`, `UNBAN_FAILURE` and `CHANGE_EMAIL_FAILURE` now end "Check the list before trying again.", with a one-line comment giving the reason. Tests reference the constants by name, so none changed.

### F10 — Stale comments and small leftovers

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/functions/admin-users/handler.ts:1
- **Detail**:
  - **`handler.ts`.**
    - Line 1 still says "The five operations".
    - Two JSDoc blocks are stacked on `setPause` (:431-432), so the first is orphaned.
  - **`account-error.ts`.**
    - The four new `MESSAGES[...].conflict` entries are never used, because `conflictMessage` returns early for those operations.
    - `isClosedConflict` is exported below the private helpers, against the exported-first order.
  - **`use-account-actions.ts`.** `run` returns a `row` that nothing uses.
  - **`ChangeEmailDialog.tsx:61-62`.** The copy names only the current address, but the plan says the dialog shows the address that will replace it.
- **Fix**:
  - Update the header comment and merge the two JSDoc blocks.
  - Remove the unused entries and the unused return.
  - Move `isClosedConflict` above the helpers.
  - Show the typed address in the dialog description.
- **Decision**: FIXED.
  - `handler.ts`: the header names all nine operations, and the two `setPause` JSDoc blocks are merged and now name the hidden-row case.
  - `account-error.ts`: the four coded operations' `conflict` entries are now `null` instead of unused sentences. The `Record` type still makes each operation declare one, so the compile-time check is kept. `conflictMessage` falls back to `failure` for a null, and `isClosedConflict` moved up beside the other exports.
  - `use-account-actions.ts`: `run` no longer takes or returns the unused row.
  - `ChangeEmailDialog.tsx`: the description reads the typed address with `useWatch` ("{new} replaces {current}. It is used at once.") and falls back to "The new address replaces {current}." while the field is empty.
