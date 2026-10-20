# Forgot Password by Email (S-402) Implementation Plan

## Overview

Let any staff member reset a forgotten password from the sign-in page:

1. They request a link on `/auth/forgot`, a native form guarded by Cloudflare Turnstile. Whatever happens, they get the same answer.
2. They receive one email, sent through Resend from `team@ib-timetable-planner.dev` ("IB Planner").
3. They open `/auth/confirm`. The page only renders on any method, and a mail scanner can open it without effect. The link is spent only by a deliberate press of the native **Continue** button.
4. They land signed in on `/account?notice=recovery` and set a new password with S-401's existing form.

The owner then gets a "your password was changed" notification. It ships as one PR. All hosted settings are made by hand first. The M365 smoke test into the coordinator's inbox runs after the merge.

Roadmap S-402; PRD FR-412, FR-418, §NFG (link lifetime, reset flood, no student data, inbox delivery).

## Current State Analysis

From `context/changes/forgot-password-by-email/research.md` (2026-10-20, commit `cc0f938`) and this session's verification passes:

- **The platform already fits.**
  - `resetPasswordForEmail`, `verifyOtp` and `updateUser({ password })` all accept the publishable key the Worker already holds. No secret key, no migration.
  - `PasswordInput` was promoted for this page (`src/shared/ui/password-input.tsx`).
  - The `/account` password form works unchanged on a recovery session. FR-411 dropped the current-password rule, and the hosted toggles are verified off (`docs/runbooks/hosted-auth-settings.md:12-16`).
- **The publishable key never reaches the browser.**
  - `astro.config.mjs:77-78` declares both Supabase variables as server secrets.
  - One server-only factory builds the client (`src/shared/api/supabase.ts:6-28`).
  - No island creates a Supabase client.
  - This is what makes an app-level bot check a real gate. Nothing pins it today.
- **The allowlist has two shapes.**
  - `PUBLIC_PATHS` matches exact paths (`src/middleware.ts:7`).
  - The `/api/auth/` prefix makes any file under it public without anyone deciding so (`:8-9`).
- **No email path exists yet.**
  - `supabase/config.toml:154-156`: `site_url` and the redirect allowlist point at a dead port (`127.0.0.1:3000`, and the second is https).
  - `[inbucket]` is deprecated in favour of `[local_smtp]` (CLI ≥ 2.108; `supabase status` warns today).
  - There are no templates.
  - CI's stack excludes `mailpit` (`.github/actions/supabase-stack/action.yml:45`).
  - Hosted runs with `mailer_autoconfirm: true`, which silently disables GoTrue's project-wide email cap (research § 4). The hosted Site URL is the `*.workers.dev` URL.
  - **Custom SMTP is live since 2026-10-20**, set up by hand by the developer:
    - Resend verifies the **apex** `ib-timetable-planner.dev`, not the `mail.` subdomain the 2026-10-10 checklist planned.
    - Supabase sends as `team@ib-timetable-planner.dev`, named "IB Planner", through `smtp.resend.com:465`, user `resend`.
  - **DNS on 2026-10-20** (Cloudflare zone export plus public lookups):
    - DKIM: TXT at `resend._domainkey.ib-timetable-planner.dev`.
    - Two DNS-only bounce-domain CNAMEs:
      - `send` → `send.forge.rmta.net`;
      - `rsend` → `rsend-euw1.forge.rmta.net`, which resolves to SPF `include:amazonses.com` and MX `feedback-smtp.eu-west-1.amazonses.com`. That confirms the **eu-west-1** region the 2026-10-10 decision named.
    - At 11:09 the Cloudflare preset for a domain that sends no email was added:
      - `_dmarc` = `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;`;
      - `*._domainkey` = `v=DKIM1; p=`;
      - apex `v=spf1 -all`.
    - Under strict SPF alignment the `send.`/`rsend.` bounce domains can never align, so DMARC rests on DKIM alone, and any failure is a silent reject behind the neutral notice.
    - **Decided 2026-10-20:** DMARC becomes `v=DMARC1; p=none;` for the rollout and is tightened after the M365 smoke test (see Phase 4 § 4). The wildcard DKIM and apex SPF stay: `resend._domainkey` has its own record, and the apex is never the bounce domain.
    - The apex has **no MX**, so replies to `team@` bounce.
- **How flooding plays out.**
  - Every `/recover` replaces the user's previous link.
  - GoTrue's per-user `smtp_max_frequency` check runs **before** the replacement.
  - An unknown address returns 200 and sends nothing.
  - Resend Free's 100 per UTC day is the effective global cap.
  - Supabase Auth CAPTCHA is ruled out: it also covers the CP-SAT solver's password grant, and only the secret key bypasses it (research § 4, F6).

## Desired End State

**For staff:**
- A signed-out staff member clicks **Forgot password?** on `/auth/signin`.
- On `/auth/forgot` they enter their email. Once the Turnstile check passes, they always see the same notice: *"If an account exists for that address, we've sent a link. It works once, for 1 hour. Only the newest email works. Didn't get it? Check Junk, then request again after 5 minutes."*
- The email holds the product name, one link to `https://ib-timetable-planner.dev/auth/confirm?token_hash=…&type=recovery`, and nothing else. No student data.
- A scanner can GET or HEAD the link any number of times without spending it.
- Pressing **Continue** signs them in and lands on `/account` with a recovery banner. They set a password of at least 15 characters, and their other sessions end.
- A "your password was changed" email follows.
- A used, replaced or expired link lands back on `/auth/forgot`, with "expired or already used" copy and the form ready to request again.

**For a flood:**
- Automation cannot get past Turnstile.
- A person who solves Turnstile can replace one colleague's link at most once per 5 minutes. This residual is accepted and the PRD guardrail is reworded to match.

**Verification:**
- Gates green: `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` (whose `postbuild` asserts no Supabase key or host in `dist/client`).
- **Integration suite** (Mailpit): an unknown address sends nothing; the link has the right shape; it verifies from a different client; it is single-use; a newer request kills the older link; the notification arrives.
- **E2E**: the full reset with a throwaway user and a simulated scanner; neutral answers for unknown addresses; guard checks on the public surface.
- **Hosted**: the runbook records the read-back of every Auth value, and the M365 smoke test passes the research's criteria.

### Key Discoveries:

**Astro 7.3.2 behaviour**
- **A route file that exports only `POST` answers GET and HEAD with 404**, and never runs the handler.
  - The handler is chosen by `mod[method] ?? mod["ALL"]`; HEAD falls back to GET only when GET is exported (`node_modules/astro/dist/runtime/server/endpoint.js:8-29`).
- **An `.astro` page renders for every method**, POST included (`core/pages/handler.js:27-48`). So the confirm page must have no side effects at all, not just on GET.
- **Response headers set in a slice component or layout are ignored.** They must be set in the `src/pages/**` route file's frontmatter (Astro docs: "only at the page level").
- **`security.checkOrigin` is on by default** and covers endpoints and pages (`core/app/origin-check.js:8-22`).
  - It runs before `src/middleware.ts` and rejects form POSTs whose `Origin` differs from the page's, with 403.
  - **`Referrer-Policy: no-referrer` makes Chromium send `Origin: null`, which gets the deliberate POST a 403** (probed in Playwright). Use `strict-origin`.
- **`context.redirect(path, 303)` is accepted**; the default is 302 (`core/constants.js:5`, `core/fetch/fetch-state.js:918`).
- **`astro:env` server secrets are read at runtime** from the Worker env and `.dev.vars` (`astro/dist/env/vite-plugin-env.js:142-150`). Public server vars are inlined at **build** from `process.env`, which the CI deploy build doesn't have. So both Turnstile keys are runtime server secrets, and the site key is rendered into the page by the server.
- **The adapter puts the Worker `ExecutionContext` on `locals.cfContext`** (`@astrojs/cloudflare/dist/utils/cf-helpers.js:23-26`). This repo's `App.Locals` (`src/env.d.ts`) doesn't type it yet. `ExecutionContext` is already hand-declared in `src/cloudflare-env.d.ts:68`.

**Supabase Auth**
- **A sessionless supabase-js client with `flowType: "implicit"` sends no code challenge** (auth-js `GoTrueClient.ts:4483`). That means no verifier cookie on the visitor's browser, no `flow_state` row, and a `{{ .TokenHash }}` without the `pkce_` prefix.
- **`verifyOtp({ token_hash, type: "recovery" })` fires `PASSWORD_RECOVERY`**, and `@supabase/ssr` writes the session cookies on that event (`@supabase/ssr/dist/main/createServerClient.js:52-62`).
- **Any GoTrue 5xx reaches the caller as `AuthRetryableFetchError` with no `code`** (auth-js `fetch.ts:75-98`). Classification cannot rely on `code` alone.
- **`/recover` error codes:**

  | Code | Status |
  |---|---|
  | `validation_failed` | 400 |
  | `over_request_rate_limit` | 429 |
  | `over_email_send_rate_limit` | 429 |
  | `email_address_invalid` | 400 |
  | `email_address_not_authorized` | 400 |
  | `captcha_failed` | 400 |
  | `email_provider_disabled` | 400 |

- **A bad, used or expired link gets 403 `otp_expired`** (GoTrue `verify.go:664,692`).

**Local config (CLI 2.117.0)**
- **The two templates resolve `content_path` from different base directories:**
  - `[auth.email.template.recovery]` resolves against the **project root**: use `./supabase/templates/recovery.html`.
  - `[auth.email.notification.password_changed]` resolves against **`supabase/`**: use `./templates/password_changed_notification.html`.
- **The notification template gets only `{{ .SiteURL }}`, `{{ .Email }}` and `{{ .Data }}`.**
- **New template env vars apply only after a stack restart.**
- **Without custom SMTP the CLI forces `GOTRUE_RATE_LIMIT_EMAIL_SENT=360000` locally.** Only `max_frequency = "1s"` and the per-IP limiters apply.

**Mailpit v1.30.2**
- `GET /api/v1/search?query=to:"<address>"` is a **substring** match and returns newest first. Use unique addresses and re-check `To[].Address`.
- `GET /api/v1/message/{ID}` returns `HTML` and `Text`.
- **`DELETE /api/v1/messages` with an empty body deletes everything.** Always pass `{"IDs": [...]}`.

**Management API** (`PATCH /v1/projects/{ref}/config/auth`)
- `uri_allow_list` is **one comma-separated string**, and `smtp_port` is a **string**.
- Template fields: `mailer_subjects_recovery`, `mailer_templates_recovery_content`, `mailer_notifications_password_changed_enabled`, `mailer_subjects_password_changed_notification`, `mailer_templates_password_changed_notification_content`.

**Turnstile (docs fetched 2026-10-20)**
- **siteverify:** `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`. Form or JSON body; fields `secret`, `response`, optional `remoteip`.
  - **An invalid or replayed token returns HTTP 200 with `success: false`.** Branch on `success`, never on status.
  - `missing-input-secret` and `invalid-input-secret` come back as 400.
  - A token lives 300 s, is single-use and is at most 2048 characters.
- **Test keys:** sitekey `1x00000000000000000000AA` (always passes, visible); secrets `1x…AA` (pass), `2x…AA` (fail), `3x…AA` (spent).
  - **The pass secret returns `hostname: "example.com"`, no `action`, and `metadata.result_with_testing_key: true`.**
  - It accepts any token, so replay, length and action/hostname checks cannot be exercised with test keys.
- **Implicit rendering** (`<div class="cf-turnstile" data-sitekey data-action>` plus `api.js`) injects a `cf-turnstile-response` field into the enclosing native form with no custom JS. Cloudflare recommends checking `action` and `hostname`, and keeping `localhost` off production widgets.

**Workers Logs**
- They keep request query strings unless `observability.redact_query_string: true` (`node_modules/wrangler/config-schema.json:3985-3990`). The campaign runner's telemetry filters on `$metadata.message`, not URLs (`bench/campaign/telemetry.ts:59-63`), so redaction breaks nothing.

**pnpm**
- pnpm 12.9.1 runs `pre*`/`post*` scripts (probed; `pretest:e2e` already relies on it). Every build path goes through `pnpm build` or `pnpm run build` (ci.yml:97, :367, the Playwright `webServer`, `scripts/solver/*.sh`), so a `postbuild` covers them all.

**Conventions**
- Auth session endpoints stay API routes, not Actions (`context/foundation/lessons.md:23`).
- Anything the preview Worker reads must be in `.dev.vars` **before** the build (`lessons.md:82-87`).
- `defineDomainAction` always requires a session (`src/shared/lib/actions/define-domain-action.ts:18`), so it cannot host a public endpoint anyway.

## What We're NOT Doing

- **No typed code (`{{ .Token }}`) in v1.** The link and the code are the same one-time secret, and a code adds a brute-force target that is limited only per IP. It is the fallback if the M365 smoke test shows a pre-click POST, and that would be a follow-up change.
- **No decision on Open Roadmap Question 2.** S-402 ships at the platform's 1 h (`mailer_otp_exp = 3600`), which meets the PRD as written; the a/b/c choice moves to S-410. No per-type expiry and no app-issued tokens.
- **Rejected flood guards:**
  - Supabase Auth CAPTCHA: it breaks the solver's sign-in.
  - "Confirm email" turned on to bring back GoTrue's global cap: it gives an attacker an easier lever.
  - A Send Email Hook: a dropped send still replaces the token.
  - A Workers rate-limit binding or WAF rule.
  - Resend Pro.
- **Copy and UI kept minimal:**
  - No client-side cooldown timer.
  - No React island on `/auth/forgot` or `/auth/confirm`.
  - No dedicated new-password page. The handoff is a redirect to `/account?notice=recovery`.
  - No redirect for signed-in visitors of `/auth/forgot` or `/auth/signin`.
- **No `unwrapAuth` promotion.** S-402's routes turn Auth outcomes into redirects, not `DomainError`s. Only the docblock's "S-402 brings a second caller" note is corrected.
- **No `redirectTo` on `resetPasswordForEmail`.** The template builds its link from `{{ .SiteURL }}`. The redirect allowlists are still corrected, as hygiene for S-410 and S-411.
- **Other hosting decisions are untouched:** no decision on whether `*.workers.dev` keeps serving the app, and no CSP.
- **No admin-triggered reset.** That stays the dashboard until S-409.
- **No inbound mailbox for `team@ib-timetable-planner.dev`.** The apex has no MX, so a reply to a reset email bounces. Cloudflare Email Routing can forward it later if replies should reach someone.
- **No move of the sending domain to `mail.`.** The apex was verified on 2026-10-20 and stays.
- **No DMARC enforcement yet.** The rollout runs on `p=none`. Tightening to `quarantine`/`reject` with relaxed alignment is a follow-up after the M365 smoke test and a few weeks of clean mail; Phase 5's verdict records it.
- **No retries or `idempotency_key` on siteverify.** One bounded attempt; a failure fails closed and the visitor resubmits with a fresh widget token.
- **Stale docs not on S-402's surface stay as they are:** the `health-check.md` line references and `user-managment-research/change.md:89`.

## Implementation Approach

**By hand, before the merge (Phase 4's gate):**
- Resend domain and DNS. Done 2026-10-20 except the DMARC record.
- Custom SMTP (done 2026-10-20) and every other hosted Auth value.
- The templates.
- The Turnstile widget and both Worker secrets.

All of it is harmless before the merge. The publishable key is server-only, so nobody can call `/recover` until the app ships a route for it. The password-changed notification goes live early, for S-401's account page, which is fine once SMTP is live.

**Code ships as one PR across Phases 1–4.** It is merged outside a production solve, and only after the gate. **Phase 5's smoke test runs on hosted after the merge** and gates archiving, not merging.

**Architecture:**
- **One new page slice, `src/_pages/password-recovery/`.**
  - `model/`: pure rules, unit-tested — email-link parsing with a `type` allowlist, the `/auth/forgot` page-state vocabulary, reset-outcome classification, the Turnstile verdict, and lifetime constants.
  - `api/`: framework-free functions taking their dependencies as parameters — `requestPasswordReset`, `verifyEmailLink`, `verifyTurnstile`.
  - `ui/`: two server-rendered `.astro` pages with native forms and no hydrated islands.
- **The route files under `src/pages/` stay thin.** They read `astro:env/server`, set response headers, and turn outcomes into 303 redirects (`lessons.md:23`).
- **The reset is sent in the background.** `POST /api/auth/forgot` verifies Turnstile synchronously, because that answer is account-independent. It then hands `/recover` to `locals.cfContext.waitUntil` and redirects at once, so the response time cannot tell a real account from an unknown one.
- **The confirm page is shared infrastructure.** S-410 (`invite`) and S-411 (`email_change`) join `EMAIL_LINK_TYPES` later; S-402 allows only `recovery`.

## Critical Implementation Details

- **Ordering: hosted before merge.**
  - Merging deploys.
  - Custom SMTP is already live (2026-10-20), but the hosted recovery template is still Supabase's default, and the default uses `{{ .ConfirmationURL }}`. If the routes reached production before the template and `site_url` are set, every reset email would carry a GET-spent link that scanners consume, and it would point at `workers.dev`.
  - The neutral response would hide that failure.
  - The Phase 4 gate rows (4.3–4.5) must be checked before the merge row (4.6).
- **Headers and referrer.**
  - Set `Cache-Control: no-store`, `Referrer-Policy: strict-origin` and `X-Robots-Tag: noindex` in `src/pages/auth/confirm.astro`'s own frontmatter, not in the slice component.
  - Never use `no-referrer`: the browser then sends `Origin: null` and Astro's origin check returns 403 on Continue.
- **Background send.**
  - `requestPasswordReset` must **never throw**. It catches thrown network errors and `AuthRetryableFetchError` (no `code`) as well as returned errors, and resolves to a `ResetOutcome` that the `waitUntil` callback only logs.
  - The redirect is computed before, and independently of, that promise.
  - Log the outcome, the GoTrue code and the status under a fixed `[forgot-password]` prefix. **Never the email address, the token or the Turnstile response.**
- **Test-key gate.**
  - The three known Turnstile test secrets are accepted only when the request host is loopback (`localhost`, `127.0.0.1`, `[::1]`); anywhere else they count as **misconfigured**.
  - That is the one condition under which the verdict skips the `action`/`hostname` checks (`metadata.result_with_testing_key === true`), so a test secret on production cannot silently turn the guard off.
- **Local stack restart.** The new `[auth.email.template.recovery]` and `[auth.email.notification.password_changed]` sections, and the `site_url` change, apply only after `pnpm exec supabase stop && pnpm exec supabase start`. `db reset` is not enough, and Phase 1's suite fails confusingly without the restart.
- **Mailpit deletes.** Only ever `DELETE /api/v1/messages` with an explicit `IDs` list. An empty body wipes every message, including mail other parallel suites or specs are waiting for.
- **Shared GoTrue rate limits.**
  - Everything runs through one IP, so the integration lane, the e2e lane and every user share GoTrue's per-IP buckets (`/recover` and `/verify` 30 per 5 min; sign-ins 30 per 5 min).
  - Keep the new suite's budget small: users created through the admin API with a password but **no** sign-in, and about 10 rate-limited calls per run.
  - The lane is already about 1-in-5 red from transient 502s, and that isn't this change's fault.
- **Copy is coupled to hosted values.**
  - "1 hour" and "5 minutes" in the notice and the email mirror `mailer_otp_exp` and `smtp_max_frequency`.
  - Keep them as named constants in `model/recovery-policy.ts`, with a docblock pointing at the runbook rows. The runbook says that changing either hosted value means changing the copy and the template in the same change (`lessons.md:68-73`).

---

## Phase 1: Local mail & the recovery core

### Overview

Make the local and CI stacks send and capture recovery mail. Build the slice's pure model and the two Auth functions. Prove the mechanics against the real local GoTrue and Mailpit before any route exists.

### Changes Required:

#### 1. Local Auth config and templates

**File**: `supabase/config.toml`, `supabase/templates/recovery.html`, `supabase/templates/password_changed_notification.html`

**Intent**: Point local Auth at the preview's real origin, move the mail catcher to the current section name, and give both emails a project-owned template. That way local and CI render exactly what hosted will send (HC Fix 4).

**Contract**:
- **`[auth]`:**
  - `site_url = "http://localhost:4321"`.
  - `additional_redirect_urls = ["http://localhost:4321/**", "http://127.0.0.1:4321/**"]`.
  - Fix the "exact URLs" comment: globs are supported.
- **`[inbucket]` → `[local_smtp]`**, same keys.
- **`[auth.email.template.recovery]`:**
  - `subject = "Reset your IB Planner password"`. "IB Planner" matches the hosted sender name, so the inbox shows one product name.
  - `content_path = "./supabase/templates/recovery.html"`.
- **`[auth.email.notification.password_changed]`:**
  - `enabled = true`.
  - `subject = "Your IB Planner password was changed"`.
  - `content_path = "./templates/password_changed_notification.html"`.
  - Add a comment on why the two paths differ.
- **`max_frequency = "1s"` stays.** Add a comment that hosted is 300 s and the copy says 5 minutes.
- **`recovery.html`:**
  - Short HTML with the product name.
  - Exactly one link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
  - "works once, for 1 hour".
  - "If you didn't ask, ignore this email — your password stays the same."
  - No `<form>`, `<script>`, images, tracking or shorteners. Never `{{ .ConfirmationURL }}`.
- **`password_changed_notification.html`:**
  - "The password for `{{ .Email }}` was just changed."
  - "If this wasn't you, reset it now at `{{ .SiteURL }}/auth/forgot` and tell your coordinator."
  - No other links.

#### 2. CI mail capture

**File**: `.github/actions/supabase-stack/action.yml`

**Intent**: Re-include Mailpit so the integration and e2e lanes can read reset mail (HC Fix 6). Otherwise the suites pass locally and fail in CI.

**Contract**: Drop `mailpit` from the `-x` list. Extend the trimming comment: Mailpit is kept because the S-402 suites read mail through its API on `:54324`.

#### 3. A sessionless Auth client

**File**: `src/shared/api/supabase.ts`, `src/shared/api/index.ts`

**Intent**: A client for the one call that must not touch the visitor's cookies or start a PKCE flow: `/recover` on an unauthenticated public endpoint.

**Contract**: Export `createSessionlessClient(): SupabaseClient | null`, built with `@supabase/supabase-js` `createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })`. It returns `null` when unconfigured, like `createClient`. Its docblock says why it exists and that it must never be used for a call that needs a session.

#### 4. The slice's pure model

**File**: `src/_pages/password-recovery/model/email-link.ts`, `model/forgot-page-state.ts`, `model/reset-outcome.ts`, `model/recovery-policy.ts` (each with a co-located `*.test.ts`), `src/_pages/password-recovery/index.ts`

**Intent**: Keep every rule the routes and pages depend on in pure, unit-tested functions, so the route files only orchestrate.

**Contract**:
- **`email-link.ts`:**
  - `EMAIL_LINK_TYPES = ["recovery"] as const`. The docblock names S-410 `invite` and S-411 `email_change` as future members.
  - `type EmailLink = { tokenHash: string; type: EmailLinkType }`.
  - `parseEmailLink(params: { get(name: string): unknown }): EmailLink | null`, so it works on both `URLSearchParams` and `FormData`.
  - It refuses a missing, empty or over-long `token_hash` (bounded, `[A-Za-z0-9_-]` only) and any `type` outside the allowlist.
- **`forgot-page-state.ts`:**
  - Owns the `/auth/forgot` query vocabulary in one place.
  - `forgotPath(reason)` builds the redirect targets: `?status=sent`, `?error=verification`, `?error=unavailable`, `?error=link-expired`, `?error=link-invalid`, `?error=link-retry`.
  - `forgotPageState(searchParams, { configured: boolean })` returns `{ kind: "form"; alert: … | null } | { kind: "sent" } | { kind: "unavailable" }`.
  - Unknown values read as the plain form, and `configured: false` always yields `unavailable`.
- **`reset-outcome.ts`:**
  - `type ResetOutcome = "accepted" | "throttled" | "rejected-address" | "send-failed" | "unexpected"`.
  - `toResetOutcome(error: unknown): ResetOutcome` classifies a returned `AuthError`, an `AuthRetryableFetchError` with no code, and any thrown value.
  - The classification is for **logs only**: the route never branches on it.
- **`recovery-policy.ts`:** `LINK_LIFETIME = "1 hour"` and `RESEND_INTERVAL = "5 minutes"`, coupled to hosted `mailer_otp_exp` and `smtp_max_frequency`. The docblock points at the runbook.
- **`index.ts`:** follows `_pages/sign-in/index.ts`.

#### 5. The two Auth functions

**File**: `src/_pages/password-recovery/api/request-password-reset.ts`, `api/verify-email-link.ts`

**Intent**: The only two GoTrue calls the flow makes, framework-free, with the client passed in, so the integration suite exercises exactly what the routes will run.

**Contract**:
- **`requestPasswordReset(client, email: string): Promise<ResetOutcome>`:**
  - Calls `client.auth.resetPasswordForEmail(email)` with no `redirectTo`.
  - **Never throws.**
  - The docblock says it is meant for the sessionless client and why.
- **`verifyEmailLink(client, link: EmailLink): Promise<{ ok: true } | { ok: false; reason: "expired" | "retry" }>`:**
  - Calls `client.auth.verifyOtp({ token_hash, type })` and nothing else alongside it: no `email` or `redirect_to`, which GoTrue rejects together with `token_hash`.
  - `over_request_rate_limit`, `AuthRetryableFetchError` and thrown network errors map to `retry`.
  - `otp_expired`, `user_banned` and every other refusal map to `expired`.

#### 6. Test harness: Mailpit client and user factory

**File**: `src/test/mailpit.ts`, `src/test/factories/create-auth-user.ts`

**Intent**: Read mail without coupling to arrival order or other suites' mail, and create password users without spending a sign-in.

**Contract**:
- **`mailpit.ts`:**
  - Base URL `MAILPIT_URL ?? "http://127.0.0.1:54324"`; refuses a non-loopback host.
  - `messagesTo(address)` searches, then filters `To[].Address` for an exact match.
  - `waitForMessageTo(address, { after?, timeoutMs })` polls with a bounded deadline.
  - `readMessage(id)` returns `HTML` and `Text`.
  - `deleteMessages(ids)` refuses an empty list.
- **`createAuthUser(admin, { password? })`:** the optional password is set on `admin.createUser`. Still no sign-in, still registered for `teardown`.

#### 7. Integration suite

**File**: `src/test/password-recovery.integration.test.ts`

**Intent**: Prove the mechanics nobody can see in review, against the real local GoTrue and Mailpit, through the same publishable-key clients the Worker uses.

**Contract** (each test with its own user; delete only its own mail by ID in `afterAll`; `teardown` as in `account-self-service.integration.test.ts`):
- **Unknown address:** `requestPasswordReset` resolves `accepted`, and Mailpit holds nothing for it. Absence is asserted only after a known user's reset, requested **after** it, has arrived (an ordering bound, not a sleep).
- **Known user:**
  - Exactly one message arrives, with the recovery subject.
  - Its HTML holds exactly one URL, `http://localhost:4321/auth/confirm?token_hash=<hash>&type=recovery`, and no `<form>` or `<script>`.
  - `parseEmailLink` on that URL's query yields the link.
- **Cross-device:** `verifyEmailLink` on a **fresh** publishable client (`createPublishableClient`, which never made the request) gives `ok`, and that client's `getUser()` is the user.
- **Single use:** verifying the same hash a second time gives `{ ok: false, reason: "expired" }`.
- **Replacement:**
  - Two requests, with the second retried until accepted past the 1 s local interval, so no fixed sleep.
  - The first link is now `expired`; the second verifies.
- **Set the password:** after a verify, the account slice's `updatePassword` succeeds on the recovery session. The new password signs in, the old one gets `invalid_credentials`, and the password-changed notification arrives for that address, its HTML holding no URL other than `/auth/forgot`.

### Success Criteria:

#### Automated Verification:

- Local stack restarted on the new config, and `pnpm exec supabase status` no longer prints the `[inbucket]` deprecation warning
- Type check passes: `pnpm check`
- Lint and FSD structure pass: `pnpm lint` and `pnpm steiger`
- Unit tests pass: `pnpm test` (email-link, forgot-page-state, reset-outcome)
- The new suite passes: `pnpm test:integration src/test/password-recovery.integration.test.ts`
- The whole lane passes: `pnpm test:integration` (re-run once on a transient 502, a known flake)

#### Manual Verification:

- In Mailpit (`http://127.0.0.1:54324`), the recovery email and the password-changed notification look right: product name, one link, "1 hour", no student data. The recovery link's host is `localhost:4321`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Turnstile gate & the auth endpoints

### Overview

Add the bot check and the two public POST endpoints. Widen the allowlist with recorded reasons, and pin the two invariants the flood guard depends on: the key stays server-only, and tokens never reach the logs.

### Changes Required:

#### 1. Env schema and local/CI keys

**File**: `astro.config.mjs`, `.github/workflows/ci.yml`, `src/env.d.ts`

**Intent**: Read both Turnstile keys at runtime like the Supabase ones. Get Cloudflare's always-pass test keys into the preview Worker **before** the build, and type the adapter's `cfContext` for `waitUntil`.

**Contract**:
- **Env schema:** `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` as `envField.string({ context: "server", access: "secret", optional: true })`.
  - Comment: the site key is public, but a public server var would be inlined at build, which CI's deploy build cannot supply.
  - A missing key is a supported state that makes reset **unavailable** (fail closed), never unguarded.
- **ci.yml, e2e job:** the "Write .dev.vars" step also writes `TURNSTILE_SITE_KEY=1x00000000000000000000AA` and `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` (public test values), with a comment citing the `.dev.vars` lesson.
- **`src/env.d.ts`:** `App.Locals` gains `cfContext: ExecutionContext`, using the declaration in `src/cloudflare-env.d.ts`. Never run `wrangler types`.

#### 2. Turnstile verification

**File**: `src/_pages/password-recovery/model/turnstile-verdict.ts` (+ `.test.ts`), `src/_pages/password-recovery/api/verify-turnstile.ts` (+ `.test.ts`)

**Intent**: Turn one siteverify exchange into a four-way verdict that fails closed, with every rule in a pure function.

**Contract**:
- `type TurnstileVerdict = "pass" | "refused" | "transient" | "misconfigured"`.
- `TURNSTILE_ACTION = "forgot-password"`.
- **`preflightTurnstile({ token, secret, requestHost })`:** returns a verdict without calling Cloudflare, or `null` to proceed.
  - A missing, empty or over-2048-character token → `refused`.
  - A missing secret → `misconfigured`.
  - A known test secret on a non-loopback host → `misconfigured`.
- **`judgeSiteverify(status, body, { requestHost })`:**
  - A 400 with `missing-input-secret` or `invalid-input-secret` → `misconfigured`.
  - Any other non-JSON or 5xx → `transient`.
  - `success !== true` → `refused`.
  - `success === true` with `metadata.result_with_testing_key === true` → `pass` (reachable only on loopback, per preflight).
  - Otherwise `pass` only when `action === TURNSTILE_ACTION` **and** `hostname === requestHost`, else `refused`.
- **`verifyTurnstile({ token, secret, remoteIp, requestHost, fetch? })`:**
  - Preflight first.
  - Then one form-encoded POST to siteverify with `secret`, `response` and `remoteip`, under a ~5 s timeout.
  - A timeout or network error → `transient`.
  - Then `judgeSiteverify`.
  - `fetch` is injectable for the unit test.

#### 3. The two endpoints

**File**: `src/pages/api/auth/forgot.ts`, `src/pages/api/auth/confirm.ts`

**Intent**: Thin orchestration over the slice: verify, act, then a 303 to a page. They follow `src/pages/api/auth/signin.ts`'s form-POST-and-redirect pattern.

**Contract**:
- **`POST /api/auth/forgot`** (only `POST` exported):
  1. Read `email` and `cf-turnstile-response` from the form.
  2. `verifyTurnstile` with `context.clientAddress` and `context.url.hostname`:
     - `misconfigured` → log with `console.error`, 303 `forgotPath("unavailable")`.
     - `refused` or `transient` → 303 `forgotPath("verification")`.
  3. On `pass`, `context.locals.cfContext.waitUntil(requestPasswordReset(createSessionlessClient(), email).then(log))`. A `null` client → log and 303 `forgotPath("unavailable")`.
  4. Always 303 `forgotPath("sent")`, never conditioned on the reset.
  - The file docblock records that it is public through the `/api/auth/` prefix, and that every outcome after Turnstile looks identical from outside.
- **`POST /api/auth/confirm`** (only `POST` exported; GET and HEAD get Astro's 404, so a scanner hitting the endpoint spends nothing):
  - `parseEmailLink(formData)`: `null` → 303 `forgotPath("link-invalid")`.
  - Otherwise `verifyEmailLink(createClient(headers, cookies), link)`:
    - `ok` → 303 `/account?notice=recovery`.
    - `expired` → 303 `forgotPath("link-expired")`.
    - `retry` → 303 `forgotPath("link-retry")`.
  - Log the reason, never the token.

#### 4. The middleware allowlist

**File**: `src/middleware.ts`

**Intent**: Widen deny-by-default for password reset only, each entry with its reason (PRD Constraints).

**Contract**:
- `PUBLIC_PATHS` gains `"/auth/forgot"` (reason: a signed-out user must be able to ask for a link, FR-412) and `"/auth/confirm"` (reason: the link holder is signed out until the deliberate POST).
- The `/api/auth/` prefix comment names all four endpoints. It says that **any** file placed under it is public by prefix and must be safe signed out.

#### 5. Pin "server-only Supabase" and redact logged URLs

**File**: `scripts/assert-server-only-supabase.mjs`, `package.json`, `wrangler.jsonc`

**Intent**: The flood guard is only real while the browser never holds the publishable key, so make a build fail if it ever does. Keep `token_hash` out of Workers Logs.

**Contract**:
- **Build check:** a `postbuild` script runs `node scripts/assert-server-only-supabase.mjs`.
  - It scans `dist/client/**` text files for `sb_publishable_`, `sb_secret_`, `.supabase.co` and `127.0.0.1:54321`.
  - It exits non-zero naming each offending file and pattern, never printing the matched value.
  - Its docblock says why (research § 4).
- **`wrangler.jsonc`:** `observability.redact_query_string: true`, with a comment (the confirm URL carries `token_hash`; campaign telemetry filters on messages, not URLs). Check the field against current Cloudflare docs before writing it.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test` (turnstile-verdict, verify-turnstile, plus Phase 1's)
- Type check, lint and FSD pass: `pnpm check`, `pnpm lint`, `pnpm steiger`
- Production build passes, including the `postbuild` client-bundle assertion: `pnpm build`

#### Manual Verification:

- Deliberate break: temporarily add the string `sb_publishable_x` to a client island, then confirm that `pnpm build` fails and names the file. Revert it.
- Against `pnpm build && pnpm preview`, with the preview restarted after the build:
  - `curl -I` and `curl` on `/api/auth/confirm` and `/api/auth/forgot` return 404.
  - A form POST to `/api/auth/forgot` with `Origin: https://evil.example` returns 403.
  - A same-origin POST with no Turnstile token redirects to `/auth/forgot?error=verification`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Pages & browser coverage

### Overview

Build the two public pages, the sign-in link and the account banner. Prove the whole flow in a real browser, including a simulated scanner and the neutral answer for unknown addresses.

### Changes Required:

#### 1. `/auth/forgot`

**File**: `src/pages/auth/forgot.astro`, `src/_pages/password-recovery/ui/ForgotPasswordPage.astro`

**Intent**: A native, server-rendered request form whose every state comes from `forgotPageState`. It uses the decided copy and keeps the sign-in card's look.

**Contract**:
- **The route file** reads `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (configured = both present) and passes the state and site key to the component.
- **Form state:**
  - `<form method="post" action="/api/auth/forgot">`.
  - An email input: labelled "Email", `type="email"`, `required`, `autocomplete="username"`.
  - `<div class="cf-turnstile" data-sitekey data-action="forgot-password" data-theme="auto" data-size="flexible">`.
  - The `api.js` script (`async defer`, exact Cloudflare URL), loaded **only in this state**.
  - A submit button "Send reset link".
  - A "Back to sign in" link.
- **Alerts, through `Banner`:**
  - `verification`: "We couldn't confirm this request. Wait until the check below the email field finishes, then send again."
  - `link-expired`: "This link has expired or was already used. Only the newest email works, for 1 hour. Request a new one below."
  - `link-invalid`: "This link is incomplete. Open it straight from the email, or request a new one below."
  - `link-retry`: "We couldn't open your link just now. Go back to the email and open the link again in a minute."
- **Sent state:**
  - The notice exactly: "If an account exists for that address, we've sent a link. It works once, for 1 hour. Only the newest email works. Didn't get it? Check Junk, then request again after 5 minutes." The lifetimes come from `recovery-policy.ts`.
  - "Request another link" goes to `/auth/forgot`; plus "Back to sign in".
- **Unavailable state:** "Password reset is unavailable right now. Ask your coordinator to reset it for you." No form and no script.
- **Styling:** semantic tokens only, following `SignInPage.astro`'s card.

#### 2. `/auth/confirm`

**File**: `src/pages/auth/confirm.astro`, `src/_pages/password-recovery/ui/ConfirmEmailLinkPage.astro`

**Intent**: The scanner-safe landing. It renders on any method and has no side effects; the only way to spend the link is a person pressing a native submit button.

**Contract**:
- **The route file** sets `Cache-Control: no-store`, `Referrer-Policy: strict-origin` and `X-Robots-Tag: noindex` (see Critical Implementation Details), and passes `parseEmailLink(Astro.url.searchParams)`.
- **A valid link** renders:
  - The heading "Reset your password".
  - "Press Continue to sign in and choose a new password. The link works once."
  - `<form method="post" action="/api/auth/confirm">` with hidden `token_hash` and `type`, and one `<button type="submit">Continue</button>`.
- **An invalid link** renders the `link-invalid` copy and a link to `/auth/forgot`.
- **Hard rules:**
  - No hydrated island, no script beyond the layout's theme script, no Turnstile, no third-party resource, no `meta refresh`.
  - **No `href` anywhere on the page carries the token.**

#### 3. Sign-in link and account banner

**File**: `src/_pages/sign-in/ui/SignInPage.astro`, `src/pages/account.astro`, `src/_pages/account/ui/AccountPage.astro`

**Intent**: The entry point and the landing. Both are plain Astro, so no island changes and `e2e/auth.setup.ts`'s locators stay unique.

**Contract**:
- **`SignInPage.astro`:** a plain `<a href="/auth/forgot">Forgot password?</a>` below the island (not inside `SignInForm`).
- **`account.astro`:** passes `notice={Astro.url.searchParams.get("notice")}`.
- **`AccountPage.astro`:**
  - Gains `notice: string | null`.
  - For `"recovery"`, it renders `<Banner variant="info">You're signed in from a password-reset link. Choose a new password below.</Banner>` above the forms, as the dashboard's weak-password notice does.
  - Other values render nothing.

#### 4. Guard checks on the public surface

**File**: `e2e/specs/auth-guard.spec.ts`

**Intent**: Prove signed out, against the real middleware, that exactly the decided surface is public and the spending endpoint can't be reached by GET, HEAD or a cross-site form.

**Contract** (runs in `chromium-guard`):
- `/auth/forgot` renders its heading signed out, with no redirect.
- `/auth/confirm` with no query renders the invalid-link copy.
- `GET` and `HEAD` on `/api/auth/confirm` and `/api/auth/forgot` return 404.
- A form POST to `/api/auth/forgot` with a foreign `Origin` returns 403.
- `/account?notice=recovery` signed out still redirects to sign-in.

#### 5. The reset flow in a browser

**File**: `e2e/specs/forgot-password-unauth.spec.ts`

**Intent**: The outside-observable proof of FR-412 and the scanner rule, with a throwaway user (the shared author's password must never change; `e2e/CLAUDE.md:37-40`).

**Contract** (runs in `chromium-guard` via the `*unauth.spec.ts` name):
- **Setup:**
  - `beforeAll` creates a confirmed user with a known password through the admin API.
    - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` come from env, or the `.env.test.local` fallback as `scripts/provision-e2e-author.mjs:17-37` reads it.
    - It **refuses a non-loopback `SUPABASE_URL`.** This is the first spec to use the service-role key, and it must never create users on hosted.
  - `afterAll` deletes the user and its Mailpit messages by ID.
- **Reset test:**
  1. Open `/auth/forgot` and wait for the widget's hidden `cf-turnstile-response` field to hold a value. It has no accessible name, so this is the spec's one documented non-role locator.
  2. Submit the user's email, and assert the exact sent notice.
  3. `expect.poll` Mailpit for the link.
  4. **Simulated scanner:** `request.head(link)` and `request.get(link)`, twice each. Each returns 200, and the GET body holds the Continue button.
  5. `page.goto(link)`, click Continue, land on `/account?notice=recovery` with the banner visible.
  6. Hydration-gate the password form (the `account.spec.ts` idiom), set a new password twice, and see the "Password changed" toast.
  7. Prove it from Node with a publishable-key `signInWithPassword`: new password OK, old password `invalid_credentials`.
  8. Assert the password-changed notification arrived.
  9. Reopen the used link and press Continue, and land on `/auth/forgot?error=link-expired` with its copy.
- **Neutral test:** a request for an unknown `@example.test` address ends on the identical sent notice and URL.

### Success Criteria:

#### Automated Verification:

- E2E passes: the new spec, the guard additions and every existing spec, `auth.setup.ts` included (the sign-in page change must not break its locators): `pnpm test:e2e`
- The full local CI gate passes: run the `/verify` skill

#### Manual Verification:

- **Walk the flow** on `pnpm build && pnpm preview`, restarting the preview after the build:
  - the sign-in link;
  - the forgot page and widget;
  - the sent copy;
  - the Mailpit link;
  - Continue;
  - the banner;
  - the password change;
  - the notification.
- **With JavaScript disabled**, `/auth/confirm` still works.
- **`curl -I` on a confirm URL** shows the three headers, and the page source has no script beyond the theme script and no `href` carrying the token.
- **Keyboard only:** both pages work by keyboard alone, with visible labels and focus order, and the alerts are announced (`role` from `Banner`).
- **Unconfigured:** with the Turnstile keys removed from `.dev.vars` and the app rebuilt, `/auth/forgot` shows the unavailable state, and a POST to `/api/auth/forgot` lands there too. Restore the keys.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Docs, rules & the hosted gate

### Overview

Record the decisions and rules where the next change will find them, fix the stale docs on this surface, and then do every hosted step by hand. The merge is the last row of this phase.

### Changes Required:

#### 1. Agent rules

**File**: `CLAUDE.md`, `e2e/CLAUDE.md`

**Intent**: Turn the accidental invariants this flow depends on into stated rules (umbrella research's "CLAUDE.md email-flow rules").

**Contract**:
- **`CLAUDE.md` § Database & auth gains:**
  - **The publishable key never reaches the browser.** The reset flood guard depends on it, and `postbuild` enforces it. Never `createBrowserClient`, `PUBLIC_SUPABASE_*` or `astro:env/client` for Supabase.
  - **Email links** use `{{ .TokenHash }}` → `/auth/confirm`, which renders on every method with no side effects. Only a native POST to `/api/auth/confirm` spends the link. Never `{{ .ConfirmationURL }}`, and never a token in an `href`. A new link type joins `EMAIL_LINK_TYPES`.
  - **Never enable Supabase Auth CAPTCHA.** It covers the solver's password grant, and its only bypass is the secret key.
  - **Every public route** in `src/middleware.ts` carries a one-line reason, and everything under `/api/auth/` is public by prefix.
  - **`redirectTo` must be allow-listed**, or Auth silently falls back to the Referer and then the Site URL.
  - **`supabase/templates/*`** reach hosted only through the runbook's Management API step, never `config push`.
- **`e2e/CLAUDE.md`:**
  - Fix "the four specs" (now 28+).
  - Add the one sanctioned exception: an unauth spec may create its own throwaway user through the service-role key, loopback-guarded, when the flow under test changes a password.
  - Specs read mail through Mailpit's API and delete only their own messages by ID.

#### 2. Runbooks

**File**: `docs/runbooks/hosted-auth-settings.md`, `docs/runbooks/email-delivery.md` (new), `docs/runbooks/solver-credential.md`, `docs/runbooks/author-provisioning.md`

**Intent**: Write down the by-hand hosted configuration and what each value **implies**, the delivery setup and smoke test, and fix the docs that prescribe `config push` or point at recovery steps that don't exist.

**Contract**:
- **`hosted-auth-settings.md`:**
  - The table gains `site_url`, `uri_allow_list`, `mailer_otp_exp`, `smtp_max_frequency`, `rate_limit_email_sent`, `security_captcha_enabled = false`, the recovery subject and template, and the three password-changed notification fields, each with "Must be", "Why" and **"What it implies"**. For example:
    - `mailer_autoconfirm: true` disables GoTrue's global email cap.
    - `smtp_max_frequency` and `mailer_otp_exp` are mirrored in the UI copy and the template.
  - The read-only `jq` check covers them all.
  - Add a template-sync command that PATCHes the subject and content from `supabase/templates/*` and reads them back.
  - The recovery pointer (`:18-21`) now names S-402's self-service flow.
  - "Last verified" gains a GoTrue version column.
- **`email-delivery.md` (new):**
  - **Resend setup, as built on 2026-10-20:**
    - The verified domain is the apex `ib-timetable-planner.dev`, in **eu-west-1** (confirmed by the `rsend` bounce MX).
    - Record why the apex was used instead of `mail.`: any future mail on the apex shares its sending reputation.
    - DNS records, all **DNS-only**:
      - DKIM TXT at `resend._domainkey`;
      - `send` CNAME → `send.forge.rmta.net`, and `rsend` CNAME → `rsend-euw1.forge.rmta.net` (SES eu-west-1 SPF and bounce MX). Both are Resend's bounce/return-path domains; copy whatever the Resend dashboard lists, never from this plan;
      - DMARC TXT at `_dmarc.ib-timetable-planner.dev`: `v=DMARC1; p=none;` (relaxed alignment), optionally with a `rua=` from Cloudflare DMARC Management.
    - **Why `p=none` for now:** the reset page answers the same for every outcome, so a rejected email is invisible to the user. During rollout a failure must land in Junk with readable headers.
    - **Tightening path:** after the M365 smoke test and a few weeks of clean mail, move to `p=quarantine`, then `p=reject`, with relaxed alignment. Never `aspf=s`: the bounce domains are subdomains of the apex.
    - **Kept from Cloudflare's preset:**
      - apex `v=spf1 -all`. Adding Cloudflare Email Routing for `team@` later means merging its `include:` into this one record, never a second SPF record.
      - `*._domainkey` `v=DKIM1; p=`. Any new provider's selector needs its own explicit record.
    - Click and open tracking off.
    - A sending-only API key scoped to the domain is the SMTP password.
  - **Custom SMTP:** `smtp.resend.com`, port `"465"`, user `resend`.
  - **Sender:** `team@ib-timetable-planner.dev` (not `no-reply@`), name "IB Planner".
    - The apex has no MX, so replies bounce.
    - If replies should reach someone, Cloudflare Email Routing can forward `team@` later.
  - **Template coupling:** the templates' product name matches the sender name.
  - **Turnstile widget:**
    - Managed mode.
    - Hostnames: the custom domain and the workers.dev host, never `localhost`.
    - Set both secrets with `wrangler secret put TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.
  - **Caps:** Resend Free's 100 per UTC day is the effective cap, and Pro is the fallback.
  - **The M365 smoke-test pass criteria**, verbatim from research § 10.
  - **What to do when mail is junked** without admin help.
  - SES eu-central-1 as standby.
- **`solver-credential.md:151-159`:** the `config push` table quotes the new `site_url` and `additional_redirect_urls` values, and the "stale even for local use" line goes.
- **`author-provisioning.md:117-132`:** remove the `supabase config push` route and the `<anon-key>` signup snippet. Point at `hosted-auth-settings.md`, and add "forgotten password → `/auth/forgot`".

#### 3. Product docs and the roadmap

**File**: `README.md`, `context/foundation/prd.md`, `context/foundation/roadmap.md`, `context/deployment/deploy-plan.md`, `src/_pages/account/api/unwrap-auth.ts`

**Intent**: Record the decisions made in this planning session where they belong.

**Contract**:
- **`README.md`:**
  - The `.envs/local.vars` snippet gains the two Turnstile test keys, with a note.
  - The Worker-secrets table gains `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.
  - The Auth routes table gains `/auth/forgot` and `/auth/confirm`.
  - The CI e2e and integration descriptions mention Mailpit.
- **`prd.md`:**
  - The §NFG flood line (`:126-127`) reads: "An **automated** flood of password-reset requests cannot prevent a genuine staff member from resetting their own password." Add a note recording the accepted residual: a person who solves the check can replace one colleague's link at most once per 5 minutes.
  - Open Question 2 notes that S-402 shipped at 1 h and the choice moves to S-410.
- **`roadmap.md`:**
  - S-402's link-lifetime unknown → "Block: no; S-402 ships at 1 h; decided at S-410".
  - The flood-guard unknown is marked decided: Turnstile in the Worker plus a 300 s interval.
  - Open Roadmap Question 2 → "Block: S-410".
  - The Backlog Handoff row's notes are updated.
- **`deploy-plan.md`:**
  - `:141,170` cite `src/shared/api/supabase.ts`.
  - `:163` records the Site URL move to the custom domain.
- **`unwrap-auth.ts`:** the docblock's "Promote this to `shared/api` when S-402 brings a second caller" becomes: S-402 maps Auth outcomes to redirects and did not need it; promote it when a second `DomainError` caller appears (S-409 or S-410).

#### 4. The hosted gate (by hand, before merge)

**File**: none (hosted Resend, Cloudflare DNS, Supabase Auth and the Worker; recorded in the runbooks)

**Intent**: Make production able to send and verify before the code that uses it ships.

**Contract**, in order, following the runbooks:
1. **Read current hosted Auth config** with a personal access token and note the before-values.
2. **Resend:**
   - **Done 2026-10-20** (the developer): domain verified, DKIM and the `send` CNAME are DNS-only.
   - **Still to do:**
     - ~~Replace the Cloudflare preset's DMARC TXT with `v=DMARC1; p=none;`~~ **Done 2026-10-20.** Verified on the authoritative nameserver and on 1.1.1.1. The apex `v=spf1 -all` and the `*._domainkey` wildcard stay.
     - Confirm click and open tracking are off, and that the API key is sending-only.
3. **Management API PATCH:**
   - **Already set** (2026-10-20, by hand): `smtp_host` `smtp.resend.com`, `smtp_port` `"465"`, `smtp_user` `resend`, `smtp_pass`, `smtp_admin_email` `team@ib-timetable-planner.dev`, `smtp_sender_name` `IB Planner`. The read-back in step 5 confirms them.
   - `site_url = "https://ib-timetable-planner.dev"`.
   - `uri_allow_list = "https://ib-timetable-planner.dev/**,https://ib-timetable-planner.dobromir-kropielnicki.workers.dev/**"`.
   - `mailer_otp_exp = 3600`, `smtp_max_frequency = 300`, `rate_limit_email_sent = 30`.
   - `security_captcha_enabled = false`.
   - The recovery subject and template, then the password-changed notification subject, template and `enabled = true`.
4. **Turnstile:** create the widget; set both Worker secrets.
5. **Read everything back**, and record the values and the hosted GoTrue version in `hosted-auth-settings.md` "Last verified".
6. **Merge** the PR when no production solve is running.

### Success Criteria:

#### Automated Verification:

- The full local CI gate passes on the final branch: run the `/verify` skill
- Formatting passes on the edited docs: `pnpm exec prettier --check README.md CLAUDE.md docs context/changes/forgot-password-by-email`

#### Manual Verification:

- The Resend domain shows "Verified", every DNS record is DNS-only (grey cloud), and `dig +short _dmarc.ib-timetable-planner.dev TXT` returns `v=DMARC1; p=none;`
- The hosted Auth read-back matches the runbook table, and "Last verified" records it with the GoTrue version
- The Turnstile widget exists with both hostnames, and `pnpm exec wrangler secret list` shows `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`
- No production solve is running; the PR is merged and the `deploy` job is green

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Hosted smoke (after merge)

### Overview

Prove on production what no local stack can: delivery to a real inbox, sender authentication, and scanner behaviour in the school's M365 tenant. Evidence gates archiving the change.

### Changes Required:

#### 1. Smoke evidence

**File**: `context/changes/forgot-password-by-email/smoke.md` (new)

**Intent**: Record both runs against the research's pass criteria, with addresses and names redacted (no production data in the repo), and the decision on the typed-code fallback.

**Contract**:
- **Developer-inbox run:** `Authentication-Results` (`spf`, `dkim`, `dmarc`), the link host, the full flow, the notification.
- **Coordinator M365 run:**
  - Delivered to the Inbox, not Junk.
  - `spf=pass`, with smtp.mailfrom on `send.` or `rsend.ib-timetable-planner.dev`. Record which one: both align with the apex under relaxed DMARC.
  - `dkim=pass header.d=ib-timetable-planner.dev`, `dmarc=pass`, and `compauth=pass`.
  - Research § 10 names `mail.ib-timetable-planner.dev`; the apex replaces it.
  - `X-Forefront-Antispam-Report` shows `SFV:NSPM` and `CAT:NONE`.
  - Any Safe Links-wrapped `url=` keeps `token_hash` and `type`.
  - Worker Logs show pre-click HEAD/GET to `/auth/confirm` and **no** POST.
  - The token is still valid 5 minutes or more after delivery, and the human's POST succeeds.
- **Verdict:** pass, or a follow-up change for the typed-code fallback.
- **DMARC follow-up:** on a pass, record the date to revisit tightening `p=none` (a few weeks of clean mail; relaxed alignment).

### Success Criteria:

#### Manual Verification:

- Developer-inbox smoke on `https://ib-timetable-planner.dev` passes: delivered, sender authentication passes, the reset completes end to end, and the notification arrives
- Worker Logs show `[forgot-password]` outcome lines with no email address, token or query string
- The coordinator's M365 smoke passes the research § 10 criteria, recorded redacted in `smoke.md`
- Scanner verdict recorded: no pre-click POST and the link survives scanning; otherwise a follow-up change for the typed code is opened

---

## Testing Strategy

### Unit Tests:

- **`parseEmailLink`:** a valid `recovery` link; refuses `invite`, `signup`, `magiclink`, `email_change` and an unknown type; refuses a missing, empty, over-long or odd-character `token_hash`; works on both `URLSearchParams` and `FormData`.
- **`forgotPageState` / `forgotPath`:** a round-trip for every reason; unknown values fall back to the plain form; `configured: false` always gives `unavailable`.
- **`toResetOutcome`:** a 200 with no error; 429 `over_email_send_rate_limit`; 429 `over_request_rate_limit`; 400 `email_address_invalid`, `validation_failed` and `email_address_not_authorized`; `AuthRetryableFetchError` with no code; a thrown `TypeError`. Each classifies, and none throws.
- **`preflightTurnstile` / `judgeSiteverify`:**
  - a missing or over-long token;
  - a missing secret;
  - a test secret on a non-loopback host versus on loopback;
  - a 400 with an invalid secret;
  - a 5xx or non-JSON body;
  - `success: false` with `timeout-or-duplicate`;
  - `success: true` with the wrong `action` or `hostname`;
  - `success: true` with `result_with_testing_key`.
- **`verifyTurnstile`:** an injected `fetch` sees a form-encoded body with `secret`, `response` and `remoteip`; a timeout or rejected fetch gives `transient`.

### Integration Tests:

- `src/test/password-recovery.integration.test.ts` (Phase 1 § 7): unknown address sends nothing, link shape, cross-client verify, single use, replacement, password set, and the notification. All of it runs against the local GoTrue and Mailpit, in CI too once Mailpit is re-included.

### Manual Testing Steps:

1. `pnpm build && pnpm preview` (restart the preview after every build). Then sign-in → **Forgot password?** → submit → read the sent notice.
2. Open Mailpit, copy the link, `curl -I` it twice, then open it in the browser and press **Continue**.
3. Set a new password on `/account`, sign out, and sign in with it. Check that the notification is in Mailpit.
4. Reopen the used link → **Continue** → the "expired or already used" copy.
5. Repeat step 2 with JavaScript disabled.

## Performance Considerations

- `POST /api/auth/forgot` adds one siteverify round trip (bounded at ~5 s, typically well under 300 ms).
- `/recover` runs in `waitUntil`, after the response, so its SMTP latency never reaches the visitor.
- `/auth/confirm` is a static render.
- The < 200 ms drag-drop budget and the middleware's per-request `getUser()` are unaffected; the two new public paths add a string comparison.

## Migration Notes

- **No database migration**, so `pnpm db:types` is not needed.
- **All hosted changes are by hand**, in the Management API and the Resend, Cloudflare and Turnstile dashboards. They are recorded in the runbooks and harmless if the code is reverted:
  - the templates point at `/auth/confirm`, which would 404, but no route could request a reset;
  - the notification keeps working for S-401's account page.
- **Rollback is roll-forward:** revert the PR. The Worker-only change needs no container rollout. The Turnstile secrets can stay.
- **For S-403:** `/auth/forgot` and `/auth/confirm` are public, and `/account?notice=recovery` must stay reachable for a user with no role (FR-410).

## References

- Research: `context/changes/forgot-password-by-email/research.md`
- Umbrella research and the Resend decision: `context/changes/user-managment-research/research.md:569-625`; carried tasks: `context/changes/user-managment-research/change.md:81-90`
- Prior slice: `context/archive/2026-10-16-account-self-service/plan.md`
- Patterns: `src/pages/api/auth/signin.ts:6-20` (form POST + redirect), `src/_pages/dashboard/ui/DashboardPage.astro:9-19` (notice via `Banner`), `src/test/account-self-service.integration.test.ts` (Auth integration suite), `e2e/specs/account.spec.ts:71-81` (hydration gate)
- Turnstile: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/, https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- Supabase email templates and prefetching: https://supabase.com/docs/guides/auth/auth-email-templates

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Local mail & the recovery core

#### Automated

- [x] 1.1 Local stack restarted on the new config, and `pnpm exec supabase status` no longer prints the `[inbucket]` deprecation warning
- [x] 1.2 Type check passes: `pnpm check`
- [x] 1.3 Lint and FSD structure pass: `pnpm lint` and `pnpm steiger`
- [x] 1.4 Unit tests pass: `pnpm test` (email-link, forgot-page-state, reset-outcome)
- [x] 1.5 The new suite passes: `pnpm test:integration src/test/password-recovery.integration.test.ts`
- [x] 1.6 The whole lane passes: `pnpm test:integration` (re-run once on a transient 502, a known flake)

#### Manual

- [x] 1.7 In Mailpit, the recovery email and the password-changed notification look right, and the recovery link's host is `localhost:4321`

### Phase 2: Turnstile gate & the auth endpoints

#### Automated

- [ ] 2.1 Unit tests pass: `pnpm test` (turnstile-verdict, verify-turnstile, plus Phase 1's)
- [ ] 2.2 Type check, lint and FSD pass: `pnpm check`, `pnpm lint`, `pnpm steiger`
- [ ] 2.3 Production build passes, including the `postbuild` client-bundle assertion: `pnpm build`

#### Manual

- [ ] 2.4 Deliberate break: `sb_publishable_x` in a client island fails `pnpm build`, naming the file; reverted
- [ ] 2.5 Preview probes: GET/HEAD on both endpoints return 404, a foreign-`Origin` POST returns 403, and a POST with no token redirects to `?error=verification`

### Phase 3: Pages & browser coverage

#### Automated

- [ ] 3.1 E2E passes: the new spec, the guard additions and every existing spec, `auth.setup.ts` included: `pnpm test:e2e`
- [ ] 3.2 The full local CI gate passes: run the `/verify` skill

#### Manual

- [ ] 3.3 The flow walked on the preview, end to end
- [ ] 3.4 `/auth/confirm` works with JavaScript disabled
- [ ] 3.5 Confirm-page headers present; no extra script and no token in any `href`
- [ ] 3.6 Both pages work by keyboard alone, and the alerts are announced
- [ ] 3.7 With the Turnstile keys removed, the forgot page and endpoint show the unavailable state; keys restored

### Phase 4: Docs, rules & the hosted gate

#### Automated

- [ ] 4.1 The full local CI gate passes on the final branch: run the `/verify` skill
- [ ] 4.2 Formatting passes on the edited docs: `pnpm exec prettier --check README.md CLAUDE.md docs context/changes/forgot-password-by-email`

#### Manual

- [x] 4.3 The Resend domain is verified, every DNS record is DNS-only, and DMARC resolves to `p=none` — 2026-10-20 (hosted, by hand; DMARC verified with `dig` on the authoritative nameserver)
- [ ] 4.4 The hosted Auth read-back matches the runbook table, recorded with the GoTrue version
- [ ] 4.5 The Turnstile widget exists with both hostnames, and both Worker secrets are set
- [ ] 4.6 No production solve is running; the PR is merged and `deploy` is green

### Phase 5: Hosted smoke (after merge)

#### Manual

- [ ] 5.1 Developer-inbox smoke on the custom domain passes
- [ ] 5.2 Worker Logs show outcome lines with no email address, token or query string
- [ ] 5.3 The coordinator's M365 smoke passes the research § 10 criteria, recorded redacted in `smoke.md`
- [ ] 5.4 Scanner verdict recorded: no pre-click POST, or a follow-up change for the typed code is opened
