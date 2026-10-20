# S-402 hosted smoke test

Plan Phase 5. Production is `https://ib-timetable-planner.dev`, deployed from PR #162 (merged
2026-10-20 13:51 UTC, `deploy` green). Addresses, names and tokens are redacted: no production data
in the repo.

## 5.1 Developer inbox (Gmail) — 2026-10-20 — pass, on the third email

Sender authentication passed on every email (Gmail's `Authentication-Results`):

- `spf=pass`, smtp.mailfrom on **`rsend.ib-timetable-planner.dev`** (SES eu-west-1, `54.240.3.x`) —
  aligns with the apex under relaxed DMARC.
- `dkim=pass header.i=@ib-timetable-planner.dev header.s=resend` (plus SES's own `amazonses.com`
  signature).
- `dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=ib-timetable-planner.dev`.
- From `IB Planner <team@ib-timetable-planner.dev>`. `Content-Type: multipart/alternative`: the relay
  adds a `text/plain` part generated from the HTML, which settles the runbook's open question.

The content took three attempts:

| # | Sent (UTC) | Subject | Link | Verdict |
| - | ---------- | ------- | ---- | ------- |
| 1 | 14:03:44 | Supabase default "Reset your password" | `…supabase.co/auth/v1/verify?token=<redacted>&type=recovery&redirect_to=https://ib-timetable-planner.dev/` — Supabase's **default template** (`{{ .ConfirmationURL }}`, spent on GET) | **Fail.** `site_url` had applied (see `redirect_to`), the template sync had not reached the GoTrue that sent it |
| 2 | 14:29:46 | still the default | `https://ib-timetable-planner.dev//auth/confirm?token_hash=<redacted>&type=recovery` — **our template**, but a double slash: `site_url` was stored with a trailing slash | **Partial.** The reset completed end to end. A signed-out GET on `//auth/confirm` returns 200 with the Continue form (probed), so the double slash was cosmetic |
| 3 | after 14:35 | "Reset your IB Planner password" | `https://ib-timetable-planner.dev/auth/confirm?token_hash=<redacted>&type=recovery` | **Pass.** Reset completed; "Your IB Planner password was changed" arrived |

Between 2 and 3 the subjects were re-PATCHed and `site_url` re-sent without the trailing slash.

**Two tokens were pasted into a working chat** (emails 1 and 2). Both are dead: every reset request
replaces the user's previous token, and email 3 was requested after both.

**What this run taught** (folded into `docs/runbooks/hosted-auth-settings.md` the same day):

- A Management API read-back proves what was stored, not what the next email looks like. Finish
  every template change with a real reset email.
- The original sync command sent the PATCH with `> /dev/null`, so a failure was silent. Every PATCH
  in the runbook now prints its HTTP status, and the read-back checks both subjects and `site_url`.
- The templates use `{{ .SiteURL }}` verbatim, so `site_url` must not end in a slash.
- The neutral reset notice hid failure 1 from the user, exactly as the plan predicted: without this
  smoke test, every production reset email would have carried a scanner-spendable link.

## 5.2 Workers Logs

_Pending._ Expect `[forgot-password] outcome=accepted code=- status=-` and
`[confirm-email-link]` lines only on failures, with no address, token or query string in any line or
request URL (`observability.redact_query_string`).

## 5.3 Coordinator's M365 inbox

_Pending — needs the coordinator._ Criteria: `docs/runbooks/email-delivery.md` § Smoke test (Inbox
not Junk; `spf`/`dkim`/`dmarc`/`compauth` pass; `SFV:NSPM`, `CAT:NONE`; a Safe Links-wrapped URL
keeps `token_hash` and `type`; Worker Logs show pre-click HEAD/GET to `/auth/confirm` and no POST;
the token still works 5+ minutes after delivery).

## 5.4 Scanner verdict

_Pending on 5.3._ Pass, or a follow-up change for the typed-code fallback (`{{ .Token }}`).

## DMARC follow-up

_On a 5.3 pass:_ record the date to revisit tightening `p=none` → `p=quarantine` → `p=reject`, with
relaxed alignment, after a few weeks of clean mail (`docs/runbooks/email-delivery.md`).
