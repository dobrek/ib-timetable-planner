# Create account with a temporary password (S-409) Implementation Plan

## Overview

As a fallback when an invitation cannot reach someone (PRD FR-403), an admin creates an account from the Users page. A server-generated temporary password is shown to the admin once. The person cannot reach any data until they choose their own password. The new account appears in the Users list as "Temporary password" until then.

The design is settled by `research.md` (spike: 51/51 checks on a throwaway local stack). A Deno Edge Function (`admin-users`) is the repo's one secret-holding component, so the Worker stays secret-free (`deploy-plan.md:141` stands). A flag column, `user_directory.must_change_password`, makes `private.current_app_role()` return null while set, so RLS fails closed everywhere. A trigger clears the flag on the first real password change.

## Current State Analysis

- No `supabase/functions/` directory. No Deno toolchain, no function deploy, no secret-holding component. CI excludes `edge-runtime` (`.github/actions/supabase-stack/action.yml:48`, `-x` list).
- Access is `granted | none | unavailable` (`src/shared/config/access-state.ts:9`). The middleware reads the role through `loadOwnRole` → `public.own_app_role()` (`src/shared/api/load-own-role.ts:15`) and gates pages with `decideRoleGate` (`src/shared/config/role-gate.ts`). `/account` is already role-exempt.
- `private.current_app_role()` is the single funnel for every capability wrapper (`20261028140939_user_roles.sql:88`). It has not been re-created since. `private.guard_last_admin()` (`20261105080343_role_management.sql:139`) counts `user_roles` admin rows only.
- The Users page reads four tables (`src/_pages/users/api/loader.ts`), builds rows in `model/user-rows.ts`, and renders status as `active | no_access` (`ui/UserTable.tsx`). Its only action is `changeUserRole` (`requires: "manage_users"`).
- The access record (`access_changes`) takes its actor from `auth.uid()`; a secret-key write records as Operator. An admin cannot insert records directly (by design).
- `updatePassword` (`src/_pages/account/api/update-password.ts`) calls `supabase.auth.updateUser({ password })`. That is the write the clearing trigger observes.

## Desired End State

An admin opens the Users page, presses **Create account**, enters an email and chooses a role (viewer / author / admin / none). A 24-character password is shown once, with a copy button. The new person signs in with it and lands on `/account` with a banner; every other page redirects there and every action and RLS read is refused. After they choose their own password, the same session gains their role with no re-sign-in. Until then the admin sees a "Temporary password" row and can re-issue a new temporary password for it.

Verify: the role matrix (including the new `pendingAdmin` principal) is green; the function's HTTP-surface integration suite and `deno test` are green in CI; the e2e spec walks create → forced change → access; the manual hosted smoke test passes.

### Key Discoveries:

- Flag location: `user_directory.must_change_password` — system-owned, RLS-readable live, survives the mirror's column-named upsert (`research.md` C2).
- `current_app_role()` returning null while pending fails every table closed with no policy edits, including for a pending admin (C4).
- Admin `createUser` on GoTrue v2.196.0 enforces no password strength floor, so only server-generated passwords are safe (C6).
- `auth: "user"` in the SDK does not mean human: the solver's machine token passes it. A live `own_app_role` check must precede the admin client (C8).
- Writing the role through the admin's own session makes S-406's trigger attribute it correctly. Only `account_created` is written with the secret key (C9).

## What We're NOT Doing

- **Resetting any confirmed account's password** (D1 option c) — an admin taking over a live account is a separate decision; it moves explicitly to S-411.
- **Expiring temporary passwords** (D3) — no scramble job, no sign-in block. Recorded as an accepted residual in the PRD; the state stays visible on the Users page.
- **Deleting an account**, including a mistyped-email one — S-411. Until then the documented recovery is dashboard deletion.
- **Inviting by email, re-send, revoke** — S-410.
- **Deactivate / reactivate** — S-408. Where it overlaps (`current_app_role()`, the guard), whichever slice lands second copies the body the first left.
- **A Deno lockfile** — exact pins plus Dependabot instead; transitive floating is an accepted residual (C12).
- **Any Worker secret, `wrangler.jsonc` change or composition-root injection.**
- **`supabase config push`** and any hosted auth-config change by this plan's code (CLAUDE.md).

## Implementation Approach

Build the trust boundary before the product: prove hosted (Phase 1), then make the repo able to host, check, test and deploy a function at all (Phase 2). Then the fail-closed access model, red-first (Phase 3). The function sits on top of that model (Phase 4), and the app is a thin courier plus UI (Phase 5). Docs and the hosted smoke test close it (Phase 6).

```
Users page island
  └─ callAction(createAccount | reissueTemporaryPassword)   JSON, never a form post
       └─ Astro Action, requires: manage_users               courier: no secret, no new Worker env
            └─ supabase.functions.invoke("admin-users")      sends the admin's own JWT
                 └─ Edge Function (Deno, @supabase/server)
                      1. withSupabase({ auth: "user" })      verifies JWT against JWKS
                      2. ctx.supabase.rpc("own_app_role")    live check, must be "admin"
                      3. supabaseAdmin: createUser           generated password
                      4. supabaseAdmin: set the flag         user_directory
                      5. supabaseAdmin: account_created      verified actor from the token
                      6. ctx.supabase: grant the role        S-406 trigger attributes the admin
                      7. return the password                 only now; on any failure, undo
```

## Critical Implementation Details

- **Reveal last.** The password goes in the response only after every write has succeeded. On any failure the function deletes the account (create) and returns no password, so even a failed delete leaves a password nobody holds.
- **Re-issue sets the flag after the password write.** The clearing trigger fires on that write and would clear the flag; set it again afterwards. Re-issue is refused for accounts that already chose a password, for machine users, and for active admins.
- **The clearing trigger never raises.** A raising trigger on `auth.users` fails GoTrue's write, which here means every password change including the solver's. The migration takes a lock on `auth.users`, so it sets `lock_timeout` like `20261105073614_user_directory.sql` does.
- **Hosted result picks the trigger form.** Default: `AFTER UPDATE OF encrypted_password ... WHEN (old distinct from new)`. If Phase 1 finds DB encryption on (`encrypted_password like '{%'` hashes), use the `OF reauthentication_token` form instead (research C3). Record which form was chosen in the migration.
- **`verify_jwt = false`, set explicitly** in `config.toml`: an absent key leaves an existing remote function's value alone. Tests assert on status codes, not body shape.
- **Deploy order.** `db push` → function deploy → Wrangler. A failed function deploy stops the job before the Worker ships; safe because migrations are additive.
- **Never log the password** — not in the function, the action, nor `DomainError` messages. The island holds it in component state only.

## Phase 1: Hosted check (developer-run gate)

### Overview

Learn the hosted facts that CI cannot, before building. The result fixes C3's trigger form and can change C12. This phase writes no repo code beyond recording the outcome in this plan's Progress.

### Changes Required:

#### 1. Hosted checklist

**File**: `context/changes/create-account-fallback/hosted-check.md` (new; the recorded result)

**Intent**: A short, dated record of what hosted answered, so Phases 2–4 build on facts rather than assumptions.

**Contract**: Records, each as observed value + date:

1. Dashboard: the current signing key is ES256 and the new API keys are enabled; the secret key's name is `default` (the SDK's admin client needs it, else `MISSING_DEFAULT_SECRET_KEY`).
2. Read-only SQL on hosted: `select count(*) filter (where encrypted_password like '{%') from auth.users;` — returns a count only, no hash content. Zero means DB encryption is off.
3. Hosted GoTrue version from `/auth/v1/health` (local CI runs v2.196.0).
4. A throwaway function returning `Deno.version` and which env names are present (`SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_JWKS`), called with no token, a viewer's token and an admin's token, then **deleted**. Records whether `verify_jwt = false` is honoured and whether `--region` pinning works on this plan.

### Success Criteria:

#### Automated Verification:

- Result file exists and is complete: `test -f context/changes/create-account-fallback/hosted-check.md`

#### Manual Verification:

- All four items recorded with observed values; the throwaway function is deleted from hosted.
- The trigger form for Phase 3 is stated in the file (`encrypted_password` form if the count is 0, else `reauthentication_token` form).
- If the secret key is not named `default`, or ES256 is not the current key: **stop and re-plan** (the roadmap's standing unknown) before Phase 2.

**Implementation Note**: After completing this phase, pause for the human to confirm the hosted facts before proceeding.

---

## Phase 2: Toolchain and CI boundary

### Overview

Make the repo able to hold, type-check, lint, test, serve and deploy a Deno function. Ships a skeleton function only; no business logic. This phase carries Health-check Fix 6.

### Changes Required:

#### 1. Function skeleton and config

**File**: `supabase/functions/admin-users/index.ts`, `supabase/functions/admin-users/deno.json`, `supabase/config.toml`

**Intent**: A deployable function that answers a fixed placeholder, with every dependency pinned exactly, and its JWT setting explicit.

**Contract**: `export default { fetch }` (the shape the spike ran). `deno.json` imports `@supabase/server` and `@supabase/supabase-js` at exact versions (no ranges). `config.toml` gains `[functions.admin-users]` with `verify_jwt = false` (the function's own `withSupabase` + live admin check is the gate) and its entrypoint/import-map keys per the installed CLI. Read flags from the installed CLI (`pnpm exec supabase functions --help`): CLI 3.0.0 shipped 2026-11-02 and `^2.117` holds it off.

#### 2. Toolchain boundary

**File**: `tsconfig.json`, `eslint.config.js`, `lefthook.yml`, `.prettierignore` (if needed), `mise.toml`, `scripts/` (new `deno-check` script), `.github/workflows/ci.yml` (`verify` job)

**Intent**: Node tooling must never see Deno files, and Deno files must still be checked by something.

**Contract**:

- `supabase/functions` excluded from `tsconfig.json`'s `include`/`exclude` and from ESLint's `ignores` (`eslint.config.js:159`); `lefthook.yml` `lint-ts` glob excludes it.
- `mise.toml` pins Deno at a version compatible with the runtime's Deno 2.1.4 semantics; a script runs `deno check`, `deno lint` and `deno test` over `supabase/functions`; a `verify` job step runs it. Following the repo rule, the task body lives in a script and `mise.toml` carries a one-line `run`.
- The `/verify` skill (`~/.claude/skills/verify`) gains the same step.
- Do **not** paste the stack assessment's CLAUDE.md text verbatim: its last bullet is stale on Mailpit.

#### 3. CI stack: re-include the edge runtime

**File**: `.github/actions/supabase-stack/action.yml`

**Intent**: The integration and e2e lanes must serve the function; excluding `edge-runtime` makes suites pass locally and fail in CI.

**Contract**: Remove `edge-runtime` from the `-x` list at `:48`. Add a warm-up request after start so a suite's first call does not pay for the dependency download. Update the explanatory comment. Measure empty-cache first-request time and runner image-pull time in the first CI run and record them in this plan's Progress notes.

#### 4. Deploy step and Dependabot

**File**: `.github/workflows/ci.yml` (deploy job, around the `db push` → Wrangler steps), `.github/dependabot.yml`

**Intent**: A merge deploys the function, after the schema and before the Worker; its pinned imports are kept current.

**Contract**: `pnpm exec supabase functions deploy admin-users --project-ref <ref>` (named, no `--prune`) between `db push` and the Wrangler action. Dependabot gets a `deno` entry for `supabase/functions/admin-users`, monthly, minor/patch grouped, majors separate — matching the existing file's rationale. Update the file's header comment that currently says "`github-actions` only".

### Success Criteria:

#### Automated Verification:

- Deno check/lint/test over the skeleton passes: the new `mise run` task (e.g. `mise run functions:check`)
- Node gates unaffected: `pnpm check`, `pnpm lint`, `pnpm steiger`
- Build stays clean: `pnpm build`
- Local stack serves the function: `pnpm exec supabase start`, then a request to `/functions/v1/admin-users` answers the placeholder (status asserted, not body)
- CI `verify`, `integration` and `e2e` lanes green with `edge-runtime` included

#### Manual Verification:

- The measured warm-up and image-pull cost is recorded and acceptable (the integration lane was already ~1-in-5 flaky; it must not get worse).
- The deploy step is reviewed against the installed CLI's flags; no `--prune`.
- `git status` after a Deno run shows no stray lockfile.

**Implementation Note**: Pause after this phase for manual confirmation before Phase 3.

---

## Phase 3: Access model (matrix red first, then the migration)

### Overview

Add the flag, the fail-closed role read, the clearing trigger and the pending-aware last-admin guard — behind a role-matrix diff shown red first, as CLAUDE.md requires for any access change.

### Changes Required:

#### 1. Role matrix: one new principal, red first

**File**: `src/test/role-matrix-expectations.ts`, `src/test/role-matrix.integration.test.ts`, `src/test/factories/create-signed-in-user.ts`, `src/test/access-probe.ts` (if it enumerates principals)

**Intent**: State the claim before the migration: a user who holds an `admin` row and the flag can reach nothing a role-less user cannot.

**Contract**: Add `pendingAdmin` to `Principal` (`:58`) and `PRINCIPAL_NOTES`. Its cells on all 14 catalog tables, plus the user-keyed and `access_changes`/`user_roles`/`user_directory` cells, mirror `noRole` (own profile and directory row readable; own role row `no-row`/denied as `noRole`'s; everything else denied). `createSignedInUser` gains an option that sets the flag. The compile-enforced matrix breaks everywhere until filled; run the integration lane to show the new cells **red** before Phase 3 item 2.

#### 2. Migration (additive only)

**File**: `supabase/migrations/<timestamp>_must_change_password.sql`

**Intent**: Introduce the flag and everything that makes it enforce, in one additive migration that is safe against live data on its own.

**Contract**:

- `alter type public.access_change_kind add value if not exists 'account_created'` and `'password_reissued'` (fine in a migration that does not use the values). The Users page's `LastChange` reads "Changed by <who>" and works unchanged; kind-specific wording is out of scope.
- `alter table public.user_directory add column must_change_password boolean not null default false`. `authenticated` keeps SELECT only (the owner reads their own row; an admin reads every row). Update the table comment: the function becomes a recorded second writer, under the secret key.
- `create or replace function private.current_app_role()` — **copied from the latest live definition**, not the original (lessons.md; S-408 changes it too). Still `security definer`, `search_path = ''`, returning null when the caller's `user_directory` row has the flag set.
- `private.clear_must_change_password()` trigger function — non-raising, `EXECUTE` revoked — and the trigger on `auth.users`, in the form recorded in `hosted-check.md`. `lock_timeout` set around the trigger creation, as `20261105073614_user_directory.sql:29-37` does.
- `private.guard_last_admin()` re-created from its latest live definition (`20261105080343_role_management.sql:139`), counting only admins whose directory row is not pending. The advisory lock and error code (`PT409`) stay.
- Post-conditions in the migration, following its neighbours: the `current_app_role` owner still has `bypassrls`, the trigger exists, the column default is false.

#### 3. Regenerate types

**File**: `src/shared/api/database.types.ts` (generated)

**Intent**: Reflect the new column and enum value verbatim.

**Contract**: `pnpm db:types` with the local stack up; check the diff; never hand-edit.

#### 4. Access-model integration tests

**File**: `src/test/must-change-password.integration.test.ts` (new); `src/test/last-admin-guard.integration.test.ts` (extend)

**Intent**: Prove the behaviours the matrix cannot express.

**Contract**: Against a real stack, signed in with the publishable key: a pending user signs in and the flag is unchanged by sign-in; cannot clear their own flag (`42501`) or change their own role; a real password change clears it and **the same session** then holds the role; same-password and short-password changes are refused and leave the flag; the reset-link path (`/verify` then choose a password) clears it; an email change leaves the flag alone (the mirror's upsert must not touch it). Guard: with a pending admin and one active admin, demoting the active admin is refused; with two active admins it is allowed; the account-deletion cascade still passes.

### Success Criteria:

#### Automated Verification:

- Matrix red before the migration, green after: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- New suite passes: `pnpm test:integration src/test/must-change-password.integration.test.ts src/test/last-admin-guard.integration.test.ts`
- Whole integration lane passes: `pnpm test:integration --maxWorkers=2` (re-run once before blaming the diff — known flake)
- Migration applies cleanly from scratch: `pnpm exec supabase db reset`
- Types regenerated, diff checked: `pnpm db:types`
- Unit tests, types and lint pass: `pnpm test`, `pnpm check`, `pnpm lint`
- Grant posture confirmed with `has_table_privilege(...)` for `authenticated` on `user_directory.must_change_password` (SELECT yes, UPDATE no), not by reading the migration

#### Manual Verification:

- The migration read once against live-data safety: additive, nothing dropped, `default false` makes existing users unaffected.
- The `current_app_role()` body diff against the previous live definition shows only the added condition.

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: The Edge Function

### Overview

Implement `admin-users` with two ops, `create` and `reissue`, on top of Phase 3. All security-relevant ordering lives here.

### Changes Required:

#### 1. Request handling and the admin check

**File**: `supabase/functions/admin-users/index.ts` (+ small modules beside it)

**Intent**: Nothing touches the admin client until the caller is proven a live admin.

**Contract**: `withSupabase({ auth: "user" })`; then `ctx.supabase.rpc("own_app_role")` must return `admin`, else 403 — before `ctx.supabaseAdmin` is referenced. Body validated against a fixed `op` set (`create` `{ email, role }`, `reissue` `{ userId }`); `app_metadata` is never accepted from input. `role` is `viewer | author | admin | null`. Responses: 401 unusable/forged credential, 403 not admin, 409 `email_exists`, 422 invalid input, 500 on rolled-back failure with no password in the body.

#### 2. `create`

**Intent**: Create, flag, record, grant, then reveal.

**Contract**: In order: `createUser` (email confirmed, generated password, no metadata) → set `must_change_password` → insert `account_created` with `actor_kind 'user'` and `actor_id` from the verified token (secret-key client) → upsert the role through `ctx.supabase` (S-406's trigger records the admin as actor; skipped when `role` is null) → return `{ userId, password }`. Any failure after `createUser` deletes the account and returns no password. Creating with a machine user's email returns `email_exists` and changes nothing.

#### 3. `reissue`

**Intent**: Recover a lost or timed-out temporary password, for pending accounts only.

**Contract**: Refused (409/403) unless the target's directory row has `must_change_password = true`; refused for machine users (never pending) and for any account that has chosen a password. Update password → set the flag **again** (the clearing trigger fires on that write) → insert a `password_reissued` record through the secret-key client, with `actor_id` from the verified token (same rule as `account_created`) → return the new password last. A re-issued credential is audited like a created one.

#### 4. Password generator

**Intent**: 24 characters from an unambiguous alphabet, uniformly distributed.

**Contract**: Rejection sampling over `crypto.getRandomValues` — not the spike's modulo version, which is biased. Pure module, no I/O, so `deno test` covers it directly.

#### 5. Tests

**File**: `supabase/functions/admin-users/*.test.ts` (Deno); `src/test/admin-users.integration.test.ts` (Vitest, HTTP surface)

**Intent**: Test the wrapper, not just the core (repo rule).

**Contract**: Deno unit: generator length, alphabet, no ambiguous characters, distribution sanity over many draws; input validation. Integration through `functions.invoke`-equivalent HTTP against the CI stack: publishable key alone or as Bearer → 401; forged token → 401; role-less, viewer, author → 403; the solver's machine token → 403 (via `42501`); admin create → 200 and the response is the only place the password appears; duplicate email → 409; forced flag-write failure → 500, no password, account gone; the access record reads `account_created|user|<admin>` and `role_granted|user|<admin>`, neither Operator; reissue works on pending, refused on confirmed/machine/active-admin; the flag ends on after reissue. Assert status codes, not body shape.

### Success Criteria:

#### Automated Verification:

- Deno gate: `mise run functions:check` (check + lint + test)
- Function integration suite: `pnpm test:integration src/test/admin-users.integration.test.ts`
- Role matrix still green: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- Node gates: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`
- CI green on a PR (edge runtime in the integration lane)

#### Manual Verification:

- Search the function and its logs for any place the password could be printed: none.
- `ctx.supabaseAdmin` is referenced only after the admin check and only for the writes that need the secret key.

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: The app

### Overview

A thin action, the pending access state and gate, the Account banner, and the Users page create/re-issue UI.

### Changes Required:

#### 1. Pending access state and page gate

**File**: `src/shared/config/access-state.ts`, `resolve-access.ts`, `role-gate.ts`, `src/shared/api/load-own-role.ts` (or a sibling read), `src/middleware.ts` (+ their `*.test.ts`)

**Intent**: Distinguish "role-less" from "must change password" and send the latter to `/account` from every gated page.

**Contract**: `AccessState` gains `{ status: "password_change_required" }`. Because `own_app_role()` returns null while pending, the middleware reads the caller's own `must_change_password` flag **only in that null branch**, so a person holding a role pays nothing extra. A failed flag read is `unavailable`, never `none`. `decideRoleGate` sends this state to `/account` (already exempt; no public route, no `ROLE_EXEMPT_PATHS` change) for every other path. `allows()` already returns false for it, so actions refuse with no new code. `resolveAccess`'s input widens; keep it pure and table-tested for every state combination, including a rejected flag read.

#### 2. Account page banner

**File**: `src/_pages/account/ui/AccountPage.astro` (+ prop plumbing from the route)

**Intent**: Tell the pending person why they are here, however they arrived.

**Contract**: An info `Banner` (alongside the `notice === "recovery"` one at `:27`) driven by `Astro.locals.access.status === "password_change_required"`, not a query string. After a successful change the existing `navigate("/account?saved=password")` reload lands them with the role already in effect.

#### 3. Users page: status, create, re-issue

**File**: `src/_pages/users/api/loader.ts`, `model/user-rows.ts`, `model/schemas.ts`, `ui/UserTable.tsx`, `ui/UsersPage.tsx`, new `ui/CreateAccountDialog.tsx`, new reveal component, `api/actions.ts`, new `api/create-account.ts`, `api/reissue-temporary-password.ts`, `api/constants.ts`

**Intent**: A secondary "Create account" control (S-410's invite will become primary; PRD: fallback only), a "Temporary password" status, a one-time reveal, and a re-issue row action for pending rows only.

**Contract**:

- Loader reads `must_change_password` from `user_directory`; `UserRow.status` becomes `"active" | "no_access" | "temporary_password"`; the table shows "Temporary password" (with muted styling like `no_access`). A pending row with a role still shows its role; the status column explains why it has no access yet.
- Actions: `createAccount` and `reissueTemporaryPassword`, both `defineDomainAction({ requires: "manage_users" })`, calling `supabase.functions.invoke("admin-users", …)` with the admin's session. They are couriers: no secret, no new Worker env. Zod 4 schema shared by the action input and the form resolver (`mode: "onTouched"`, per lessons.md). Map function statuses to `DomainError` codes (409 → `CONFLICT` with a clear "an account with this email already exists" message). No password in any message or log.
- Called from the island through `callAction` (JSON), **not** a form-post action whose result Astro can carry across a redirect. Check Astro 7's current docs at implementation time for the result-passing behaviour.
- The create dialog confirms the email by echoing it before submit (typo guard, since delete is S-411). The reveal shows the password once, with a copy button and plain text that it will not be shown again; it lives only in component state and is cleared on close. Re-issue asks for confirmation (it invalidates the old password).
- Edit controls render only on the route-computed `canEdit`/`canManageUsers`; a non-admin never sees them. Semantic theme tokens only (lessons.md); detokenize any new shadcn primitive.
- Keep `UserTable` free of ad-hoc conditions: derive row state in `model/` (orchestration rule).

#### 4. Tests

**File**: `src/_pages/users/**/*.test.ts(x)`, `src/shared/config/*.test.ts`, `e2e/specs/create-account.admin.spec.ts` (new), `e2e/CLAUDE.md`

**Intent**: Cover the pure decisions in Vitest and the whole journey once in a browser.

**Contract**: Vitest: `resolveAccess` and `decideRoleGate` for the new state; `buildUserRows` third status; schema validation; the action maps function statuses to codes; the reveal clears on close. e2e: an admin creates a throwaway user (service-role admin API client for cleanup in a `finally`), the throwaway signs in through the UI, is redirected to `/account` from `/plans`, changes the password, and then reaches `/plans`; also asserts the admin sees "Temporary password" before and "Active" after. `e2e/CLAUDE.md:92-97` is amended: this spec both creates through the UI and drives the sign-in UI, which only setup files may do today (`:60-62`) — state the new sanctioned exception precisely and keep the admin account's password/role/session untouched.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Types, lint and FSD structure pass: `pnpm check`, `pnpm lint`, `pnpm steiger`
- Build stays clean and no key leaks to the client: `pnpm build` (runs `assert-server-only-supabase`)
- Integration lane still green: `pnpm test:integration --maxWorkers=2`
- e2e passes: build, start the preview yourself, then `pnpm test:e2e e2e/specs/create-account.admin.spec.ts` (preview daemonizes; restart it after every build)
- Role matrix and last-admin suites green

#### Manual Verification:

- Create an account as an admin in the real UI; the reveal shows the password once and cannot be recovered after closing.
- Sign in as the new user: every page lands on `/account` with the banner; direct navigation to `/plans` redirects; after the change the same tab opens `/plans` with the chosen role (a viewer gets no edit controls).
- Re-issue works on a pending row, and the control is absent on a confirmed one.
- `functions.invoke` works inside workerd (`pnpm build && pnpm preview`) — not just under Node (research's one unmeasured app-side risk).
- The admin's own row, other admins' rows and the "You" badge behave as before.

**Implementation Note**: Pause for manual confirmation before Phase 6.

---

## Phase 6: Docs and hosted smoke

### Overview

Write down the new component's rules where the next agent will read them, correct the stale promises (D1), record the accepted residual (D3), then prove hosted.

### Changes Required:

#### 1. CLAUDE.md and README

**File**: `CLAUDE.md`, `README.md`

**Intent**: A function section and a path through the new commands.

**Contract**: `CLAUDE.md` gains a short function section: Deno boundary and where it is checked, exact-pin rule and the lockfile residual, `verify_jwt = false` with the live admin check as the gate, "two identities" (`ctx.supabase` for what RLS/triggers judge, `ctx.supabaseAdmin` only where the secret key is needed), the flag column and the second writer, and the S-408 re-create rule. Also the new `Database & auth` bullet for the pending state. `README.md`: the new CI/deploy step, "adding a function needs a stack restart" (function list is fixed at bring-up), Users page note. Correct both lines in the Auth routes section.

#### 2. Runbooks, PRD, roadmap

**File**: `docs/runbooks/hosted-auth-settings.md:24`, `docs/runbooks/author-provisioning.md:131`, `context/foundation/prd.md`, `context/foundation/roadmap.md`

**Intent**: Remove the "admin-triggered reset waits for S-409" promise; say re-issue exists for pending accounts and full reset moves to S-411. Record D3.

**Contract**: Both runbook lines corrected. `prd.md`: temporary-password non-expiry recorded as an accepted residual with the visibility mitigation. `roadmap.md`: S-409's status is advanced by `/10x-implement` and `/10x-archive`, not hand-edited here.

#### 3. Hosted smoke test (after the real merge)

**Intent**: Prove on hosted what CI cannot.

**Contract**: One run: create an account on hosted; its first sign-in leaves the flag **on**; choosing a password clears it and the person reaches their role; a wrong-role token (viewer) gets 403 from the function. Delete the test account via the dashboard. Respect the no-merge-during-a-solve rule: the merge deploys the Worker.

### Success Criteria:

#### Automated Verification:

- Formatting and links: `pnpm format --check`, `pnpm lint`
- Full local CI gate: `/verify`

#### Manual Verification:

- Both runbook lines read correctly; CLAUDE.md's function section matches the code (symbols grepped, not remembered — lessons.md).
- Hosted smoke test passes; the throwaway account is deleted; result noted in `hosted-check.md`.

---

## Testing Strategy

### Unit Tests:

- Password generator (Deno): length, alphabet, ambiguity, rejection-sampling uniformity; `op` input validation.
- `resolveAccess`, `decideRoleGate` for `password_change_required` and a failed flag read; `buildUserRows` third status; create/re-issue schemas; the action's status → `DomainError` mapping; the reveal component clears on close.

### Integration Tests:

- Role matrix with `pendingAdmin` (red → green); flag lifecycle (sign-in leaves it, real change clears it, same session gains the role, reset-link path clears it, email change leaves it); last-admin guard with pending admins.
- Function at the HTTP surface: all refusals, create, duplicate, rollback on forced failure, reissue rules, attribution of both records.

### Manual Testing Steps:

1. As admin, create an author account; copy the password; close the dialog and confirm it cannot be shown again.
2. In a private window sign in as them: banner on `/account`, `/plans` redirects, after changing the password `/plans` opens editable.
3. Create a viewer; confirm no edit controls after the change.
4. Re-issue on a pending row; the old password fails and the new one works; confirm it is absent on active rows.
5. Try to create with an existing email and with a machine user's email: clear refusal, nothing changed.

## Performance Considerations

The role lookup measured ~0.1 ms with the added `not exists`, so the <200 ms placement budget is unaffected. The flag read happens only for a signed-in user with no role. The function's cold start is unmeasured; Phase 2 measures it on a runner and the warm-up request keeps suites from paying it.

## Migration Notes

One additive migration; nothing is dropped; every existing user has `must_change_password = false`, so access is unchanged on merge. CI's `deploy` applies it to hosted before the function deploy and the Worker. Roll forward only: there is no function rollback and no migration rollback. S-408 is planned to change `current_app_role()` and the guard; whichever slice lands second re-creates from the body the first left.

## References

- Related research: `context/changes/create-account-fallback/research.md`
- Prior decision: `context/changes/user-managment-research/research.md` §6 (Edge Function, `must_change_password` flag)
- Roadmap: `context/foundation/roadmap.md` S-409 (PRD FR-403, issue #150)
- Pattern to follow: `supabase/migrations/20261105073614_user_directory.sql` (non-raising trigger, `lock_timeout`, post-conditions), `src/_pages/users/api/change-user-role.ts` (action → domain function)
- Health check Fix 6: `context/foundation/health-check.md:366-384`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Hosted check (developer-run gate)

#### Automated

- [x] 1.1 Result file exists and is complete (`hosted-check.md`) — 65f61c6e

#### Manual

- [ ] 1.2 All four hosted facts recorded with observed values; throwaway function deleted
- [x] 1.3 Trigger form for Phase 3 stated in `hosted-check.md` — 65f61c6e
- [x] 1.4 Secret key named `default` and ES256 current, else stop and re-plan — 65f61c6e

### Phase 2: Toolchain and CI boundary

#### Automated

- [x] 2.1 Deno check/lint/test over the skeleton passes (`mise run functions:check`) — b09da52c
- [x] 2.2 Node gates unaffected (`pnpm check`, `pnpm lint`, `pnpm steiger`) — b09da52c
- [x] 2.3 Build stays clean (`pnpm build`) — b09da52c
- [x] 2.4 Local stack serves the function (status asserted) — b09da52c
- [x] 2.5 CI `verify`, `integration` and `e2e` lanes green with `edge-runtime` included (PR #174, run 42615048432, 2026-11-09) — 618551b8

#### Manual

- [x] 2.6 Warm-up and image-pull cost recorded and acceptable (stack start 75 s e2e / 67 s integration; first warm-up request 0.95 s / 0.99 s, HTTP 200; Deno steps in `verify` ~2 s) — 618551b8
- [x] 2.7 Deploy step reviewed against the installed CLI's flags; no `--prune` — 618551b8
- [x] 2.8 No stray lockfile after a Deno run — 618551b8

### Phase 3: Access model (matrix red first, then the migration)

#### Automated

- [x] 3.1 Matrix red before the migration, green after (`role-matrix.integration.test.ts`) (red: 48 `pendingAdmin` cells with the flag write skipped, setup error with it; green: 459/459 after) — 7f6b2549
- [x] 3.2 New flag-lifecycle and last-admin suites pass (9 + 4; the three clearing cases go red with the trigger disabled) — 7f6b2549
- [x] 3.3 Whole integration lane passes (`pnpm test:integration --maxWorkers=2`) (740 passed; 5 skipped are the two solver suites, no `SOLVER_URL`) — 7f6b2549
- [x] 3.4 Migration applies cleanly from scratch (`supabase db reset`) — 7f6b2549
- [x] 3.5 Types regenerated and diff checked (`pnpm db:types`) — 7f6b2549
- [x] 3.6 `pnpm test`, `pnpm check`, `pnpm lint` pass — 7f6b2549
- [x] 3.7 Grant posture confirmed with `has_table_privilege(...)` (authenticated: SELECT yes, UPDATE/INSERT no; anon no; service_role UPDATE yes) — 7f6b2549

#### Manual

- [x] 3.8 Migration read once for live-data safety (additive, default false) — 7f6b2549
- [x] 3.9 `current_app_role()` diff vs the previous live definition shows only the added condition — 7f6b2549

### Phase 4: The Edge Function

#### Automated

- [x] 4.1 Deno gate passes (`mise run functions:check`) (14 Deno tests) — e2400553
- [x] 4.2 Function integration suite passes (`admin-users.integration.test.ts`) (24 cases; forced-failure case confirmed in the function log as `flag:db:P0001`) — e2400553
- [x] 4.3 Role matrix still green (459/459) — e2400553
- [x] 4.4 `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build` pass — e2400553
- [x] 4.5 CI green on a PR with the edge runtime in the integration lane (PR #174, run 42775540254: integration 48 files and 769 tests, admin-users 24/24 on the edge runtime) — e2400553

#### Manual

- [x] 4.6 No place the password can be printed in the function or its logs — e2400553
- [x] 4.7 `ctx.supabaseAdmin` used only after the admin check and only where the secret key is needed — e2400553

### Phase 5: The app

#### Automated

- [x] 5.1 Unit tests pass (`pnpm test`) (267 files, 2723 tests)
- [x] 5.2 `pnpm check`, `pnpm lint`, `pnpm steiger` pass
- [x] 5.3 `pnpm build` clean, no key in `dist/client`
- [x] 5.4 Integration lane still green (46 files and 764 tests pass, 2 solver suites skipped locally; CI runs them)
- [x] 5.5 e2e `create-account.admin.spec.ts` passes (3 cases, with workerd preview against the local stack)
- [x] 5.6 Role matrix and last-admin suites green

#### Manual

- [x] 5.7 Create in the real UI; the password is shown once and unrecoverable after close
- [x] 5.8 Pending user lands on `/account` from every page; same tab gains the role after the change
- [x] 5.9 Re-issue works on a pending row and is absent on a confirmed one
- [x] 5.10 `functions.invoke` works inside workerd (`pnpm build && pnpm preview`)
- [x] 5.11 Admin's own row, other rows and the "You" badge behave as before

### Phase 6: Docs and hosted smoke

#### Automated

- [ ] 6.1 `pnpm format --check` and `pnpm lint` pass
- [ ] 6.2 Full local CI gate passes (`/verify`)

#### Manual

- [ ] 6.3 Both runbook lines corrected; CLAUDE.md's function section matches the code
- [ ] 6.4 Hosted smoke test passes (flag survives first sign-in, clears on change); test account deleted
