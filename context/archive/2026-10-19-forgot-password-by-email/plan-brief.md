# Forgot Password by Email (S-402) — Plan Brief

> Full plan: `context/changes/forgot-password-by-email/plan.md`
> Research: `context/changes/forgot-password-by-email/research.md`

## What & Why

Any staff member can reset a forgotten password from the sign-in page, through an email that reaches a real school inbox (FR-412). Today a forgotten password needs the developer and the Supabase dashboard.

Three hazards shape the design:
- **Mail scanners spend one-time links.** Microsoft Defender Safe Links GETs and HEADs links, and runs their JavaScript, before anyone clicks.
- **A public reset endpoint can be flooded.** Each request replaces the previous link, and Resend Free allows 100 emails per day.
- **This is the first email the product ever sends**, through DNS and hosted settings changed by hand.

## Starting Point

- **What already works:**
  - The Worker's publishable key can request and verify reset links. No secret key and no migration are needed.
  - S-401's `/account` password form works unchanged on a recovery session.
- **What is missing:**
  - Resend and Supabase custom SMTP are live since 2026-10-20: the apex `ib-timetable-planner.dev`, sending as `team@ib-timetable-planner.dev` ("IB Planner").
  - The DMARC record is still missing, the recovery template is still Supabase's default, and the Site URL is still the `workers.dev` URL.
  - Local Auth points at a dead port.
  - CI excludes Mailpit.
- **What is true but unstated:** the key never reaches the browser, and nothing enforces that yet. This plan makes it a rule.

## Desired End State

1. **Request.** A visitor clicks **Forgot password?**, passes a Turnstile check, and always sees the same notice. They receive one plain email with one link.
2. **Confirm.** The link opens a page that scanners can fetch any number of times without spending it. A person pressing **Continue** signs in and lands on `/account` with a banner, sets a password of at least 15 characters, and gets a "password changed" email.
3. **Bad links.** A used, replaced or expired link lands back on the request form, with copy saying why.
4. **Proof.** Production delivers into the coordinator's M365 inbox with SPF, DKIM and DMARC passing, and no scanner POST is seen.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Link flow | `{{ .TokenHash }}` → `/auth/confirm` (renders on any method, no side effects) → native POST → `verifyOtp` | The default `ConfirmationURL` is spent on GET, and PKCE `?code=` links fail across devices | Research |
| Link lifetime (Open Roadmap Q2) | Ship at the platform's 1 h; move the a/b/c choice to S-410 | S-402's code is identical under every option, and 1 h meets the PRD as written | Plan |
| Flood guard | Turnstile verified in the Worker + 300 s per-user resend interval; never Supabase CAPTCHA | Supabase CAPTCHA would break the solver's password sign-in | Research |
| Turnstile failure | Fail closed with honest copy; test keys accepted only on loopback | A missing secret or a test secret on production must never silently drop the guard | Plan |
| Residual risk | Accept a human replacing one link per 5 min; reword the PRD guardrail to "automated flood" | The guardrail then states what the mechanism proves | Plan |
| Response | One neutral notice for every outcome; the real outcome only in server logs; the send runs in `waitUntil` | Neither the content nor the timing reveals which addresses have accounts | Plan |
| Notice copy | States 1 h, single use, newest email wins, Junk, wait 5 min | Explains the silent re-request refusal and the dead older link without leaking anything | Plan |
| Set-password step | 303 to `/account?notice=recovery` with a banner | Smallest change, no cross-slice import, works for role-less users later | Plan |
| Typed code | Not in v1; it is the fallback if M365 shows a pre-click POST | Same secret as the link, and it adds a brute-force target | Research |
| Password-changed email | On, with a project template | The only signal an owner gets if a hijacked session changes their password | Plan |
| Site URL | `https://ib-timetable-planner.dev` (both hosts allow-listed) | The link domain matches the sending domain `ib-timetable-planner.dev` | Plan |
| Ship order | Hosted setup first, by hand → one PR → merge → hosted M365 smoke gates archiving | Mail sent before SMTP is live would look sent and never arrive | Plan |
| Provider | Resend via Supabase custom SMTP; apex `ib-timetable-planner.dev`; sender `team@` "IB Planner" | Provider decided 2026-10-10; domain and sender set up by the developer 2026-10-20 (the apex, not `mail.`) | Research / developer |

## Scope

**In scope:**
- **New surface:**
  - `/auth/forgot` and `/auth/confirm`.
  - `POST /api/auth/forgot` and `POST /api/auth/confirm`.
  - The sign-in link and the account banner.
  - The middleware allowlist, each entry with its reason.
- **Email:** the recovery and password-changed templates; local config (URLs, `[local_smtp]`).
- **CI:** Mailpit re-included; Turnstile test keys in `.dev.vars`.
- **Guards:** a `postbuild` check that `dist/client` holds no Supabase key or host; `redact_query_string` in Workers Logs.
- **Tests:** unit, a Mailpit integration suite, an e2e spec with a scanner simulation, guard checks.
- **Docs:** CLAUDE.md rules; runbooks (hosted Auth, email delivery); PRD, roadmap and README edits.
- **Hosted:** setup by hand, then the smoke test.

**Out of scope:**
- The typed code.
- An invite-length lifetime (S-410).
- WAF or rate-limit bindings; Resend Pro.
- A dedicated new-password page.
- A client-side cooldown.
- A CSP.
- The future of `workers.dev`.
- Admin-triggered reset (S-409).

## Architecture / Approach

A new `_pages/password-recovery` slice:
- **`model/`:** pure rules — link parsing with a `type` allowlist, page-state vocabulary, outcome classification, the Turnstile verdict, lifetime constants.
- **`api/`:** `requestPasswordReset` on a sessionless implicit-flow client, `verifyEmailLink` on the cookie-bound client, and `verifyTurnstile`.
- **`ui/`:** two server-rendered `.astro` pages with native forms and no hydrated islands.

Thin API routes verify, act and 303. The allowlist on `/auth/confirm` is meant to grow: S-410 adds `invite`, S-411 adds `email_change`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Local mail & recovery core | Config, templates, CI Mailpit, sessionless client, model, the two Auth functions, Mailpit integration suite | Stack restart needed for templates; shared per-IP Auth rate limits in a flaky lane |
| 2. Turnstile gate & endpoints | Env keys, fail-closed verdict, both POST routes, allowlist, bundle check, log redaction | Test secrets give `example.com` and no `action`, handled by the loopback-only gate |
| 3. Pages & browser coverage | `/auth/forgot`, `/auth/confirm`, sign-in link, account banner, e2e flow + guard checks | The e2e widget loads from `challenges.cloudflare.com` in CI; the first e2e use of the service-role key |
| 4. Docs, rules & hosted gate | CLAUDE.md, runbooks, PRD/roadmap edits; Resend, DNS, SMTP, Auth PATCH, Turnstile secrets; the merge | Hand-set hosted values drift from repo copy (mitigated by read-back + runbook) |
| 5. Hosted smoke | Developer-inbox and M365 runs recorded in `smoke.md` | M365 junks the message, or a scanner spends the POST → follow-up change for the typed code |

**Prerequisites:**
- A Resend domain, Supabase custom SMTP and DMARC `p=none`: all done 2026-10-20.
- Cloudflare DNS access for `ib-timetable-planner.dev`.
- A Supabase personal access token.
- A local stack restart after Phase 1's config.
- The coordinator's M365 inbox, for Phase 5 only.

**Estimated effort:** about 3–4 sessions of code (Phases 1–3), plus one session for docs and the hosted gate, plus a smoke test scheduled with the coordinator.

## Open Risks & Assumptions

- **Scanner behaviour.** No public report shows Safe Links submitting a native `<form method="post">`. If the M365 smoke test shows it, the typed-code fallback becomes a follow-up change.
- **The apex sends the mail**, not a `mail.` subdomain, so any future mail from `ib-timetable-planner.dev` shares its reputation. `team@` has no inbound mailbox, so replies bounce. Both are accepted as built.
- **DMARC is temporarily `p=none`** (decided 2026-10-20). It replaces Cloudflare's strict `p=reject` preset, under which SPF could never align and any DKIM failure would be a silent reject behind the neutral notice. Tightening is a follow-up after the M365 smoke test.
- **A new sending domain** may be junked at first. The recovery path without admin help is Not junk, Safe Senders and a steady cadence (runbook).
- **Hosted GoTrue v2.197.0** is assumed to match local v2.196.0 for `/recover` and `/verify`. The smoke test confirms it.
- **The guard depends on the publishable key staying server-only.** The `postbuild` check and a CLAUDE.md rule now pin it.
- **Coupled copy.** The UI copy and template say "1 hour" and "5 minutes", mirroring two hosted values. Changing either value means changing the copy too (runbook).

## Success Criteria (Summary)

- A staff member resets their own password from the sign-in page into the school's M365 inbox, with no developer involved, and gets a "password changed" email.
- Opening the link without pressing Continue, by a scanner or by curl, never spends it.
- No answer, by content or timing, reveals whether an address has an account. Automated floods are stopped by the Turnstile check.
