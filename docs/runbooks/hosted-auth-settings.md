# Hosted Auth settings runbook

The hosted Supabase Auth settings that account self-service (S-401) and password reset by email
(S-402) depend on. None of them can reach hosted from the repo: `supabase/config.toml` is the
**local development** config, and it is never pushed (`supabase config push` sends the whole file —
see [`solver-credential.md`](solver-credential.md#do-not-reach-for-supabase-config-push-unless-you-have-read-this)).
Some have no `config.toml` key at all, so local and CI can never reproduce them. Hosted is therefore
set and checked **by hand**, here.

Each row records what the value **implies**, not only what it is: several of these settings change
behaviour nobody chose them for (`mailer_autoconfirm` switching a rate limiter off is the example).

## Passwords (S-401)

| Management API field                                | Must be | Why                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `password_min_length`                               | `15`    | The PRD's floor (§NFG). It has to live in Auth, because the `@supabase/ssr` cookies are not HttpOnly and a user can call `PUT /auth/v1/user` around the form. The form's Zod rule is UX only. Local is `minimum_password_length = 15` (`config.toml:181`).                                                                                                         |
| `security_update_password_require_reauthentication` | `false` | "Secure password change". When on, a session older than 24 hours must supply a nonce that is **emailed** (`auth.reauthenticate()`), and the account page has no step for it. Every password change would fail. Local is `secure_password_change = false` (`config.toml:220`). The CLI's docs describe this key as "requires the current password", which is wrong. |
| `security_update_password_require_current_password` | `false` | "Require current password when updating". PRD FR-411 dropped the current-password rule: a user arriving from a reset link (S-402) cannot supply it. **No `config.toml` key exists.**                                                                                                                                                                               |

**The accepted trade-off** (FR-411): with no current-password check, anyone holding a live session —
a stolen cookie, an unlocked shared PC — can change the password and lock the owner out. The owner
then resets it at `/auth/forgot` (S-402) and gets a "your password was changed" email either way.
An admin-triggered reset stays the dashboard (**Authentication → Users**) until S-409.

In the dashboard all three sit under **Authentication → Sign In / Providers → Email** (labels as of
2026-10; the Management API field names above are the stable reference).

## Email and reset (S-402)

| Management API field                                     | Must be                                                                                                 | Why                                                                                                                                                                    | What it implies                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site_url`                                               | `https://ib-timetable-planner.dev`                                                                      | The recovery template builds its link from `{{ .SiteURL }}`, so the link domain matches the sending domain. It was the `*.workers.dev` URL before S-402.               | Every email link's host. Changing it moves every link at once.                                                                                                                                                                                                                         |
| `uri_allow_list`                                         | `https://ib-timetable-planner.dev/**,https://ib-timetable-planner.dobromir-kropielnicki.workers.dev/**` | Both hosts the app serves on. **One comma-separated string**, not a list.                                                                                              | S-402 sends no `redirectTo`, so nothing reads it yet; S-410 and S-411 will. A `redirectTo` that matches no entry silently falls back to the Referer, then the Site URL.                                                                                                                |
| `mailer_otp_exp`                                         | `3600`                                                                                                  | PRD §NFG: a reset link stops working after 1 hour.                                                                                                                     | **One lifetime for every email link** — recovery, invite, email change, magic link. Mirrored in the UI copy (`LINK_LIFETIME`, `src/_pages/password-recovery/model/recovery-policy.ts`) and in `recovery.html`: change all three together. Open Roadmap Question 2 is decided at S-410. |
| `smtp_max_frequency`                                     | `300`                                                                                                   | The per-user resend interval. GoTrue checks it **before** replacing the user's link, so it bounds how often anyone can replace a colleague's link: once per 5 minutes. | Mirrored in the copy ("request again after 5 minutes", `RESEND_INTERVAL`): change both together. A genuine re-request inside 5 minutes is silently not sent — the answer is the same neutral notice.                                                                                   |
| `rate_limit_email_sent`                                  | `30`                                                                                                    | A deliberate value, set now.                                                                                                                                           | **Dormant while `mailer_autoconfirm` is `true`**: GoTrue skips its project-wide email cap under autoconfirm (`mail.go:803-813`, marked TODO). If GoTrue ever applies it, it lands on a chosen value. Until then Resend Free's 100 per UTC day is the effective global cap.             |
| `mailer_autoconfirm`                                     | `true` (unchanged)                                                                                      | From the provisioning era: accounts are created already confirmed.                                                                                                     | It switches GoTrue's global email limiter off (row above). Turning "Confirm email" on to bring that cap back was rejected: a 30-per-hour cap is an easier denial-of-service lever than Resend's 100 per day.                                                                           |
| `security_captcha_enabled`                               | `false`                                                                                                 | Supabase's CAPTCHA also covers `/token?grant_type=password`, and its only bypass is the secret key.                                                                    | Turning it on makes every Generate fail at the solver's sign-in, and breaks the campaign runner. The reset bot check is Turnstile, verified in the Worker (`email-delivery.md`).                                                                                                       |
| `mailer_subjects_recovery`                               | `Reset your IB Planner password`                                                                        | Matches `config.toml` and the sender name "IB Planner".                                                                                                                | —                                                                                                                                                                                                                                                                                      |
| `mailer_templates_recovery_content`                      | `supabase/templates/recovery.html`, byte for byte                                                       | Supabase's default template uses `{{ .ConfirmationURL }}`, which GoTrue spends on GET — a mail scanner would spend every link before the person clicks.                | Set only through the sync below, never by editing the dashboard alone.                                                                                                                                                                                                                 |
| `mailer_notifications_password_changed_enabled`          | `true`                                                                                                  | The only signal an owner gets if someone else changed their password.                                                                                                  | One email per password change, the account page's included — it counts against Resend's daily cap.                                                                                                                                                                                     |
| `mailer_subjects_password_changed_notification`          | `Your IB Planner password was changed`                                                                  | Matches `config.toml`.                                                                                                                                                 | —                                                                                                                                                                                                                                                                                      |
| `mailer_templates_password_changed_notification_content` | `supabase/templates/password_changed_notification.html`, byte for byte                                  | GoTrue gives this template only `SiteURL`, `Email` and `Data`.                                                                                                         | Set only through the sync below.                                                                                                                                                                                                                                                       |
| `smtp_host` / `smtp_port` / `smtp_user`                  | `smtp.resend.com` / `"465"` (a string) / `resend`                                                       | Custom SMTP through Resend, set by hand on 2026-10-20 — see [`email-delivery.md`](email-delivery.md).                                                                  | Without custom SMTP the built-in mailer sends only to team addresses, 2 per hour. `smtp_pass` is a sending-only Resend key and is never read back here.                                                                                                                                |
| `smtp_admin_email` / `smtp_sender_name`                  | `team@ib-timetable-planner.dev` / `IB Planner`                                                          | The sender. The templates' product name matches it.                                                                                                                    | The apex has no MX, so a reply bounces (`email-delivery.md`).                                                                                                                                                                                                                          |

## Check them (read-only)

Needs a personal access token (dashboard → **Account → Access Tokens**). It is read-only here.

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects/hwmuiymhjgewtymymbmb/config/auth \
  | jq '{password_min_length,
         security_update_password_require_reauthentication,
         security_update_password_require_current_password,
         site_url, uri_allow_list, mailer_otp_exp, smtp_max_frequency, rate_limit_email_sent,
         mailer_autoconfirm, security_captcha_enabled,
         mailer_subjects_recovery, mailer_notifications_password_changed_enabled,
         mailer_subjects_password_changed_notification,
         smtp_host, smtp_port, smtp_user, smtp_admin_email, smtp_sender_name}'
```

The two template bodies are checked against the repo by the sync's read-back below.

The hosted GoTrue version (local runs v2.196.0, the lockfile CLI's default):

```bash
curl -s -H "apikey: <publishable key>" https://hwmuiymhjgewtymymbmb.supabase.co/auth/v1/health
```

Whether sign-up is closed, without trying to sign up (a probe sign-up would create an account if
it were open):

```bash
curl -s -H "apikey: <publishable key>" https://hwmuiymhjgewtymymbmb.supabase.co/auth/v1/settings \
  | jq '{disable_signup, mailer_autoconfirm}'
# Expect: true, true
```

## Set them

Dashboard, or the Management API by hand. The password floor:

```bash
curl -s -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  https://api.supabase.com/v1/projects/hwmuiymhjgewtymymbmb/config/auth \
  -d '{"password_min_length": 15}'
```

The S-402 values (custom SMTP is already set; see `email-delivery.md`):

```bash
curl -s -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  https://api.supabase.com/v1/projects/hwmuiymhjgewtymymbmb/config/auth -o /dev/null -w 'HTTP %{http_code}\n' \
  -d '{"site_url": "https://ib-timetable-planner.dev",
       "uri_allow_list": "https://ib-timetable-planner.dev/**,https://ib-timetable-planner.dobromir-kropielnicki.workers.dev/**",
       "mailer_otp_exp": 3600,
       "smtp_max_frequency": 300,
       "rate_limit_email_sent": 30,
       "security_captcha_enabled": false}'
```

Never turn either password toggle **on**, nor the CAPTCHA. If one is found on, turn it off and record
it below.

### Sync the templates from the repo

`supabase/templates/*` are the source of truth; this sends them byte for byte, then reads them back
and diffs. Run it from the repo root whenever a template or subject changes. Every PATCH here prints
its HTTP status — expect `HTTP 200` — because a failed one is otherwise silent.

```bash
jq -n \
  --rawfile recovery supabase/templates/recovery.html \
  --rawfile changed supabase/templates/password_changed_notification.html \
  '{mailer_subjects_recovery: "Reset your IB Planner password",
    mailer_templates_recovery_content: $recovery,
    mailer_notifications_password_changed_enabled: true,
    mailer_subjects_password_changed_notification: "Your IB Planner password was changed",
    mailer_templates_password_changed_notification_content: $changed}' \
  | curl -s -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
      https://api.supabase.com/v1/projects/hwmuiymhjgewtymymbmb/config/auth -d @- \
      -o /dev/null -w 'HTTP %{http_code}\n'

hosted=$(curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects/hwmuiymhjgewtymymbmb/config/auth)
jq '{site_url, mailer_subjects_recovery, mailer_subjects_password_changed_notification}' <<<"$hosted"
# Expect site_url with NO trailing slash, and both "IB Planner" subjects
jq -j .mailer_templates_recovery_content <<<"$hosted" | diff - supabase/templates/recovery.html \
  && echo "recovery template in sync"
jq -j .mailer_templates_password_changed_notification_content <<<"$hosted" \
  | diff - supabase/templates/password_changed_notification.html && echo "notification template in sync"
```

`jq -j` prints the string without adding a newline, so a template that matches diffs clean.

**A read-back proves what the Management API stored, not what the next email looks like**, so finish
by sending yourself a reset and reading the email itself. On 2026-10-20 the first email after the
merge still carried Supabase's default template, and the second its default subject, before both
were re-sent. The templates use `{{ .SiteURL }}` verbatim: a `site_url` with a trailing slash gives
`…dev//auth/confirm`, which production happens to normalize, so keep `site_url` slash-free.

## What goes wrong when a value drifts

- **A password toggle flipped on.** Every change on `/account` fails with a toast carrying GoTrue's
  own message, and the action answers `INTERNAL_SERVER_ERROR`. The codes are
  `reauthentication_needed` ("Secure password change") and `current_password_required` /
  `current_password_invalid` ("Require current password"). `src/_pages/account/api/unwrap-auth.ts`
  sends them to its catch-all on purpose, so this list is where such a failure gets diagnosed.
- **The floor unset or lowered.** Nothing visibly breaks: the form still refuses a short password.
  But the floor is then UX only, because a direct `PUT /auth/v1/user` gets through.
- **Existing passwords under the floor** are expected, not drift. GoTrue applies the floor when a
  password is _set_, never at sign-in, and reports the shortfall as `weakPassword`: sign-in then
  lands on `/dashboard?notice=weak-password`, whose banner points at `/account`. It shows after every
  such sign-in until the password changes.
- **The recovery template reverted to Supabase's default.** Nothing visibly breaks: the reset page
  answers with the same neutral notice whatever happens. But the email then carries a
  `{{ .ConfirmationURL }}` that a mail scanner spends on GET, so links arrive already used. Run the
  sync's read-back.
- **`mailer_otp_exp` or `smtp_max_frequency` changed alone.** The reset still works, but the notice
  and the email now promise the wrong lifetime or interval. Change `recovery-policy.ts` and
  `recovery.html` in the same change.
- **`site_url` changed.** Every email link points at the new host. If the old host stops serving
  the app, links already in inboxes fail.
- **`security_captcha_enabled` turned on.** Every Generate fails at the solver's sign-in.
- **Resend's daily cap reached.** Every reset (and later every invite) fails until midnight UTC, and
  the visitor still sees the neutral notice. Workers Logs show `[forgot-password] outcome=send-failed`.

## Last verified

Add a row after every read-back.

| Date       | Values                                                                                                                                                                                                                                                                                                                                                                                                                                          | GoTrue       | By                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------- |
| 2026-10-17 | `password_min_length` 15 (set); reauthentication `false`; current password `false`                                                                                                                                                                                                                                                                                                                                                              | not recorded | the developer, before S-401 Phase 1 (plan 1.9)                                    |
| 2026-10-20 | S-402, set and read back: `site_url` `https://ib-timetable-planner.dev`; `uri_allow_list` both hosts; `mailer_otp_exp` 3600; `smtp_max_frequency` 300; `rate_limit_email_sent` 30; CAPTCHA off; `mailer_autoconfirm` `true`; both subjects; password-changed notification on; both templates in sync (diff clean); SMTP `smtp.resend.com` / `"465"` / `resend` / `team@ib-timetable-planner.dev` / "IB Planner"; S-401's three values unchanged | v2.197.0     | the developer, right after the S-402 merge, before its deploy finished (plan 4.4) |
