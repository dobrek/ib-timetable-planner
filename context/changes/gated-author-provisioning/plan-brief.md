# Gated Author Provisioning — Plan Brief

> Full plan: `context/changes/gated-author-provisioning/plan.md`

## What & Why

Close the open self-service registration the starter ships with so only authors
created out-of-band (manually, in Supabase Studio / the hosted dashboard) can hold an
account. This is roadmap foundation **F-01** and a hard prerequisite for every
PII-bearing slice — per **NFR Data privacy**, student names and choices cannot sit
behind a public signup form.

## Starting Point

Auth is fully wired but open: a signup page → form → `/api/auth/signup` calls
`supabase.auth.signUp()`, `config.toml` has `enable_signup = true`, and middleware
gates only `/dashboard` — everything else (including `/`) is public.

## Desired End State

No reachable way to self-register (`/auth/signup` 404s, the endpoint is gone, and
Supabase rejects `signUp`), every route requires a session except sign-in + auth
APIs + assets, and a manually-created author can sign in. A runbook documents
provisioning and hosted closure.

## Key Decisions Made

| Decision         | Choice                                      | Why (1 sentence)                                                     | Source |
| ---------------- | ------------------------------------------- | -------------------------------------------------------------------- | ------ |
| Gate mechanism   | Manual creation in Studio / dashboard       | Lowest code & risk for a handful of authors; no new secret or table. | Plan   |
| Signup surface   | Remove entirely                             | Eliminates the public attack surface; recoverable from git for v2.   | Plan   |
| Route protection | Deny-by-default + public allowlist          | Matches PRD "reject at every gated route"; future slices auto-gated. | Plan   |
| Bootstrap author | Documented manual runbook step              | Zero code, honest fit for a manual-creation gate.                    | Plan   |
| Enforcement      | App + Supabase `enable_signup = false`      | A gate bypassable by a direct API call isn't a gate.                 | Plan   |
| Service-role key | Not introduced                              | Manual gate needs no admin API; avoids an unused high-priv secret.   | Plan   |
| Prod scope       | Local enforced + prod documented as runbook | Keeps the diff CI-verifiable and free of live prod creds.            | Plan   |

## Scope

**In scope:** delete signup page/form/endpoint + orphaned confirm-email page; remove all signup links; `enable_signup = false` in `config.toml`; deny-by-default middleware; provisioning runbook + README fixes.

**Out of scope:** in-app invite flow, service-role key, allow-list table, domain schema (F-02), SMTP/email confirmation, redesigning the `/` landing, executing hosted changes, automated tests.

## Architecture / Approach

Two enforcement layers. **App:** the signup surface is deleted and `src/middleware.ts`
flips from an explicit protected-list to deny-by-default — every route redirects
unauthenticated users to `/auth/signin` unless its path is on a public allowlist
(`/auth/signin`, `/api/auth/*`, Astro/static internals). **Supabase:**
`enable_signup = false` so the auth REST endpoint also refuses registration. Accounts
are created by hand; a runbook covers local + hosted.

## Phases at a Glance

| Phase                         | What it delivers                                      | Key risk                                               |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| 1. Close the gate             | Signup surface removed; Supabase signup disabled      | Missing a dangling import/link → build or dead UI      |
| 2. Deny-by-default protection | Middleware gates all routes except a public allowlist | Allowlist too narrow → blocks sign-in or static assets |
| 3. Runbook & doc fixes        | Provisioning runbook + corrected README references    | Hosted-closure steps drift from the live dashboard     |

**Prerequisites:** local Supabase stack runnable (`supabase start`); none of F-02+ required.
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- `config.toml` `enable_signup` governs local only; hosted closure is a manual dashboard step (documented, not executed here) — prod stays open until the author runs the runbook.
- Deny-by-default depends on a correct public allowlist; an over-narrow list locks sign-in or breaks asset loading (covered by Phase 2 manual checks).
- The stock `/` landing (`Welcome.astro`) becomes a post-auth-only page; only its signup link is removed, its starter content is left as-is.

## Success Criteria (Summary)

- No self-registration is possible from the UI or a direct Supabase API call.
- Every route redirects unauthenticated users to sign-in; a manually-created author signs in and reaches protected pages.
- A runbook lets the author provision accounts and close hosted registration.
