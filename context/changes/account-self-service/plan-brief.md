# Account Self-Service (S-401) — Plan Brief

> Full plan: `context/changes/account-self-service/plan.md`
> Research: `context/changes/account-self-service/research.md`

## What & Why

Every signed-in user gets an **Account** page (from the sidebar footer) to change their own password and set a display name. Today no screen allows either — the provisioning runbook tells new authors to "change the password", which they cannot. This is the smallest slice of the user-management milestone (M-02): it needs no role, no email and no secret, and it is where the PRD's 15-character password floor first lands, so every later password path (reset, forced change, invite) inherits it.

## Starting Point

Sign-in/sign-out exist as API routes; Actions have a `requireSession → requireSupabase → runDomain` pipeline with PostgREST-only error translation; the sidebar footer shows the bare email; `minimum_password_length` is 6 locally and unrecorded on hosted; the role-matrix harness assumes every table hangs off a plan. No `profiles` table, no `user_metadata` use, no `pnpm db:types`.

## Desired End State

A user opens Account, types a name, and the footer shows it with their email beneath. They type a new password twice; it must be 15+ characters (≤ 72 bytes), the server refuses anything shorter even when called directly, they stay signed in here and their other devices are signed out on their next request. Users whose existing password is under 15 characters see a dismissible banner after sign-in pointing at Account. Hosted's three relevant Auth settings are recorded as verified.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Current-password rule | None; hosted "Require current password" and "Secure password change" verified **off** | PRD FR-411 dropped it (a reset-link arrival cannot supply it); the nonce variant needs email this slice lacks; the session-hijack trade-off is accepted | Research (PRD) |
| Where the floor lives | Supabase Auth config (local `config.toml`, hosted by hand); Zod is UX only | `@supabase/ssr` cookies are not HttpOnly, so a user can `PUT /auth/v1/user` around the form | Research |
| Display-name storage | `public.profiles (user_id PK → auth.users, display_name nullable, CHECK)` with own-row RLS, no trigger, no DEFINER | Validated in the DB and readable by S-406/S-407; `user_metadata` is invisible to others and unvalidated | Plan |
| Where the name shows now | Sidebar footer link: name, email beneath (email alone when unset) | Setting a name has an immediate visible effect and honours FR-413's "email beside name" | Plan |
| Legacy short passwords | Dismissible nudge banner from sign-in's `weakPassword` hint via a session cookie | Honours "refused" at set time without locking anyone out; the forced flow belongs to S-409 | Plan |
| Confirm field | Yes, two `PasswordInput`s (client-only match rule) | A typo is otherwise found at the next sign-in, and there is no self-service reset before S-402 | Plan |
| Transport | Astro Actions (`defineDomainAction`), not an API route | API routes are reserved for session endpoints; forms get RHF field errors | Research |
| Caller identity | `requireSession` returns the `User`; `run(supabase, input, { userId })` | Avoids a second `getUser()` round trip; existing domain functions keep compiling | Plan |
| Success feedback | Password form skips the reload (toast survives); name form reloads to `/account?saved=name` with a server-rendered status | `refreshPage()` is a full reload with no `<ClientRouter />`, which kills toasts; the footer needs the reload | Research |
| E2E isolation | Second fixed account + `chromium-account` project, signed in by the existing `setup` | Password mechanics proven at integration level; no spec drives the sign-in UI; no shared-author mutation | Plan |
| HC Fix 4 split | Only `minimum_password_length` here | Matches the roadmap; `site_url`/redirects/`[local_smtp]` are S-402's and untestable without email | Plan |

## Scope

**In scope:** `/account` route + `_pages/account` slice (two forms, one island); `profiles` migration with RLS/grants; `AuthError → DomainError` mapper and two new domain codes; `PasswordInput` in `shared/ui` (sign-in adopts it + autocomplete attributes); token-clean `Banner`; weak-password cookie + banner; sidebar footer account link; role-matrix generalization (per-table fixture key, own/other write cells) and solver-guard coverage; `pnpm db:types` (HC Fix 8); integration suite for password mechanics; second e2e account + three specs; runbooks incl. a new hosted-auth-settings checklist; `.editorconfig` (HC Fix 10).

**Out of scope:** reset email / SMTP / `site_url` (S-402); `email` in `profiles`, `auth.users` trigger, rows for users who never set a name (S-406); any `SECURITY DEFINER` (S-403); forced password change (S-409); character-class rules; HIBP; React in the shell; `<ClientRouter />`; middleware changes; a password click-through in Playwright.

## Architecture / Approach

`SidebarLayout` → `loadOwnProfile` (`shared/api`) → footer link → `/account` page passes `{ email, displayName }` to one `AccountSettings` island. Each form: shared Zod schema → RHF resolver and action `input` → `account-client.ts` → `defineDomainAction` → domain fn. `updatePassword` calls `auth.updateUser({ password })` read through `unwrapAuth` (new `shared/api/auth/`); `updateDisplayName` upserts `profiles` (`return=minimal`) with the actor id. `signin.ts` sets/clears the `weak-password` cookie; the shell renders the banner from it. The matrix probes `profiles` by `user_id` with a dedicated fixture owner.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer & access proof | Floor = 15 locally, `profiles` migration, `pnpm db:types`, matrix + solver-guard coverage | Harness generalization is the hidden cost; grant lists must match exactly |
| 2. Shared plumbing | Domain codes, auth mapper, actor param, `PasswordInput`, token-clean `Banner` | Sign-in toggle rename would break the e2e setup gate — keep "Show password" |
| 3. Account slice | Schemas, domain fns, actions, island, route, integration suite | Other-session revocation must be proven, not assumed |
| 4. Shell, nudge & e2e | Footer link, weak-password banner, second e2e account, 3 specs | Toast-vs-reload UX; second storageState wiring in CI |
| 5. Docs & hosted | Hosted checklist runbook, runbook edits, CLAUDE.md/README, `.editorconfig`, roadmap drift | Hosted toggles are hand-set and unverifiable from the repo |

**Prerequisites:** local Supabase stack; hosted dashboard / Management API access for Phase 5; no production solve running at any merge.
**Estimated effort:** ~4–5 sessions; Phase 1 and Phase 3 carry most of the work.

## Open Risks & Assumptions

- Hosted "Secure password change" / "Require current password" state is unknown until Phase 5's check; if either is on, every change fails with a mapped "misconfigured" error until it is turned off by hand.
- The CHECK regex uses Postgres ARE `\u` escapes — proven live by the matrix's `23514` cell, not assumed.
- Hosted GoTrue version unverified (local is v2.196.0); nothing here needs a newer feature.
- The middleware/action double token refresh already exists today and is tolerated by `refresh_token_reuse_interval`; the integration suite exercises `updateUser` after a fresh sign-in only.
- Two `loadOwnProfile` reads on `/account` (shell + page) are accepted.

## Success Criteria (Summary)

- A user changes their password (15+ chars) and display name from `/account`, stays signed in, and sees the name in the footer; other devices are signed out on their next request.
- Short or reused passwords are refused server-side; `profiles` is provably readable by signed-in users, writable only by its owner, unreachable to `anon` and the solver role.
- All CI lanes green (verify, integration, e2e, solver); hosted floor set and both toggles recorded off before merge.
