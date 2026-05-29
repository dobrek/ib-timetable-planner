# Gated Author Provisioning Implementation Plan

## Overview

Close the open self-service registration that ships with the starter so that only
authors created out-of-band (manually, in Supabase Studio locally / the hosted
dashboard in prod) can register and sign in. This is roadmap foundation **F-01**
(`gated-author-provisioning`) and a hard prerequisite for every PII-bearing slice
(S-02, S-04, S-05): per **NFR Data privacy**, student names and choices cannot sit
behind a publicly reachable signup form.

The gate is enforced at two layers — the app (the signup surface is deleted; every
route is auth-gated by default) and Supabase (`enable_signup = false`, so a direct
call to the auth REST endpoint is also rejected).

## Current State Analysis

Auth is fully wired but **open**:

- Self-service signup: `src/pages/auth/signup.astro` → `src/components/auth/SignUpForm.tsx` → `POST /api/auth/signup` (`src/pages/api/auth/signup.ts:13`, calls `supabase.auth.signUp()`) → redirect to `src/pages/auth/confirm-email.astro`. Anyone can create an account.
- Sign-in / signout work the same way (`src/pages/api/auth/{signin,signout}.ts`); signin redirects to `/` on success.
- Middleware (`src/middleware.ts:4`) protects **only `/dashboard`** via an explicit `PROTECTED_ROUTES` list; every other route (including `/`) is public. PRD Access Control requires "unauthenticated access is rejected at every gated route" — current protection is narrower.
- Supabase SSR client (`src/lib/supabase.ts`) uses the **anon key** (`SUPABASE_KEY`). No service-role key is configured — `.envs/local.vars` / `.envs/prod.vars` carry only `SUPABASE_URL` + `SUPABASE_KEY`, and `astro.config.mjs:18` declares only those two env fields.
- `supabase/config.toml`: `enable_signup = true` (line 169) and `[auth.email] enable_signup = true` (line 204); `enable_confirmations = false` (local auto-confirms; `confirm-email.astro` keys its copy off `import.meta.env.DEV`).
- No domain schema / migrations yet (`schema_paths = []`, no `supabase/migrations/`) — F-02 has not run. A DB-backed allow-list would be the first table; deliberately avoided here.

Links pointing at the signup route that must also be removed:

- `src/pages/auth/signin.astro:18` — "Don't have an account? Sign up"
- `src/components/Topbar.astro:30` — "Sign up" link (unauthenticated branch)
- `src/components/Welcome.astro:48` — "Sign Up" hero button

### Key Discoveries:

- Removing signup orphans `src/pages/auth/confirm-email.astro` (only reachable via `signup.ts:19`) — it should be removed too.
- `enable_signup` in `config.toml` governs the **local** stack only; the hosted project's toggle lives in the Supabase dashboard (or a `supabase config push`). Prod closure is therefore a manual/documented step.
- Static assets and the signin path must stay reachable without auth, or sign-in becomes impossible — the deny-by-default middleware needs a precise public allowlist (`/auth/signin`, `/api/auth/*`, Astro internals like `/_`).
- `src/components/Welcome.astro` is the stock starter landing rendered at `/`; with deny-by-default it is only reachable post-auth. De-starter-ifying it is out of scope — only its signup link is removed.

## Desired End State

- There is no reachable way to self-register: `/auth/signup` returns 404, the API endpoint is gone, and the Supabase auth layer rejects `signUp` (`enable_signup = false`).
- Every route requires an authenticated session except the sign-in path, the auth API endpoints, and static assets; an unauthenticated request to `/` (or any future route) redirects to `/auth/signin`.
- An author created manually in Studio (local) or the hosted dashboard (prod) can sign in and reach protected pages.
- A runbook documents how to provision the first/any author and how to close registration on the hosted project.

Verification: `pnpm build` + `pnpm lint` pass with no dangling imports; visiting `/auth/signup` 404s; unauthenticated `/` redirects to signin; a Studio-created user signs in successfully.

## What We're NOT Doing

- No in-app invite flow, no service-role / admin key, no allow-list table (all deferred — would be v2 or a later slice).
- No domain schema (F-02 owns that).
- No SMTP / email-confirmation configuration for prod.
- No redesign of the stock `/` landing (`Welcome.astro`) beyond removing its signup link.
- Not executing the hosted-project changes inside this change — they are documented as a runbook for the author to run.
- No automated test suite (no runner configured; CI is lint + build only).

## Implementation Approach

Three small, independently verifiable phases: (1) delete the signup surface and flip
the Supabase config flag; (2) invert middleware to deny-by-default with a public
allowlist; (3) write the provisioning runbook and fix doc references. Each phase ends
with `pnpm build` + `pnpm lint` (the CI gate, mirrored by `/verify`) and a short manual check.

## Critical Implementation Details

- **Config requires a restart.** `enable_signup = false` in `config.toml` only takes effect after `pnpm exec supabase stop && supabase start` (or `supabase db reset`). The manual verification for Phase 1 must restart the stack before testing that signup is rejected at the API layer.
- **Middleware allowlist ordering.** The deny-by-default check must run only after the public-path test; `/api/auth/signin` and `/auth/signin` and Astro internals (`/_…`) must be allowlisted or sign-in and asset loading break. Allowlist `/api/auth/` (auth endpoints), not all of `/api/`, so future domain APIs stay protected.

## Phase 1: Close the registration gate

### Overview

Remove every part of the self-service signup surface and disable signup at the Supabase layer.

### Changes Required:

#### 1. Supabase config flag

**File**: `supabase/config.toml`

**Intent**: Reject account creation at the auth backend so the gate can't be bypassed by calling the auth REST endpoint directly.

**Contract**: Set `enable_signup = false` under `[auth]` (line 169) and `enable_signup = false` under `[auth.email]` (line 204). Leave `enable_anonymous_sign_ins` / `enable_confirmations` as-is.

#### 2. Delete the signup surface

**Files** (delete): `src/pages/auth/signup.astro`, `src/components/auth/SignUpForm.tsx`, `src/pages/api/auth/signup.ts`, `src/pages/auth/confirm-email.astro`.

**Intent**: Remove the public registration page, its form island, the API route that calls `signUp()`, and the now-orphaned confirmation page.

**Contract**: After deletion, no module imports `SignUpForm`, and no route resolves `/auth/signup`, `/api/auth/signup`, or `/auth/confirm-email`. The shared auth components (`FormField`, `PasswordToggle`, `SubmitButton`, `ServerError`) stay — `SignInForm` still uses them.

#### 3. Remove links to the signup route

**Files**: `src/pages/auth/signin.astro`, `src/components/Topbar.astro`, `src/components/Welcome.astro`

**Intent**: Drop every `/auth/signup` link so the UI has no dead pointers; keep the surrounding sign-in links/layout intact.

**Contract**: Remove the "Sign up" anchor at `signin.astro:18`, the "Sign up" anchor in the unauthenticated branch of `Topbar.astro` (line 30), and the "Sign Up" hero button in `Welcome.astro` (lines 47-52). The cosmetic "sign in, sign up, …" prose in `Welcome.astro:76` may be left or trimmed — non-load-bearing.

### Success Criteria:

#### Automated Verification:

- `pnpm exec astro sync` succeeds (env/content types regenerate)
- Build passes with no unresolved imports: `pnpm build`
- Linting passes: `pnpm lint`
- No remaining references to the removed routes in app code: `grep -rn "/auth/signup\|/auth/confirm-email\|SignUpForm" src/` returns nothing

#### Manual Verification:

- After `pnpm exec supabase stop && pnpm exec supabase start`, a direct `POST` to the Supabase `/auth/v1/signup` endpoint is rejected (signup disabled)
- `GET /auth/signup` returns 404 in `pnpm dev`
- `/auth/signin` renders with no "Sign up" link; Topbar and Welcome show no signup link

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Deny-by-default route protection

### Overview

Invert the middleware so every route is gated unless explicitly public, satisfying "reject unauthenticated at every gated route".

### Changes Required:

#### 1. Rewrite route-protection logic

**File**: `src/middleware.ts`

**Intent**: Replace the `PROTECTED_ROUTES` allow-list (currently just `/dashboard`) with a deny-by-default model: resolve the user as today, then redirect any unauthenticated request to `/auth/signin` unless its path is on a public allowlist.

**Contract**: Define a `PUBLIC_PATHS` set/prefixes covering `/auth/signin`, `/api/auth/` (sign-in/sign-out endpoints), and Astro/static internals (paths starting with `/_`, plus `favicon`-style static files). Keep `context.locals.user` assignment unchanged. For a non-public path with no `context.locals.user`, `return context.redirect("/auth/signin")`. Unauthenticated `/` thus redirects to signin; authenticated requests pass through unchanged.

### Success Criteria:

#### Automated Verification:

- Build passes: `pnpm build`
- Linting passes: `pnpm lint`

#### Manual Verification:

- Unauthenticated `GET /` redirects to `/auth/signin`
- Unauthenticated `GET /dashboard` redirects to `/auth/signin`
- `/auth/signin` loads while unauthenticated and its CSS/JS assets load (middleware does not block static assets)
- After signing in (with a manually created user), `/` and `/dashboard` are reachable; sign-out returns to a gated state

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Provisioning runbook & doc fixes

### Overview

Document how authors are created (local + hosted) and how registration is closed on the hosted project, and fix doc references to the removed routes.

### Changes Required:

#### 1. Provisioning runbook

**File**: `docs/runbooks/author-provisioning.md` (new)

**Intent**: Give the solo author a copy-pasteable procedure for the manual gate: create the first/any author locally in Supabase Studio, create authors in the hosted dashboard, and close registration on the hosted project (the dashboard equivalent of `enable_signup = false`).

**Contract**: Sections for (a) local author creation via Studio (`http://127.0.0.1:54323`) with email auto-confirmed, (b) hosted author creation via the Supabase dashboard Auth → Users, (c) closing hosted signup (Auth provider settings / `supabase config push`), and (d) a note that there is no in-app signup by design. Plain prose + commands; no code.

#### 2. README reference fixes

**File**: `README.md`

**Intent**: Remove the now-invalid `/auth/signup` and `/auth/confirm-email` rows from the Auth routes table (lines ~167-174) and add a one-line pointer to the runbook stating accounts are provisioned manually.

**Contract**: Auth routes table lists only the surviving routes (`/auth/signin`, `/dashboard`); a sentence links `docs/runbooks/author-provisioning.md`.

### Success Criteria:

#### Automated Verification:

- Runbook file exists: `docs/runbooks/author-provisioning.md`
- Build still passes (docs-only, should be unaffected): `pnpm build`
- No references to removed auth routes remain in docs: `grep -rn "/auth/signup\|/auth/confirm-email" README.md docs/` returns nothing

#### Manual Verification:

- Following the runbook, an author created in local Studio can sign in successfully
- The hosted-closure steps are accurate against the current Supabase dashboard (spot-checked by the author)

**Implementation Note**: This is the final phase; after verification the change is ready to commit and hand to `/10x-archive` once merged.

---

## Testing Strategy

No automated test runner is configured (CI = install → astro sync → lint → build).
Verification is the CI gate plus the manual checks per phase.

### Manual Testing Steps:

1. With the stack restarted, attempt signup via direct API call → rejected; `/auth/signup` → 404.
2. Unauthenticated: `/` and `/dashboard` redirect to `/auth/signin`; signin page + assets load.
3. Create an author in local Studio per the runbook; sign in; confirm `/dashboard` is reachable; sign out; confirm routes re-gate.

## Performance Considerations

Negligible. The middleware already calls `supabase.auth.getUser()` on every request; the change only alters the post-resolution branch and adds a cheap path-prefix check.

## Migration Notes

No data migration. `config.toml` change requires a local stack restart to take effect. Hosted closure is a manual dashboard step captured in the runbook.

## References

- Roadmap: `context/foundation/roadmap.md` (F-01)
- PRD: `context/foundation/prd.md` (FR-001, NFR Data privacy, Access Control §)
- Current middleware: `src/middleware.ts:4`
- Signup endpoint being removed: `src/pages/api/auth/signup.ts:13`
- Supabase signup flags: `supabase/config.toml:169`, `supabase/config.toml:204`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Close the registration gate

#### Automated

- [x] 1.1 `pnpm exec astro sync` succeeds — 35afce9
- [x] 1.2 Build passes with no unresolved imports (`pnpm build`) — 35afce9
- [x] 1.3 Linting passes (`pnpm lint`) — 35afce9
- [x] 1.4 No remaining references to removed routes in `src/` (grep clean) — 35afce9

#### Manual

- [x] 1.5 Direct `POST` to Supabase `/auth/v1/signup` rejected after stack restart — 35afce9
- [x] 1.6 `GET /auth/signup` returns 404 — 35afce9
- [x] 1.7 No "Sign up" links remain in signin page, Topbar, or Welcome — 35afce9

### Phase 2: Deny-by-default route protection

#### Automated

- [x] 2.1 Build passes (`pnpm build`) — 39933b9
- [x] 2.2 Linting passes (`pnpm lint`) — 39933b9

#### Manual

- [x] 2.3 Unauthenticated `GET /` redirects to `/auth/signin` — 39933b9
- [x] 2.4 Unauthenticated `GET /dashboard` redirects to `/auth/signin` — 39933b9
- [x] 2.5 `/auth/signin` and its static assets load while unauthenticated — 39933b9
- [x] 2.6 After sign-in, protected routes reachable; sign-out re-gates — 39933b9

### Phase 3: Provisioning runbook & doc fixes

#### Automated

- [x] 3.1 Runbook file exists (`docs/runbooks/author-provisioning.md`)
- [x] 3.2 Build still passes (`pnpm build`)
- [x] 3.3 No references to removed auth routes remain in docs (grep clean)

#### Manual

- [x] 3.4 Author created in local Studio per runbook can sign in
- [x] 3.5 Hosted-closure steps spot-checked against current Supabase dashboard
