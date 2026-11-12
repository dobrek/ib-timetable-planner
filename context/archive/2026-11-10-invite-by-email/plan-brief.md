# Invite a colleague by email (S-410) — Plan Brief

> Full plan: `context/changes/invite-by-email/plan.md`
> Research: `context/changes/invite-by-email/research.md`

## What & Why

An admin invites a colleague by email with a role chosen up front. The colleague confirms on the scanner-safe page, chooses a password and lands with that role: read-only for a viewer. This is the milestone's north star: the PRD's primary success criterion, where the school onboards a colleague with the right access and without the developer. The admin can re-send or revoke a pending invitation. An expired or used link says "ask your admin to re-send", and an address that already has an account is refused.

## Starting Point

S-402 built the scanner-safe link flow (`/auth/confirm` plus the POST that spends a link). S-405 built the read-only viewer, and S-409 built the secret-holding `admin-users` function and the `must_change_password` fence. Two gaps remain: GoTrue writes a random password when an invite is accepted, which would lift the fence before the person chooses one, and every email link lives 1 h. Nothing in the directory, the link flow or the Users page knows about invitations yet.

## Desired End State

On `/users`, **Invite** (email plus a role, Viewer by default) sends one email whose link opens "Accept your invitation". Continue signs the person in, still fenced, and `/account` welcomes them. Their first password lands them on `/dashboard` with the role live, and their row reads Active. Pending rows read Invited, Invitation expired or Invitation accepted, and offer Re-send (60 s cooldown) and Revoke. Every email link lives 24 h with a 10-digit OTP, and the PRD guardrail is amended to match.

## Key Decisions Made

| Decision                    | Choice                                                                                                       | Why (1 sentence)                                                                                              | Source                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Link lifetime (ORQ 2)       | 24 h for every link, OTP length 10, PRD guardrail amended                                                    | GoTrue has one lifetime for every email link; this needs no new code and re-send covers the rest              | Research → Plan (user) |
| Invitee fence               | Set `must_change_password` at invite; the clear trigger fires only once `old.email_confirmed_at is not null` | GoTrue's own password write on acceptance would otherwise lift it, and an invited admin would count as active | Research               |
| Invitation state            | Mirror `invited_at` and `email_confirmed_at` into `user_directory`                                           | GoTrue is the source of truth; follows S-406's mirror pattern                                                 | Research               |
| Send order                  | `generateLink` → flag → record → grant → `inviteUserByEmail` last                                            | No live link ever exists for a half-made or unfenced account                                                  | Research               |
| "Pending" for actions       | Revoke until the person chooses a password; Re-send only while unconfirmed                                   | The admin always has a stop; GoTrue refuses re-inviting a confirmed user                                      | Plan (user)            |
| Re-invite with another role | Apply the new role (recorded `role_changed`), then re-send                                                   | What the admin typed is what the invitee gets                                                                 | Plan (user)            |
| Re-send cooldown            | 60 s, enforced in the function                                                                               | GoTrue doesn't throttle invites, and the 100/day Resend cap is shared with resets                             | Plan (user)            |
| Revoke record               | Target-less after delete; email snapshot decided jointly with S-411                                          | Keeps S-406's ids-only privacy rule                                                                           | Plan (user)            |
| Failed invite link          | "Expired or already used. Ask your admin to re-send it. Already set your password? Sign in."                 | US-401's wording, plus the honest exit for a re-clicked link                                                  | Plan (user)            |
| Role on invite              | Required (Viewer / Author / Admin)                                                                           | FR-401: the role is chosen up front; "No access" would be a dead end                                          | Plan (user)            |
| After first password        | Go to `/dashboard` (invitees and S-409 accounts)                                                             | "Lands in the app", literally                                                                                 | Plan (user)            |
| Signed-in visitor on a link | Warn on the confirm page, still allow                                                                        | Prevents a silent identity switch at no cost                                                                  | Plan (user)            |
| Public routes               | No allowlist widening                                                                                        | `/auth/confirm`, `/api/auth/` and the role-exempt `/account` already cover it                                 | Research               |

## Scope

**In scope:**

- One additive migration (three record kinds, two mirrored columns, the narrowed clear trigger), plus local Auth config at 24 h / OTP 10 and an invite template
- `admin-users` gains `invite`, `resend` and `revoke`; `reissue` refuses invitees
- The confirm page: invite copy, an invite failure state, the signed-in warning; `/account` welcome and the first password landing on `/dashboard`
- The Users page: Invite dialog, three statuses, Re-send and Revoke, per-op results and errors
- An e2e invite spec; CLAUDE.md, README, runbooks, PRD guardrail, roadmap ORQ 2
- Hosted settings and templates changed by hand, a hosted check, and the done-line demo

**Out of scope:**

- App-issued 72 h tokens and per-type lifetimes
- An email snapshot on revoke records (decided with S-411)
- Re-send for accepted-unfinished invitees, and an account-level invitation expiry
- Changes to `current_app_role()` or `guard_last_admin()` (S-408)
- Invites with "No access", bulk invites, ban or delete of confirmed accounts (S-411)
- Renaming the `password-recovery` slice, and CI changes

## Architecture / Approach

The Users page island calls an Astro Action (`requires: manage_users`), which is a courier to `admin-users`. The function checks for a live admin, looks the address up in the directory, then creates and fences the account, records and grants, and sends the email last. The email links to `/auth/confirm?type=invite` (GET, no side effects). Continue POSTs to `/api/auth/confirm`, which spends the link. GoTrue confirms the person, and the narrowed trigger keeps them fenced. On `/account` they choose a password, the trigger lifts the fence, and they land on `/dashboard` with their role. The invitee reuses the existing "pending" lever, so RLS, the last-admin guard, the middleware and the role matrix need no new state.

## Phases at a Glance

| Phase              | What it delivers                                                                                                 | Key risk                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1. Platform        | Live GoTrue probe, the migration, 24 h / OTP 10 locally, the invite template, the fence-through-acceptance suite | The probe contradicts the source-read assumptions                                |
| 2. `admin-users`   | invite / resend / revoke, with send-last rollback, cooldown and refusals, tested against Mailpit                 | The edge runtime serving stale code; check-then-delete race on revoke (accepted) |
| 3. Link acceptance | Invite type, copy and failure state, signed-in warning, `/account` welcome, first-password landing               | Regressing the recovery path S-402 proved                                        |
| 4. Users page      | Invite dialog, statuses, row actions, per-op courier and errors                                                  | Status precedence at the 24 h boundary                                           |
| 5. E2E and docs    | Invite spec, shared mail helpers, docs, PRD and roadmap updates                                                  | e2e timing around mail and fresh contexts                                        |
| 6. Hosted rollout  | Settings and templates before merge, hosted check after, the done-line demo                                      | The coordinator's M365 mailbox is outside the developer's control                |

**Prerequisites:** S-402, S-405 and S-409 done (they are). The local stack is up with the edge runtime and Mailpit, and the solver runs for the full e2e suite. A Supabase personal access token for the hosted step. The coordinator's availability for the demo.
**Estimated effort:** about 4–5 sessions over 6 phases, smaller than S-409 (no new runtime, toolchain or CI change). The bulk is the Users-page UI and tests.

## Open Risks & Assumptions

- GoTrue behaviour is read from source at v2.196.0 (local) and v2.197.0 (hosted); Phase 1's probe and Phase 6's hosted check confirm it. A contradiction stops the affected step.
- Hosted DB encryption must stay off: the fence trigger's existing assumption, unchanged here.
- The 24 h lifetime also applies to reset links. Accepted: only the newest link works and the confirm POST stops scanners.
- After a link expires, an unconfirmed invitee can still claim the account through "Forgot password" (same mailbox proof). Revoke is the account-level stop.
- The done-line depends on the school's M365 tenant (Safe Links, quarantine). Schedule it early.

## Success Criteria (Summary)

- A colleague invited as Viewer receives the email, accepts it with a deliberate click, chooses a password and lands read-only. The admin sees them as Viewer, Active. Shown on hosted against a real school mailbox.
- No path grants an invitee their role before they choose their own password, proven by the fence-through-acceptance suite and the hosted SQL check.
- Re-send, revoke, the cooldown, duplicate refusal and the expired-link copy all behave as US-401 states, covered by integration and e2e tests.
