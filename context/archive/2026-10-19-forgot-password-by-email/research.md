---
date: 2026-10-20T10:14:29+02:00
researcher: Claude (Opus 5.5)
git_commit: cc0f9387596f8c8039e3059478ba9d36ff2aed8f
branch: main
repository: dobrek/ib-timetable-planner
topic: "S-402 forgot password by email: feasibility, challenges, options, and the email provider"
tags: [research, codebase, auth, supabase-auth, gotrue, password-reset, recovery, smtp, resend, turnstile, captcha, rate-limits, safe-links, m365, deliverability, middleware, e2e, mailpit, S-402]
status: complete
last_updated: 2026-10-20
last_updated_by: Claude (Opus 5.5)
---

# Research: S-402 forgot password by email — feasibility, challenges, options

**Date**: 2026-10-20T10:14:29+02:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: `cc0f938`
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

S-402 (`forgot-password-by-email`, roadmap [`:150-162`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/context/foundation/roadmap.md#L150-L162)):

- Check whether it is feasible, and what the challenges are.
- List the options.
- Suggest an email provider.

**Scope agreed with the author.**
- The provider stays **Resend**, decided on 2026-10-10. It is not compared again.
- Nothing has changed on the school side:
  - US storage under a DPA is accepted;
  - no help from school IT is expected;
  - free tiers are preferred.

**Sources.**
- Three parallel research passes: the codebase; Supabase Auth, read from the GoTrue source at `v2.196.0` and `master`; and Microsoft 365 link scanning and deliverability.
- Two live read-only probes of hosted Auth, made on 2026-10-20 with the publishable key.

## Summary

**Feasible, and no platform blocker exists.**
- S-402 needs no secret key, no new runtime and no migration. The publishable key the Worker already holds can request a recovery email and verify the link.
- The work is:
  - two public pages and two API routes;
  - one email template;
  - a sign-in link;
  - a bot check;
  - tests that read mail from Mailpit;
  - a set of hosted settings changed by hand, recorded in the runbook.
- Rough size: **M**.

**Four challenges decide the design.**

1. **A flood of reset requests is a real attack, and Supabase settings alone cannot stop it.** This is the main finding.
   - Every new reset request **replaces** the user's previous link. Requesting a reset for one known staff address every 61 s therefore keeps that person from ever finishing a reset.
   - The same loop exhausts Resend's free **100/day** in under two hours. After that, every reset fails until midnight UTC.
   - **Live probe:** hosted runs with `mailer_autoconfirm: true`. In that state GoTrue never applies its project-wide email limit (`mail.go:803-813`), so no Supabase-side cap exists today.
   - **Supabase's own CAPTCHA is out.** It covers every password sign-in, and the only bypass is the secret key. Turning it on would break the production solver's sign-in and the campaign runner.
   - **The defence that fits is an app-level gate**, because the publishable key never reaches the browser and the app's reset endpoint is the only practical way in:
     - Cloudflare Turnstile, verified in the Worker;
     - a longer per-user resend interval;
     - responses that reveal nothing about which accounts exist.
2. **Microsoft Defender Safe Links opens links in mail before the person does.**
   - It sends HEAD and GET requests, and it runs the page's JavaScript in a real browser.
   - The link must therefore point to an app page that only **renders** on GET and HEAD. The token is spent only by a native `<form method="post">` button.
   - Never use the default `{{ .ConfirmationURL }}`. It spends the token on GET.
   - No report was found of Safe Links pressing a plain HTML submit button.
3. **`@supabase/ssr` forces PKCE on the server client.**
   - The default `?code=` link only works in the browser that made the request, and only for 5 minutes, because the flow state expires.
   - The template must carry `{{ .TokenHash }}` and the app must call `verifyOtp`. That works across devices, and the PKCE prefix does not matter to it.
4. **The link lifetime question (Open Roadmap Question 2) does not really block S-402.**
   - One platform setting governs every email link.
   - S-402 can ship on today's 1 hour, which meets the PRD as written. S-402's code is the same under options (a), (b) and (c), so the choice can move to S-410.

**Recommended option set** (decisions for `/10x-plan` are listed under [Open Questions](#open-questions)):

| Concern | Recommendation |
|---|---|
| Link flow | Template `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`. GET and HEAD render one POST button. `POST /api/auth/confirm` calls `verifyOtp({ token_hash, type: "recovery" })` and then redirects with 303 |
| Set-password step | Land on the existing `/account` page with a `?notice=recovery` banner. The recovery link is already a full sign-in |
| Flood guard | Turnstile verified in the Worker on `POST /api/auth/forgot`. Hosted `smtp_max_frequency` raised from 60 s to about 300 s. One neutral response for every outcome, with the real outcome logged server-side. Never turn on Supabase CAPTCHA |
| Link lifetime | 1 h (`mailer_otp_exp = 3600`, to be checked on hosted). Defer the decision on Open Roadmap Question 2 to S-410 |
| Typed code | Not in v1. Add `{{ .Token }}` only if the M365 smoke test shows the POST being spent before a human acts |
| Provider | **Resend**, as decided: domain `mail.ib-timetable-planner.dev` in eu-west-1, Supabase custom SMTP. The 2026-10-10 checklist needs four amendments ([§ 10](#10-email-provider-resend-as-decided)) |
| Site URL | Change it from the `*.workers.dev` URL to `https://ib-timetable-planner.dev` |

## Detailed Findings

### 1. Platform fit: what S-402 needs and what it does not

- **No secret key.**
  - `resetPasswordForEmail` (`POST /recover`), `verifyOtp` (`POST /verify`) and `updateUser({ password })` all accept the publishable key.
  - This keeps the decision of record intact ([`deploy-plan.md:141`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/context/deployment/deploy-plan.md#L141)).
- **The publishable key is server-only.**
  - Both Supabase variables are `context: "server", access: "secret"` ([`astro.config.mjs:77-78`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/astro.config.mjs#L77-L78)).
  - There is one client factory, and it only runs on the server ([`src/shared/api/supabase.ts:6-28`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/src/shared/api/supabase.ts#L6-L28)).
  - Nothing in `src/` uses `astro:env/client`, `PUBLIC_*`, `createBrowserClient` or `define:vars`.
  - A grep of the built `dist/client` finds no `sb_publishable`, no `supabase.co` and no `127.0.0.1:54321`.
  - **The browser never talks to GoTrue.** The flood guard in § 4 depends on that, so it should be pinned by a test.
- **PKCE is forced.**
  - `createServerClient` spreads `options.auth` and then sets `flowType: "pkce"` (`node_modules/@supabase/ssr/dist/main/createServerClient.js:36-37`, ssr 0.12.7).
  - `resetPasswordForEmail` on this client sends a code challenge. GoTrue then writes a `flow_state` row and stores the token as `pkce_<hash>` (GoTrue `recover.go:59-63`, `mail.go:409`).
- **The cookie session after verification works with the S-401 password form unchanged.**
  - `verifyOtp` yields an aal1 session with AMR `otp` (GoTrue `verify.go:285`).
  - `Session.IsRecovery()` counts `otp`, so the current-password rule would be skipped even if it were on (`api/user.go:173-186`).
  - The hosted toggles stay off ([`hosted-auth-settings.md:12-16`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/docs/runbooks/hosted-auth-settings.md#L12-L16)).
- **Versions.**
  - Hosted GoTrue is **v2.197.0** (live probe, 2026-10-20); the runbook's "Last verified" row has "not recorded". Local is v2.196.0.
  - `@supabase/supabase-js` 2.116.0, `@supabase/ssr` 0.12.7, `astro` 7.3.2, `supabase` CLI 2.117.0.

### 2. Flow options

| | Flow | Scanner-safe | Cross-device | Verdict |
|---|---|---|---|---|
| A | PKCE: default `{{ .ConfirmationURL }}` → `/auth/v1/verify` → `?code=` → `exchangeCodeForSession` | **No.** A GET on `/verify` spends the token (`verify.go:120-226`) | **No.** The exchange needs the verifier cookie (`token.go:230-251`), and the flow state dies 300 s after the request (`models/flow_state.go:210-215`) | Rejected |
| B | `{{ .TokenHash }}` → app page → POST → `verifyOtp({ token_hash, type: "recovery" })` | **Yes**, if GET and HEAD only render | **Yes.** An exact `token_hash` lookup, with no verifier and no flow state (`verify.go:643-697`) | **Recommended** |
| C | `{{ .Token }}`, a 6–10 digit code typed into a form → `verifyOtp({ email, token, type: "recovery" })` | **Strongest**: there is no URL to fetch | Yes | Optional fallback ([§ 3](#3-scanner-safety-microsoft-365)) |
| D | B and C in one email | Same as B for the link | Yes | The link and the code are the same one-time secret, so spending one burns the other |

**Details that matter for B:**
- `{{ .TokenHash }}` includes the `pkce_` prefix, and the template passes it through as is (`templatemailer.go:343`).
  - Sending `email`, `phone` or `redirect_to` with a `token_hash` returns 400 `validation_failed` (`verify.go:83-87`).
  - This is verified from the source but not probed. Probe it once on the local stack before planning ([Open Question 7](#open-questions)).
- **Single use.** Verifying clears the token (`models/user.go:659-666`). **Every new `/recover` replaces the previous token** (`one_time_token.go:135-138`).
- **Errors.** An expired link, a used link and one that never existed all return the same 403 `otp_expired`, "Email link is invalid or has expired" (`verify.go:662-665, 691-693`).
  - So there is one UX for all of them: "This link has expired or was already used", plus "Send a new link".
  - A banned user gets 403 `user_banned` (`verify.go:669-671`).
- The Supabase SSR docs recommend `token_hash` + `verifyOtp`, but their example verifies **in a GET handler**, which is the scanner hazard. Supabase's own "Option 2" (a page with a button) puts `{{ .ConfirmationURL }}` in the button's link. A scanner that renders the page and follows its links spends it.
  - Follow neither verbatim.
  - The page must contain no `href` that carries the token.

**Avoidable cookie noise.**
- `resetPasswordForEmail` on the forced-PKCE client writes a code-verifier cookie to the requester's browser, and that cookie is never used in flow B.
- A plain `supabase-js` `createClient` with `flowType: "implicit"` and `persistSession: false`, used only for the `/recover` call, would avoid both the cookie and the `flow_state` row.
- It is optional, and the plan decides.

### 3. Scanner safety (Microsoft 365)

**What scanners do** (sources in the M365 research pass):
- Safe Links scans URLs **before delivery**, whether or not it rewrites them, and again at click.
- URLs without a reputation are detonated in the background, and a brand-new domain has no reputation. https://learn.microsoft.com/en-us/defender-office-365/safe-links-about
- "Wait for URL scanning" is on in the Built-in, Standard and Strict presets, which adds some delivery latency. The Built-in preset does **not** rewrite URLs by default, so links can look untouched and still be scanned.
- Practitioners have observed HEAD before GET from Microsoft address ranges.
  - In one documented Supabase case, a `/auth/confirm` route spent the token on **HEAD** because the framework treated HEAD as GET. https://alexvwilson.com/blog/the-scanner-clicked-first
- Since about January 2025 the scanners render pages in a Chromium-class browser, **run JavaScript and send any POST that the JavaScript fires**. Scripted "click" claims exist.
  - https://berthub.eu/articles/posts/shifting-cyber-norms-microsoft-post/
  - https://news.ycombinator.com/item?id=42632337
- **No report was found of a native `<form method="post">` with a plain submit button being submitted.** All the counter-claims involve JavaScript handlers.
- Mimecast turned on pre-delivery holds for every customer on 2025-11-18. Proofpoint and Barracuda also sandbox links.

**Rules for `/auth/confirm` that follow from this:**
- GET and HEAD have no side effects and render one native POST form.
  - The token is in a hidden field.
  - No input fields, no JavaScript on the page, no auto-submit, no `meta refresh`, no Refresh header, no JavaScript redirect.
- No link on the page contains the token.
- Headers: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`. Load no third-party resources, so **no Turnstile on this page**.
- The POST endpoint must not answer GET or HEAD with the handler. Export only `POST` from the Astro route, and probe what Astro 7 returns for GET and HEAD ([Open Question 7](#open-questions)).
- The token goes in the **query string, never the fragment**.
  - Safe Links encodes the original URL into `url=` and keeps the query.
  - It double-encodes or drops `#…`.
  - A ~150-character URL is far below Outlook's limits.

**Typed code: a fallback, not v1.**
- A code has no URL, so it is the strongest pattern.
- It does not rescue a link a scanner already spent, because the code and the link are the same secret.
- It adds a brute-force target. GoTrue limits it **only per IP** (`rate_limit_verify`, 30 per 5 min), and **there is no per-code attempt counter** in v2.196.0 or `master`.
- Behind the Worker every user shares that IP bucket ([§ 4](#4-flood-resistance-the-main-challenge)). An attacker guessing codes through the app would also block every genuine link verification.
- Recommendation: ship the link-only POST, and keep the code (with Turnstile on the code form) as the path to switch to if the smoke test shows a spent POST.

### 4. Flood resistance (the main challenge)

The PRD guardrail ([`prd.md:126-127`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/context/foundation/prd.md#L126-L127)): *"A flood of password-reset requests cannot prevent a genuine staff member from resetting their own password."*

**How `/recover` behaves** (GoTrue `v2.196.0`; `master` is identical; hosted runs v2.197.0):
- **Unknown address:** returns 200 `{}` immediately and sends nothing (`recover.go:52-56`). Random addresses cost the attacker nothing and the school nothing.
- **Known address:**
  1. The per-user frequency check runs **before** the token is replaced: `validateSentWithinFrequencyLimit(u.RecoverySentAt, config.SMTP.MaxFrequency)` (`mail.go:402`). The default is 60 s, under the Management API name `smtp_max_frequency`.
  2. Then comes the project-wide limiter, **but only when `!config.Mailer.Autoconfirm`** (`mail.go:803-813`, with the comment "TODO(km): Deprecate this behaviour - rate limits should still be applied to autoconfirm").
  3. Then the token is replaced and the mail is sent.
- **Live probe (2026-10-20):** hosted `GET /auth/v1/settings` returns `mailer_autoconfirm: true` and `disable_signup: true`. So **Supabase applies no global email cap on hosted today**, and `rate_limit_email_sent` is a dormant setting.
- **Per-IP buckets** exist: `/recover` 30 per 5 min, `/verify` 30 per 5 min, `/token` 150 per 5 min with a burst of 30.
  - GoTrue sees the **Worker's** address, because every Auth call is server-side.
  - `Sb-Forwarded-For` is honoured only with a secret key.
  - So all users share each bucket. Thirty requests through the app empty `/recover` for everyone.
  - The sign-in path already has this property today. S-402 extends it to two more buckets.

**The attack.**
- Request a reset for one **known** staff address every 61 s.
  - Each request **replaces** the victim's link. With "wait for URL scanning" delaying delivery, the victim may never hold a live link long enough to use it.
  - It also exhausts **Resend's free daily cap of 100**, counted per UTC day, in about 100 minutes. After that every reset, and later every invite, fails with GoTrue's 500 "Error sending recovery email" until midnight UTC.
- With K known addresses, the cap is gone in about 100/K minutes.
- Resend allows 10 requests per second per team. Pro costs $20/month for 50,000 emails with "No daily email limit".

**The options.**

| # | Option | Stops link replacement? | Stops the daily cap being exhausted? | Cost | Verdict |
|---|---|---|---|---|---|
| F1 | Raise hosted `smtp_max_frequency` to about 300 s | **Bounds it.** At most one new link per 5 min per person (the check runs before the token is replaced) | Partly: at most 12 per hour per address | Zero code; one hosted value. A genuine "send again" waits 5 min | **Adopt** |
| F2 | **Turnstile verified in the Worker** before `/recover` | Yes, against automation | Yes, against automation | Small: a widget in a native form, `siteverify` in the route, a new Worker secret, test keys in CI | **Adopt** |
| F3 | Per-IP or per-email throttle in front of `/api/auth/*` (Cloudflare WAF rate-limiting rule or Workers rate-limiting binding) | Against a human solving Turnstile | Yes | Infrastructure. The WAF covers the custom domain only, so `*.workers.dev` bypasses it. Fetch current Cloudflare docs before writing any config | Optional hardening; it would also cover the existing shared sign-in bucket |
| F4 | Resend Pro ($20/month) | No | Yes | Money | Only if a flood is ever observed |
| F5 | Send Email Hook with per-recipient budgets | **No.** A dropped send still replaces the token (`mail.go:425-434`) | Yes | High: a public signed webhook and a new failure mode (5 s budget, then 422/500) | Rejected |
| F6 | Supabase Auth CAPTCHA | Yes | Yes | **It breaks production**: it covers `/token?grant_type=password` (`middleware.go:278-301`) and its only bypass is a `service_role` JWT, i.e. the secret key | **Rejected** |
| F7 | Turn on "Confirm email" (`mailer_autoconfirm=false`) to bring back Supabase's global cap | No | **Worse**: a 30/h cap becomes an easier DoS lever than Resend's 100/day | One toggle | Rejected. Still set `rate_limit_email_sent` to a deliberate value now, so that the GoTrue TODO landing changes nothing silently |

**F6 in detail: who signs in with a password.**
- These callers would all need a captcha token:
  - the CP-SAT solver, which `POST`s `/auth/v1/token?grant_type=password` with the publishable key at boot and every 3000 s ([`services/solver/src/cpsat_service/supabase.py:123-140`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/services/solver/src/cpsat_service/supabase.py#L123-L140));
  - the calibration campaign runner, through the app's sign-in route (`bench/campaign/http-client.ts:87-100`);
  - the app's own sign-in (`src/pages/api/auth/signin.ts:14`);
  - e2e setup;
  - `createSignedInUser`;
  - two integration suites.
- Hosted CAPTCHA would make **every Generate fail** at the container's sign-in.

**Recommended combination: F2 + F1, plus neutral responses.**
- `POST /api/auth/forgot` verifies Turnstile and then calls `/recover`.
- It answers with the **same** redirect and copy for every outcome: success, unknown address, 429 frequency, `email_address_invalid` and 500.
  - These four non-success responses occur only for real accounts, so letting any of them through would reveal which addresses exist.
  - Log the real GoTrue outcome server-side, so an exhausted quota shows up in Cloudflare observability.
- The guard **depends on the publishable key staying server-only**. Pin that with a build check that `dist/client` contains no `sb_publishable_`, and a CLAUDE.md rule.

**Residual risks.**
- A human who solves Turnstile once every 5 minutes can still replace a victim's link at that rate. The victim then has about a 5-minute window per link.
- Admin recovery remains the dashboard until S-409.
- Because a reset link is a sign-in, a compromised mailbox means a compromised account. That is inherent to email reset.
  - A password-changed notification (`mailer_notifications_password_changed_enabled`) would at least tell the owner. It is optional and costs one email each time.

### 5. Email link lifetime (Open Roadmap Question 2) for S-402

- **Still one setting.** `mailer_otp_exp` governs confirmation, recovery, magic-link, email-change and invite links (`verify.go:675-689`). Expiry counts from `recovery_sent_at`.
  - No per-type expiry exists in v2.196.0, `master` or the Management API. `master` adds a `one_time_tokens.expires_at` column behind an experimental flag that "ships dark".
  - Going above 86,400 s is still "strongly discouraged" and possible only through the Management API.
  - Local is `otp_expiry = 3600` ([`supabase/config.toml:221`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/supabase/config.toml#L221)). The hosted value needs a personal access token to read and has not been checked.
- **S-402's code is the same under (a), (b) and (c).**
  - (a) and (c) change one hosted value and one sentence of the template.
  - (b) adds S-410 code and leaves the reset untouched.
  - So S-402 can ship on 1 h, which **meets the PRD guardrail as written** ([`prd.md:125`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/context/foundation/prd.md#L125)). The question then blocks only S-410.
- Proposed roadmap edit: S-402's unknown goes from "Block: yes" to "Block: no; S-402 ships at 1 h; decided at S-410". The author decides.

### 6. Where the "set a new password" step lives

| Option | What it is | Cost | Notes |
|---|---|---|---|
| S1 | `POST /api/auth/confirm` → 303 to `/account?notice=recovery` → a banner "You're signed in from a reset link — choose a new password below" above S-401's form | Smallest: a banner and a notice reader | No cross-slice import, because the handoff is a redirect. It still works after S-403, since a user with no role can reach `/account` (FR-410). The S-401 form only shows a toast after success; that is acceptable |
| S2 | A dedicated gated page (session required, so no allowlist entry) with its own form | Promote the password schema ([`src/_pages/account/model/schemas.ts:13-51`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/src/_pages/account/model/schemas.ts#L13-L51)) and the form out of `_pages/account` (steiger forbids cross-slice imports) | Its copy fits a reset better. S-409's forced change and S-410's accept-invite will want a similar page |

- **Recommendation: S1.**
  - Per `ui-conventions.md:117`, promote at the second consumer. S-409 and S-410 are the consumers who would make S2 pay off.
- **Watch `unwrapAuth`'s promotion note** ([`unwrap-auth.ts:17`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/src/_pages/account/api/unwrap-auth.ts#L17)).
  - The S-402 routes map outcomes to **redirects** (neutral for `/recover`; "expired or used" for `/verify`), not to `DomainError`s.
  - So S-402 may not be the "second caller" that note anticipated. The plan decides; do not promote by reflex.

### 7. Codebase integration map

**Routes.**
- **The middleware allowlist must widen, for the first time since sign-in** ([`src/middleware.ts:7-15`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/src/middleware.ts#L7-L15)).
  - `PUBLIC_PATHS` is an exact match. Add `/auth/forgot` and `/auth/confirm`, each with a one-line reason (PRD [`:272-273`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/context/foundation/prd.md#L272-L273); `stack-assessment.md:326-328`).
  - `/api/auth/*` is **already public** through its prefix. Any new endpoint there is public without anyone deciding so. Note that in the route's comment, and cover it in `auth-guard.spec.ts`.
- **API routes, not Actions.**
  - `defineDomainAction` always calls `requireSession` (`define-domain-action.ts:18`), so a public Action would need a new variant.
  - [`lessons.md:23`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/context/foundation/lessons.md#L23) reserves API routes for auth session endpoints. Both new endpoints belong there: `POST /api/auth/forgot` and `POST /api/auth/confirm`.
  - Astro's default `checkOrigin: true` refuses cross-origin form POSTs (`node_modules/astro/dist/core/app/origin-check.js:8-22`), so CSRF protection comes free.
- **Sign-in page.**
  - Add a "Forgot password?" link. `FormField` has an unused `hint` slot (`src/_pages/sign-in/ui/FormField.tsx:15,61-68`); a plain `<a>` in `SignInPage.astro` also works.
  - Do not break `e2e/auth.setup.ts:26-36`, which finds the field with `getByLabel("Password", { exact: true })` and finds "Show password".
  - `signin.astro` reads only `?error=` today ([`src/pages/auth/signin.astro:5`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/src/pages/auth/signin.astro#L5)). It may need a `?notice=` channel, following the precedents `/dashboard?notice=weak-password` and `/account?saved=name`.
  - A signed-in visitor to `/auth/signin` is not redirected today. That matters little here.
- **`PasswordInput`** is shared already (`src/shared/ui/password-input.tsx`), and S-401 promoted it explicitly "for the reset page (S-402)".
- **Slice.**
  - Either a new `_pages/<password-recovery>` slice for the forgot and confirm UIs and their pure model (outcome → neutral redirect, the confirm `type` allowlist), or an extension of `_pages/sign-in`.
  - There are 10 page slices against steiger's threshold of 20.
  - Design `/auth/confirm` so that S-410 can add `type=invite` and S-411 `email_change` through an allowlist. S-402 accepts only `recovery`.
- **Turnstile.**
  - The site key would be the app's **first client-visible env value**: `envField … context: "client"`, or a server-rendered attribute. Verify the Astro 7 API first.
  - The secret goes in as an `astro:env` server secret ([`astro.config.mjs:75-88`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/astro.config.mjs#L75-L88)) via `wrangler secret put`. **Never run `wrangler types`.**
  - There is no CSP today, so `challenges.cloudflare.com` needs no header change.
  - Implicit rendering inside a native `<form>` adds the `cf-turnstile-response` field, which keeps the sign-in page's native-form progressive-enhancement pattern.

**Configuration.**
- **Local `config.toml`** (HC Fix 4, [`health-check.md:323-342`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/context/foundation/health-check.md#L323-L342)):
  - `site_url` is `http://127.0.0.1:3000` and the redirect allowlist entry is `https://127.0.0.1:3000` ([`:154-156`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/supabase/config.toml#L154-L156)). Both are a dead port, and the second is https. Playwright runs on `http://localhost:4321`.
  - Rename `[inbucket]` to `[local_smtp]`.
  - Add `[auth.email.template.recovery]` with `content_path = "./supabase/templates/recovery.html"`.
  - `email_sent = 2` per hour (`:183`) **does not bind locally**: `enable_confirmations = false` means autoconfirm, so the global limiter is skipped. `max_frequency = "1s"` (`:217`) suits tests.

**CI.**
- `mailpit` is excluded from the stack ([`.github/actions/supabase-stack/action.yml:45`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/.github/actions/supabase-stack/action.yml#L45)). Re-include it (HC Fix 6, `health-check.md:379-381`), or the reset suites pass locally and fail in CI.

### 8. Hosted settings, all by hand (never `config push`)

**What the live probe found** (2026-10-20, read-only, publishable key): `mailer_autoconfirm: true`, `disable_signup: true`, `external.email: true`, GoTrue `v2.197.0`.

**Read with a personal access token first** (`GET /v1/projects/hwmuiymhjgewtymymbmb/config/auth`):
- `site_url`, `uri_allow_list`
- `mailer_otp_exp`, `smtp_max_frequency`, `rate_limit_email_sent`
- `security_captcha_enabled`
- `mailer_subjects_recovery`, `mailer_templates_recovery_content`

| Management API field | Target | Why |
|---|---|---|
| `smtp_host` / `smtp_port` / `smtp_user` / `smtp_pass` | `smtp.resend.com` / `465` / `resend` / a Resend key scoped to sending on this domain | Custom SMTP. The built-in mailer refuses non-team addresses and sends 2 per hour |
| `smtp_admin_email` / `smtp_sender_name` | An address on `mail.ib-timetable-planner.dev`; "IB Timetable Planner" | See § 10 on `no-reply@` |
| `site_url` | `https://ib-timetable-planner.dev` | It is the workers.dev URL today ([`deploy-plan.md:163`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/context/deployment/deploy-plan.md#L163)). The template builds the link from `{{ .SiteURL }}`. A cross-device token_hash means the request host does not matter |
| `uri_allow_list` | The custom domain and the workers.dev host (`/**` globs) | A non-allow-listed `redirectTo` silently falls back to the Referer, then the Site URL (`utilities/request.go:75-89`) |
| `mailer_subjects_recovery` / `mailer_templates_recovery_content` | From `supabase/templates/recovery.html` | Pushed through the Management API |
| `mailer_otp_exp` | `3600` | PRD 1 h. See § 5 |
| `smtp_max_frequency` | about `300` | F1 |
| `rate_limit_email_sent` | A deliberate value, e.g. 30 | Dormant while autoconfirm is on. It future-proofs against the GoTrue TODO |
| `security_captcha_enabled` | `false`, with the reason recorded | F6 would break the solver |
| `security_update_password_require_*` | `false` (unchanged) | S-401 |
| Worker secret `TURNSTILE_SECRET_KEY` + Turnstile widget hostnames | The custom domain and workers.dev | F2 |

**Runbook.** Extend [`docs/runbooks/hosted-auth-settings.md`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/docs/runbooks/hosted-auth-settings.md) with these rows and a GoTrue-version column. Its "Last verified" row already has "not recorded" for GoTrue.

### 9. Testing

- **Unit:**
  - the neutral-outcome mapping, so every `/recover` result yields the same redirect;
  - the confirm `type` allowlist;
  - the Turnstile verification wrapper.
- **Integration** (local stack and CI):
  - an unknown address returns 200 and Mailpit gets nothing;
  - a real user's mail arrives in Mailpit (`GET :54324/api/v1/messages`). It carries `/auth/confirm?token_hash=…&type=recovery`, and nothing beyond the product name and the link;
  - `verifyOtp` with that hash from a **fresh** client succeeds, which proves cross-device;
  - a second verify returns `otp_expired`;
  - `updateUser` enforces 15 characters and revokes other sessions. GoTrue does that itself (`models/user.go:457-463`).
  - `admin.generateLink({ type: "recovery" })` can produce a hash without sending mail, for cases that do not need the template.
  - No Mailpit client exists in the repo today.
- **E2E:**
  - request → neutral notice → open the link from Mailpit → **GET and HEAD the page several times** (a simulated scanner) → press Continue → `/account?notice=recovery` → set a password → sign in with it;
  - `auth-guard.spec.ts` checks that `/auth/forgot` and `/auth/confirm` are reachable signed out, and that `GET /api/auth/confirm` has no effect.
  - Constraints from [`e2e/CLAUDE.md`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/e2e/CLAUDE.md):
    - never submit the shared author's password form, so a **throwaway user** is needed. This would be the first e2e use of the service-role key from Node. CI exports it, and locally it comes from `.env.test.local`.
    - only `auth.setup.ts` drives the sign-in UI.
  - Turnstile test keys go into `.dev.vars` **before** the build (the snapshot rule): sitekey `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.
- **Hosted smoke test** (the roadmap blocker): the coordinator's school M365 inbox. Pass criteria are in § 10.

### 10. Email provider: Resend (as decided)

The decision stands ([`user-managment-research/research.md:569-625`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/context/changes/user-managment-research/research.md#L569-L625)):
- Resend, with domain `mail.ib-timetable-planner.dev` in **eu-west-1**.
- Supabase custom SMTP on `smtp.resend.com:465`.
- Tracking off.
- AWS SES eu-central-1 as standby.
- Shared with S-310.

**Live DNS (2026-10-20):** no records exist for `mail.`, `send.mail.`, `resend._domainkey.mail.` or `_dmarc`. The apex has only a Google site-verification TXT. **Setup has not started.** It can start now; it needs no code.

**Amendments to the 2026-10-10 checklist:**
1. **DNS record types.**
   - Resend domains created after August 2026 may be given **CNAME** records instead of the TXT and MX the checklist assumes.
   - Copy whatever Resend's dashboard shows, all **DNS-only (grey cloud)**.
   - Put DMARC at `_dmarc.ib-timetable-planner.dev` (`p=none`, with `rua=`). It covers the subdomain, and passing mail is unaffected by `p=none`.
2. **Sender address.**
   - Resend's deliverability insights flag `no-reply@`.
   - Prefer a real-looking address, e.g. `planner@mail.…`, or set a Reply-To on a monitored mailbox.
3. **Plain-text part.**
   - Supabase's mailer renders one HTML body.
   - It is unverified whether Resend's SMTP relay adds a text part. Check `Content-Type` in the smoke test.
   - Keep the HTML short, with no `<form>` or `<script>` in the email, no shorteners, and every link on `ib-timetable-planner.dev`.
4. **Caps.**
   - On hosted, Supabase's own email cap is dormant (§ 4), so **Resend Free's 100 per UTC day is the effective global cap**.
   - The flood guard is what protects it.
   - Pro ($20/month) is the fallback (F4).

**Microsoft 365 smoke-test pass criteria** (one school mailbox, headers read by the recipient in Outlook on the web: "…" → View → View message details):
- The message is in the **Inbox**, not Junk or quarantine. Resend's "Delivered" only means the receiving server accepted it.
- `Authentication-Results`:
  - `spf=pass` (smtp.mailfrom on `send.mail.…`)
  - `dkim=pass header.d=mail.ib-timetable-planner.dev`
  - `dmarc=pass`
  - `compauth=pass reason=1xx`
- `X-Forefront-Antispam-Report`: `SFV:NSPM`, `CAT:NONE`, no `SFTY:9.19` or `9.20`. Also `BCL:0` and `dest:I`.
- If Safe Links wrapped the URL, the decoded `url=` keeps `token_hash` and `type=recovery`.
- **Worker logs show pre-click HEAD and GET from Microsoft ranges, and no POST.** The token is still valid 5 minutes or more after delivery, and the human's POST succeeds.
- **If the message is junked**, with no admin help available:
  - "Not junk", and add the exact sender address to Safe Senders. Address entries are honoured even for quarantine verdicts.
  - Keep a steady cadence. Microsoft says a new sender takes "a couple of weeks or less" to ramp.
  - Only a tenant admin can add a Tenant Allow/Block List entry or a Safe Links "Do not rewrite" entry.

## Code References

- [`src/middleware.ts:7-15`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/src/middleware.ts#L7-L15): `PUBLIC_PATHS` (exact match) and `PUBLIC_PREFIXES` (`/api/auth/` is already public).
- [`src/middleware.ts:24-42`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/src/middleware.ts#L24-L42): `getUser()` on every request, then `locals.user`, then a redirect.
- [`src/pages/api/auth/signin.ts:6-20`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/src/pages/api/auth/signin.ts#L6-L20): the form-POST plus redirect pattern the new routes copy.
- [`src/pages/auth/signin.astro:5-9`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/src/pages/auth/signin.astro#L5-L9): reads only `?error=`.
- `src/_pages/sign-in/ui/SignInForm.tsx:16-41` and `FormField.tsx:15,61-68`: the native form and the unused `hint` slot.
- [`src/shared/api/supabase.ts:6-28`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/src/shared/api/supabase.ts#L6-L28): the single server client; no `auth` options, so PKCE is forced by ssr.
- [`astro.config.mjs:75-88`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/astro.config.mjs#L75-L88): the `astro:env` schema; the Supabase variables are server secrets.
- [`src/_pages/account/api/unwrap-auth.ts:14-22`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/src/_pages/account/api/unwrap-auth.ts#L14-L22): the AuthError mapper and its promotion note.
- [`src/_pages/account/model/schemas.ts:13-51`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/src/_pages/account/model/schemas.ts#L13-L51): the 15-character and 72-byte password rules, slice-private.
- `src/_pages/account/api/update-password.ts:9-14`: `updateUser({ password })`, with the docblock's PKCE warning.
- `src/shared/ui/password-input.tsx:6-35`: `PasswordInput`, promoted for the reset page.
- [`services/solver/src/cpsat_service/supabase.py:123-140`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/services/solver/src/cpsat_service/supabase.py#L123-L140): the machine user's password grant. This is why Supabase CAPTCHA is out.
- `bench/campaign/http-client.ts:87-100`: the campaign runner signs in through the app.
- [`supabase/config.toml:154-221`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/supabase/config.toml#L154-L221): `site_url`, rate limits, captcha (commented out), `[auth.email]`, `otp_expiry`.
- [`.github/actions/supabase-stack/action.yml:45`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/.github/actions/supabase-stack/action.yml#L45): `-x …,mailpit,…`.
- `playwright.config.ts:20-21,36-55`: port 4321, the `chromium` and `chromium-guard` projects, and `webServer`.
- GoTrue `v2.196.0`:
  - `internal/api/recover.go:52-63`: unknown email returns 200; the PKCE flow state.
  - `internal/api/mail.go:397-425`: frequency check, then token replacement, then send.
  - `internal/api/mail.go:792-813`: the global limiter is skipped under autoconfirm.
  - `internal/api/verify.go:643-697`: the `token_hash` lookup.
  - `internal/api/middleware.go:241-301`: captcha scope and the admin-only bypass.

## Architecture Insights

- **"Server-only Supabase" turns out to be load-bearing.**
  - It was an accident of the SSR design, not a decision: no island ever needed a Supabase client.
  - It is now the reason an app-level bot check is a real gate rather than a speed bump.
  - Once something depends on it, it should become explicit, both as a test and as a rule.
- **The deny-by-default allowlist has two shapes.** Exact pages need a recorded reason each time. The `/api/auth/` prefix makes any new auth endpoint public without anyone deciding so. S-402 adds the first new entries of each kind since sign-in.
- **Fail-closed meets public endpoints.**
  - The house style (hook allowlists, launcher guards, neutral 404s on the ops route) carries over as "every outcome looks the same from outside".
  - The real outcome is visible only in server logs.
- **Hosted Auth is shaped by settings nobody chose for this feature.** `mailer_autoconfirm: true` came from the provisioning era ("no SMTP is configured"), and it switches a GoTrue rate limiter off. The runbook should record what each such setting **implies**, not only its value.
- **The confirm page is shared infrastructure for M-02.** S-410 (invite) and S-411 (email change) need the same scanner-safe GET-renders / POST-spends page. Build it with a `type` allowlist now.

## Historical Context (from prior changes)

- `context/changes/user-managment-research/research.md:569-625`: the SMTP comparison. Resend was **decided** on 2026-10-10, with SES as standby. Its 11-step setup checklist, and the gotchas ("the recovery endpoint is public… 100/day free cap"; "never enable click or open tracking").
- `context/changes/user-managment-research/research.md:310-325`: the first sketch of forgot-password (`resetPasswordForEmail` → `token_hash` template → `verifyOtp` in `/auth/confirm` → `updateUser`), plus the Safe Links warning.
- [`context/archive/2026-10-16-account-self-service/`](https://github.com/dobrek/ib-timetable-planner/tree/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/context/archive/2026-10-16-account-self-service):
  - FR-411 dropped the current-password rule so that a reset-link arrival works.
  - Hosted reauthentication and current-password toggles are verified off.
  - `PasswordInput` was promoted for S-402.
  - `unwrapAuth` was to be promoted "when S-402 brings a second caller".
  - The HC Fix 4 remainder (`site_url`, redirects, `[local_smtp]`) was left to S-402 (`plan-brief.md:32`, `plan.md:45`).
- [`context/foundation/health-check.md:323-381`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/context/foundation/health-check.md#L323-L381): HC Fix 4 (URLs, mail catcher), Fix 5 (one link lifetime, where option (a) is called the smallest change), and Fix 6 (CI mail capture).
- [`context/foundation/prd.md:389-408`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/context/foundation/prd.md#L389-L408): Open Question 2, with options a/b/c.
- `context/archive/2026-05-29-gated-author-provisioning/`: chose manual creation with no SMTP, and deferred invites and SMTP to "v2". That origin explains `mailer_autoconfirm: true`.
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md`: the machine user plus hook design, i.e. why the solver signs in with a password grant on the publishable key. That is the constraint that rules out Supabase CAPTCHA.

## Related Research

- `context/changes/user-managment-research/research.md`: the M-02 umbrella research, covering roles, lifecycle and the SMTP provider.
- `context/archive/2026-10-16-account-self-service/research.md`: S-401, covering password-change mechanics, session revocation and GoTrue errors.
- `context/archive/2026-10-14-ci-publishable-key-and-pinned-cli/`: the pinned CLI and the CI stack's key format (the local GoTrue version).

## Stale or contradictory docs found along the way

None of these is fixed by this research. Each needs a one-line follow-up, ideally inside S-402.

- **`docs/runbooks/author-provisioning.md:117-122` prescribes `supabase config push`**, and `:129` uses `<anon-key>`. This contradicts `CLAUDE.md` ("Never run `supabase config push`") and `solver-credential.md:141-164`.
- [`hosted-auth-settings.md:18-21`](https://github.com/dobrek/ib-timetable-planner/blob/cc0f9387596f8c8039e3059478ba9d36ff2aed8f/docs/runbooks/hosted-auth-settings.md#L18-L21) names `author-provisioning.md` § b as the recovery procedure, but § b only **creates** users. No password-recovery steps exist.
- The hosted Site URL is the workers.dev URL (`deploy-plan.md:163`), while the Resend checklist step 5 targets the custom domain. A decision is needed (§ 8).
- `health-check.md` cites `action.yml:28` and `:23` (now `:45` and `:39-42`), and `minimum_password_length = 6` at `:175` (now 15 at `:176`). `user-managment-research/change.md:89` also cites `action.yml:28`.
- `deploy-plan.md:141,170` cites `src/lib/supabase.ts` (now `src/shared/api/supabase.ts`).
- `e2e/CLAUDE.md` says "the four specs already here"; there are 27.
- Roadmap `:300` lists HC Fix 4 for S-402, but its `minimum_password_length` half already landed in S-401.
- `docs/runbooks/hosted-auth-settings.md:75` has "not recorded" for GoTrue. Hosted is v2.197.0 as of 2026-10-20.

## Open Questions

Decisions for the author before `/10x-plan`. The recommendation comes first.

1. **Open Roadmap Question 2: link lifetime.**
   - Recommendation: ship S-402 on the platform's 1 h, and move the a/b/c choice to S-410.
   - That means editing S-402's "Block: yes" in the roadmap.
2. **Flood guard.**
   - Recommendation: F2 (Turnstile in the Worker) + F1 (`smtp_max_frequency` about 300 s) + neutral responses with server-side logging.
   - F3 and F4 are not adopted for now.
   - **Accept** the residual risk: a human attacker can replace one person's link every 5 minutes.
   - This is also an occasion to reword the guardrail to "…cannot prevent an automated flood from…", if the author wants it to match the mechanism.
3. **The set-password step.** Recommendation: S1, reusing `/account?notice=recovery`.
4. **Typed code (`{{ .Token }}`).** Recommendation: not in v1. Keep it as the switch if the smoke test shows a spent POST.
5. **Site URL host.** Recommendation: `https://ib-timetable-planner.dev`, with both hosts in `uri_allow_list` and in the Turnstile hostnames. Should `*.workers.dev` keep serving the app at all? That is out of scope here.
6. **Password-changed notification email.** It is optional and costs one email per change, the S-401 account page included. Recommendation: on, as a cheap security signal. The author decides.
7. **To verify before or early in planning:**
   - **Local probe:** a reset requested on the forced-PKCE server client gives a `pkce_` `token_hash` that `verifyOtp` accepts from a **different** client. This is verified from the source only.
   - **Local probe:** what Astro 7 returns for GET and HEAD on a POST-only API route. The handler must not run.
   - **Hosted read with a personal access token:** `mailer_otp_exp`, `smtp_max_frequency`, `rate_limit_email_sent`, `site_url`, `uri_allow_list`, `security_captcha_enabled`, and the recovery template fields.
   - **What client IP hosted GoTrue records for app traffic** (Auth logs or `auth.audit_log_entries.ip_address`). This confirms whether every user shares one per-IP bucket.
   - **The Cloudflare docs for Turnstile and any rate-limiting binding**, fetched before writing config. CLAUDE.md's post-cutoff rule applies in spirit.
8. **External blocker (unchanged).** The coordinator's school M365 inbox is needed for the smoke test. Provider and DNS setup can start now.
