# S-410 manual checks — what was run, and what was seen

The user delegated the plan's manual checks to the implementing session (2026-11-11). Each was run against the local stack (GoTrue v2.196.0), and for the browser checks through `pnpm build && pnpm preview` on real workerd. The driver scripts were throwaway and lived in the session scratchpad, never in the repo. This file is their record. It never names a real person: every address was a throwaway `@example.test`, deleted afterwards with its mail.

## Phase 1

| Row | Check                                     | Evidence                                                                                                                                                                                        |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.7 | Probe P1–P5                               | [`probe.md`](probe.md): all five (plus P5b) match the research; P3 reproduced the fence failing open on the old schema                                                                          |
| 1.8 | A reset email says "24 hours" and works   | Mailpit text: "The link works once, for 24 hours. If you asked more than once, only the newest email works."; link `/auth/confirm?…&type=recovery`; `verifyOtp` succeeded; browser walk confirmed by the user |

## Phase 2

| Row | Check                                                    | Evidence                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.4 | A deliberate break shows in `docker logs` and turns red  | `invite` made to skip its flag step and log `DELIBERATE-BREAK s410`; after `docker restart supabase_edge_runtime_…` the marker appeared 11 times. The suite went red on 3 cases (invite happy path, send-last rollback, revoking an accepted invitee); reverted and restarted, it went back to 42/42 |
| 2.5 | A failed invite logs `fn`, `op`, `step` only              | The failure line was `{"fn":"admin-users","op":"invite","step":"flag:db:P0001"}`. A scan of 30 minutes of runtime log (1457 lines) found 0 email addresses, 0 `token_hash`/`hashed_token`/`action_link`/`email_otp`, and 0 56-hex hashes                    |

## Phase 3 (browser, 11/11 checks)

| Row | Check                                                   | Evidence                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.5 | An invite link opens "Accept your invitation"; Continue lands on `/account` welcomed | The real function sent the invite; Mailpit link `/auth/confirm?…&type=invite`; `<h1>` and `<title>` "Accept your invitation"; no signed-in warning in a fresh browser; Continue → `/account` with "Welcome to IB Planner. Choose a password below to start using the planner."; no temporary-password banner; `/plans` bounced back to `/account` (fenced) |
| 3.6 | The same link again shows the invite-expired copy       | Continue → `/auth/confirm?error=invite-expired`: "This invitation link has expired or was already used. Ask your admin to re-send it." plus the link "Already set your password? Sign in" (`/auth/signin`); not the reset form                                           |
| 3.7 | A signed-in browser is warned, and nothing is spent      | A second invite link opened in the invitee's signed-in browser showed "You're signed in as <invitee>. Continuing signs you in as the person this link was sent to." Without pressing Continue, that link still verified in another client                               |

## Phase 4 (browser, 18/18 checks, light and dark)

| Row | Check                                                       | Evidence                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.6 | Invite → "Invited" with Re-send and Revoke; at once → wait; revoke → gone | As the e2e admin, in each theme: the page reloaded into an "Invited" row with **Re-send** and **Revoke**, Viewer in the picker, and 1 email in Mailpit. Re-send at once showed "An invitation was sent less than a minute ago. Wait a minute, then re-send." and sent nothing (still 1 email). Revoke asked "Revoke the invitation for …? Their link stops working and the account is removed."; afterwards the account was gone from the directory and the row from the reloaded page |
| 4.7 | Dialogs and statuses in light and dark                      | Screenshots, after the animations settled, of the invite dialog, the Invited row, the cooldown toast and the revoke confirmation in both themes: the destructive **Revoke invitation** button, the primary **Invite** and the outline **Create account** all follow the theme tokens. A first run had misreported the row as gone while the alert dialog hid the page from the accessibility tree; corrected |

## Phase 5

| Row | Check                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5.5 | Docs match what shipped  | A scan of CLAUDE.md, README.md, `docs/`, the PRD, the roadmap, the templates and `src/` for "72 h", "1 hour", "3600" and `otp_length = 6`. The only hits are dated records: the 2026-10-20 "Last verified" row, the PRD's amendment note and Open Question 2's original options, and the roadmap's S-402 and ORQ 2 history, now followed by "Decided". Each new claim was checked against the tests that prove it |

## Deviations recorded here

- **An invite to an address that has an account** shows its message under the dialog's email field, not as a toast (the plan's Phase 4 said "errors toast the fixed messages"). This mirrors `submitCreateAccount`, keeps the dialog open so the address can be corrected, and `invite.admin.spec.ts` relies on it. Every other refusal toasts.
- **A first password landing on `/dashboard`** moved `create-account.admin.spec.ts` in Phase 3 rather than Phase 5, so the suite never went red between phases.
