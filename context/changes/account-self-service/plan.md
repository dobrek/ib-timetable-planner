# Account Self-Service (S-401) Implementation Plan

## Overview

Give every signed-in user an `/account` page, reached from the sidebar footer, where they change their own password and set a display name. Enforce the PRD's 15-character password floor where a user cannot bypass it (Supabase Auth config, local and hosted), nudge existing users whose password is below it, and store the display name in a new `public.profiles` table that later slices (S-406 Users page, S-407 "Created by") can read. Roadmap S-401; PRD FR-411, FR-413, §NFG "Passwords shorter than 15 characters are refused".

> **Revised 2026-10-17 after `reviews/plan-review.md`** (verdict REVISE). All ten findings were accepted with their recommended fix and are folded in below; each changed spot cites its finding (F1–F10). Progress step titles are unchanged by rule, and where a title no longer matches its step, a note in the phase's Success Criteria says what the step now means.

## Current State Analysis

From `context/changes/account-self-service/research.md` (2026-10-16, commit `a86f52c`):

- **Auth plumbing works for this today.** Actions build a server client from `context.cookies` (`src/shared/lib/actions/require-supabase.ts:5`); cookies written in an action reach the response; `@supabase/ssr` calls `setAll` on `USER_UPDATED`. GoTrue's `PUT /user` returns the user only (no new tokens), keeps the caller's session, and **deletes every other session of the user** (hard-coded, `internal/models/user.go` `LogoutAllExceptMe`). The middleware's per-request `getUser()` (`src/middleware.ts:26-35`) turns that into a sign-out on the other devices' next request.
- **Missing plumbing:** no `AuthError → DomainError` mapper (`toDomainError` is PostgREST-only, `src/shared/api/postgrest/to-domain-error.ts:15-19`); `DomainErrorCode` lacks `UNAUTHORIZED` / `TOO_MANY_REQUESTS` (`src/shared/lib/errors/domain-error.ts:9-14`); `defineDomainAction`'s `run(supabase, input)` receives no caller id (`src/shared/lib/actions/define-domain-action.ts:15`).
- **Config:** `minimum_password_length = 6` (`supabase/config.toml:175`), `secure_password_change = false` (`:214`), `password_requirements = ""` (`:178`). Hosted values for the password floor, "Secure password change" and "Require current password when updating" are **unrecorded**; the last one has **no `config.toml` key at all**. Every password in the repo, CI and e2e is already ≥ 15 characters.
- **Legacy passwords:** GoTrue enforces the floor only when a password is *set*; sign-in returns `data.weakPassword` on a 200, which `src/pages/api/auth/signin.ts:13` discards.
- **Shell:** `SidebarLayout.astro:102-122` footer shows the email, the theme toggle and a native sign-out form; no account link, no React in the shell. `GLOBAL_NAV_ITEMS` also drives the dashboard cards (`DashboardPage.astro:5`) and will be role-gated by S-403.
- **Forms:** reference pattern is `src/_pages/teachers/ui/TeacherFormDialog.tsx` (RHF + `zodResolver`, `mode: "onTouched"`, `submitForm`, `callAction`). `submitForm` toasts then `refreshPage()` → a full reload with no `<ClientRouter />`, which destroys the toast (`src/shared/lib/forms/refresh-page.ts:4-5`). `PasswordToggle` is private to the sign-in slice (`src/_pages/sign-in/ui/PasswordToggle.tsx`). `Banner.astro` uses literal hex colours (`:27-41`).
- **Harness:** the role matrix is typed over every public table (`src/test/role-matrix-expectations.ts:44,109`) and assumes plan-rooted rows (`planKey` → `id | plan_id`, `src/test/access-probe.ts:123-127`); `WRITES` has no "whose row" dimension and `role-matrix-expectations.test.ts:21-23` forbids an all-denied write row. Every `chromium` e2e spec shares one author whose provisioning never resets the password (`scripts/provision-e2e-author.mjs:53-68`). No `pnpm db:types` script exists (HC Fix 8).
- **Grants precedent:** `generation_jobs` is the only table revoking all eight privileges from `anon` (`supabase/migrations/20260810200122_generation_jobs.sql:120-129`); `solver_job_writer` holds no default privileges, so a new table is unreachable to it unless granted.

## Desired End State

A signed-in user (with or without a role, once S-403 lands) opens **Account** from the sidebar footer and:

- sets, changes or clears a **display name**; the footer immediately shows it (email beneath), and other signed-in users can read it from `public.profiles`;
- **changes their password** by typing it twice (no current password asked); on success they stay signed in on this device, their other devices are signed out on their next request, and a password under 15 characters or over 72 bytes is refused by the server, not just the form;
- a user whose *existing* password is below 15 characters lands on the dashboard after each sign-in with a warning banner pointing at `/account`, until the password changes (F4).

Verification: `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` green; the role matrix declares and proves `profiles` (anon none; `authenticated` INSERT/SELECT/UPDATE; own-row writes allowed, another's row denied; `solver_job_writer` unreachable); an integration suite proves the password mechanics (success, floor, same-password, other-session revocation), the profile upsert through the `auth.uid()` default, and the name CHECK; e2e proves the page, the footer link, the display-name round trip and the unauth `/account` redirect; the hosted-settings runbook records the three Auth values as checked.

### Key Discoveries:

- `supabase.auth.updateUser({ password })` must never be passed `email` on the server client (forced PKCE writes a verifier cookie; a different email starts an email-change flow) — research §1.
- GoTrue measures password length in **UTF-8 bytes** (`len(password)`), caps at **72 bytes** (`validation_failed`, 400); a client `min(15)` on UTF-16 code units is at least as strict, so it is safe for UX; the 72-byte cap needs a byte check — research §4.
- `upsert` without `.select()` sends `Prefer: return=minimal`, which keeps the write off the SELECT policy (the RETURNING trap recorded in `20260812141459_solver_select_column_scope.sql:16-29`).
- `heldPrivileges` returns verbs sorted; `GRANTS.profiles.authenticated` must be `["INSERT","SELECT","UPDATE"]` in that order (`src/test/postgres-client.ts`).
- `e2e/auth.setup.ts` is the only place allowed to drive the sign-in UI (`e2e/CLAUDE.md:34-36`). No spec reads the sidebar footer (`auth.spec.ts:16-19` scopes its email check to the dashboard `<header>`), so the account spec can run on the shared author if it restores the name (F5).
- Cross-slice loaders live in `src/shared/api/` (`loadPlanSummary`, `loadTeacherNames`) and throw through `unwrap*` — the precedent for `loadOwnProfile` (F10).
- A column default of `auth.uid()` gives the domain function the caller's id without widening `defineDomainAction` (F3); RLS's `with check` still enforces ownership.

## What We're NOT Doing

- No current-password check and no "Secure password change" nonce (PRD FR-411 dropped the rule; the session-hijack trade-off is accepted and recorded in the hosted-settings runbook). Both hosted toggles are verified **off**, never enabled.
- No forgot-password / reset email, SMTP, `site_url`, redirect allowlist or `[inbucket] → [local_smtp]` changes — S-402 (roadmap `:299-300`).
- No `email` column, no `auth.users` trigger and no mirror of users who never set a name in `profiles` — S-406 owns the readable user list and its sync mechanism.
- No `SECURITY DEFINER` function (S-403 introduces the first, recorded exception).
- No forced password change for legacy users — a dismissible nudge only (the forced flow is S-409's).
- No `password_requirements` character classes (PRD requires length only; classes would break `openssl rand -hex`, bare `randomUUID()` and the e2e default). No HIBP (Pro-tier; plan tier unrecorded).
- No React in the app shell: the footer link stays plain Astro; no user dropdown menu.
- No `<ClientRouter />`; the display-name save reloads the page and reports success server-side.
- No password-change click-through in Playwright (mechanics are proven at integration level); no changes to the shared e2e author's password; no second e2e account, `chromium-account` project or action-unauth spec (F5).
- No caller-identity parameter on `defineDomainAction`, and no change to `requireSession` (F3).
- No weak-password cookie, inline dismiss script or shell-wide banner (F4).
- No shared `AuthError` mapper yet: it stays private to the account slice until S-402 is its second consumer (F2).
- No display name on the dashboard header ("Signed in as <email>" stays; `auth.spec.ts:16-19` asserts it).
- No middleware change. `/account` is an ordinary authenticated route today; S-403 adds the role-less allowance when it adds roles (noted for S-403 in Migration Notes).

## Implementation Approach

**Prerequisites, by hand, before Phase 1 (F8):** run the read-only `GET /v1/projects/hwmuiymhjgewtymymbmb/config/auth` on the Management API and confirm `security_update_password_require_reauthentication` and `security_update_password_require_current_password` are both `false`, then set hosted `password_min_length = 15`. These are the only unknowns that can make the no-current-password design fail on hosted, so they come first. Tracked as Progress row 1.9; Phase 5 records them in the runbook.

Five phases, each independently green, shipped as **one PR** (F8): only the merge exposes `/account` on hosted, and it deploys the migration (observe the no-solve-running rule):

1. **Data layer & access proof** first, because the migration is the only piece that touches hosted data on merge and the harness generalization is where the hidden cost sits. It lands the floor locally so the integration suite in Phase 3 can prove the refusal.
2. **Shared plumbing** next — two domain codes, `PasswordInput`, token-clean `Banner` — small, pattern-following, no account UI yet.
3. **The account slice**: schemas, domain functions and their private auth-error mapper, actions, island, route, and the integration suite that proves the password mechanics, the upsert and the CHECK.
4. **Shell, nudge and browser coverage**: the footer link, the dashboard weak-password notice, and the specs.
5. **Docs and hosted settings**: runbooks, recording the hosted check, CLAUDE.md/README, `.editorconfig`, roadmap drift.

Within the slice: Astro Actions, not an API route (API routes are reserved for session endpoints, `lessons.md:23`); one island mounting one `<Toaster />`; two private form hooks (`ui-conventions.md:26-33`); the password form skips the reload (toast survives), the name form reloads to `/account?saved=name` and the page renders the status.

## Critical Implementation Details

- **`updateUser` call shape.** Pass exactly `{ password }`. Never include `email` or `data` in the same call on the server client (see Key Discoveries). Read the result with the new `unwrapAuth`, never `if (error) throw`.
- **Floor must land in `config.toml` before the integration suite.** The "14 characters → refused" test depends on the local stack running `minimum_password_length = 15`; restart the stack after the edit (`pnpm exec supabase stop && start`, or `db reset`).
- **Both profile forms live in one island.** `submitForm` toasts on success; a second `<Toaster />` would show each toast twice. The password form passes `refresh: async () => {}` and `onClose: () => form.reset()`; the name form passes `refresh: () => navigate("/account?saved=name")`.
- **Grant lists are compared sorted and exact** (`livePosture` vs `GRANTS`); the migration must revoke precisely so `authenticated` reads `["INSERT","SELECT","UPDATE"]` and `anon` `[]`.
- **The owner id comes from the column default (F3).** `updateDisplayName` upserts `{ display_name }` only, with `onConflict: "user_id"`; `user_id` defaults to `auth.uid()`. The service role has no uid, so factories always pass `user_id` explicitly. Confidence in the PostgREST upsert path is medium until Phase 3's suite proves it; if it fails, fall back to the review's Fix B (actor parameter plus a `ui-conventions.md` amendment) and say so at the phase gate.
- **The account spec restores what it changes (F5).** It runs on the shared author in `chromium` and clears the display name in a `finally` through the action endpoint, so a failed run leaves no name behind. No other spec asserts on footer text.

## Phase 1: Data layer & access proof

### Overview

Raise the local password floor, add `public.profiles` with its RLS and grants, make type regeneration fail-safe, and extend the role-matrix and solver-guard suites so the new table is declared, probed and proven.

### Changes Required:

#### 1. Local password floor

**File**: `supabase/config.toml`

**Intent**: Make the local Auth server refuse passwords under 15 characters so every later test of the floor can fail. Leave `secure_password_change = false` and `password_requirements = ""` as they are, with a one-line comment above the floor citing PRD §NFG.

**Contract**: `[auth] minimum_password_length = 15` (`:175`). Nothing else in `[auth]` / `[auth.email]` changes in this slice.

#### 2. `profiles` migration

**File**: `supabase/migrations/<timestamp>_profiles.sql` (via `pnpm exec supabase migration new profiles`)

**Intent**: One additive table keyed by the Auth user id, holding only the display name, written by its owner and readable by every signed-in human; unreachable to `anon` and to the solver role. Header block in the house style ("GRANTS / RLS: yes to both"), and a comment stating that the forbidden-character check mirrors the Zod rule because PostgREST can be called directly.

**Contract** (the default, the CHECK and the grant narrowing are the non-obvious parts):

```sql
create table public.profiles (
  -- same key S-403's user_roles will use; the default is the caller (F3) — the service role has none, so it passes user_id
  user_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text
    check (
      display_name is null
      or (
        char_length(display_name) between 1 and 60
        and display_name = btrim(display_name)
        -- written as ARE hex escapes, never as the literal characters (F6), one commented range each:
        --   [:cntrl:]      C0/C1 controls
        --   \x200B-\x200F  zero-width space/joiners and LRM/RLM marks (U+200B–U+200F)
        --   \x202A-\x202E  bidi embeddings and overrides (U+202A–U+202E)
        --   \x2066-\x2069  bidi isolates (U+2066–U+2069)
        --   \xFEFF         byte-order mark / zero-width no-break space (U+FEFF)
        and display_name !~ '[[:cntrl:]\x200B-\x200F\x202A-\x202E\x2066-\x2069\xFEFF]'
      )
    ),
  updated_at   timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function extensions.moddatetime(updated_at);

alter table public.profiles enable row level security;
create policy "Authenticated users read every profile" on public.profiles
  for select to authenticated using (true);
create policy "Users insert their own profile" on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users update their own profile" on public.profiles
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- no DELETE policy: rows leave by cascade

revoke select, insert, update, delete on public.profiles from anon;
revoke truncate, references, trigger, maintain on public.profiles from anon;
revoke delete, truncate, references, trigger, maintain on public.profiles from authenticated;
-- service_role keeps its default DML (factories, teardown); solver_job_writer and supabase_auth_admin get nothing.
```

Invariants: `display_name` nullable (S-406 will add rows for users who never set one); no authorization data ever lives here; the source file contains no invisible characters (`grep -P '[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]'` finds nothing). The escapes are `\x`/`\u{…}` forms on purpose: the agent tooling decodes a JSON-style `\u` + four hex digits into the literal character, which is how the first draft of this plan got invisible bytes. The `\x` form was checked against local Postgres 17 (2026-10-17): it refuses U+202E, U+200B, U+FEFF, U+2066, tab, DEL and U+0085, and accepts "Zoë Łukasz" and emoji. The account suite proves it for good (Phase 3 §8, F7), not the role matrix.

#### 3. Fail-safe type regeneration (HC Fix 8)

**File**: `scripts/db-types.mjs`, `package.json`

**Intent**: Replace the raw redirect that empties `database.types.ts` on failure with a script that captures `pnpm exec supabase gen types typescript --local`, writes to a temp file and moves it into place only on exit 0 with non-empty output. Wire it as `pnpm db:types`.

**Contract**: `"db:types": "node scripts/db-types.mjs"`; the script exits non-zero and leaves the committed file untouched on any failure. Node-only (host tooling, like the other `scripts/*.mjs`).

#### 4. Regenerated types

**File**: `src/shared/api/database.types.ts`

**Intent**: Run `pnpm db:types` with the stack on the new migration; commit verbatim. This is what makes the role matrix a type error until `profiles` is declared.

**Contract**: `Database["public"]["Tables"]["profiles"]` with `user_id`, `display_name: string | null`, `updated_at`.

#### 5. Per-table fixture key in the access probe

**File**: `src/test/access-probe.ts`, `src/test/role-matrix.integration.test.ts`

**Intent**: Generalize the probe from "every row belongs to a plan" to a per-table fixture reference, so a user-keyed table can be probed with the same `classifyRead`. Add a fixture profile owned by a dedicated fixture user; keep the shared-workspace classifier unchanged (`using (true)` still holds; S-403 owns the "own row only" outcome).

**Contract**: `probeRead(client, table, fixture)` and `seesFixtureRows(client, table, fixture)` take `FixtureRef = { planId: string; profileOwnerId: string }`; a private `fixtureKey(table): { column: "id" | "plan_id" | "user_id"; value: string }` replaces `planKey`. `buildFixture` returns a `FixtureRef`, creating the owner through a new factory (change 6) and inserting its profile row as the service role. The docblock's "partial visibility" sentence is reworded to "other rows but none of the fixture's".

#### 6. Factories for a plain Auth user and a profile row

**File**: `src/test/factories/create-auth-user.ts`, `src/test/factories/add-profile.ts`, `src/test/factories/create-signed-in-user.ts`, `src/test/factories/index.ts`

**Intent**: `createAuthUser(admin)` creates and registers a confirmed user without signing in (no rate-limit cost); `addProfile(admin, { userId, displayName })` inserts a row as the service role, always passing `user_id` (the service role has no `auth.uid()`, F3). `createSignedInUser` additionally returns `password`, so a suite can open a second session for the same user (Phase 3's revocation test). Export all from the barrel.

**Contract**: `SignedInUser` gains `password: string`; `createAuthUser` returns `{ id, email }`; both register with `teardown` (users cascade their profile).

#### 7. Role-matrix expectations and probes for `profiles`

**File**: `src/test/role-matrix-expectations.ts`, `src/test/role-matrix-expectations.test.ts`, `src/test/role-matrix.integration.test.ts`

**Intent**: Declare the new table in `READS` and `GRANTS`, and add write cells with the "whose row" dimension profiles need: own-row writes (the evidence that the payload is valid) and another user's row (the claim under test). Access cells only: the CHECK constraint is proven once, in the account suite (F7).

**Contract** (F1 — `profiles` stays out of `RepresentativeTable`, `WRITES`, `WRITE_PROBES` and `WriteProbeBuilder`, none of which change):

| Cell | anon | noRole |
|---|---|---|
| `READS.profiles` | denied | allowed |
| `PROFILE_WRITES.own.insert` / `.own.update` | denied | allowed |
| `PROFILE_WRITES.others.insert` (foreign `user_id`) / `.others.update` | denied | denied |
| `GRANTS.profiles` | `[]` | `["INSERT","SELECT","UPDATE"]` |

- Shape: one explicit `PROFILE_WRITES: Record<"own" | "others", Record<"insert" | "update", Cell>>` beside `WRITES`. DELETE has no cell: `GRANTS.profiles.authenticated` holds no DELETE, and the catalog check proves it.
- Each cell builds its own target, so none depends on order. Own-INSERT first deletes the principal's row as admin; own-UPDATE first upserts it as admin. Each `others` cell targets a fresh user from `createAuthUser`, with a profile only for UPDATE, so RLS is the only possible reason for a refusal. Probes send `user_id` explicitly and pass the principal's own id (`null` for anon → a random uuid, denied at the grant layer).
- `PRINCIPAL_NOTES.noRole` is reworded: allowed everywhere *except another user's profile row*.
- The expectations test adds the `own` rows to the "at least one allowed principal" check, and checks each `others[op]` row through its `own[op]` counterpart.

#### 8. Solver guard covers `profiles`

**File**: `src/test/solver-credential.integration.test.ts`

**Intent**: Prove the machine role cannot reach the new table even if the token hook fell back to `authenticated` — add `profiles` to the unreachable-table loop and to the `heldPrivileges(...) → []` assertions.

**Contract**: `heldPrivileges(pg, "solver_job_writer", "public.profiles")` equals `[]`; `solver.from("profiles").select("user_id")` errors `42501`.

### Success Criteria:

#### Automated Verification:

- `pnpm exec supabase db reset` applies the migration cleanly on the local stack (done as `supabase migration up --local`, to keep the developer's local Auth users; CI's stack applies every migration from scratch — accepted at the Phase 1 gate)
- `pnpm db:types` regenerates `src/shared/api/database.types.ts` and a deliberately failing run (stack stopped) leaves the file unchanged
- `pnpm check` passes with `profiles` declared in `READS` and `GRANTS`
- `pnpm test` passes (`role-matrix-expectations.test.ts` with the own-row rule)
- `pnpm test:integration src/test/role-matrix.integration.test.ts src/test/solver-credential.integration.test.ts` passes, including the catalog check and the `PROFILE_WRITES` cells (Progress 1.5's "CHECK-constraint cells" moved to Phase 3 §8, F7)
- `pnpm lint` and `pnpm steiger` pass

#### Manual Verification:

- `select has_table_privilege('anon','public.profiles', v) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) v` is all `false`; the same for `authenticated` is `true` only for SELECT/INSERT/UPDATE
- Supabase Studio shows `profiles` with RLS enabled and the three policies
- Prerequisite (F8, Progress 1.9): hosted toggles read `false` and hosted `password_min_length` set to 15, by hand

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Shared plumbing

### Overview

Add the pieces later phases rely on: two domain error codes, a reusable password input, and a token-clean banner. No user-visible change yet beyond sign-in gaining autocomplete attributes. (The auth-error mapper moved into the account slice, Phase 3 §2, F2; the caller-identity change was dropped for a column default, F3.)

### Changes Required:

#### 1. Domain error codes

**File**: `src/shared/lib/errors/domain-error.ts`

**Intent**: Let the domain layer express "no session" and "rate limited", which GoTrue produces and `ActionError` already carries.

**Contract**: `DomainErrorCode` gains `"UNAUTHORIZED" | "TOO_MANY_REQUESTS"`; `runDomain` needs no change (codes stay a 1:1 subset).

#### 2. ~~Auth error mapper~~ — moved to Phase 3 §2, private to the slice (F2)

#### 3. ~~Caller identity for domain functions~~ — dropped (F3)

`profiles.user_id default auth.uid()` supplies the caller; `requireSession`, `defineDomainAction` and `ui-conventions.md`'s "(supabase, input)-shaped" rule stay as they are.

#### 4. `PasswordInput` promoted to `shared/ui`

**File**: `src/shared/ui/password-input.tsx`, `src/shared/ui/index.ts`; delete `src/_pages/sign-in/ui/PasswordToggle.tsx`; update `src/_pages/sign-in/ui/SignInForm.tsx` and `FormField.tsx`

**Intent**: One input-with-toggle for sign-in now and for the account page, the reset page (S-402), the forced change (S-409) and the invite acceptance (S-410). The toggle names itself after the field so two toggles on one page have distinct accessible names, and declares its state and target.

**Contract**: `<PasswordInput id name autoComplete toggleLabel="password" className …inputProps />` renders the shadcn `Input` with `type` switched by local state and a button with `aria-label={visible ? \`Hide ${toggleLabel}\` : \`Show ${toggleLabel}\`}`, `aria-pressed`, `aria-controls={id}`. Token classes only.

Sign-in adoption (F9), a change that removes code:

- When `type="password"`, `FormField` renders `PasswordInput` (forwarding `className` for the `pl-10` icon padding) instead of `Input`.
- Delete `endContent` from `FormField` and the `showPassword` state from `SignInForm`.
- Sign-in keeps `toggleLabel="password"`, so `auth.setup.ts:26-27` ("Show password" / "Hide password") still matches.
- Email gains `autoComplete="username"`; password gains `"current-password"`.

#### 5. Token-clean `Banner`

**File**: `src/shared/ui/Banner.astro`

**Intent**: The weak-password nudge (Phase 4, on the dashboard) uses the `warning` variant, and `lessons.md:12-17` forbids the literal hex it carries today. Rewrite the three variants on semantic tokens (`--warning`, `--destructive`, and an info tone on `--accent`/`--foreground`), keep the `role` logic and the slot.

**Contract**: No hex or palette-named utilities remain in the file; variants and `role` unchanged; the missing-config banner in `BaseLayout.astro` renders as before.

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes (Progress 2.1's mapper tests now land in Phase 3 with the slice-private mapper, F2; in Phase 2 the step means the existing suite stays green)
- `pnpm check`, `pnpm lint`, `pnpm steiger` pass (no `_pages/sign-in` import of the deleted toggle remains)
- `pnpm build` passes
- `pnpm test:e2e e2e/specs/auth.spec.ts` passes (the setup project's toggle gate still finds "Show password")

#### Manual Verification:

- Sign-in page: the toggle flips the field, a password manager offers to fill it (autocomplete attributes), light and dark themes show no literal colours on the missing-config banner (temporarily blank a key in `.dev.vars` to see it)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Account slice

### Overview

The `_pages/account` slice with its two actions, the `/account` route and island, and the integration suite that proves the password mechanics and the profile upsert through real publishable-key sessions.

### Changes Required:

#### 1. Schemas

**File**: `src/_pages/account/model/schemas.ts`, `schemas.test.ts`

**Intent**: One source of truth for both the action gates and the form resolvers. The password rule mirrors GoTrue (≥ 15, ≤ 72 bytes); the display-name rule mirrors the DB CHECK and normalizes to NFC so the stored string is what the user saw. The confirm field exists only on the client.

**Contract**:

- `passwordInput = z.object({ password: z.string().min(15, …).refine(utf8Bytes ≤ 72, …) })` — the action input.
- `passwordFormSchema = passwordInput.extend({ confirm: z.string() }).refine(match, { path: ["confirm"], message: "Passwords do not match" })` — client only; `PasswordFormValues = z.input<…>`, `PasswordInput = z.output<typeof passwordInput>`.
- `displayNameInput = z.object({ displayName: z.string().transform(NFC + trim).pipe(z.string().max(60).refine(noForbiddenChars)).transform("" → null) })`, where `noForbiddenChars` tests one named, commented `FORBIDDEN_NAME_CHARACTERS = /[\p{Cc}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{FEFF}]/u` — escapes, one comment per range, mirroring the SQL CHECK (F6); `DisplayNameFormValues = z.input`, `DisplayNameInput = z.output` (`{ displayName: string | null }`).
- Unit tests: 14 vs 15 chars; a 73-byte password made of 2-byte characters is refused while 72 bytes passes; confirm mismatch lands on `confirm`; name trimming, NFC, bidi-override refusal, `""` → `null`.

#### 2. Domain functions and their auth-error mapper

**File**: `src/_pages/account/api/update-password.ts`, `src/_pages/account/api/update-display-name.ts`, `src/_pages/account/api/unwrap-auth.ts` (+ `unwrap-auth.test.ts`), `src/_pages/account/api/constants.ts`

**Intent**: Framework-free, `(supabase, input)`-shaped like every other domain function (F3). `updatePassword` calls `supabase.auth.updateUser({ password })` and reads it through `unwrapAuth`. `updateDisplayName` upserts `{ display_name }` with `onConflict: "user_id"` and no `.select()` — `user_id` comes from the column default — and maps `23514` to `UNPROCESSABLE_CONTENT` with the slice's message before falling through to `unwrapCompleted`.

`unwrapAuth` is private to the slice and covers only the rows this call can reach (F2). It moves to `shared/api` when S-402 arrives as its second consumer:

| GoTrue `code` | Domain code | Message |
|---|---|---|
| `weak_password` | `UNPROCESSABLE_CONTENT` | "Use at least 15 characters." when `reasons` includes `length`; else GoTrue's |
| `same_password` | `UNPROCESSABLE_CONTENT` | "Choose a password you have not used before." |
| `over_request_rate_limit` | `TOO_MANY_REQUESTS` | "Too many attempts — try again in a few minutes." |
| `isAuthSessionMissingError(error)` (revoked in a race past `requireSession`) | `UNAUTHORIZED` | "Your session has ended — sign in again." |
| anything else (incl. a hosted toggle's `reauthentication_needed` / `current_password_required`, which the runbook lists) | `INTERNAL_SERVER_ERROR` | GoTrue's message |

**Contract**: `unwrapAuth<T>(result: { data: T; error: AuthError | null }): T`; `updatePassword(supabase, { password }): Promise<void>`; `updateDisplayName(supabase, { displayName }): Promise<void>`. Neither returns user data to the client. Unit tests cover each mapper row with constructed `AuthError` / `AuthWeakPasswordError` / `AuthSessionMissingError` instances (no network).

#### 3. Actions, client, barrel, composition

**File**: `src/_pages/account/api/actions.ts`, `src/_pages/account/api/account-client.ts`, `src/_pages/account/api/index.ts`, `src/actions/index.ts`

**Intent**: The declarative routing table and the typed client seam, following the teachers slice exactly; `accountActions` spread into the composition root.

**Contract**: `accountActions = { updatePassword: defineDomainAction({ input: passwordInput, run: updatePassword }), updateDisplayName: defineDomainAction({ input: displayNameInput, run: updateDisplayName }) }`; `account-client.ts` exports `updatePassword(values)` / `updateDisplayName(values)` over `callAction`; `api/index.ts` exports `accountActions` (and `loadOwnProfile` re-exported from `@/shared/api` is **not** here — see change 4).

#### 4. Profile loader

**File**: `src/shared/api/load-own-profile.ts`, `src/shared/api/index.ts`

**Intent**: The one read the account page and the app shell share: the caller's display name, or `null` when no row exists. Like every sibling in `shared/api` it throws on a read error; what to do about the error is the caller's decision (F10). The shell catches and degrades (Phase 4 §1); `/account` lets it fail, because an empty field after a failed read would look like "no name".

**Contract**: `loadOwnProfile(supabase, userId): Promise<string | null>` — `maybeSingle()` on `profiles` by `user_id`, through `unwrapMaybeRow`.

#### 5. ~~Display label helper~~ — moved to Phase 4 §1, beside `SidebarLayout` (F10)

It has no account-page consumer, so it stays next to its only caller until a second appears.

#### 6. Island and forms

**File**: `src/_pages/account/ui/AccountSettings.tsx`, `src/_pages/account/ui/DisplayNameForm.tsx`, `src/_pages/account/ui/PasswordForm.tsx`, `src/_pages/account/index.ts`

**Intent**: One island (`AccountSettings`, the thin orchestrator that mounts the single `<Toaster />`) with two named form sections. Each form file owns its private hook below the component (`useDisplayNameForm`, `usePasswordForm`), RHF + `zodResolver`, `mode: "onTouched"`, `submitForm`. Page header follows `TeacherCatalog.tsx:38-42`; content in a `max-w-xl` column; cards hand-rolled like `DashboardPage.astro:22`.

**Contract**:

- `AccountSettings({ email, displayName })`; both forms are `<form aria-labelledby>` landmarks ("Display name", "Change password") with distinct submit labels ("Save name", "Change password").
- Display-name form: one `Input` with `FormDescription` ("Shown beside your email. Leave empty to show only your email."), no counter (F10); `submitForm({ …, conflictField: "displayName", conflictCodes: ["UNPROCESSABLE_CONTENT", "BAD_REQUEST"], successMessage: "Display name saved", onClose: noop, refresh: () => navigate("/account?saved=name") })`.
- Password form: a hidden `<input type="text" name="username" autoComplete="username" value={email} readOnly hidden>` then two `PasswordInput`s (`autoComplete="new-password"`, `toggleLabel` "new password" / "confirmation"), `FormDescription` "At least 15 characters. Your other devices will be signed out."; `submitForm({ …, conflictField: "password", conflictCodes: ["UNPROCESSABLE_CONTENT", "BAD_REQUEST", "TOO_MANY_REQUESTS"], successMessage: "Password changed", onClose: () => form.reset(), refresh: async () => {} })`; `UNAUTHORIZED` falls through to the toast. No cookie to clear (F4): the nudge is gone at the next sign-in, because GoTrue stops sending the hint once the password is long enough.
- No `autoComplete="off"` anywhere in this slice. `FormMessage`s are complemented by a `role="status"` line for success where no toast survives.

#### 7. Route and page

**File**: `src/pages/account.astro`, `src/_pages/account/ui/AccountPage.astro`

**Intent**: Read the profile, render the header and a server-side `saved` status, mount the island. The status line is what survives the display-name reload.

**Contract**: `account.astro` builds the client like `dashboard.astro`/`teachers.astro`, calls `loadOwnProfile(supabase, user.id)` (a read error fails the page, F10), and renders `<AccountPage email displayName saved={Astro.url.searchParams.get("saved")} />` inside `AppShellLayout title="Account"`; `AccountPage.astro` renders `<p role="status">Display name saved.</p>` when `saved === "name"` and `<AccountSettings … client:load />`. 503 branch when Supabase is unconfigured, as the other pages do. The flag stays in the URL, so reloading the page shows "saved" again; that is accepted.

#### 8. Integration suite — password mechanics and profile access

**File**: `src/test/account-self-service.integration.test.ts`

**Intent**: Prove the domain functions against the real local Auth and database through publishable-key sessions, including the one behaviour nobody can see in code review: other sessions are revoked. Signs in once per principal per file. Access claims stay in the role matrix (F7).

**Contract** (each `it` independent; `teardown` in `afterAll`):

1. `updatePassword(user.client, { password: strong })` resolves; `signInWithPassword` with the new password succeeds and with the old one fails `invalid_credentials`.
2. A 14-character password → `DomainError` `UNPROCESSABLE_CONTENT` (requires Phase 1's floor on the running stack).
3. The same password again → `UNPROCESSABLE_CONTENT` (`same_password`).
4. Two sessions of one user (`createSignedInUser` + a second `createPublishableClient` signed in with `user.password`): after a change on session A, `B.auth.getUser()` returns an error (session missing) while `A.auth.getUser()` still succeeds.
5. `updateDisplayName(user.client, { displayName: "Ada" })` creates the row with `user_id` = the caller, through the `auth.uid()` default (read back as service role) — the round trip F3 depends on; a second call updates it and `updated_at` moves; `null` clears it.
6. The CHECK, once (F7): `updateDisplayName` with a raw, non-Zod name containing U+202E (and one over 60 characters) raises `UNPROCESSABLE_CONTENT`. That proves the `\u` escapes work in this Postgres and that `23514` is mapped, together.

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes (`schemas.test.ts`, `unwrap-auth.test.ts`; `profile-label.test.ts` moved to Phase 4 with its helper, F10)
- `pnpm test:integration src/test/account-self-service.integration.test.ts` passes against the local stack with the Phase 1 floor
- `pnpm check`, `pnpm lint`, `pnpm steiger` pass (new slice conforms to FSD; no `astro:actions` import in `ui/`)
- `pnpm build` passes

#### Manual Verification:

- `pnpm build && pnpm preview`: `/account` renders both forms; saving a name reloads with "Display name saved."; a 10-character password shows the field error before submit; a 15-character password succeeds with a toast, the form clears and the session persists; the same password again shows the field error; a second browser (or private window) signed in as the same user is bounced to sign-in on its next navigation
- Password manager offers to save the new credential (username + new-password autocomplete)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Shell, nudge & browser coverage

### Overview

Make the account page reachable from every page, surface the legacy-password nudge, and cover the new surface in Playwright on the shared author (F5).

### Changes Required:

#### 1. Sidebar footer becomes the account entry point

**File**: `src/app/layouts/SidebarLayout.astro` (and a sibling `SidebarAccountLink.astro` if the markup warrants it), `src/app/layouts/profile-label.ts` + `profile-label.test.ts` (F10)

**Intent**: Replace the plain email paragraph with a link to `/account` showing `profileLabel` (name, email beneath; email alone when no name), a `UserRound` icon, `title="Account"`, and `aria-current="page"` on `/account`. Collapsed mode shows the icon only. The theme toggle and sign-out form stay. The layout reads the profile itself (`createClient` + `loadOwnProfile`) and owns the try/catch: a read error logs and renders the email alone, so the shell never fails on it (F10).

**Contract**: `profileLabel({ displayName, email }): { primary: string; secondary: string | null }` lives beside its only caller (FR-413: name when set, email otherwise, email as the second line only when a name exists). A `role="link"` whose accessible name starts with "Account" exists in the footer on every shell page; the two text lines are `truncate`d with `title`; no user value enters an `is:inline` script.

#### 2. Weak-password notice on the dashboard (F4)

**File**: `src/pages/api/auth/signin.ts`, `src/_pages/dashboard/ui/DashboardPage.astro`

**Intent**: Turn the `weakPassword` hint GoTrue already returns into a nudge, reusing the plan's own status-through-a-query-flag pattern. There is no client state. The banner shows again after each sign-in until the password changes, and leaves once the user navigates away.

**Contract**: `signin.ts` reads `const { data, error }` and redirects to `/dashboard?notice=weak-password` when `data.weakPassword` is set, `/dashboard` otherwise; `DashboardPage` renders `<Banner variant="warning">` ("Your password is shorter than the new 15-character minimum. <a href="/account">Change it on your account page</a>.") when `notice === "weak-password"`. No cookie, no constant, no inline script.

#### 3. ~~Second e2e account~~ — dropped (F5)

`e2e/CLAUDE.md` gains one line instead: `account.spec.ts` edits the shared author's display name (and restores it), so no spec may assert on the sidebar footer's text.

#### 4. Specs

**File**: `e2e/specs/account.spec.ts`, `e2e/specs/auth-guard.spec.ts`

**Intent**: Browser proof of the page, the footer round trip and the redirect gate. The action gate is already proven by `action-unauth.spec.ts` and `define-domain-action.test.ts:46-60` (same `requireSession`), so it gets no new spec (F5).

**Contract**:

- `account.spec.ts` (`chromium`, the shared author): open `/account` via the footer "Account" link; both landmarks visible with their descriptions; set display name `E2E Name <shortId>` (hydration gate: re-assert `toHaveValue` after fill) → "Display name saved." status → footer link text contains the name and the email; clear the name → footer shows the email only. A `finally` clears the name through `page.request.post("/_actions/updateDisplayName", { data: { displayName: "" } })`, so a failed run restores the author too. The password section asserts labels, the "At least 15 characters" description and the two toggles by their distinct names; it does **not** submit.
- `auth-guard.spec.ts` (`chromium-guard`) gains a second test: `/account` → redirected to `/auth/signin`.

### Success Criteria:

#### Automated Verification:

- `pnpm test:e2e` passes locally (all projects, with the solver up per README) — at minimum `pnpm test:e2e e2e/specs/account.spec.ts e2e/specs/auth-guard.spec.ts e2e/specs/auth.spec.ts` (Progress 4.1's account-guard and account-action-unauth specs folded or dropped, F5)
- `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test` (incl. `profile-label.test.ts`), `pnpm build` pass
- CI `e2e` job green on the PR (Progress 4.3 means the one existing author account, F5)

#### Manual Verification:

- In `pnpm preview`: footer shows name + email, collapsed rail shows the icon with the "Account" tooltip, `aria-current` on `/account`; a user with a < 15-char password (create one with the floor temporarily lowered, then restore it and restart) lands on `/dashboard?notice=weak-password` with the warning banner, sees it again on the next sign-in, and no longer after changing the password (Progress 4.4's "banner lifecycle", F4); dark theme banner reads correctly
- Mobile width (~375px): both forms usable beside the 64px rail

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Docs & hosted settings

### Overview

Record what hosted must hold by hand, update the runbooks and command references the slice changes, and carry the two any-time hygiene items the roadmap assigned to S-401.

### Changes Required:

#### 1. Hosted auth settings runbook

**File**: `docs/runbooks/hosted-auth-settings.md`

**Intent**: The three Auth values this slice depends on, none of which `config.toml` can carry to hosted, with the read-only check and the decision behind each: `password_min_length = 15` (set), `security_update_password_require_reauthentication = false` (keep off: nonce needs email), `security_update_password_require_current_password = false` (keep off: FR-411, trade-off accepted). Also how to read the GoTrue version (`/auth/v1/health`) and the standing "never `config push`" pointer. Records the values read in the prerequisite check (Progress 1.9, F8).

**Contract**: a checklist with the Management API `GET /v1/projects/hwmuiymhjgewtymymbmb/config/auth` fields, the dashboard path for each, a "last verified" line, and the GoTrue codes a flipped toggle produces (`reauthentication_needed`, `current_password_required`, `current_password_invalid`). The slice-private mapper sends those to the catch-all as GoTrue's own message (F2), so the runbook is where a future 500 gets diagnosed.

#### 2. Existing runbooks

**File**: `docs/runbooks/author-provisioning.md`, `docs/runbooks/solver-credential.md`

**Intent**: Point the "change the password" step (`author-provisioning.md:93-94`) at `/account`; state the 15-character floor where a password is entered (`:39-40`, `:91`); in `solver-credential.md:156-157` update the `minimum_password_length` row to `15` with its new line number and reword the `secure_password_change` row ("deliberately off — FR-411; see hosted-auth-settings.md").

**Contract**: no runbook still says a password can be changed only in the console; the config-push table matches `config.toml` line numbers after Phase 1.

#### 3. Command references and hygiene

**File**: `CLAUDE.md`, `README.md`, `.editorconfig`

**Intent**: Swap the raw `gen types … >` command for `pnpm db:types` in CLAUDE.md `:52` and add it to README's script table and § Database steps; mention the password floor beside `SOLVER_MACHINE_PASSWORD` in README's local setup. Add `.editorconfig` (HC Fix 10) covering Python, TOML, YAML and Deno files Prettier does not format.

**Contract**: `grep "gen types" CLAUDE.md README.md` finds only the script's own documentation; `.editorconfig` has `root = true`, LF, final newline, 2-space default, 4-space `*.py`.

#### 4. Roadmap drift

**File**: `context/foundation/roadmap.md`

**Intent**: Two lines the research found stale: "v2.189.0 locally" (`:131`) → v2.196.0; F-402's backlog row "Ready: yes" (`:298`) → done. Status fields for S-401 are owned by the `/10x-*` tooling and are not hand-edited here.

**Contract**: only those two cells change.

### Success Criteria:

#### Automated Verification:

- `pnpm format` reports no changes needed on the edited docs; `pnpm lint` and `pnpm build` still pass
- `/verify` (full local CI gate) passes

#### Manual Verification:

- Hosted dashboard / Management API: the values read and set in the prerequisite check (1.9) written into `hosted-auth-settings.md`, with the date, **before the PR merges** (the merge deploys the migration); re-read them if the check was more than a few days earlier
- A sign-in on hosted with an existing author still works; `/account` changes that author's password successfully (then hand the new password to its owner over the usual channel)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `schemas.test.ts`: 14/15-character boundary; 72-byte cap with multi-byte characters; confirm mismatch path; NFC + trim; forbidden characters; `""` → `null`.
- `unwrap-auth.test.ts` (slice-private, F2): each mapper row, including the `weak_password` `reasons` wording and `isAuthSessionMissingError`.
- `profile-label.test.ts` (beside `SidebarLayout`, F10): name set / unset.
- `role-matrix-expectations.test.ts`: `PROFILE_WRITES.own` rows have an allowed principal; each `others` row is evidenced by its `own` counterpart; sorted grant lists.

### Integration Tests:

- `role-matrix.integration.test.ts`: `profiles` READS/GRANTS/`PROFILE_WRITES` own-vs-others; catalog completeness. Access cells only (F7).
- `solver-credential.integration.test.ts`: `profiles` unreachable to `solver_job_writer`.
- `account-self-service.integration.test.ts`: password success / floor / same-password / other-session revocation; profile create through the `auth.uid()` default / update / clear; the CHECK refusing a raw U+202E or over-long name as `UNPROCESSABLE_CONTENT`.

### Manual Testing Steps:

1. `pnpm exec supabase db reset` → `pnpm db:types` → diff is only `profiles`.
2. `pnpm build && pnpm preview`; sign in; open Account from the footer; set a name → footer updates; clear it → email only.
3. Change password to 14 characters → field error; to 15+ → toast, still signed in; in a private window signed in as the same user, navigate → bounced to sign-in.
4. Sign in as a user with a short password → `/dashboard?notice=weak-password` banner; sign in again → banner returns; change password → no banner on later sign-ins.
5. Collapse the sidebar → icon + tooltip; resize to phone width → forms usable.
6. Hosted: the prerequisite check (before Phase 1), recorded in the hosted-auth-settings runbook in Phase 5.

## Performance Considerations

One extra PostgREST read (`loadOwnProfile`) per shell render, and two on `/account` (shell + page). Negligible against the existing per-request `getUser()`; if it ever matters, the middleware can set `locals.profile` once — not now. Drag-drop validation is untouched (no role checks introduced).

## Migration Notes

- **Additive only; safe on live data.** `profiles` starts empty; nothing reads it before the code that tolerates `null`. The migration auto-deploys on merge to `main` — do not merge while a production solve runs.
- **Hosted by hand, before Phase 1 (F8):** the password floor and the two toggles; Phase 5 records them in the runbook before the single PR merges. The app works with the floor unset on hosted (the Zod rule still refuses in the form), but the floor is then UX-only until it is set.
- **For S-407:** `profiles.user_id default auth.uid()` is the schema's first `auth.uid()` default, and the precedent for `created_by` (it also works for rows written inside RPCs).
- **Local stacks:** developers must restart their stack after Phase 1 for the floor; any developer `SOLVER_MACHINE_PASSWORD` under 15 characters is refused on the next `provision-solver-user.mjs` run (README gets the note).
- **For S-403:** `/account` and `updatePassword` / `updateDisplayName` must stay reachable without a role (FR-410) — a role-less path tier in the middleware and an exemption in any action-level role guard. The matrix's `classifyRead` will need an "own row" outcome once role-less SELECT on `profiles` narrows to the caller's row. The `profiles.user_id` key is the one `user_roles` should share.
- **For S-406:** add `email` to `profiles` together with its sync mechanism, and create rows for users who never set a name; both are access decisions owned there.

## References

- Research: `context/changes/account-self-service/research.md`
- Roadmap item: `context/foundation/roadmap.md:136-148` (S-401); PRD `context/foundation/prd.md:210-229` (FR-410/411/413), `:130` (§NFG)
- Reference form: `src/_pages/teachers/ui/TeacherFormDialog.tsx`; schemas `src/_pages/teachers/model/schemas.ts`; actions `src/_pages/teachers/api/actions.ts`
- Action plumbing: `src/shared/lib/actions/define-domain-action.ts`, `require-session.ts`, `run-domain.ts`; errors `src/shared/lib/errors/domain-error.ts`
- Grants precedent: `supabase/migrations/20260810200122_generation_jobs.sql:116-129`; RETURNING trap `20260812141459_solver_select_column_scope.sql:16-29`
- Harness: `src/test/access-probe.ts`, `src/test/role-matrix-expectations.ts`, `src/test/role-matrix.integration.test.ts`, `src/test/factories/`
- E2E topology: `playwright.config.ts`, `e2e/auth.setup.ts`, `e2e/author-credentials.mjs`, `scripts/provision-e2e-author.mjs`, `e2e/CLAUDE.md`
- Conventions: `context/foundation/ui-conventions.md` (hooks `:26-53`, forms `:129-160`, action clients `:191-217`, inline scripts `:259-266`); `context/foundation/lessons.md` (tokens, actions transport, anon revoke, `astro check`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer & access proof

#### Automated

- [x] 1.1 `pnpm exec supabase db reset` applies the migration cleanly on the local stack — fc9c5a8
- [x] 1.2 `pnpm db:types` regenerates `database.types.ts`; a deliberately failing run leaves the file unchanged — fc9c5a8
- [x] 1.3 `pnpm check` passes with `profiles` declared in `READS` and `GRANTS` — fc9c5a8
- [x] 1.4 `pnpm test` passes (`role-matrix-expectations.test.ts` with the own-row rule) — fc9c5a8
- [x] 1.5 `pnpm test:integration` role-matrix + solver-credential suites pass, including catalog and CHECK-constraint cells — fc9c5a8
- [x] 1.6 `pnpm lint` and `pnpm steiger` pass — fc9c5a8

#### Manual

- [x] 1.7 `has_table_privilege` shows anon none, authenticated SELECT/INSERT/UPDATE only — fc9c5a8
- [x] 1.8 Studio shows `profiles` with RLS and the three policies — fc9c5a8
- [x] 1.9 Prerequisite: hosted password-update toggles read off and hosted floor set to 15, by hand — fc9c5a8

### Phase 2: Shared plumbing

#### Automated

- [x] 2.1 `pnpm test` passes including `to-domain-error.test.ts` for every mapping row — 35a1517
- [x] 2.2 `pnpm check`, `pnpm lint`, `pnpm steiger` pass with the sign-in toggle removed — 35a1517
- [x] 2.3 `pnpm build` passes — 35a1517
- [x] 2.4 `pnpm test:e2e e2e/specs/auth.spec.ts` passes (setup toggle gate intact) — 35a1517

#### Manual

- [x] 2.5 Sign-in toggle works, password manager fills, banner token-clean in both themes — 35a1517

### Phase 3: Account slice

#### Automated

- [x] 3.1 `pnpm test` passes (schemas, profile-label, mapper) — 1abc69f
- [x] 3.2 `pnpm test:integration src/test/account-self-service.integration.test.ts` passes — 1abc69f
- [x] 3.3 `pnpm check`, `pnpm lint`, `pnpm steiger` pass for the new slice — 1abc69f
- [x] 3.4 `pnpm build` passes — 1abc69f

#### Manual

- [x] 3.5 `/account` forms behave as specified in preview (name save, floor error, password change, same-password error, second session bounced) — 1abc69f
- [x] 3.6 Password manager offers to save the new credential — 1abc69f

### Phase 4: Shell, nudge & browser coverage

#### Automated

- [x] 4.1 `pnpm test:e2e` passes (account, account-guard, account-action-unauth, auth specs at minimum)
- [x] 4.2 `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` pass
- [ ] 4.3 CI `e2e` job green with both accounts provisioned

#### Manual

- [x] 4.4 Footer link (expanded, collapsed, `aria-current`), weak-password banner lifecycle, dark theme
- [x] 4.5 Phone-width layout usable

### Phase 5: Docs & hosted settings

#### Automated

- [ ] 5.1 `pnpm format` clean on edited docs; `pnpm lint` and `pnpm build` pass
- [ ] 5.2 `/verify` passes

#### Manual

- [ ] 5.3 Hosted floor set and both toggles confirmed off, recorded in `hosted-auth-settings.md` before merge
- [ ] 5.4 Hosted sign-in works and `/account` changes an existing author's password
