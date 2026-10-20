# Email delivery runbook

How the product sends email, and how to prove it reaches a school inbox. Everything here is set by
hand — Resend, Cloudflare DNS, Supabase custom SMTP, the Turnstile widget — and recorded so the next
change finds it. The hosted Auth values that sit on top of it (Site URL, templates, the resend
interval) are in [`hosted-auth-settings.md`](hosted-auth-settings.md).

The first sender is S-402 (password reset); S-410 (invites) and S-310 (job emails) reuse it.

## Provider: Resend, through Supabase custom SMTP

Decided 2026-10-10 (`context/changes/user-managment-research/research.md`), set up by the developer
on 2026-10-20.

- **Verified domain: the apex `ib-timetable-planner.dev`**, region **eu-west-1** (the `rsend` bounce
  MX resolves to `feedback-smtp.eu-west-1.amazonses.com`). The 2026-10-10 checklist planned a
  `mail.` subdomain; the apex was used instead. The cost: any future mail sent from the apex shares
  this sending reputation, good or bad.
- **Click and open tracking: off.** Tracking rewrites links through a redirect host, which breaks the
  one-link-on-our-domain rule and looks like phishing to scanners.
- **The SMTP password is a sending-only Resend API key** scoped to this domain. It lives only in
  Supabase's `smtp_pass`; it is never committed and never reaches the Worker.

### DNS (Cloudflare zone `ib-timetable-planner.dev`)

Every record is **DNS-only (grey cloud)** — proxying a mail record breaks it.

| Record              | Type  | Value                       | Purpose                                                                                     |
| ------------------- | ----- | --------------------------- | ------------------------------------------------------------------------------------------- |
| `resend._domainkey` | TXT   | Resend's DKIM public key    | DKIM for `d=ib-timetable-planner.dev` — what DMARC passes on.                               |
| `send`              | CNAME | `send.forge.rmta.net`       | Resend's bounce / return-path domain.                                                       |
| `rsend`             | CNAME | `rsend-euw1.forge.rmta.net` | Resend's bounce / return-path domain (SES eu-west-1 SPF and feedback MX).                   |
| `_dmarc`            | TXT   | `v=DMARC1; p=none;`         | DMARC, relaxed alignment, monitoring only (below). Optionally add a `rua=` report address.  |
| `@` (apex)          | TXT   | `v=spf1 -all`               | Kept from Cloudflare's "domain sends no email" preset: the apex is never the bounce domain. |
| `*._domainkey`      | TXT   | `v=DKIM1; p=`               | Kept from the same preset: revokes every selector that has no record of its own.            |

**Copy record values from the Resend dashboard, never from this table** — Resend may issue CNAMEs
where older domains got TXT and MX, and the values can change.

- **Why DMARC is `p=none` for now.** The reset page answers the same for every outcome, so a
  rejected email is invisible to the person waiting for it. During rollout a failure must land in
  Junk with readable headers, not vanish. Cloudflare's preset (`p=reject; adkim=s; aspf=s`) made
  that worse: under strict SPF alignment the `send.`/`rsend.` bounce domains can never align, so
  DMARC rested on DKIM alone and any DKIM failure was a silent reject.
- **Tightening path.** After the M365 smoke test passes and a few weeks of clean mail, move to
  `p=quarantine`, then `p=reject`, keeping **relaxed** alignment. Never `aspf=s`: the bounce domains
  are subdomains of the apex and only align relaxed.
- **Adding another sender later** (Cloudflare Email Routing for `team@`, a second provider): merge its
  `include:` into the one apex SPF record — never a second SPF record — and give its DKIM selector
  its own explicit record, or the `*._domainkey` wildcard revokes it.

### Supabase custom SMTP

| Management API field | Value                           |
| -------------------- | ------------------------------- |
| `smtp_host`          | `smtp.resend.com`               |
| `smtp_port`          | `"465"` (a string)              |
| `smtp_user`          | `resend`                        |
| `smtp_pass`          | the sending-only Resend API key |
| `smtp_admin_email`   | `team@ib-timetable-planner.dev` |
| `smtp_sender_name`   | `IB Planner`                    |

- **The sender is `team@`, not `no-reply@`** — Resend's deliverability insights flag `no-reply@`.
- **The apex has no MX, so a reply bounces.** If replies should reach someone, Cloudflare Email
  Routing can forward `team@` later (merge its SPF `include:` as above).
- **The templates' product name matches the sender name**: "IB Planner" in both subjects and bodies.

### Caps

Supabase's own project-wide email cap is dormant while `mailer_autoconfirm` is on
([`hosted-auth-settings.md`](hosted-auth-settings.md)), so **Resend Free's 100 emails per UTC day is
the effective global cap**, shared by resets, password-changed notifications and, later, invites.
Reaching it fails every send until midnight UTC, behind the reset page's neutral notice; Workers
Logs show `[forgot-password] outcome=send-failed`. The flood guard below is what protects it. The
fallback is Resend Pro (no daily limit); AWS SES eu-central-1 is the standby provider.

## The reset flood guard: Cloudflare Turnstile

`POST /api/auth/forgot` verifies a Turnstile token in the Worker before it asks GoTrue for a reset.
It is a real gate only because the browser never holds the Supabase key (`CLAUDE.md`; the
`postbuild` check enforces it). Supabase's own CAPTCHA is ruled out — it would break the solver's
password sign-in.

- **Widget:** managed mode. **Hostnames: `ib-timetable-planner.dev` and
  `ib-timetable-planner.dobromir-kropielnicki.workers.dev`** — the Worker accepts a token only when
  Cloudflare reports the host the request came to. Never add `localhost`: local runs use Cloudflare's
  test keys instead.
- **Worker secrets** (both runtime secrets; the site key is public but would otherwise be inlined at
  build, which CI's deploy build cannot supply):

  ```bash
  pnpm exec wrangler secret put TURNSTILE_SITE_KEY
  pnpm exec wrangler secret put TURNSTILE_SECRET_KEY
  pnpm exec wrangler secret list   # names only
  ```

- **Fail closed.** A missing key makes reset _unavailable_ ("Ask your coordinator"), never unguarded.
  Cloudflare's test secrets are accepted only on a loopback host; on any other host they count as
  misconfigured, so a test secret on production cannot silently switch the check off.
- **The accepted residual:** a person who solves the check can replace one colleague's link at most
  once per 5 minutes (`smtp_max_frequency`). The PRD guardrail is worded for automated floods.

## Logs

Workers Logs redact query strings (`observability.redact_query_string`), because the confirm URL
carries a one-time `token_hash`. The reset endpoints log one line per outcome, never the address,
the token or the Turnstile response:

- `[forgot-password] outcome=<accepted|throttled|rejected-address|send-failed|unexpected> code=… status=…`
- `[forgot-password] turnstile=<refused|transient|misconfigured>`
- `[confirm-email-link] outcome=<invalid|expired|retry> type=recovery`

## Smoke test: a real school inbox (Microsoft 365)

The reset's done-line is delivery into the coordinator's M365 mailbox, which a local stack cannot
prove. Run it after the merge, on `https://ib-timetable-planner.dev`, first into a developer inbox,
then into the coordinator's. Record both, redacted, in the change's `smoke.md`.

**Pass criteria** (the recipient reads the headers in Outlook on the web: "…" → View → View message
details):

- The message is in the **Inbox**, not Junk or quarantine. Resend's "Delivered" only means the
  receiving server accepted it.
- `Authentication-Results`:
  - `spf=pass`, with smtp.mailfrom on `send.` or `rsend.ib-timetable-planner.dev` (record which;
    both align with the apex under relaxed DMARC)
  - `dkim=pass header.d=ib-timetable-planner.dev`
  - `dmarc=pass`
  - `compauth=pass reason=1xx`
- `X-Forefront-Antispam-Report`: `SFV:NSPM`, `CAT:NONE`, no `SFTY:9.19` or `9.20`. Also `BCL:0` and
  `dest:I`.
- If Safe Links wrapped the URL, the decoded `url=` keeps `token_hash` and `type=recovery`.
- **Worker Logs show pre-click HEAD and GET to `/auth/confirm` from Microsoft ranges, and no POST.**
  The token is still valid 5 minutes or more after delivery, and the human's Continue succeeds.
- Check the `Content-Type`: whether Resend's relay added a plain-text part is unverified.

If a scanner ever POSTs the Continue form before the person does, the fallback is a typed code
(`{{ .Token }}`) — a follow-up change, not a setting.

### When the message is junked (no admin help available)

- Mark it **Not junk**, and add the exact sender address `team@ib-timetable-planner.dev` to **Safe
  Senders**. Address entries are honoured even for quarantine verdicts.
- Keep a steady sending cadence: Microsoft says a new sender takes "a couple of weeks or less" to
  ramp.
- Only a tenant admin can add a Tenant Allow/Block List entry or a Safe Links "Do not rewrite" entry.
