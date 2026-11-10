<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Create account with a temporary password (S-409)

- **Plan**: context/changes/create-account-fallback/plan.md
- **Scope**: Full plan, Phases 1–6. Phases 2–5 are complete. Two manual rows are pending: 1.2 (throwaway function, deliberately skipped and recorded) and 6.4 (hosted smoke, after merge by design).
- **Date**: 2026-11-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 7 warnings, 6 observations. F11, F12 and F13 were found during triage.
- **Triage**: complete on 2026-11-10. All 13 findings are FIXED (see "Triage outcome" at the end).
- **Extra focus (requested)**: simplicity and readability. This review adds a seventh dimension for it.

## Verdicts

| Dimension                | Verdict |
| ------------------------ | ------- |
| Plan Adherence           | PASS    |
| Scope Discipline         | PASS    |
| Safety & Quality         | WARNING |
| Architecture             | PASS    |
| Pattern Consistency      | WARNING |
| Success Criteria         | PASS    |
| Simplicity & Readability | WARNING |

### Notes on the verdicts

- **Plan Adherence.** Five small drifts, each justified:
  - `pendingAdmin`'s own-role cell is `allowed`, not `noRole`'s `no-row`, because the account really holds the row.
  - The typo guard is a typed-twice confirm field rather than an echo.
  - `user-client.ts` calls the action directly, because `callAction` drops `data`.
  - The banner reads `Astro.locals` directly, as `DashboardPage.astro` already does.
  - The role is written with `insert` rather than `upsert`, which is correct for a new user.
- **Scope Discipline.** Every addition outside the plan is needed or harmless: `e2e/support/sign-in.ts` `landsOn`, `scripts/solver/lint.sh` covering `scripts/functions`, the `isInputError` stub, and the forms barrel export.
- **Success Criteria.** Re-run at review time, all green:
  - `mise run functions:check` (14 Deno tests)
  - `pnpm check` (0 errors)
  - `pnpm lint`
  - `pnpm steiger`
  - `pnpm test` (267 files, 2723 tests)
  - `pnpm format --check`
  - `pnpm build` (no key in `dist/client`)
  - Integration on the local stack: `admin-users`, `must-change-password`, `last-admin-guard`, `role-matrix` and `access-changes`, 503 of 503.

  Rows 1.2 and 6.4 are honestly pending, not rubber-stamped.

## Findings

### F1 — A re-issue that fails at the flag step cannot be retried, though its comment says it can

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/functions/admin-users/handler.ts:108
- **Detail**:
  - `updateUserById` fires `private.clear_must_change_password()`: an AFTER UPDATE OF `encrypted_password` trigger, migration :120-124. It clears the flag.
  - If the following `setPending` fails, the function answers 500 and the admin sees "Couldn't issue a new password. Try again." (`constants.ts:11`).
  - A retry then reaches `handler.ts:102`, finds `must_change_password = false`, and answers 409. The admin now sees "That person has already chosen their own password." (`constants.ts:14`), which is false.
  - The comment at :108-109 ("a retry fixes it") is wrong.
  - The account ends up unfenced, with its role live and a password nobody holds, and it can no longer be re-issued. Recovery is a reset by email (S-402), the very path this fallback exists to replace.
  - For a pending admin, `guard_last_admin()` would also start counting the account as an admin who can act.
  - No test covers it, though `failFlagWritesFor` (`admin-users.integration.test.ts:321`) could drive one.
  - Confirmed independently by the drift and safety reviews and by reading the trigger.
- **Fix A ⭐ Recommended**: Retry the idempotent `setPending` once or twice before failing. Log a distinct `flag-lost` step. Correct the comment to state the real outcome. Add an integration case with `failFlagWritesFor`.
  - Strength: Closes the gap for transient failures, which are the realistic ones. `setPending` is a single idempotent UPDATE, so retrying is safe. The test pins the behaviour.
  - Tradeoff: Adds a small loop to a handler that currently reads straight through. A persistent DB failure still leaves the same state.
  - Confidence: HIGH — the trigger semantics and the 409 path are confirmed in code.
  - Blind spot: Whether `failFlagWritesFor` can fail only the second flag write of a re-issue without also failing the first lookup is not checked.
- **Fix B**: Correct the comment only, and document the recovery (reset by email, or remove the role) in `author-provisioning.md`.
  - Strength: Smallest change. The state is safe, because nobody holds the password.
  - Tradeoff: The admin still gets a false "already chosen their own password" on retry.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A).
  - `setPending` now tries `writePending` twice, and the re-issue step is named `flag-lost`. The comment states the real outcome and the recovery.
  - `failFlagWritesFor(email, { times })` counts failures with a sequence, which a rollback does not undo.
  - Two re-issue cases were added: one lost write answers 200 and stays fenced; a persistent failure answers 500 with no password and is pinned as unfenced.
  - Deliberate-break check: with the retry removed, the one-lost-write case went red (500, log `flag-lost:db:P0001`). Restored, the suite is 26/26 and `functions:check` is clean.

### F2 — The role matrix doubled in size from line-wrapping; express each table's access pattern as a named constant

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Simplicity & Readability
- **Location**: src/test/role-matrix-expectations.ts:134 (`READS`), :361 (`WRITES`)
- **Detail**:
  - The file grew from 579 to 1025 lines. Most of that is Prettier wrapping: the sixth key pushed each one-line cell past 120 columns, so each became eight lines.
  - `READS` has 16 identical cells, and `WRITES` has 15 identical editor-only cells. The file already names such patterns for grants (`NONE`, `ALL_EIGHT`, `READ_ONLY`, `DML` at :987-1001), but not for cells.
  - CLAUDE.md requires every access change to start as a diff to this file, so its readability matters on every future access slice.
  - Deriving `pendingAdmin` from `noRole` would be wrong. They differ in three cells (`user_roles.own`, `access_changes.own`, `SELF_GRANTS["drop own role"]`), and a derivation would hide the claim.
- **Fix**: Add `ANY_ROLE` and `EDITORS` cell constants, used per table (`bundles: ANY_ROLE`), with deviating tables keeping literal cells. Turn `PRINCIPAL_NOTES.pendingAdmin`'s prose ("reaches exactly what noRole reaches") into one invariant test: wherever `noRole !== "no-row"`, `pendingAdmin === noRole`.
  - Strength: About 350 fewer lines. Each table still names its access pattern, a deviation stands out, and a future principal adds one line per constant instead of 30+ cells.
  - Tradeoff: A mechanical edit to the access-control spec file. The live matrix suite must stay at 459/459 before and after.
  - Confidence: HIGH — mirrors the file's own `GRANTS` pattern.
  - Blind spot: Not checked whether `role-matrix.integration.test.ts` relies on cell object identity anywhere. It shouldn't, but run it.
- **Decision**: FIXED.
  - Five named cells (`NOBODY`, `SIGNED_IN`, `ANY_ROLE`, `EDITORS`, `ADMIN_ONLY`) replace 64 literal cells, applied by a regex transform. The small nested maps are on one line each.
  - Only the cells that differ stay written out: `user_roles.own`, `access_changes.own`, `JOB_STOPS.own` and `SELF_GRANTS`.
  - The file is now 582 lines, down from 1025.
  - Every exported value is byte-identical before and after (JSON snapshot `cmp`).
  - New invariant in `role-matrix-expectations.test.ts`: it walks every cell in the module, so future tables are covered, and asserts `pendingAdmin === noRole` wherever noRole holds the row.
  - Deliberate-break check: giving pendingAdmin `clone_plan` turns the invariant red, naming `RPCS.clone_plan`.
  - Results: `pnpm check` 0 errors, eslint and prettier clean, the expectations test 92/92, and the live matrix 459/459.

### F3 — Four files to follow one function call, with the failure mapping written twice

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Simplicity & Readability
- **Location**: src/\_pages/users/api/invoke-admin-users.ts:41; create-account.ts; reissue-temporary-password.ts; account-error.ts:40
- **Detail**:
  - Following a create means opening `actions.ts` → `create-account.ts` (a 9-line forwarder) → `invoke-admin-users.ts` → `account-error.ts`.
  - `invoke-admin-users.ts:41` writes out `operation === "create" ? CREATE_ACCOUNT_FAILURE : REISSUE_FAILURE` again, which `account-error.ts:40` `failureOf` already holds. `toAccountError(operation, null)` returns exactly that error.
  - `AdminUsersBody.role: string | null` (:8) is wider than the schema's `AppRole | null`.
  - `AccountOperation` could be `AdminUsersBody["op"]`.
  - The 409 branch in `toAccountError` builds the same `DomainError` twice, differing only in the message.
- **Fix A ⭐ Recommended**: Keep the files, remove the duplication: `throw toAccountError(operation, null)` at :41, `role: AppRole | null`, `AccountOperation = AdminUsersBody["op"]`, and one `new DomainError("CONFLICT", create ? … : …)`.
  - Strength: Keeps the repo's per-action domain-file convention (memory: action orchestration split; `change-user-role.ts`). One source of truth for the failure wording.
  - Tradeoff: The two forwarders stay.
  - Confidence: HIGH — `toAccountError`'s default branch is exactly the duplicated expression.
  - Blind spot: None significant.
- **Fix B**: Also collapse the forwarders: export `createAccount` and `reissueTemporaryPassword` from one `admin-users-function.ts`, with the private `invoke` below them.
  - Strength: Three files instead of four, and nothing that only forwards.
  - Tradeoff: Departs from "one domain file per action" in this slice.
  - Confidence: MEDIUM — depends on how strictly you hold the per-action convention.
  - Blind spot: `invoke-admin-users.test.ts` imports would move.
- **Decision**: FIXED (Fix A, adjusted).
  - `account-error.ts` exports `accountFailure(operation)`, the one source for the failure wording. `toAccountError`'s default branch and `invoke-admin-users.ts`'s malformed-body path both use it. It is not `toAccountError(op, null)`, because `null` is documented as "unreachable".
  - The 409 branch builds one CONFLICT.
  - `AdminUsersBody.role` is `AppRole | null`.
  - `AccountOperation` stays in `account-error.ts`. Deriving it from `AdminUsersBody` would make the two files import types from each other.
  - Results: users-slice tests 90/90, `pnpm check` 0 errors, eslint and steiger clean.

### F4 — Comments in permanent files cite plan phases, and some are already stale

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Simplicity & Readability
- **Location**: .github/actions/supabase-stack/action.yml:141-146; supabase/migrations/20261109143000_must_change_password.sql:29, :116; src/test/admin-users.integration.test.ts:29; e2e/support/sign-in.ts:45
- **Detail**:
  - `action.yml` says "answers 401 … from Phase 4 on; the Phase 2 skeleton answers 200" and "the thing Phase 2 asked to measure". The skeleton no longer exists.
  - The migration says "(plan, Phase 4)" and "(plan probe P11)". The test says "(S-409 Phase 2)".
  - `sign-in.ts:45` "Every account lands on /dashboard" is now false: the new `landsOn` parameter exists because a pending account does not.
  - A plan is archived after merge, so these citations point at a document future readers won't have open (lessons.md: a comment that names a mechanism is coupled to it).
- **Fix**: State what is true now. For example: "An anonymous call answers 401; any status below 500 proves the runtime booted." Drop the phase and probe references, and say "except a pending account, which lands on /account" in `sign-in.ts`.
- **Decision**: FIXED.
  - `action.yml`'s warm-up comment now states what is true today.
  - The migration cites `handler.ts`, and gives the reason in place of "probe P11". It is not on `main`, so the comment-only edit is safe.
  - The test header drops "(S-409 Phase 2)".
  - `sign-in.ts` names the `/account` exception.
  - A grep confirms no `Phase N` or `probe P` citation is left in the touched code. Prettier and eslint are clean.

### F5 — `PASSWORD_CHANGE_PATH` and the exempt `"/account"` are two literals that must agree

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Simplicity & Readability
- **Location**: src/shared/config/role-gate.ts:10, :37
- **Detail**:
  - `PASSWORD_CHANGE_PATH = "/account"` is where a pending user is redirected.
  - `ROLE_EXEMPT_PATHS` separately lists the literal `"/account"`.
  - If one changes without the other, a pending user loops between redirects, and nothing in the types links the two.
- **Fix**: List `PASSWORD_CHANGE_PATH` in `ROLE_EXEMPT_PATHS` (keeping the one-line reason) so the redirect target is exempt by construction.
- **Decision**: FIXED.
  - `ROLE_EXEMPT_PATHS` lists `PASSWORD_CHANGE_PATH`, as it already did `ROLE_UNAVAILABLE_PATH`.
  - Its one-line reason (at most 120 columns) now names all three uses: FR-410, S-402 and S-409.
  - Config and middleware tests 53/53; prettier and eslint clean.

### F6 — Users-slice model: twin types, a constant in the wrong home, and small re-implementations

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Simplicity & Readability
- **Location**: src/\_pages/users/model/temporary-password-reveal.ts; schemas.ts:46; submit-create-account.ts:10; use-reissue-password.ts:6, :54; status-labels.ts:6; ui/UsersPage.tsx:85
- **Detail**:
  - `TemporaryPassword` `{userId, password}` and `PasswordReveal` `{email, password}` are near-twins in two files. The second is a 6-line file whose name (`temporary-password-reveal`) doesn't match its type, and the app never reads `TemporaryPassword.userId`.
  - `UNREACHABLE_MESSAGE` is exported from a form-submit module and imported by the re-issue hook. Every other message in the slice lives in `api/constants.ts`, and `use-role-change.ts:26` has a private constant of the same name with different wording.
  - `row.label.secondary ?? row.label.primary` (`use-reissue-password.ts:54`) re-implements `emailOf` (`user-rows.ts`).
  - `STATUS_LABELS.no_access` repeats `NO_ACCESS_LABEL`.
  - `reissue.confirm` returns a Promise where `roleChange.confirm` returns void, which forces `onConfirm={() => void reissue.confirm()}`.
- **Fix**:
  - Put `PasswordReveal` beside `TemporaryPassword` in `schemas.ts`, as `{ email: string } & Pick<TemporaryPassword, "password">`, and delete the 6-line file.
  - Move `UNREACHABLE_MESSAGE` to `api/constants.ts` under a create/re-issue-specific name.
  - Use `emailOf`, or add `email` to `UserRow`.
  - Use `NO_ACCESS_LABEL` in `STATUS_LABELS`.
  - Put the `void` inside the hook.
- **Decision**: FIXED.
  - `PasswordReveal` moved into `schemas.ts` beside `TemporaryPassword`, with its doc comment, and `temporary-password-reveal.ts` was deleted. Five imports were repointed.
  - `UNREACHABLE_MESSAGE` became `ACCOUNT_UNREACHABLE_MESSAGE` in `api/constants.ts`.
  - `emailOf` is now an exported function after `buildUserRows`, and the re-issue hook uses it.
  - `STATUS_LABELS.no_access` is `NO_ACCESS_LABEL`.
  - The re-issue hook's `confirm` is void over a private `send`, and `UsersPage` passes `reissue.confirm` directly.
  - Results: users-slice tests 90/90, `pnpm check` 0 errors, eslint and steiger clean.

### F7 — Function handler and parser: an unused field and five ways to format an error

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Simplicity & Readability
- **Location**: supabase/functions/admin-users/request.ts:11; handler.ts:30, :53/:93, :76, :85, :99, :106, :125, :161
- **Detail**:
  - `ParseResult.reason` is never read: the handler answers `invalid_input` regardless, nothing logs it, and the tests assert only `.ok`. That is why `readRequest` builds `{ ok: false as const }` twice.
  - Errors are formatted five ways: `code ?? status ?? "unknown"`, `code ?? status`, `code ?? "unknown"`, bare `code`, and `discard`'s own `{fn, step, code}` log.
  - `MAX_BODY_BYTES` is compared with `text.length`, which counts characters, after the whole body is read.
  - `create(ctx, …)` takes the whole context while `reissue(admin, …)` takes one client.
  - `recordAccess` lacks the return type its siblings declare.

  The handler otherwise reads well top-down. Keep the "THE ORDER IS THE DESIGN" header and the `firstFailure` step list.

- **Fix**:
  - Make `parseRequest` return `AdminRequest | null`, keeping the reasons as comments.
  - Add one `codeOf(error)` helper and route `discard` through `failure`'s log shape.
  - Rename the limit `MAX_BODY_CHARS`, or check `Content-Length` first.
  - Add `Promise<string | null>` to `recordAccess`.
- **Decision**: FIXED.
  - `parseRequest` returns `AdminRequest | null`; `ParseResult` and `refuse` are gone. `readRequest` is typed and returns `null`, and `handle` reads `request` directly.
  - All eight error sites go through `codeOf(error)`. `discard` logs through `logFailure`, the same `{fn, op, step}` line as `failure`.
  - The limit is `MAX_BODY_CHARS`, and `recordAccess` declares its return type.
  - `create(ctx)` and `reissue(admin)` are left as they are, since only create needs the session.
  - Results: `functions:check` clean (14 tests), prettier clean, and the HTTP suite 26/26 after a runtime restart. Log lines are unchanged (`flag:db:P0001`, `flag-lost:db:P0001`).

### F8 — Test helpers copied across suites; e2e and page-test boilerplate

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Simplicity & Readability
- **Location**: src/test/must-change-password.integration.test.ts:121-129, :192-194; src/test/admin-users.integration.test.ts:247, :362, :369; e2e/specs/create-account.admin.spec.ts:121-133; src/\_pages/users/ui/UsersPage.test.tsx:131-246; src/\_pages/users/model/user-rows.test.ts
- **Detail**:
  - `strongPassword` (`${randomUUID()}Aa1!`) now exists in 6 places, 3 of them added here. `signedOutClient` is in 4 files, 2 added here.
  - `linkIn`/`urlsIn` are copied from `password-recovery.integration.test.ts:168-177`.
  - The e2e helper's `{ expectRefusal }` flag only gates a wait that `readAndCloseReveal` repeats.
  - `UsersPage.test.tsx` repeats open → fill → submit five times and has a second `beforeEach` that repeats the first.
  - `must_change_password: false` was appended to 9 literals in `user-rows.test.ts`.
- **Fix**:
  - Move `strongPassword` and `signedOutClient` into `src/test/factories` and `linkIn` beside the Mailpit helper.
  - Drop `expectRefusal` and its final wait.
  - Add a `submitCreateForm(email, confirm = email)` helper and a `directoryEntry(id, email, overrides)` builder.
- **Decision**: FIXED.
  - **Helpers, one copy each.** `strongPassword` lives in `src/test/factories/strong-password.ts`, exported from the barrel; `createSignedInUser` uses it too, so the `Aa1!` literal now exists only there. `signedOutClient` sits beside `createPublishableClient` in `src/test/publishable-client.ts`. `linkIn` and `urlsIn` live in a new `src/test/email-links.ts`; `mailpit.ts` stays free of app imports.
  - **Suites repointed.** Four suites use the shared helpers: `must-change-password`, `password-recovery`, `account-self-service` and `admin-users`. The must-change-password reset test now reads `await linkIn(message)`.
  - **e2e.** `expectRefusal` is dropped, and the helper's doc says the caller asserts the outcome.
  - **`UsersPage.test.tsx`.** One file-level `beforeEach` replaces the two copies, and `submitCreateForm(email, confirmEmail = email)` replaces the five open → fill → submit sequences. `PENDING_ROW` joins `ROWS`.
  - **`user-rows.test.ts`.** An `entry(id, email, overrides)` builder replaces 11 literals.
  - **Results.** eslint and prettier clean, `pnpm check` 0 errors. Unit: 10 files and 182 tests. Integration: the 5 touched suites, 51/51.
  - **One parallel run went red**, on the pre-existing race recorded as F13; it is green on re-run. The e2e spec was not re-run here; it gets run in the final check.

### F9 — Re-issue reloads on CONFLICT, which erases its own explanation

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/\_pages/users/model/use-reissue-password.ts:11
- **Detail**:
  - `REFRESH_ON` includes `CONFLICT`, so the "already chosen their own password" toast disappears with the full-page reload, because `refreshPage()` is a hard load.
  - The sibling `use-role-change.ts:13-22` leaves `CONFLICT` out for exactly this reason, and says so.
  - Here the row's status does change after the reload, so the admin sees the new state but not why it changed.
- **Fix**: Drop `CONFLICT` from `REFRESH_ON` to match the sibling: the toast stays, and a second click gets the same answer. Or keep the reload and record why it differs from `use-role-change`.
- **Decision**: FIXED.
  - `REFRESH_ON` is now `NOT_FOUND` and `FORBIDDEN`. Its comment names each code and, like the sibling's, says why `CONFLICT` is left out.
  - The CONFLICT test now expects the toast and no reload. A new NOT_FOUND test keeps the reload path covered.
  - `UsersPage.test.tsx` passes 15/15, and lint and prettier are clean.

### F10 — Rare-path loose ends: an audit row for a rolled-back create, "no password was issued" when unsure, and an untested session revocation

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/functions/admin-users/handler.ts:61-68; src/\_pages/users/api/invoke-admin-users.ts:26 with constants.ts:9-10; src/\_pages/users/ui/ConfirmReissueDialog.tsx:34; docs/runbooks/hosted-auth-settings.md
- **Detail**:
  - **(a) Audit row after rollback.** `account_created` is recorded before the grant. If the grant fails, `discard` deletes the user, and the record stays with `target_id` set to null (`on delete set null`): "account created by <admin>" for an account that does not exist.
  - **(b) Unreachable function.** A transport failure (`FunctionsFetchError`/`RelayError`) maps to "…and no password was issued", but the function may have completed. "Check the list" softens this.
  - **(c) Old sessions after a re-issue.** Nothing tests whether a session opened with the old temporary password dies on re-issue, though the dialog promises "stops working at once". This is PLAUSIBLE: GoTrue's admin password update should log out all sessions.
  - **(d) The trigger form depends on database encryption staying off.** It was chosen because encryption is off on hosted (`hosted-check.md` item 2). If database encryption were ever enabled, a sign-in could rewrite `encrypted_password` and clear the flag, which fails open. No runbook line warns of this.
- **Fix**:
  - (a) State in the handler comment that the record is an audit of the attempt.
  - (b) For `status === null`, use "the account may have been created; check the list".
  - (c) Add one integration case: sign in with the old password, re-issue, then assert that session's `getUser()` fails.
  - (d) Add one line to `hosted-auth-settings.md`: "enabling DB encryption requires revisiting `clear_must_change_password`'s trigger form".
  - Strength: Each item is a small change. (c) and (d) turn a recalled assumption into a pinned fact.
  - Tradeoff: Four small edits across four files.
  - Confidence: MEDIUM — (c) rests on GoTrue behaviour I recall but did not run.
  - Blind spot: (c) may already hold; the test would confirm or refute it.
- **Decision**: FIXED, all four parts.
  - **(a)** A `create` comment states that `discard` cascades the rows, and that an `account_created` record stays with a null target, as the record of an attempt.
  - **(b)** A new `outcomeUnknown(operation)` covers a create whose answer never came: `toAccountError(op, null)`, and also a 200 without a password, which means the account does exist. Its wording, `CREATE_ACCOUNT_UNKNOWN`, says "may exist … re-issue its password"; a re-issue keeps "try again". A 500 keeps "no password was issued", which is true there because the function rolled back. `accountFailure` went back to being the default branch. Both unit tests were updated, and the malformed-200 case now asserts the exact message.
  - **(c)** New integration case: a session opened with the old password is live (`getUser` succeeds), then after a re-issue `getUser` fails, `updateUser({ password })` fails, and the flag stays on. GoTrue's behaviour is now confirmed, not just recalled.
  - **(d)** A paragraph in `hosted-auth-settings.md` § Passwords says the fence assumes database encryption stays off, and that the trigger must change first.
  - Results: unit 9 files and 92 tests, `pnpm check` 0 errors, eslint, prettier and `functions:check` clean.

## Found during triage

### F11 — The password uniformity test fails about 1 run in 4, and the rejection test doesn't test rejection

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/functions/admin-users/password.test.ts:35-63
- **Detail**:
  - **Flakiness, measured.** 8 of 30 runs of `deno test` failed. One failure read `5: 8865 against 8421.05`.
  - **The generator is right; the test asserts something it never promised.** A password with no digit is redrawn, which happens 2.65% of the time, so each digit's share rises by +2.74% (measured over 40,000 draws). Uppercase is −0.3% and lowercase −0.6%. The class redraw keeps the result uniform over qualifying passwords, as `password.ts` claims, but not uniform per character. That bias eats most of the test's 5% band.
  - **The comments are wrong about the alphabet.** It has 57 characters, not 56. So the expected count is ~8421, not ~8571, and `LIMIT` is 228, not 224.
  - **The rejection test passes by accident.** It feeds bytes 224..255, but bytes 224..227 are below 228 and accepted. The test passes only because those bytes map to digits 6–9, the all-digit candidate fails the class check, and the generator draws again. Rejection itself is never exercised.
  - `functions:check` runs in CI's `verify` job, so this is a flaky required gate.
- **Fix**:
  - Assert uniformity within each class (digits against digits, uppercase against uppercase, lowercase against lowercase). That is what rejection sampling plus a symmetric redraw guarantees. A modulo bias would still be caught, because it would favour `a`–`d` over the rest of the lowercase letters.
  - Correct the comments to 57 and 228.
  - Feed bytes 228..255 in the rejection test.
- **Decision**: FIXED.
  - The uniformity test now asserts flatness within each class, and its comment carries the real numbers (57, the 2.65% redraw, ~2.7% digit lift).
  - The rejection test feeds 24 bytes from 228..255, then 24 valid bytes, and asserts the exact password built from the valid ones.
  - 0 failures in 30 runs, against 8 of 30 before.
  - Deliberate-break check: with `LIMIT = 256` (no rejection), both tests go red. Restored, `functions:check` is clean.

### F12 — Edge-function edits are not served "live per request" as the README says

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (docs)
- **Location**: README.md (Supabase › Local development, "Edge Functions"); CLAUDE.md (Edge Functions)
- **Detail**: During F1's break check, under `policy = "per_worker"` the local runtime kept serving the previously loaded `handler.ts` across consecutive requests. Even a break that failed every create still passed. Only `docker restart supabase_edge_runtime_ib-timetable-planner` picked up the edit. Anyone running a break check, or iterating on the function, can be misled into a false green.
- **Fix**: Change the README line to say an edit may need the edge-runtime container restarted (`docker restart supabase_edge_runtime_<project_id>`), and to confirm the served code by its log output.
- **Decision**: FIXED.
  - The README's "live per request, so an edit to `admin-users` needs no restart" is replaced. It now explains the warm-worker behaviour, gives the restart command, and says to confirm a deliberate break by its log line.
  - CLAUDE.md's Edge Functions section gains the same rule as one bullet.
  - Prettier is clean.

### F13 — The machine-address test compares a global user count, which parallel suites change

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/test/admin-users.integration.test.ts (`refuses a machine user's address (409) and changes nothing`; `countUsers`)
- **Detail**:
  - The test asserts `countUsers()` (every row in `auth.users`) is equal before and after the call.
  - Any suite running in parallel that creates or tears down a user moves that count. CI's integration lane runs with `--maxWorkers=2`.
  - It went red once in a 5-suite parallel run during F8's check, and green on re-run, with the same code.
  - `countUsers` is also a near-duplicate of `userCountWithEmail`.
- **Fix**: Assert what "changes nothing" means for this request: exactly one account still holds the machine's address (`userCountWithEmail(machine.email) === 1`), and it still has no role. Delete `countUsers`.
- **Decision**: FIXED.
  - The assertion is scoped to the machine's address, with a one-line why, and `countUsers` is deleted.
  - The 5-suite parallel run passed 51/51 three times in a row.

## Done well (keep)

- **`handler.ts`** reads top-down like its spec. The "THE ORDER IS THE DESIGN" header records the security ordering, and `firstFailure([...])` puts each operation's steps and its single rollback point on one screen.
- **`resolveAccess` and `decideRoleGate`** are pure, and their bullet docs match their branches one to one. The flag is read only in the null-role branch, so a caller holding a role pays nothing extra.
- **`toAccountError`'s `it.each` table** works as an executable record of the function's status contract.
- **`Record<UserStatus, string>`** forces every new status to be labelled, and `canReissuePassword` is derived in `model/`, not in the table.
- **The migration** re-creates `current_app_role()` and `guard_last_admin()` from their live bodies, with only the pending condition added (diffed by the drift review). Its post-conditions are broader than planned.

## Triage outcome

| Finding | Decision |
|---------|----------|
| F1 Re-issue flag step | FIXED (Fix A): retry, `flag-lost`, comment, two tests, break-checked |
| F2 Role matrix size | FIXED: five named cells, 1025 → 582 lines, values byte-identical, `pendingAdmin ≡ noRole` invariant |
| F3 Four-file call, duplicated mapping | FIXED (Fix A, adjusted): one source for the wording, `AppRole` typing |
| F4 Plan-phase comments | FIXED: four sites state current facts |
| F5 `/account` twin literals | FIXED: `PASSWORD_CHANGE_PATH` in `ROLE_EXEMPT_PATHS` |
| F6 Users-slice model scatter | FIXED: five tidy-ups, one file deleted |
| F7 Handler/parser nits | FIXED: `AdminRequest \| null`, `codeOf`, `logFailure`, `MAX_BODY_CHARS` |
| F8 Test helper copies | FIXED: `strongPassword`, `signedOutClient`, `linkIn`/`urlsIn` shared; boilerplate trimmed |
| F9 Reload erases toast | FIXED: `CONFLICT` out of `REFRESH_ON`, NOT_FOUND test added |
| F10 Rare-path loose ends | FIXED: (a) comment, (b) `outcomeUnknown`, (c) old-session test, (d) runbook line |
| F11 Flaky uniformity test | FIXED: within-class check; 0/30 failures (was 8/30); break-checked |
| F12 Stale "live per request" docs | FIXED: README + CLAUDE.md |
| F13 Racy global user count | FIXED: scoped to the address; 3/3 parallel runs green |

### Final gate (2026-11-10, after triage)

- **Static and build:** `pnpm check` 0 errors; `pnpm lint`, `pnpm steiger` and `pnpm format --check` clean; `pnpm build` clean with no key in `dist/client`.
- **Unit:** `pnpm test` 267 files and 2726 tests.
- **Deno:** `mise run functions:check` clean.
- **Integration:** `pnpm test:integration --maxWorkers=2` 767 passed and 5 skipped (the solver suites, no `SOLVER_URL`). The role matrix is 459/459.
- **e2e:** `create-account.admin.spec.ts` passes 3 of 3 on the workerd preview.
- **Still open, outside triage:** Progress rows 1.2 and 6.4, the hosted manual steps.
