---
date: 2026-10-16T22:59:55+02:00
researcher: Claude (Opus 5.5)
git_commit: a86f52c7419fad8e06601b49baf6bf8512c12b2a
branch: main
repository: dobrek/ib-timetable-planner
topic: "S-401 account self-service: feasibility and UI challenges of an in-app password change, a display name and a 15-character password floor"
tags: [research, codebase, auth, supabase-auth, gotrue, account, display-name, profiles, sidebar, forms, role-matrix, e2e, S-401]
status: complete
last_updated: 2026-10-16
last_updated_by: Claude (Opus 5.5)
---

# Research: S-401 account self-service — feasibility and UI challenges

**Date**: 2026-10-16T22:59:55+02:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: a86f52c7419fad8e06601b49baf6bf8512c12b2a
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Roadmap S-401 (`context/foundation/roadmap.md:136-148`). Any user can open an account page from the sidebar, change their own password and set a display name. A password shorter than 15 characters is refused. The PRD refs are FR-411, FR-413 and §NFG ("Passwords shorter than 15 characters are refused", `prd.md:130`).

The question has two parts:

- **Feasibility.** Can this be built on today's plumbing, which runs on Workers with only the publishable key, forbids `SECURITY DEFINER`, allows additive migrations only, and changes hosted auth config by hand?
- **UI challenges.** Which UI problems will implementing it run into?

The roadmap names two unknowns, and this research answers both:

- the current-password rule;
- where the display name must live so that S-406 and S-407 can read it later.

## Summary

**Verdict: feasible, with no code-level blocker. The real risks sit outside the repo, plus one harness cost that is easy to underestimate.**

1. **The password change works on existing plumbing.**
   - An Astro Action calls `supabase.auth.updateUser({ password })` on the server client its handler already builds from `context.cookies`.
   - GoTrue returns only the updated user, with **no new tokens**. The current session stays alive.
   - `@supabase/ssr` fires `setAll` on `USER_UPDATED`. Cookies written in an action reach the response.
   - GoTrue **deletes every other session of the user**. This is hard-coded, and no setting turns it off.
   - The middleware calls `getUser()` on every request, so other devices are signed out on their next request.
   - What has to be built: an `AuthError` → `DomainError` mapper (none exists; `toDomainError` is PostgREST-only) and two new `DomainErrorCode`s.

2. **Two hosted auth toggles could silently break it, and neither is visible from the repo.**
   - "Secure password change" (`secure_password_change` / `security_update_password_require_reauthentication`), if on, demands an emailed nonce from any session older than 24 h. Sessions never expire today, so that is nearly every user, and S-401 has no email.
   - "Require current password when updating" (`security_update_password_require_current_password`) has **no `config.toml` key at all**. Local and CI can never reproduce a hosted flip, and a flip turns every change into `current_password_required`.
   - Both must be verified **off** on hosted before the plan relies on them. The PRD supersedes the research's "enable Require current password" (FR-411, `roadmap.md:145`).

3. **The 15-character floor must live in GoTrue config. App validation is only UX.**
   - `@supabase/ssr` cookies are not `HttpOnly`, so a user can `PUT /auth/v1/user` directly.
   - The floor goes into local `config.toml:175` (`6` → `15`) and into hosted `password_min_length`, set by hand.
   - GoTrue counts **UTF-8 bytes** (`len(password)`) and caps passwords at **72 bytes** (`validation_failed`, 400).
   - Existing users with shorter passwords are **not locked out**. Sign-in returns a `weakPassword` hint in `data`, which `signin.ts:13` discards today.
   - Every repo, CI and e2e password is already 15 characters or longer.

4. **Display-name storage is the one real design decision.** No option in S-401 alone can give S-406 "every user, with email", because emails and never-visited users exist only in `auth.users`. S-406 must build an `auth.users` reader whatever S-401 picks. S-401 decides only where the name's source of truth lives.
   - **Recommended:** a `public.profiles (user_id, display_name)` table. The user upserts their own row under RLS (`user_id = auth.uid()`), and a CHECK constraint validates the name. It needs no trigger and no DEFINER.
   - **Make `display_name` nullable**, so S-406's mirror can later add rows for users who never set a name.
   - **Hidden cost:** the role-matrix harness assumes plan-rooted tables (`planKey` returns `id` or `plan_id`, `access-probe.ts:123`). A non-plan table forces a harness generalization, plus new "own row vs another's row" write cells.
   - The lighter alternative is `user_metadata.display_name`: no migration, but no database validation, and invisible to other users.

5. **UI challenges, most significant first.**
   - **Feedback is destroyed by the refresh.** `submitForm` toasts and then calls `refreshPage()`. With no `<ClientRouter />` that is a full reload, which wipes the toast. The name form needs that reload to update the server-rendered sidebar.
   - **The entry point belongs in the sidebar footer, not `GLOBAL_NAV_ITEMS`.** Nav items also feed the dashboard cards, and S-403/S-405 will gate them by role, while the account page must stay reachable without a role (FR-410).
   - **The password show/hide toggle is private to the sign-in slice** and must be promoted to `shared/ui`.
   - **Password managers.** The CRUD forms' `autoComplete="off"` must not be copied. The form needs a username field and `autocomplete="new-password"`.
   - **A confirm field is advisable.** S-401 ships before self-service reset (S-402), so a mistyped new password goes unnoticed until the next sign-in, and recovery then needs the developer.
   - **E2E isolation.** A password-change spec needs a throwaway user. All `chromium` specs share one author session, and its provisioning never resets the password.

## Detailed Findings

### 1. The password-change mechanism on today's plumbing

**The server client and cookies.**
- `createClient(requestHeaders, cookies)` (`src/shared/api/supabase.ts:6-28`) reads cookies from the raw `Cookie` header (`:12-16`) and writes them through `AstroCookies.set` (`:18-22`).
- Actions build their own client from `context.cookies` (`src/shared/lib/actions/require-supabase.ts:5`). There is no client on `locals`.
- The action handler runs on the same per-request `AstroCookies`, and Astro attaches those cookies to the response after the endpoint returns (`node_modules/astro/dist/core/middleware/astro-middleware.js:42`; the CF adapter emits them at `@astrojs/cloudflare/dist/utils/handler.js:86`).

**What `updateUser` does on the client.**
- auth-js 2.116.0 `_updateUser` reads the stored session and sends `PUT /user`.
- On success it runs `session.user = data.user`, then `_saveSession`, then `USER_UPDATED` (`GoTrueClient.js:2883-2885`).
- `@supabase/ssr` 0.12.7 listens for `USER_UPDATED` and calls `setAll` (`createServerClient.js:52-65`).
- The tokens are unchanged, so a lost cookie write would be harmless: the only stale part would be the user object inside the cookie.

**Two things to do in the call itself.**
- **Never pass `email` in the `updateUser` call.** The server client forces PKCE. A non-null `email` makes auth-js write a code verifier cookie, and a *different* email starts an email-change flow, which sends mail.
- **No `getUser()` first.** `updateUser` refreshes an expired access token itself (`TOKEN_REFRESHED` → `setAll`). With no session it throws `AuthSessionMissingError` before any request is sent.

**A double refresh that already exists today.**
- If the middleware's `getUser()` refreshes tokens in the same request, the action's second client still reads the *old* `Cookie` header (`supabase.ts:13`) and refreshes again with the parent token.
- That works because of `refresh_token_reuse_interval = 10` (`config.toml:167`). Hosted is presumably on the platform default, which is unverified. Last `cookies.set` wins.
- This is not new to S-401, but a password change is a good moment to prove it in a test.

**How actions are built.**
- `defineDomainAction` (`src/shared/lib/actions/define-domain-action.ts:13-26`) runs `requireSession` → `requireSupabase` → `runDomain(() => run(supabase, input))`.
- `run` receives the full `SupabaseClient<Database>`, so `supabase.auth.*` is callable.
- It receives **no user id** (`:15`). A profile write needs the caller's id from one of three places: a column default `auth.uid()`, a widened `run` signature, or an extra `getUser()`. That is a plan detail.

**Error translation is missing.**
- `runDomain` (`run-domain.ts:8-17`) translates only `DomainError`.
- `toDomainError` (`src/shared/api/postgrest/to-domain-error.ts:15-19`) is keyed on SQLSTATE and PostgREST codes. It is not exported from its barrel, and its `{ code: string }` type does not fit `AuthError.code`, which is optional.
- auth-js returns `{ error }` rather than throwing.
- `DomainErrorCode` (`src/shared/lib/errors/domain-error.ts:9-14`) has no `UNAUTHORIZED` or `TOO_MANY_REQUESTS`. Both are valid `ActionError` codes, so adding them is a 1:1 extension.

**`/_actions/*` is public at the middleware.**
- The `"/_"` prefix (`src/middleware.ts:8-11`) matches `/_actions/*`, so `requireSession` is the only gate for actions. This holds for every action today.
- `updateUser` fails closed without a session anyway.

**Recommendation:** use an Astro Action, not an API route. `lessons.md:23` reserves API routes for *session* endpoints (sign-in and sign-out), and a password change is a user mutation that should get RHF field errors like every other form.

### 2. What GoTrue does on a password change

Verified against the `supabase/auth` source fetched for this research: `internal/api/user.go`, `internal/models/user.go`, `internal/api/password.go`. Local now runs **GoTrue v2.196.0**, the default image of CLI 2.117.0. The roadmap's "v2.189.0 locally" is stale: that was the old link snapshot, moved aside in F-402. The hosted version is unverified; `GET https://<ref>.supabase.co/auth/v1/health` reports it.

**What happens to sessions.**
- `UserUpdate` calls `user.UpdatePassword(tx, sessionID)` (user.go:214). That calls `LogoutAllExceptMe`, which runs `DELETE FROM sessions WHERE id != ? AND user_id = ?`. Refresh tokens cascade with their sessions.
- It also clears the recovery, confirmation, reauthentication and email-change tokens.
- The response is the user only, with no new tokens.
- On the other devices, the next `getUser()` gets `session_not_found`. auth-js surfaces that as `AuthSessionMissingError` and emits `SIGNED_OUT`, and `setAll` clears their cookies.
- An access token already issued still verifies statelessly at PostgREST until `exp`, which is at most `jwt_expiry = 3600` s. But every page load goes through the middleware's `getUser()` first.

**Errors to map.** HTTP status and code come from `apierrors`. The handling column is a proposal.

| Condition | HTTP | `error.code` | Proposed handling |
|---|---|---|---|
| Below the length floor, character rules, or HIBP leak | 422 | `weak_password` (`AuthWeakPasswordError`, `.reasons`: `length` \| `characters` \| `pwned`) | Field error on the new password |
| New password equals the old one | 422 | `same_password` | Field error |
| Longer than 72 **bytes** | 400 | `validation_failed` | Field error. The client should catch it first |
| Hosted "Secure password change" is on and the session is older than 24 h | 400 | `reauthentication_needed` | Server misconfiguration: generic error plus `console.error` |
| Hosted "Require current password" is on | 400 | `current_password_required` / `current_password_invalid` | Server misconfiguration, same handling |
| Rate limit | 429 | `over_request_rate_limit` | "Try again in a few minutes" |
| Session gone (this device revoked, or no cookie) | — | `AuthSessionMissingError` (status 400, `code` undefined) | `UNAUTHORIZED` → sign-in |

**Rate limit.** `PUT /user` shares the per-IP `sign_in_sign_ups` bucket (`config.toml:190`: 30 per 5 min). The request comes from the Worker's egress IP, and IP forwarding needs a secret key that the Worker does not hold. For one school this is low risk, but it should still be mapped.

### 3. The hosted toggles that can silently break it

**"Secure password change" (the reauthentication nonce).**
- config.toml `[auth.email] secure_password_change` maps to `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION`.
- It demands a nonce only when the flag is on **and** the session is either `nil` or more than 24 h old (user.go:157). The clock is session *creation*; a token refresh does not reset it.
- The nonce is delivered **by email** (`auth.reauthenticate()`).
- Local is `false` (`config.toml:214`). Hosted is **unverified**.
- **Docs bug:** the CLI config spec says this setting "requires the user's current password". That is wrong. The research's OQ10b probe (`user-managment-research/research.md:510`) and the runbook row (`docs/runbooks/solver-credential.md:156`) describe it correctly.

**"Require current password when updating".**
- GoTrue flag: `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD`, introduced in v2.187.0, with the recovery-session exemption fixed in v2.189.0.
- Request field: `current_password`; supabase-js supports it from 2.102.
- It is a hosted Studio toggle. **The CLI exposes no config key for it**, so local and CI are always off.
- A recovery session is exempt (AMR `otp`, `magiclink` or `recovery`; user.go:175). That is relevant to S-402.

**Plan consequence.**
- Add a by-hand check, recorded in a runbook, that hosted has both `security_update_password_require_reauthentication: false` and `security_update_password_require_current_password: false`. The source is `GET /v1/projects/hwmuiymhjgewtymymbmb/config/auth` on the Management API, which is read-only.
- Map the codes those toggles produce to a "misconfigured" error, so a hosted flip shows up as a loud failure rather than a confusing field error.
- The runbook's "do not `config push`" row for `secure_password_change` (`solver-credential.md:156`) should say it is deliberately off per FR-411.

**The accepted trade-off.** With no current-password check, anyone holding a live session (a stolen cookie, an unlocked shared PC) can change the password and lock the owner out (`prd.md:219-221`). Until S-402 there is no self-service recovery, so the owner needs the developer. This is accepted, but the plan should record it as the PRD asks (`roadmap.md:145`).

### 4. The 15-character floor: where it is enforced, and whom it affects

**Where the floor is enforced.**
- GoTrue enforces it when a password is **set**: signup, `updateUser`, admin `createUser` and admin `updateUserById`.
- It does **not** enforce it at sign-in. `POST /token?grant_type=password` returns 200 with `weak_password: { reasons, message }`, which supabase-js returns as `data.weakPassword`.
- **Existing users with a password under 15 characters keep signing in.** They get only the hint, and `src/pages/api/auth/signin.ts:13` destructures `{ error }` and ignores the rest.
- So the plan must decide: ignore the hint, show a nudge banner, or force a change. A forced change is cheap here, because the in-app change needs no current password and S-409 will need the same "must change at first sign-in" flow anyway.

**Bytes, not characters.**
- GoTrue checks `len(password)`, which counts UTF-8 bytes (password.go:31-43).
- A client-side `z.string().min(15)` counts UTF-16 code units. Every code unit is at least one UTF-8 byte, so the client check is **at least as strict** as the server's. Using `.min(15)` on the client is therefore safe.
- The 72-byte maximum needs a byte check on the client (`new TextEncoder().encode(v).length <= 72`). A long passphrase with Polish diacritics can pass 72 characters while exceeding 72 bytes.

**Where the floor is set.**
- Local: `minimum_password_length = 15` (`config.toml:175`).
- Hosted: by hand (Auth → Providers → Email → Minimum password length, or `password_min_length` on the Management API). **Never `config push`.**
- Keep `password_requirements = ""` (`config.toml:178`). The PRD requires only length, and character classes would break `openssl rand -hex`, bare `randomUUID()` and the e2e default (F-401 `research.md:197`).

**Passwords already in the repo, against the floor.**

| Source | Length |
|---|---|
| `e2e/author-credentials.mjs:11` | 19 |
| `src/test/factories/create-signed-in-user.ts:35` | 40 |
| `src/test/solver-credential.integration.test.ts:60` | 36 |
| CI machine user (`.github/workflows/ci.yml:126,219`, `openssl rand -hex 24`) | 48 |

- The seed has no `auth.users` rows.
- **Raising the local floor breaks nothing in the repo.**
- Exposure outside the repo: a developer's own `SOLVER_MACHINE_PASSWORD` under 15 characters is refused on re-provisioning (`scripts/provision-solver-user.mjs` has no length check of its own).
- Hosted human passwords are unknown.

**HIBP (leaked-password protection).** It is Pro plan and above, fails open if the API is unreachable, and has no CLI key. The Supabase plan tier is recorded nowhere in the repo, and the PRD does not require HIBP. If it is ever enabled, `reasons: ['pwned']` falls into the `weak_password` mapping.

### 5. The display name: where it lives

**Facts that decide the question.**
- No code reads `user_metadata`, `raw_user_meta_data` or `display_name` today. Every `full_name` hit is on the `teachers`/`students` tables.
- `auth.users` is not exposed: only `public` and `graphql_public` are (`config.toml:13`). `public` has no views. Listing other users needs the admin API and the secret key, which only scripts and tests hold.
- `user_metadata` is user-writable through `PUT /user`, so it bypasses app validation. It is readable only by its owner. The JWT copy is stale until refresh, but the middleware's `getUser()` returns the fresh row.
- The Supabase dashboard's "Display name" column reads `raw_user_meta_data`, trying `name`, then `displayName`, then `display_name`, and so on.
- Supabase's documented profiles pattern uses an `after insert on auth.users` trigger whose function is `security definer`, which conflicts with `CLAUDE.md`'s "No SECURITY DEFINER". The docs themselves warn that a failing trigger blocks signups.
- The machine user's `app_metadata.machine_role` is set inside `createUser` (`scripts/provision-solver-user.mjs:87-89`). A future insert-time filter could therefore exclude it.

**The constraint that frames everything.** S-406 lists *every* user with email, role and status, including users who never opened the account page. Emails and the machine flag exist only in `auth.users`. So **S-406 must add a reader or mirror of `auth.users` regardless of what S-401 does.** The roadmap gives "the readable list of school users" to S-406 (`roadmap.md:101,212`). S-401 decides only where the name's source of truth lives.

| | O1 `user_metadata.display_name` | **O2 `public.profiles`, written by the user's own upsert** | O3 `profiles` + trigger on `auth.users` |
|---|---|---|---|
| Migration in S-401 | none | one, additive | one, plus a trigger |
| Database validation | none (`PUT /user` bypasses the app) | CHECK constraint | CHECK constraint |
| Readable by other users | never, through the publishable key | yes, by RLS SELECT | yes |
| `SECURITY DEFINER` | no | no | documented form: yes. INVOKER form (grant plus a policy for `supabase_auth_admin`): plausible but unproven |
| Self-display in the sidebar | free (`locals.user`) | one extra PostgREST read per page | one extra read |
| Role-matrix cost in S-401 | none | harness generalization (below) | the same, plus proving the trigger |
| Works for role-less users (FR-410) | trivially (GoTrue, no RLS) | yes, because own-row policies use `auth.uid()` with no role check | yes |
| Forward cost on S-406 | its mirror must copy `raw_user_meta_data` | its mirror adds `email` and rows for users who never set a name | pre-empts S-406's access decision |
| Risk | — | — | a failing trigger blocks admin provisioning and the solver machine user; DEFINER would pre-empt S-403's "first and only exception" (`roadmap.md:173`, `stack-assessment.md:296-299`) |

**Recommendation: O2, in its narrowest form.**

```sql
create table public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,  -- same key as S-403's user_roles
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and <N>),
  updated_at   timestamptz not null default now()
);
```

- **`display_name` is nullable** (a refinement of the sub-agent's `not null` draft). S-406's mirror will create rows for users who never set a name, and clearing a name falls back to the email.
- **No `email` column yet.** S-406 adds it together with its sync mechanism, because that is an access decision.
- **No authorization data, ever.** S-409's "must change password" flag belongs in `app_metadata`.

RLS before S-403:

| Operation | Policy |
|---|---|
| SELECT | `to authenticated using (true)`, like the 16 existing tables and S-407's any-role read |
| INSERT | `to authenticated with check (user_id = (select auth.uid()))` |
| UPDATE | `to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))` |
| DELETE | no policy (rows go by cascade) |

After S-403:
- SELECT becomes "a role grants read, or it is my own row".
- The own-row writes stay free of any role check (FR-410; the access table at `prd.md:348`).
- Keep the upsert `return=minimal`. `ON CONFLICT DO UPDATE` also evaluates the SELECT policy, the trap recorded in `solver_select_column_scope.sql:16-29`.

Grants:
- `revoke` all eight privileges from `anon`, following the `generation_jobs` precedent (`20260810200122_generation_jobs.sql:120-129`). Default privileges still hand `anon` TRUNCATE, REFERENCES, TRIGGER and MAINTAIN (`lessons.md:47-52`).
- Narrow `authenticated` to INSERT, SELECT and UPDATE.
- `solver_job_writer` holds no default privileges (`20260810200931_solver_job_writer_role.sql:28-29`), so it cannot reach the table. Still add `profiles` to the solver guard suite (`src/test/solver-credential.integration.test.ts:97-102,185-186`), because the machine user falls back to `authenticated` if the token hook is ever off.
- Do not column-scope UPDATE to `(display_name)` without checking live. It is unverified whether PostgREST's merge-duplicates upsert puts `user_id` in `DO UPDATE SET`.

**What O2 costs the role-matrix harness.** This is the main hidden cost, and it is all in `src/test/`.
1. **Type gate.** `READS` and `GRANTS` are `Record<PublicTable, …>` (`role-matrix-expectations.ts:20-22,44,109`). After `database.types.ts` is regenerated, `pnpm check` fails until both declare `profiles`.
2. **Catalog gate.** The runtime check fails on any undeclared live table (`role-matrix.integration.test.ts:107-114`).
3. **Plan-rooted probes.** `planKey` returns `"id" | "plan_id"` (`access-probe.ts:123-127`), and `profiles` has neither column. The probe and `buildFixture` (`role-matrix.integration.test.ts:364-381`) need a per-table key and a fixture profile owned by a separate user.
4. **The classifier will break in S-403.** `classifyRead` throws "partial visibility" when a principal sees some rows but not the fixture's (`access-probe.ts:67-81`). That is fine under `using (true)`. Once S-403 restricts role-less users to their own row, it throws, so S-403 will need an "own" outcome. Record this for S-403.
5. **No "whose row" dimension for writes.** `WRITES` holds one cell per operation per table (`:63-89`), and `role-matrix-expectations.test.ts:21-23` forbids a write row with no allowed principal. Profiles need an "own row" cell (allowed) and an "another's row" cell (denied for everyone), which is the actual claim being tested.
6. **A stale note.** `PRINCIPAL_NOTES.noRole` says "allowed everywhere" (`:41`). That stops being true.

Expected cells today: anon is denied everywhere. noRole reads all rows, may insert and update its own row, and may not update another's row or insert with someone else's `user_id`. `GRANTS.profiles = { anon: NONE, authenticated: ["INSERT","SELECT","UPDATE"] }`.

**Also comes with O2.**
- HC Fix 8: a `pnpm db:types` script that is fail-safe (write to a temp file, then `mv` only on success). No such script exists yet (`roadmap.md:299`; `health-check.md:403-415`).
- Regenerating `database.types.ts`.

**When O1 is the better choice.** If S-401 should ship with no schema change and no harness work, O1 is a legitimate, smaller slice. Its costs move to S-406, whose mirror must then read `raw_user_meta_data`, and the name gets no database validation. Under `main_goal: quality`, and because S-406 needs the harness generalization anyway, O2 front-loads that work onto the smallest slice. That is the reason it is recommended.

### 6. UI: entry point and app shell

**The shell has no JavaScript.**
- `src/app/layouts/SidebarLayout.astro` is plain Astro with inline scripts. There is no React island in the shell.
- The user comes from `Astro.locals.user` (`:16`).
- The footer (`:102-122`) holds a truncated email (`:104-106`, hidden when collapsed), the theme toggle, and a native POST sign-out form.
- There is no avatar, no user menu and no profile link.

**Where the entry point should go: the footer, not nav config.**
- `GLOBAL_NAV_ITEMS` (`src/shared/config/nav.ts:14-17`) also drives the dashboard cards (`DashboardPage.astro:5`). An "Account" item there would add a dashboard card.
- `NavItem` has no gating field (`nav.ts:4-8`), and S-403/S-405 will introduce per-item role gating. The account link must stay visible to role-less users (FR-410).
- **Recommended:** turn the footer identity (name and/or email) into a link to `/account` with an icon (e.g. `UserRound`), `title` and `aria-current`. That keeps the shell free of JavaScript. A dropdown user menu would be the first React island in the shell, on every page.

**Collapsed mode.**
- Labels are `collapsed:hidden` (`SidebarNavLink.astro:13,23`), and the native `title` is the only tooltip (there is no Tooltip primitive). The account link needs an icon plus `title`, which also supplies its accessible name when collapsed.
- On mobile there is no drawer: a 64 px rail stays in place, and `main` is `max-w-7xl px-8 py-10` (`SidebarLayout.astro:132`). The forms should sit in a narrow single column (about `max-w-xl`).

**Showing the name in the sidebar.**
- With O2, rendering the name in the shell costs one extra read per page, and on an O1 mirror it would be free.
- Alternatively the sidebar keeps the email and the name appears only on the account page. But then, **until S-406 and S-407 land, the only place a user ever sees their display name is the account page**. It is worth deciding consciously what visible effect setting a name has in S-401.
- If the sidebar shows the name, it becomes two truncated lines (name and email). The name must never be put into an `is:inline` script (`ui-conventions.md:259-266`).
- `e2e/specs/auth.spec.ts:16-19` asserts the header email text.

**The route.**
- `/account` and `/settings` are both free (there is no `404.astro`). The middleware gates them by default.
- S-403 will need a second tier of paths reachable without a role (e.g. `ROLELESS_PATHS`). Any role guard it adds to `defineDomainAction` must exempt the account actions.
- S-403's "no access yet" notice should copy `PlanScopedError.astro:5-10` and link to `/account` plus sign-out.

### 7. UI: the two forms

**Conventions** (`context/foundation/ui-conventions.md`, `lessons.md:23`):
- RHF with `zodResolver` and a Zod schema shared with the action's `input`.
- `mode: "onTouched"`.
- `submitForm` from `@/shared/lib/forms`.
- A client module `api/account-client.ts` over `callAction`. UI code never imports `astro:actions`.
- One private hook per independent flow (`:26-33,44`), so `useDisplayNameForm` and `usePasswordForm`, not one shared bag hook.
- Typing: `FormValues = z.input`, `Input = z.output`, and the resolver is never cast (`:129-140`).
- The reference implementation to copy is `src/_pages/teachers/ui/TeacherFormDialog.tsx`.
- Proposed slice:
  - `src/_pages/account/{index.ts, api/{actions.ts, update-password.ts, update-display-name.ts, account-client.ts, index.ts}, model/schemas.ts, ui/{AccountPage.astro, AccountSettings.tsx, …}}`
  - `src/pages/account.astro`
  - `...accountActions` added in `src/actions/index.ts:19-28`
  - This matches the earlier research (`user-managment-research/research.md:336`).

**The password field.**
- **The show/hide toggle is private to the sign-in slice** (`src/_pages/sign-in/ui/PasswordToggle.tsx:8-18`). Importing it from `_pages/account` would be a cross-slice import that steiger rejects. Promote it to `shared/ui` as a `PasswordInput`.
  - It has three more consumers coming: S-402's reset page, S-409's forced change and S-410's acceptance page.
  - Add `aria-pressed`/`aria-controls` while moving it.
  - Two toggles on one page need distinct accessible names. `getByLabel` matches `aria-label` too: "Show password" collides with "Password" (see `auth.setup.ts:35-36`).
- **Password managers.**
  - Every CRUD form sets `autoComplete="off"` (`TeacherFormDialog.tsx:56,64,78`). **Do not copy that here.**
  - The change form needs a username field, either the read-only visible email or a hidden `autocomplete="username"` input, plus `autocomplete="new-password"`.
  - Sign-in has no `autocomplete` attributes at all (`src/_pages/sign-in/ui/FormField.tsx:42-53`). It is cheap to add `username` and `current-password` there in the same change.
- **Confirm field.**
  - This is not a lockout risk on the spot: the current session survives and needs no current password, so the user can simply set the password again.
  - But a typo is discovered only at the next sign-in, and until S-402 there is no self-service recovery.
  - A confirm field in a client-only refined schema, or an always-visible toggle, removes that failure mode. Field names must still equal the action's input keys for `isInputError` mapping (`apply-action-errors.ts:7-9`).
- **Rules and copy.**
  - Helper text in `FormDescription` ("At least 15 characters"), which is already wired into `aria-describedby` (`form.tsx:99,106-117`).
  - An optional counter via `useWatch` (precedent: `StudentFormDialog.tsx:53`).
  - `min(15)` and a 72-byte refinement.
  - Copy about revocation: "You stay signed in here; your other devices will be signed out."

**The display-name field.**
- Trim it and cap its length (pick N; the sidebar truncates in any case).
- An empty value clears the name, and the email is shown as the fallback.
- **Impersonation (FR-413 Socrates note).** The PRD's mitigation is the email beside the name wherever identity matters. Worth adding in S-401's validation: NFC normalization, and rejecting control, bidi-override and zero-width characters. Those characters can make a name visually mimic a colleague's even with the email beside it.

**Two forms on one page.**
- Use two named `<form>` landmarks (`aria-labelledby` pointing at each heading) and distinct submit labels ("Save name", "Change password"). This serves accessibility and lets e2e scope with `getByRole("form", { name })`.
- Field errors are not announced today: `FormMessage` (`form.tsx:119-131`) has no `role` or `aria-live`. Server and success messages need `role="status"`/`role="alert"`, following the precedents in `GenerateButton.tsx:145,164` and `StopAndKeep.tsx:79,108`.

**Missing primitives.**
- There is no card, separator, alert or tooltip in `src/shared/ui/`.
- Either hand-roll the card the way the dashboard does (`border-border bg-card rounded-lg border p-5`, `DashboardPage.astro:22`), or add the primitives and **detokenize** them (`lessons.md:26-31`).
- Do not reuse `Banner.astro` for success: it uses literal hex colours (`Banner.astro:27-41`).
- `--valid` is the success token (`global.css:28,86,147`).

### 8. UI: feedback after save

The repo has no pattern for success feedback that survives a reload:
- `submitForm` (`src/shared/lib/forms/submit-form.ts:33-37`) runs `toast.success`, then `onClose()`, then `(refresh ?? refreshPage)()`.
- `refreshPage()` calls `navigate(…)` (`refresh-page.ts:4-5`). No page mounts `<ClientRouter />`, so Astro falls back to `location.href = …`, a **full reload that destroys the toast**.
- `onClose` is required, because the helper assumes a dialog.
- There is no global `<Toaster />`; each island mounts its own (`TeacherCatalog.tsx:101`, and others). The account page should be **one island** with one Toaster, or every toast shows twice.

Per form:
- **Password:** no reload is needed, because nothing server-rendered changes. Pass `refresh: async () => {}`, use `onClose = form.reset`, and the toast survives.
- **Display name:** the sidebar is server-rendered, so it shows the old name until a reload. The options:
  - (a) reload, with a `?saved=…` flag the page renders as a server-side status line (a new small pattern);
  - (b) no reload, accepting a stale sidebar until the next navigation;
  - (c) keep the email in the sidebar, which removes the problem (see §6).
- **Recommendation:** (c) or (a). Introducing `<ClientRouter />` just for this would be out of proportion.

### 9. Testing: integration and e2e

**Integration (the right level for the password mechanics).**
- `createSignedInUser` (`src/test/factories/create-signed-in-user.ts:31-48`) returns a publishable-key client with an in-memory session. Its type matches `SupabaseClient`, so `changePassword(user.client, input)` can be tested directly.
- Claims to prove:
  - the change succeeds;
  - the new password signs in and the old one does not;
  - <15 is refused with `weak_password`;
  - `same_password` is refused;
  - **a second session of the same user is revoked**: sign in twice, change on one, and the other's `getUser()` → `AuthSessionMissingError`;
  - the caller's session survives.
- The role matrix has **no cell shape for a GoTrue capability**; its probes are PostgREST/RPC only. The password claims therefore belong in their own suite, and only the `profiles` access claims go in the matrix (CLAUDE.md's rule is about *access-control* claims).
- Rate limit: principals sign in once per file because of `sign_in_sign_ups = 30` (`config.toml:190`). A suite with several sign-ins per test should keep within that, and the integration lane is already about 1-in-5 flaky in parallel.

**E2E (the UI wiring).**
- Projects (`playwright.config.ts:36-49`): `setup` signs in once and writes `e2e/.auth/user.json`; `chromium` reuses it; `chromium-guard` runs without state.
- **Every `chromium` spec shares one author and one GoTrue session.**
- `scripts/provision-e2e-author.mjs:53-68` is idempotent on `email_exists` and **never resets the password**.
- A spec that changed the author's password would break the next run's `setup`. A fresh sign-in plus a change would also revoke the shared storageState session mid-run.
- A password-change spec therefore needs:
  - a **throwaway user** created and deleted through the admin API. The service key is in CI's job env (`.github/actions/supabase-stack/action.yml:87-91`), but locally only the provisioning script reads `.env.test.local`, so the Playwright process does not have it;
  - a **sign-in through the UI inside the test**, an explicit exception to `e2e/CLAUDE.md:34-36`;
  - a hydration gate, because RHF inputs are controlled;
  - exact label matching.
- A display-name change on the shared author would leak into parallel specs, e.g. `auth.spec.ts:16-19` if the sidebar shows the name.
- A cheaper split: prove the mechanics at integration level, and e2e only the UI wiring on a throwaway user.
- Add guard specs as well:
  - unauthenticated `/account` redirects (copy `auth-guard.spec.ts`);
  - an unauthenticated action POST is refused (copy `action-unauth.spec.ts:14-23`, using a schema-valid body).
- Side note: sign-out uses the default **global** scope (`src/pages/api/auth/signout.ts:7`). Any future spec that clicks Sign out on the shared storageState revokes every parallel spec's session.

### 10. Config, runbooks and ops edits S-401 carries

- **`supabase/config.toml`:** `minimum_password_length = 15` (`:175`). Keep `secure_password_change = false` (`:214`) and `password_requirements = ""` (`:178`).
  - Per the roadmap, the rest of HC Fix 4 belongs to S-402 (`roadmap.md:299-300`): `site_url` (`:154`, still on `:3000`), the redirect allowlist, and `[inbucket]` → `[local_smtp]` (`:99`).
  - The health check and the tasks list instead bundle all four as "any time". Pick one in the plan.
- **Hosted, by hand (never `config push`):**
  - set `password_min_length = 15`;
  - verify both password-update toggles are off (§3);
  - read the GoTrue version from `/auth/v1/health`.
  - Record all of it in a runbook.
- **`docs/runbooks/solver-credential.md:156-157`:** the `config push` table quotes `secure_password_change = false` ("Removes re-authentication…") and `minimum_password_length = 6`. Update the value, the line reference, and the rationale (the secure change is off on purpose, per FR-411).
- **`docs/runbooks/author-provisioning.md`:**
  - `:93-94` "have them … change the password", which no screen allows today, should point at `/account`;
  - `:39-40` and `:91` (entering a password) should state the 15-character floor.
- **README:** its local-setup instructions for `SOLVER_MACHINE_PASSWORD` should mention the floor.
- **HC Fix 8** (`pnpm db:types`) if O2 is chosen. **HC Fix 10** (`.editorconfig`) is any-time hygiene (`roadmap.md:299`).

## Code References

Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/`

**Auth plumbing**
- [`src/shared/api/supabase.ts:6-28`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/shared/api/supabase.ts#L6-L28): server client. `getAll` reads the raw `Cookie` header; `setAll` writes through `AstroCookies`.
- [`src/middleware.ts:7-42`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/middleware.ts#L7-L42): allowlist (`"/_"` covers `/_actions`), `getUser()` per request, `locals.user`.
- [`src/shared/lib/actions/define-domain-action.ts:13-26`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/shared/lib/actions/define-domain-action.ts#L13-L26): `run(supabase, input)` gets no user id.
- [`src/shared/lib/errors/domain-error.ts:9-14`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/shared/lib/errors/domain-error.ts#L9-L14): `DomainErrorCode`, with no `UNAUTHORIZED` and no `TOO_MANY_REQUESTS`.
- [`src/shared/api/postgrest/to-domain-error.ts:15-19`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/shared/api/postgrest/to-domain-error.ts#L15-L19): a PostgREST-only mapper.
- [`src/pages/api/auth/signin.ts:13-17`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/pages/api/auth/signin.ts#L13-L17): `data.weakPassword` discarded.
- [`src/pages/api/auth/signout.ts:7`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/pages/api/auth/signout.ts#L7): global-scope sign-out.

**Config and runbooks**
- [`supabase/config.toml:154-214`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/supabase/config.toml#L154-L214): `site_url` `:154`, reuse interval `:167`, `minimum_password_length = 6` `:175`, `password_requirements` `:178`, rate limit `:190`, `secure_password_change` `:214`.
- [`docs/runbooks/solver-credential.md:153-157`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/docs/runbooks/solver-credential.md#L153-L157): the `config push` table that quotes the password values.
- [`docs/runbooks/author-provisioning.md:92-94`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/docs/runbooks/author-provisioning.md#L92-L94): "change the password" with no screen to do it.

**UI**
- [`src/app/layouts/SidebarLayout.astro:102-122`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/app/layouts/SidebarLayout.astro#L102-L122): sidebar footer (email, theme toggle, sign-out).
- [`src/shared/config/nav.ts:4-25`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/shared/config/nav.ts#L4-L25): `NavItem` with no gating; `GLOBAL_NAV_ITEMS` also feeds the dashboard cards.
- [`src/shared/lib/forms/submit-form.ts:26-37`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/shared/lib/forms/submit-form.ts#L26-L37): toast, then close, then refresh.
- [`src/shared/lib/forms/refresh-page.ts:4-5`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/shared/lib/forms/refresh-page.ts#L4-L5): `navigate()`, a full reload without `<ClientRouter />`.
- [`src/_pages/sign-in/ui/PasswordToggle.tsx:8-18`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/_pages/sign-in/ui/PasswordToggle.tsx#L8-L18): the slice-private show/hide toggle.
- [`src/_pages/teachers/ui/TeacherFormDialog.tsx`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/_pages/teachers/ui/TeacherFormDialog.tsx): reference RHF + `submitForm` form (note its `autoComplete="off"`, which should not be copied).

**Tests**
- [`src/test/access-probe.ts:67-81`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/test/access-probe.ts#L67-L81) and [`:123-127`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/test/access-probe.ts#L123-L127): `classifyRead`'s partial-visibility throw; `planKey` assumes plan-rooted tables.
- [`src/test/role-matrix-expectations.ts:20-126`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/test/role-matrix-expectations.ts#L20-L126): `READS` / `WRITES` / `GRANTS` typed over every public table.
- [`src/test/factories/create-signed-in-user.ts:31-48`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/src/test/factories/create-signed-in-user.ts#L31-L48): a publishable-key client per test user.
- [`e2e/author-credentials.mjs:11`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/e2e/author-credentials.mjs#L11) and [`scripts/provision-e2e-author.mjs:53-68`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/scripts/provision-e2e-author.mjs#L53-L68): the shared e2e author (19 characters), never re-passworded.

**Migrations**
- [`supabase/migrations/20260810200122_generation_jobs.sql:116-129`](https://github.com/dobrek/ib-timetable-planner/blob/a86f52c7419fad8e06601b49baf6bf8512c12b2a/supabase/migrations/20260810200122_generation_jobs.sql#L116-L129): the only table that revokes all eight privileges from `anon` (the precedent for `profiles`).

**External source** (`supabase/auth` master, fetched 2026-10-16)
- `internal/api/user.go:154-214`: reauthentication 24 h rule, current-password check, `same_password`, `UpdatePassword(tx, sessionID)`.
- `internal/models/user.go:435-464`: clears tokens; `LogoutAllExceptMe`.
- `internal/api/password.go:12-43`: 72-byte maximum; minimum length on `len()` (bytes).

## Architecture Insights

- **Two stores of identity.** GoTrue owns credentials and sessions, and RLS cannot reach it. Postgres owns everything other users may see. A password change is a pure GoTrue operation, so fail-closed RLS (S-403) can never block it. That is why FR-410's "a role-less user can still manage their own account" is free for passwords and needs care only for `profiles`, where own-row policies must stay free of role checks.
- **Policy lives at the narrowest point a user cannot bypass.** The browser holds a usable access token (`@supabase/ssr` cookies are not `HttpOnly`). So password rules belong in GoTrue config, and name rules in a CHECK constraint, and app-side Zod is UX only. O1 (`user_metadata`) has no such enforcement point, which is the main technical argument for O2.
- **Hosted auth config is a third configuration surface with no test coverage.** `config.toml` is local-only by decision of record, and at least one load-bearing hosted flag (require current password) cannot be expressed in it at all. Each slice that depends on a hosted auth flag should name the flag and the read-only Management API check in its runbook step.
- **The role-matrix harness is plan-rooted.** It assumes every table hangs off `plans`, and S-401's `profiles` would be the first table that does not. Generalizing the harness here (a per-table key, and "own vs another's" write cells) is work S-406's user list and S-403's own-row read need anyway.
- **The password form is the first of four.** S-402 (reset), S-409 (forced change at first sign-in) and S-410 (invite acceptance) will all set a password. Keep the field component and the schema rules (`min 15`, 72 bytes) reusable from the start, and promote them to `shared/` when the second consumer arrives (`ui-conventions.md:115-117`).
- **"Feedback that survives a reload" is a missing primitive**, not an S-401 quirk. Any server-rendered value edited by a form (the sidebar name now, the current-plan marker in S-404 possibly) hits it.

## Historical Context (from prior changes)

- `context/changes/user-managment-research/research.md`:
  - `:257,264`: `user_metadata` must never carry authorization, but is fine for a display name; `profiles` must be separate from `user_roles`.
  - `:290`: DEFINER called "fine for … profiles". **Superseded** by `CLAUDE.md` and `stack-assessment.md:296-299`, under which S-403's helper is the first and only exception.
  - `:307`: `on delete cascade` for profiles.
  - `:319-323`: self-service (`current_password` needs supabase-js 2.102 or later; reauthentication needs SMTP; "an admin list needs the `profiles` mirror either way").
  - `:336`: account page at `src/_pages/account/` plus `src/pages/account.astro`, linked from the sidebar footer.
  - `:510`: the OQ10b probe, which ran on **v2.189.0** (`:494`). Local is now v2.196.0, so re-probe anything the plan relies on.
  - `:556` (Decided scope P1): "enable Require current password". **Superseded** by PRD FR-411.
- `context/foundation/shape-notes.md:39,270-274`: the current-password rule dropped and the session-hijack trade-off accepted. `:47`: 15-character minimum.
- `context/foundation/prd.md:210-229`: FR-410, FR-411 (trade-off at `:219-221`) and FR-413 (email beside name). `:130`: 15-character NFG. `:348`: the access table ("Own account" for every role, including role-less).
- `context/foundation/health-check.md`:
  - `:185-186`: minimum length 6 means a guardrail test cannot fail.
  - `:323-342`: HC Fix 4.
  - `:403-415`: HC Fix 8.
  - `:428-454`: HC Fix 10.
  - `:250-251`: every test password is already 15 characters or longer.
- `context/foundation/stack-assessment.md:114`: profiles but no type-regeneration step. `:296-299`: the single-DEFINER rule. `:393`: minimum length 6 versus the PRD's 15.
- `context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/research.md`:
  - `:197`: policy is enforced at create and update, not at sign-in.
  - `:284-308`: a schema-only `user_roles` was rejected partly because it would decide "the `profiles` split" early. S-401 is where that split is now legitimately decided.
- `context/archive/2026-10-14-ci-publishable-key-and-pinned-cli/plan.md:348-349,402`: the CLI is pinned to the lockfile. CI and developer machines run GoTrue v2.196.0, and the link-time snapshot was moved aside.
- `context/changes/user-managment-research/change.md:29-46`: the HC Fix 4 / 8 / 10 task text, including "update the `config push` table in `solver-credential.md` in the same commit".

**Drift found in passing** (not S-401's to fix, but worth a line in its plan):
- The roadmap says "v2.189.0 locally" (`roadmap.md:131`). It is now v2.196.0.
- The backlog row still marks F-402 "Ready: yes" (`roadmap.md:298`), although F-402 is done.
- `e2e/CLAUDE.md`'s intro says four specs; there are 26.
- `BaseLayout.astro:10`'s default title is "10x Astro Starter".

## Related Research

- `context/changes/user-managment-research/research.md`: the milestone-wide user-management research (decided P0–P6 scope)
- `context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/research.md`: F-401, signed-in clients and the role matrix
- `context/archive/2026-10-14-ci-publishable-key-and-pinned-cli/research.md`: F-402, key formats and the pinned CLI

## Open Questions

For the user or the plan to settle before `/10x-plan`:

1. **Display-name storage.** O2 `public.profiles` (recommended: validated, readable by others, but it costs the role-matrix harness generalization in this slice) or O1 `user_metadata` (no schema change; S-406 inherits the cost)? If O2, what is the maximum length N, and can a name be cleared? — Owner: user/plan.
2. **Where the name shows in S-401.** In the sidebar (an extra read per page with O2, plus the reload/feedback problem), or only on the account page until S-406 and S-407 give it readers? — Owner: user.
3. **Existing users with passwords under 15 characters.** Ignore them, show a nudge from `data.weakPassword` at sign-in, or force a change? — Owner: user. The PRD says only "refused", which governs setting a password, not signing in.
4. **Hosted state (by hand, read-only).** Are "Secure password change" and "Require current password when updating" both **off**? What is hosted's GoTrue version? (`GET /v1/projects/hwmuiymhjgewtymymbmb/config/auth`, `GET /auth/v1/health`.) — Owner: developer. This blocks the plan's assumptions, not the code.
5. **Confirm-password field.** Recommended, because a typo is discovered only at the next sign-in and there is no self-service recovery before S-402. — Owner: plan.
6. **E2E scope.** Throwaway-user infrastructure in Playwright (the service key in the local Playwright env, and a recorded exception to "never sign in through the UI"), or password mechanics proven only at integration level with e2e limited to the display-name UI on a throwaway user? — Owner: plan.
7. **The HC Fix 4 split.** S-401 takes only `minimum_password_length` (per the roadmap), or the whole local auth bundle (`site_url`, redirects, `[local_smtp]`) as the health check suggests? — Owner: plan.
8. **The double refresh between middleware and action** (§1). Is it worth a regression test now, given that hosted's `refresh_token_reuse_interval` is unverified? — Owner: plan.
