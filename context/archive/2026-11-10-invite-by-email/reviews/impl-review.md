<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Invite a colleague by email (S-410)

- **Plan**: context/changes/invite-by-email/plan.md
- **Scope**: Phases 1–5 of 6 (Phase 6, the hosted rollout, not started)
- **Date**: 2026-11-11
- **Verdict**: APPROVED (with one warning to fix before the hosted rollout)
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Notes:

- **Plan adherence.** Every planned item for Phases 1–5 matches its contract, including every row of the function's status table, every migration post-condition and every quoted copy string. The one deviation is F6.
- **Scope.** The unplanned files were each forced by the plan's own changes or by e2e/CLAUDE.md's "second spec needs it" rule:
  - the capability matrix entries;
  - the directory trigger's column assertion;
  - the invited-user factory;
  - `RoleSelect`'s `withNoAccess`;
  - the promoted e2e helpers;
  - a middleware reason comment;
  - the deadlock retry in the suite's forced-failure helper.
- **Success criteria.** At HEAD-equivalent code:
  - `/verify` passed all nine steps;
  - the integration lane passed 791/791 with `--maxWorkers=2` and the solver up;
  - the full e2e suite passed 75/75;
  - `pnpm db:types` shows no diff, and `mise run functions:check` is clean (re-run for this review);
  - the from-scratch `db reset` ran in Phase 1.

## Findings

### F1 — A send can create an unfenced account if its target vanished in the last instant

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/functions/admin-users/handler.ts:384 (`sendInvitation`), called from `invite` (new-address path) and `resendTo`
- **Detail**: `inviteUserByEmail` creates a user when the address has none (research, "Invite, no user"). Every earlier step fails if the target has been deleted:
  - the flag write finds no directory row;
  - the record and grant inserts hit the foreign key.

  So the window is the one round-trip between the last write and the send. If a concurrent revoke, or a concurrent invite's `discard`, deletes the user inside it, the send mints a fresh user: no flag, no role, a live link. The function still answers 200 with the old id. If an admin then gives that row a role from the picker, the person lands with access without the fence. That breaks the handler's own stated invariant ("no live link ever belongs to a half-made or unfenced account").
- **Fix**: In `sendInvitation`, take the expected `userId`. If `data.user.id` differs, `discard` the stray user and return a failed step (`send:target-gone`). Pin it with a Deno-free integration case if one can be forced, or a code comment.
- **Decision**: FIXED — `sendInvitation` checks the sent user's id; a mismatch deletes the stray account and fails `send:target-gone` (500). Pinned test-first by `admin-users.integration.test.ts` ("deletes an account the send would create…"): red at 200, green after.

### F2 — The migration takes its locks in the reverse order of GoTrue's writes

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261111074135_invitations.sql:63-134
- **Detail**: The migration takes ACCESS EXCLUSIVE on `public.user_directory` (`alter table … add column`), then asks for SHARE ROW EXCLUSIVE on `auth.users` (`create or replace trigger`). A GoTrue write that the mirror or clear trigger follows takes the opposite order: it holds `auth.users`, then writes `user_directory`. Examples are a user insert, an invite acceptance, or any password change.

  If such a write lands between the migration's two lock steps, they deadlock. The GoTrue transaction started waiting first, so its 1 s deadlock check fires first, and the Auth write is aborted, not the deploy. The window is milliseconds on a school-sized project. S-409's migration used the same order without incident.
- **Fix**: Move `alter table … add column` (and its comments) below the two `create or replace trigger` statements. The triggers' SHARE ROW EXCLUSIVE on `auth.users` then comes first, and no Auth write can reach `user_directory` until commit.
  - Strength: removes the cycle entirely, and the file is not yet applied on hosted, so reordering is free. plpgsql does not resolve column references when a function is created.
  - Tradeoff: the migration must be re-verified from scratch (`pnpm exec supabase db reset`, which wipes local users again), and the header's ORDER paragraph changes.
  - Confidence: HIGH — standard lock-ordering fix; no other transaction can write `auth.users` between the trigger statements and commit.
  - Blind spot: not reproduced live; the deadlock is reasoned from lock modes, not observed.
- **Decision**: FIXED — the migration now runs function, triggers, columns, backfill, so auth.users is locked before user_directory (header ORDER and LOCKS updated). Verified from scratch (`db reset`, types unchanged) and on existing rows (pre-migration shape rebuilt in a rolled-back transaction: post-conditions pass, 5 rows backfilled, 0 disagreeing); 7 related suites 535/535.

### F3 — A re-send can re-fence an invitee who finished in the same instant

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/functions/admin-users/handler.ts:204 (`resendTo` → `setPending`)
- **Detail**: The re-send path writes the flag unconditionally after its lookup. Suppose the invitee spends the link and chooses a password between the lookup and that write. The flag is set again on a now-active account, the send then fails because GoTrue refuses a confirmed address, and the admin gets a 500. The person is sent back to `/account` to choose a password again. It is self-healing, and the window is narrow.
- **Fix**: In the re-send path, write the flag only while `email_confirmed_at is null` (the mirror now holds it), and answer `409 not_pending` when no row matches.
- **Decision**: FIXED — `resendTo` fences through `fenceUnaccepted` (one conditional write, `email_confirmed_at is null`); no row → 409 `not_pending`, which also covers a revoke landing in between. The existing re-send tests (incl. the dashboard-era flag false → true) pass through it; the race branch itself has no deterministic test.

### F4 — "Couldn't send the invitation, and nothing was created" can be untrue

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/users/api/constants.ts:24 (`INVITE_FAILURE`)
- **Detail**: The message is keyed by operation, so it also covers an invite to a pending address. There, the account already exists, and a role change and an `invitation_resent` record may have been written before the send failed (`handler.ts:204-210`). It is also untrue when `discard` itself fails on a new address. The plan quoted this wording, so the code matches the plan.
- **Fix**: Reword to "Couldn't send the invitation. Check the list before trying again." (the shape of `REVOKE_FAILURE`), and update `account-error.test.ts`.
- **Decision**: FIXED — `INVITE_FAILURE` now reads "Couldn't send the invitation. Check the list before trying again.", with a comment saying why, and `account-error.test.ts` pins that it never claims nothing changed.

### F5 — The sent / re-sent toast is never seen

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/_pages/users/ui/UsersPage.tsx (`InviteDialog` `onSent` → `refreshPage()`)
- **Detail**: The plan's toast says "Invitation sent to …" or "Invitation re-sent to …", and the page refreshes after success. `refreshPage()` is a full page load (no `ClientRouter`), so the toast goes with it, as the role change's does today. The admin never learns that an invite re-sent a pending one rather than making a new one. The row reads "Invited" either way.
- **Fix**: Accept it as the page's existing pattern; the row's status and "Changed by" line are the confirmation.
- **Decision**: ACCEPTED — the Users page's existing toast-then-reload pattern (as for a role change); the row's status and "Changed by" line are the confirmation.

### F6 — Manual checks 2.4–5.5 were run by the assistant; their evidence lives only in the session

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/invite-by-email/plan.md (Progress, Manual rows 2.4–5.5)
- **Detail**: The user delegated the manual checks, and they were performed with real evidence:
  - the deliberate break and the log scan;
  - the browser runs (11/11 and 18/18 checks, plus screenshots in light and dark);
  - the docs scan.

  None of that evidence is in the repo, except probe.md for 1.7. A later reader or `/10x-archive` sees ticked manual rows with nothing to point at. Separately, a 409 on invite lands on the email field rather than as a toast, as `submitCreateAccount` does. The e2e spec relies on that, and it is a benign deviation from "errors toast the fixed messages".
- **Fix**: Add `context/changes/invite-by-email/manual-checks.md`: per row, what was run, the result counts and the observed strings. Also record the 409-on-field deviation there.
- **Decision**: FIXED — `context/changes/invite-by-email/manual-checks.md` records, per manual row, what was run and what was seen, plus the 409-on-field and early create-account-spec deviations.
