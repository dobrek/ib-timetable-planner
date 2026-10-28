# S-403 Fail-Closed Roles Implementation Plan

## Overview

Every person's access follows the one role an admin assigned. On the day it goes live, every existing author sees and edits everything as before, including Generate → solve → proposal → delivery. The developer is admin through a documented operator step. A signed-in user without a role sees only a "no access yet — ask your admin" notice plus their own account. A role change takes effect on the person's next action, and drag-drop validation stays under 200 ms (roadmap S-403; PRD FR-410, FR-416, FR-417, FR-418, §Guardrails, §NFG).

It ships as **two PRs**:

- **PR 1 (Phases 1–2)** creates roles and backfills every existing human as `author`. It enforces nothing, so the backfill can be checked against real hosted rows and the developer promoted to admin first.
- **PR 2 (Phases 3–5)** flips every human-facing policy to fail-closed and makes the app follow the role.

## Current State Analysis

The research (`context/changes/fail-closed-roles/research.md`, at `30c46e8`, which is today's HEAD) prototyped the whole database design on the local stack in a rolled-back transaction. Its findings are the baseline here.

- **The policies.**
  - 17 human-facing tables allow every signed-in user everything. 16 carry an `ALL to authenticated using (true) with check (true)` policy (e.g. `supabase/migrations/20260602185012_minimal_domain_schema.sql:163-174`).
  - `profiles` has a read-all SELECT plus own-row INSERT/UPDATE (`supabase/migrations/20261017170524_profiles.sql:56-65`).
  - The solver's two `generation_jobs` policies are scoped `to solver_job_writer` and stay.
- **No role exists anywhere.** There is no `user_roles`, no `private` schema and no `SECURITY DEFINER` function. CLAUDE.md:47 says so.
- **The middleware** (`src/middleware.ts:31-53`) runs `getUser()` and a deny-by-default public-path check. `/_actions/*` passes the gate by the `/_` prefix (`:18`), so page gating never reaches actions.
- **Actions.** All 40 actions go through `defineDomainAction` (`src/shared/lib/actions/define-domain-action.ts:13-26`): `requireSession` → `requireSupabase` → `runDomain`. `DomainErrorCode` has no `FORBIDDEN` (`src/shared/lib/errors/domain-error.ts:9-16`). `toDomainError` maps only `23505` and `PGRST116` (`src/shared/api/postgrest/to-domain-error.ts:15-19`).
- **The shell.** `GLOBAL_NAV_ITEMS` (`src/shared/config/nav.ts:14-17`) drives both the sidebar (`src/app/layouts/SidebarLayout.astro:28-29`) and the dashboard tiles (`src/_pages/dashboard/ui/DashboardPage.astro:6`).
- **The F-401 harness** is ready but knows only `anon | noRole`:
  - `src/test/role-matrix-expectations.ts:29`;
  - `createSignedInUser` takes no role (`src/test/factories/create-signed-in-user.ts:31`);
  - `classifyRead` throws on partial visibility (`src/test/access-probe.ts:79-87`), which every own-row read trips.
- **The e2e author** is created after migrations, in CI and locally (`package.json:26`, `.github/workflows/ci.yml:276-278`). On `email_exists` the provisioner exits without an id (`scripts/provision-e2e-author.mjs:59-66`).
- **Silent denial is the defining hazard.** RLS refuses UPDATE/DELETE as "0 rows, no error", and about 20 app paths read that as success (research §3.3). Only the read-back-judged matrix and catalog assertions can prove that authors are untouched.

## Desired End State

**After PR 1 is deployed:**

- `public.user_roles` holds exactly one row per non-machine human, all `author`, except the developer, who is `admin`.
- Nothing behaves differently for anyone.
- The matrix pins all five principals (anon, noRole, viewer, author, admin) at today's posture.

**After PR 2 is deployed:**

| Principal | Plan/catalog/job data | Writes (incl. RPCs) | Own account | Other users' profiles |
|---|---|---|---|---|
| admin, author | read | as today | ✓ | read |
| viewer | read | refused (42501 on INSERT/UPDATE; 0 rows on DELETE; `FORBIDDEN` from every edit action) | ✓ | read |
| no role | nothing; every gated page redirects to `/dashboard`, which shows the notice | refused; `FORBIDDEN` from every read/edit action | ✓ (`/account`, both account actions, sign-out) | none |
| solver (hook on) | unchanged | unchanged | — | — |
| solver (hook off) | **nothing** (today: full read) | refused | — | — |

**Verify by:**

- the flipped role matrix, green, plus its structural catalog assertion;
- the `no-role` e2e spec;
- every existing lane staying green (the e2e author is `author`);
- the hosted post-deploy smoke.

### Key Discoveries:

- **One DEFINER, required no later than S-406.** An INVOKER helper overflows the stack once an admin-reads-all policy exists, and only after the table is analyzed (research §2.3, probes C/D). One DEFINER `private.current_app_role()` plus INVOKER wrappers needs `grant usage on schema private to authenticated` (probe G).
- **`profiles` SELECT needs the own-row clause.** Without it, a role-less user's display-name upsert fails RLS through `ON CONFLICT DO UPDATE` (research §2.4, probe E vs F).
- **The `(select …)` wrapper is mandatory.** Without it, `clone_plan` runs the helper 10540 times instead of 18 (research §2.6).
- **Read the role through an RPC.** The middleware must not take the role from an unfiltered `user_roles` select: S-406's admin-reads-all policy would make `.maybeSingle()` fail for admins. Nor from `getSession().user.id`: supabase-js wraps it in an insecure-access warning proxy on the server (`node_modules/.pnpm/@supabase+auth-js@2.116.0/.../GoTrueClient.js:2554-2563`). A `public.own_app_role()` INVOKER RPC that returns `private.current_app_role()` gives the app the exact value the policies see.
- **Astro 7.3.8 action codes** (the lockfile's version). `ActionError` has both `FORBIDDEN` (403) and `SERVICE_UNAVAILABLE` (503) (`astro/dist/actions/runtime/client.js:11,39`).
- **Astro 7.3.8 middleware rewrites.** `context.rewrite(path)` re-runs the whole middleware chain (`core/rewrites/handler.js:67-72`), and a loop guard answers 508 on the 4th entry (`core/middleware/astro-middleware.js:25-32`). `next(path)` renders the target without re-entering middleware (`astro-middleware.js:33-39`).
- **Function grants.** Per-schema `alter default privileges` cannot revoke the global PUBLIC EXECUTE on functions, so every new function needs its own `revoke execute … from public, anon`. The catalog assertion is what catches a missed one.
- **`private` is not exposed.** Locally, `supabase/config.toml:13` exposes `public` and `graphql_public` only. Hosted's exposed schemas live in dashboard settings, so 2.11 checks them there.

## What We're NOT Doing

- **Viewer UI gating and viewer-triggered delivery:** S-405 / PRD Open Question 1. In S-403 a viewer sees edit controls, and every write *action* is refused with `FORBIDDEN` and rolled back. The roadmap accepts this while no real viewers exist; before S-406 a viewer exists only through `assign-role.mjs`.
  - **The page-load path is not an action.** `/plans/[id]` runs `checkPlan` and `releaseOrphanProposal` as direct domain calls in its frontmatter (`src/pages/plans/[id]/index.astro:50,66`), and the pending page polls the `checkPlan` action (declared `read`) every 5 s. Under a viewer, RLS refuses every write, so nothing is left half-written. But this plan's UPDATE policy makes a viewer's UPDATE fail with 42501, not the silent no-op research §3.4 assumed, so S-405 inherits this:
    - reclaim's 42501 reads as a lost CAS (`generation-reclaim.ts:70-75`), so a dead job stays active and the pending page polls it for as long as it is open;
    - each visit and each poll tick reloads the ~160 KB payload and re-runs the verifier;
    - four branches report "failed" or "clone removed" while the database is unchanged, because `failJob` swallows its 42501 and the clone DELETE removes 0 rows (`generation-delivery.ts:259,291,309,320`);
    - the errors arrive as `INTERNAL_SERVER_ERROR`, not `FORBIDDEN`: `placements.ts:129` and `generation-delivery.ts:547` throw raw `DomainError`s that bypass `toDomainError`.
- **Admin surfaces.** Admin-only surfaces, `user_roles` write policies, an `is_admin()` helper and the access-change record ("who made it and when"): S-406. `user_roles` gets no audit columns now.
- **Restricting who may stop a job:** S-407.
- **The `active` / deactivation flag:** S-408. It later changes `private.current_app_role()` alone.
- **HC Fix 7 (`supabase db lint` CI gate).** Moved out of S-403 to its own small follow-up change, recorded in the roadmap in Phase 5.
- **Revoking `anon`'s TRUNCATE/REFERENCES/TRIGGER/MAINTAIN residue on the 15 older tables.** PostgREST cannot reach it. The matrix keeps pinning it as fact. `user_roles` itself revokes all eight.
- **No re-backfill in migration 2.** Humans created between PR 1 and PR 2 get a role only through `scripts/assign-role.mjs`, so an operator's deliberate `none` is never silently undone.
- **No dedicated `/no-access` route.** The notice lives on `/dashboard`.
- **No JWT role claim.** The live lookup was decided upstream.
- **No hosted auth-config change.** No emails in migrations, and never `config push`.
- **No role checks inside RPC bodies or `src/entities/timetable/`.** Gating stays in RLS: service-role factories have no `auth.uid()`.
- **No viewer or admin e2e accounts:** S-405 and S-406 add them.

## Implementation Approach

**One mechanism, two layers.**

- **Enforcement is RLS**, through capability-named helpers (`can_read`, `can_edit`) over the single DEFINER role read.
- **The app layer adds clarity, not security:**
  - a page gate for FR-410's notice;
  - an action guard that turns silent 0-row denials into `FORBIDDEN`, so optimistic board writes roll back;
  - nav filtering.

**The role → capability map exists twice:** in the SQL wrappers and in `src/shared/lib/access/`. The matrix pins the SQL side and unit tests pin the TS side. The enum's generated type keeps role *names* single-sourced.

**Sequencing follows the F-401 recipe:**

1. Extend the harness at today's posture (green).
2. Flip the expectations (red).
3. Apply the policy migration (green).

The red run is recorded as the evidence that the suite can fail. PR 1 lands first, so hosted's backfill is observed rather than predicted.

**Branches.** PR 1 is cut from `main` after Phase 2 and squash-merged. PR 2 starts from the updated `main`. The change folder stays open across both.

## Critical Implementation Details

- **State sequencing across the PRs.**
  - PR 2 must not merge until PR 1 has deployed, the developer holds `admin` on hosted, and every hosted human has an explicit role or a deliberate `none`. Migration 2 grants nothing.
  - Both merges obey "no merge mid-solve" (README).
- **Each migration file applies atomically.** A `raise exception` post-condition aborts it with nothing recorded, and CI's `deploy` stops before `wrangler deploy`. Migration 1 alone changes nothing for anyone. Migration 2 is correct for *today's* Worker too: backfilled authors behave identically (research §2.2, 29 probes). So the ~45 s window between `db push` and the new Worker is harmless, however long it stretches.
- **`DROP POLICY` vs. the additive-only rule.** The rule protects data. Splitting an `ALL` policy into four per-command ones cannot be done with `ALTER POLICY`, which can't change the command, so migration 2 drops and re-creates policies. Record that reasoning in the migration header.
- **How the CLI applies a file** (verified on the lockfile's CLI, v2.117.0). Each file goes out as one batch with a single Sync, so it runs as one implicit transaction, and the `schema_migrations` history INSERT comes last, so a `raise` records nothing. Three consequences:
  - `set local` takes effect, but Postgres prints `WARNING: SET LOCAL can only be used in transaction blocks`. That warning is expected, not a failure.
  - Never write explicit `BEGIN`/`COMMIT`: the CLI then switches to sequential execution.
  - Never use `CONCURRENTLY` or `VACUUM`: they split the batch, and atomicity is lost.
  - A CLI bump in `pnpm-lock.yaml` can change this, so re-check it if the CLI moves before PR 2.
- **Locks.** Use `set local lock_timeout = '5s'` at the top of migration 2. 17 tables take `AccessExclusiveLock` until commit, and a lock queued behind a long `clone_plan` would otherwise stall every request. A timeout fails the deploy, and it can be re-run.
- **Matrix writes never chain `.select()`.** RETURNING is checked against the SELECT policy, so a read denial would masquerade as a write denial (`src/test/access-probe.ts` docblock).

## Phase 1: Roles Schema, Types, and the Matrix Learns `user_roles`

### Overview

Migration 1 creates roles and backfills every existing human as `author`. It changes no behaviour, because every policy is still `using (true)`. The generated types and the F-401 matrix learn the new table, schema and RPC, so `pnpm check` stays green.

### Changes Required:

#### 1. Migration 1: roles exist

**File**: `supabase/migrations/<ts>_user_roles.sql` (via `pnpm exec supabase migration new user_roles`)

**Intent**: Create the role store and the one sanctioned DEFINER read, plus capability wrappers and an app-facing RPC. Backfill every non-machine human as `author`. Assert the post-conditions so a wrong hosted assumption (e.g. the helper's owner lacking `bypassrls`) aborts the deploy before anything is enforced.

**Contract**:

- **Role type and table.**
  - `create type public.app_role as enum ('admin', 'author', 'viewer')`.
  - `public.user_roles (user_id uuid primary key references auth.users (id) on delete cascade, role public.app_role not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`.
  - A `moddatetime` trigger, as on `profiles`.
  - The cascade is load-bearing: `src/test/factories/teardown.ts:29` relies on it.
- **RLS on `user_roles`.** RLS is on, with one policy: `for select to authenticated using (user_id = (select auth.uid()))`.
- **Grants on `user_roles`.**
  - `revoke all … from anon`;
  - `revoke insert, update, delete, truncate, references, trigger, maintain … from authenticated`.
  - Afterwards anon holds nothing and authenticated holds only SELECT (lessons.md, "granting a role is not excluding the others").
- **The `private` schema.** `create schema private;` then `grant usage on schema private to authenticated;`.
- **`private.current_app_role() returns public.app_role`.** `language sql stable security definer set search_path = ''`. Body: `select role from public.user_roles where user_id = (select auth.uid())`. It is the repo's **one recorded SECURITY DEFINER exception**. The header comment gives the reason (S-406's recursion, research §2.3), the scope (it reads only the caller's own row) and the owner requirement.
- **`private.can_read()` and `private.can_edit()`.** INVOKER, `stable`, `search_path = ''`.
  - `can_read`: `current_app_role() is not null`.
  - `can_edit`: `current_app_role() in ('admin', 'author')`.
  - No `is_admin()` yet (S-406).
- **`public.own_app_role() returns public.app_role`.** INVOKER, `stable`, `search_path = ''`. Body: `select private.current_app_role()`. The middleware reads the role through this RPC.
- **Function grants.** For all four functions: `revoke execute … from public, anon` and `grant execute … to authenticated`.
- **Backfill.** `insert into public.user_roles (user_id, role) select id, 'author' from auth.users where raw_app_meta_data->>'machine_role' is null`.
- **Post-conditions** (a `do` block that `raise exception`s on any failure):
  1. Every `auth.users` row without `machine_role` has a role row.
  2. No machine user has a role row.
  3. `private.current_app_role` has `prosecdef`, `proconfig` containing `search_path=""`, and an owner with `rolbypassrls`.
  4. `has_function_privilege('anon', …)` is false for all four functions.
  5. `has_table_privilege('anon', 'public.user_roles', p)` is false for every privilege.
  6. authenticated holds only SELECT on `user_roles`.
- **Wording.** Follow `profiles.sql`'s header style: what, grants/RLS, and what later slices own.

#### 2. Regenerated types

**File**: `src/shared/api/database.types.ts`

**Intent**: Generator output with the local stack up. Never hand-edited.

**Contract**: Run `pnpm db:types`. The diff is limited to `Enums.app_role`, `Tables.user_roles` and `Functions.own_app_role`. `private` never appears.

#### 3. The app's role type

**File**: `src/shared/lib/access/app-role.ts`, `src/shared/lib/access/index.ts` (barrel)

**Intent**: A client-safe projection of the generated enum, so the TS role type never drifts from Postgres. It follows the barrel-plus-concept-file convention.

**Contract**: `export type AppRole = Database["public"]["Enums"]["app_role"]`. The barrel re-exports it. Phase 4 adds capabilities beside it.

#### 4. Factory role option

**File**: `src/test/factories/create-signed-in-user.ts`

**Intent**: Let any suite sign in a user who holds a given role. The role row is inserted by the service role *after* `registerUser`, so a failed insert never leaks the user.

**Contract**: `createSignedInUser(admin, options?: { role?: AppRole })`. Omitting `role` keeps today's role-less user. Replace the `:31` "extension point" note with the option's doc.

#### 5. The matrix learns `user_roles`, `private` and `own_app_role`

**File**: `src/test/role-matrix-expectations.ts`, `src/test/role-matrix.integration.test.ts`, `src/test/access-probe.ts`

**Intent**: `PublicTable` gains `user_roles` from the regenerated types, which makes the expectation records incomplete until it is declared. Declare it at today's posture with the existing two principals. Prove the new catalog facts that only `pg` can see.

**Contract**:

- **Probe and fixture.**
  - `fixtureKey` gives `user_roles` the `user_id` column.
  - `buildFixture` inserts a role row for the never-signed-in fixture owner (`profileOwnerId`).
- **Cells and grants.**
  - `READS.user_roles = { anon: "denied", noRole: "denied" }`.
  - `GRANTS.user_roles = { anon: NONE, authenticated: ["SELECT"] }`.
- **A `private`-schema catalog test, over `pg`.**
  - `private.current_app_role` is DEFINER, has `search_path=""`, and its owner has `rolbypassrls`.
  - Every function in `private`, and `public.own_app_role`, is non-executable by `anon` and `public`.
  - `private.can_read` / `can_edit` are not DEFINER.
- **`private` is not exposed.** A PostgREST probe against the `private` schema answers the schema-not-allowed error. Pin the exact code observed locally.
- **`own_app_role` RPC cell.** anon is `denied` (no EXECUTE); noRole is `allowed` and returns `null`.

### Success Criteria:

#### Automated Verification:

- [ ] Migrations apply from scratch with migration 1's post-conditions passing: `pnpm exec supabase db reset`
- [ ] Types regenerate with a diff limited to `app_role`, `user_roles`, `own_app_role`: `pnpm db:types && git diff --stat src/shared/api/database.types.ts`
- [ ] Type check passes with 0 errors: `pnpm check`
- [ ] Unit suite passes (incl. `role-matrix-expectations.test.ts`): `pnpm test`
- [ ] Role matrix green, incl. the new catalog, `private` and `own_app_role` cells: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- [ ] Full integration lane green (a red run judged against the known ~1-in-5 transient 502 baseline): `pnpm test:integration`
- [ ] Lint and FSD structure clean: `pnpm lint && pnpm steiger`

#### Manual Verification:

- [ ] Read migration 1 against research § Recommended option: one DEFINER function, the exception recorded in its header, no email or other PII in the SQL
- [ ] In local psql, `\df+ private.*` lists exactly three functions, only `current_app_role` marked `security definer`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Every Role as a Principal at Today's Posture, Assignment Tooling, PR 1 Docs

### Overview

The matrix signs in `viewer`, `author` and `admin` alongside `anon` and `noRole`. All of them are pinned to **today's** posture: every signed-in user is allowed everywhere except other users' profile rows. Every path that creates an account learns to give it a role. The docs that PR 1 makes false are fixed. PR 1 is then opened, merged and verified on hosted.

### Changes Required:

#### 1. Five principals, own/others reads, self-grant denials

**File**: `src/test/role-matrix-expectations.ts`, `src/test/role-matrix-expectations.test.ts`, `src/test/role-matrix.integration.test.ts`, `src/test/access-probe.ts`

**Intent**: Make S-403's flip a reviewable diff of data. Every principal and cell already exists, pinned to today's facts, so Phase 3 changes only values.

**Contract**:

- **Principals.** `Principal = "anon" | "noRole" | "viewer" | "author" | "admin"`. The three role principals sign in concurrently (`Promise.all`) in `beforeAll` via `createSignedInUser(admin, { role })`, once per file.
- **Own/others reads for user-keyed tables.** `profiles` and `user_roles` move out of `READS` into a user-keyed read record: `Record<UserKeyedTable, Record<RowOwner, Cell>>`, where `RowOwner` is today's `ProfileOwner` renamed.
  - The probe reads the targeted owner's row explicitly by `user_id`, so own-row policies no longer trip `classifyRead`'s partial-visibility throw.
  - noRole has no `user_roles` row, so its own-row `user_roles` cell is an explicit `"no-row"` outcome, not a fake `denied` and not an omitted key. The user-keyed record's cell type is `Record<Principal, AccessOutcome | "no-row">`, so completeness still forces every principal × cell. The probe skips `"no-row"` cells, and `role-matrix-expectations.test.ts` allows `"no-row"` only for noRole's own `user_roles` row.
  - This also removes today's hidden order dependency in noRole's `profiles` read (research §4.1.3).
- **Self-grant denial cells (`user_roles` writes).**
  - noRole INSERTs its own row as `admin`.
  - viewer, author and admin each UPDATE their own row to `admin`.
  - Any role principal DELETEs its own row.
  - All of these are denied at the grant layer.
  - These all-denied rows join the evidence invariant's exceptions. Each is evidenced by the same payload landing as the service role (`role-matrix-expectations.test.ts` rule).
- **`own_app_role` value test.** Each role principal reads back its own role; noRole reads `null`.
- **Notes.** `PRINCIPAL_NOTES` states today's posture for each principal ("TODAY: …").

#### 2. Shared user lookup for operator scripts

**File**: `scripts/lib/find-user-id-by-email.mjs` (new), `scripts/provision-solver-user.mjs`

**Intent**: Three scripts need to resolve an email to an id. Extract the existing pager (`provision-solver-user.mjs:53-62`) instead of copying it.

**Contract**: `findUserIdByEmail(supabase, email) → Promise<string | undefined>`. Errors are thrown, not `process.exit`ed; each caller keeps its own `fail()`.

#### 3. E2E author gets `author`

**File**: `scripts/provision-e2e-author.mjs`

**Intent**: The e2e author is created after migrations, so the backfill never sees it. Give it `author` idempotently on both the create and the `email_exists` paths. Add a loopback guard, because the script now grants data access with a public literal password.

**Contract**:

- Refuse any non-loopback `SUPABASE_URL` before sending a request (same host set as `create-signed-in-user.ts:54`).
- Resolve the id: `data.user.id`, or `findUserIdByEmail` on `email_exists`.
- Upsert `{ user_id, role: "author" }` on conflict `user_id`.

#### 4. Operator role tool

**File**: `scripts/assign-role.mjs` (new)

**Intent**: The documented operator step that makes the developer admin. It also covers every hosted user created before S-406 ships a Users page. It follows the `provision-solver-user.mjs` precedent: Node, the service-role (secret) key from a human shell, never a committed file.

**Contract**:

- `node scripts/assign-role.mjs <email> <admin|author|viewer|none>`.
- `none` deletes the row; the others upsert it.
- Refuses an unknown role, an unknown email, and any account with `app_metadata.machine_role`.
- Prints the target host and the before → after role.
- On a non-loopback host it requires `ASSIGN_ROLE_CONFIRM=yes`, mirroring `SOLVER_HOSTED_CONFIRM`.
- Reuses `loadTestEnvFallback` behaviour for the local stack.

#### 5. PR 1 docs

**File**: `CLAUDE.md`, `README.md`, `docs/runbooks/author-provisioning.md`, `e2e/CLAUDE.md`

**Intent**: Fix what PR 1 makes false, and teach every account-creating path its role step.

**Contract**:

- **`CLAUDE.md:47`.** Replace "no migration defines a DEFINER function today" with the recorded exception:
  - `private.current_app_role()` is the only DEFINER function, and why;
  - it reads only the caller's own row, with `search_path = ''`;
  - its owner's `bypassrls` is asserted by the migration and the matrix;
  - a second DEFINER function needs a recorded reason;
  - wrappers stay INVOKER.
- **`CLAUDE.md:57`.** `createSignedInUser` takes `{ role }`.
- **README.**
  - Getting Started gains a step: give your local account a role with `node scripts/assign-role.mjs <email> author`, repeated after every `db reset` (a reset leaves no users and no roles).
  - Auth routes (`:500`): a manually provisioned account also needs a role.
- **`author-provisioning.md`.** At `:30-31`, `:45`, `:57-64`, `:91-102` and `:135-139`: creating an account now includes `assign-role.mjs`. From S-403's enforcement on, an account without a role sees only the notice.
- **`e2e/CLAUDE.md:30-31`.** The provisioned author holds `author`.

### Success Criteria:

#### Automated Verification:

- [ ] Type check passes (completeness forces every principal × cell): `pnpm check`
- [ ] Unit suite passes, incl. the self-grant evidence invariant: `pnpm test`
- [ ] Role matrix green with five principals at today's posture: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- [ ] Full integration lane green: `pnpm test:integration`
- [ ] E2E green, and a second `pnpm test:e2e` run is green too (provisioner idempotent on `email_exists`): `pnpm test:e2e`
- [ ] Operator tool round trip on local: `assign-role.mjs <local email> admin` → `none` → `author` leaves one `author` row. It refuses the solver machine user, an unknown role and an unknown email (exit 1).
- [ ] Provisioner refuses a non-loopback URL: `SUPABASE_URL=https://example.supabase.co node scripts/provision-e2e-author.mjs` exits 1 before any request
- [ ] Full local CI gate green: `/verify`

#### Manual Verification:

- [ ] Before merging PR 1, read-only in the hosted SQL editor: the expected backfill set (`select email, raw_app_meta_data->>'machine_role' from auth.users`), and no solve running
- [ ] PR 1 opened, CI green, squash-merged; `deploy` green
- [ ] After deploy, read-only on hosted: every human holds `author`, the solver machine user holds no row, and hosted's exposed schemas (Dashboard → Data API settings) do not include `private`
- [ ] Developer promoted: `ASSIGN_ROLE_CONFIRM=yes node scripts/assign-role.mjs <developer email> admin` with the hosted URL and secret key in a human shell; re-query shows `admin`
- [ ] Stale or test accounts reviewed, and any that should lose access set to `none`
- [ ] Hosted app unchanged for an author: sign in, edit a plan, open a board

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. **PR boundary**: Phases 1–2 are PR 1. Phase 3 starts on a fresh branch from the updated `main`.

---

## Phase 3: The Flip

### Overview

Flip the matrix expectations to the fail-closed posture and watch it go red. Then apply migration 2 to turn it green. The diff to `role-matrix-expectations.ts` is the access change under review.

### Changes Required:

#### 1. Flipped expectations and the structural assertion

**File**: `src/test/role-matrix-expectations.ts`, `src/test/role-matrix.integration.test.ts`

**Intent**: State the target posture as data before the migration exists, so the red run proves the suite can fail. Add a catalog check that proves the 11 tables without behavioural cells.

**Contract**:

| Cell | anon | noRole | viewer | author | admin |
|---|---|---|---|---|---|
| plan-scoped reads (16 tables) | denied | denied | allowed | allowed | allowed |
| writes on the 5 representatives, `clone_plan` | denied | denied | denied | allowed | allowed |
| `profiles` own read / own insert / own update | denied | allowed | allowed | allowed | allowed |
| `profiles` others read | denied | denied | allowed | allowed | allowed |
| `profiles` others writes, re-key | denied | denied | denied | denied | denied |
| `user_roles`, `own_app_role` | unchanged from Phase 2 | | | | |

- **The structural catalog test, over `pg_policies`.**
  - Every RLS table in `public` other than `profiles` and `user_roles` has exactly four `to authenticated` policies: SELECT on `can_read`, and INSERT/UPDATE/DELETE on `can_edit`. UPDATE's USING is `can_read`, as contracted below.
  - No policy for `authenticated` or `public` in `public` has a literal `true` USING or WITH CHECK. The solver's `to solver_job_writer` policies are excluded.
- **Docblocks.** Update `PRINCIPAL_NOTES` and the suite's header docblock to the target posture.

#### 2. Red run evidence

**File**: `context/changes/fail-closed-roles/change.md`

**Intent**: Record the deny drill, the shape F-401 prescribed: the flipped matrix against the Phase 2 schema, failing exactly on the flipped cells.

**Contract**: A `## Deny drill` section with the date, the command, the count of failing cells and their names (grouped by principal), and the green rerun after migration 2.

#### 3. Migration 2: fail-closed policies

**File**: `supabase/migrations/<ts>_fail_closed_policies.sql`

**Intent**: Replace every human `using (true)` policy with capability policies, matched by **shape, not name**, because hosted names may have drifted (`20260812141459_solver_select_column_scope.sql:55-62`). Give `profiles` an own-row-or-reader SELECT. Assert the result.

**Contract**:

- **Header.** It records:
  - why `DROP POLICY` is not data loss;
  - that the DEFINER exception lives in migration 1;
  - that there is deliberately no re-backfill (role-less humans are assigned with `assign-role.mjs` before merge).
- **Lock timeout.** `set local lock_timeout = '5s'` first.
- **The rewrite.** A `do` block over `pg_policies` where `schemaname = 'public' and cmd = 'ALL' and roles = '{authenticated}' and qual = 'true' and with_check = 'true'`. For each match, it drops the policy and creates four, all `to authenticated`, with names constant across tables:
  - `for select using ((select private.can_read()))`;
  - `for insert with check ((select private.can_edit()))`;
  - `for update using ((select private.can_read())) with check ((select private.can_edit()))`, so a viewer's UPDATE fails loudly with 42501 instead of a silent 0-row no-op. Authors are unaffected, since both helpers are true for them;
  - `for delete using ((select private.can_edit()))`.
- **`profiles`.** Its `cmd = 'SELECT' and qual = 'true'` policy, matched by shape, becomes `using (user_id = (select auth.uid()) or (select private.can_read()))`. The own-row INSERT/UPDATE policies stay role-free.
- **Post-conditions** (`raise exception` on failure):
  - exactly 16 policies were rewritten;
  - no `authenticated` or `public` policy in `public` keeps a literal `true` qual or with_check;
  - every RLS table in `public` except `user_roles` has a SELECT policy referencing `can_read`.
- **Untouched:** both solver policies and `custom_access_token_hook`.

#### 4. Docblocks the flip makes false

**File**: `src/test/solver-credential.integration.test.ts`

**Intent**: Its docblock (`:16-21`) describes the hook-off fallback as full read; it is now no data.

**Contract**: Docblock only. No assertion changes.

### Success Criteria:

#### Automated Verification:

- [ ] Flipped matrix is red against the Phase 2 schema, failing only on flipped cells (recorded in `change.md`): `pnpm test:integration src/test/role-matrix.integration.test.ts`
- [ ] Migration 2 applies from scratch with its post-conditions passing: `pnpm exec supabase db reset`
- [ ] Role matrix green, incl. the structural policy assertion: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- [ ] Full integration lane green, incl. `account-self-service`, `solver-credential` and both solver-touching suites with the solver up: `pnpm test:integration`
- [ ] E2E green with the author unaffected (incl. `generation.spec.ts` with `mise run solver:dev` up): `pnpm test:e2e`
- [ ] Type check and unit suite pass: `pnpm check && pnpm test`

#### Manual Verification:

- [ ] Read the `role-matrix-expectations.ts` diff cell by cell and confirm it states exactly the intended access change
- [ ] Read migration 2 and confirm the rewrite is shape-matched, wrapped in `(select …)`, and scoped `to authenticated`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: The App Follows the Role

### Overview

The middleware reads the role live on every gated request and every action. A role-less user is redirected to the dashboard notice, a failed lookup renders a 503, and actions refuse insufficient capability with `FORBIDDEN`. Nav hides Plans from a role-less user. A provisioned no-role e2e account proves it on workerd.

### Changes Required:

#### 1. Access model (pure, client-safe)

**File**: `src/shared/lib/access/` — `capability.ts`, `access-state.ts`, `resolve-access.ts`, `role-gate.ts`, tests beside each, barrel update

**Intent**: Keep the role → capability map and the gate's routing decision pure and unit-testable, beside `AppRole`.

**Contract**:

- `type Capability = "session" | "read" | "edit"`.
- `grants(role: AppRole, capability: Capability): boolean`:
  - `read` for all three roles;
  - `edit` for `admin` and `author`;
  - `session` always.
- `type AccessState = { status: "granted"; role: AppRole } | { status: "none" } | { status: "unavailable" }`.
- `allows(access, capability): boolean`.
- `resolveAccess(hasUser: boolean, lookup: PromiseSettledResult<AppRole | null>): AccessState`. It is the middleware's whole interpretation of the role read, kept pure because it is the safety-critical step:
  - no user → `none`, whatever the lookup said;
  - a user and a rejected lookup → `unavailable`, never `none`;
  - a user and a `null` role → `none`;
  - a user and a role → `granted`.
- `decideRoleGate(pathname, access) → "allow" | "notice" | "unavailable"`:
  - role-exempt paths → `allow`;
  - `/dashboard` → `allow` for `granted` or `none` (it renders the notice), and `unavailable` for `unavailable`;
  - any other path → `allow` / `notice` / `unavailable` by status.
- `ROLE_EXEMPT_PATHS` carries a one-line reason per entry, like `PUBLIC_PATHS`:
  - `/account`: FR-410, a role-less user manages their own account, and S-402's reset lands on `?notice=recovery`;
  - `/api/solver/container`: an operator route with its own email allowlist, which reads no plan data;
  - the 503 page.

#### 2. Role read

**File**: `src/shared/api/load-own-role.ts` (+ barrel export)

**Intent**: The single app-side role read, through the same function the policies use.

**Contract**: `loadOwnRole(supabase) → Promise<AppRole | null>`. It calls `supabase.rpc("own_app_role")` and throws on error (the caller maps that to `unavailable`).

#### 3. Middleware

**File**: `src/middleware.ts`, `src/env.d.ts`

**Intent**: Populate `locals.access` on every request that can need it, without serialising a second round trip. Then gate pages.

**Contract**:

- **`locals.access`.** `src/env.d.ts` gains `access: AccessState`.
- **When the role is read.** On a non-public path or any `/_actions/*` path, `loadOwnRole` runs concurrently with `getUser()`.
- **Interpreting the result** is `resolveAccess`, never inline logic. The middleware settles the lookup and passes it in, with whether `getUser()` returned a user. Public paths skip the lookup and get `{ status: "none" }`, and the existing sign-in redirect applies first.
- **The page gate** runs after the auth check, on non-public paths except `/_actions/*` (actions guard themselves):
  - `notice` → redirect to `/dashboard`;
  - `unavailable` → `return next("/unavailable")`, which renders `src/pages/unavailable.astro` once, without re-entering the middleware. That minimal page shows no plan data and sets `Astro.response.status = 503`. Never `context.rewrite()`: it re-runs the chain, which repeats `getUser()` and the role lookup.

#### 4. Dashboard notice and capability-filtered nav

**File**: `src/shared/config/nav.ts`, `src/app/layouts/SidebarLayout.astro`, `src/_pages/dashboard/ui/DashboardPage.astro`

**Intent**: Give a role-less user FR-410's notice and remove the Plans entry, keeping their account link, the theme toggle, sign-out and the weak-password banner. This is also the per-item seam S-405 extends.

**Contract**:

- **Nav.** `NavItem` gains an optional `requires?: Capability`; Plans gets `requires: "read"`. A pure `visibleNavItems(items, access)` helper, unit-tested, feeds both the sidebar and the tiles.
- **Dashboard.** When `access.status === "none"`, `DashboardPage` renders "No access yet — ask your admin" plus a link to `/account`, with semantic tokens only, and no tiles.

#### 5. Action guard

**File**: `src/shared/lib/actions/define-domain-action.ts`, `src/shared/lib/actions/require-capability.ts` (new), `src/shared/lib/errors/domain-error.ts`, `src/shared/api/postgrest/sqlstates.ts`, `src/shared/api/postgrest/to-domain-error.ts`

**Intent**: Turn RLS's silent denials into a clear, rollback-triggering error. A forgotten declaration stays fail-closed.

**Contract**:

- **The option.** `defineDomainAction({ input, run, requires = "edit" })`.
- **Order.** `requireSession` → `requireCapability(context, requires)` → `requireSupabase` → `runDomain`.
- **`requireCapability`:**
  - `session` → pass;
  - `granted` without the capability, or `none` → `ActionError FORBIDDEN` ("You don't have permission to do that.");
  - `unavailable` → `ActionError SERVICE_UNAVAILABLE`.
- **Errors.** `DomainErrorCode` gains `"FORBIDDEN"`. `INSUFFICIENT_PRIVILEGE = "42501"` joins `sqlstates.ts`, and `toDomainError` maps it to `FORBIDDEN` before the fallback.
- **Declarations.** Only:
  - `updatePassword` and `updateDisplayName` → `session`;
  - `readGenerationJobStatuses` and `checkPlan` → `read`.
- **Everything else** keeps the `edit` default.

#### 6. Action tests

**File**: `src/shared/lib/actions/define-domain-action.test.ts`, `src/shared/lib/actions/require-capability.test.ts`, `src/_pages/plans-list/api/action-boundary.integration.test.ts`, a new action-capability map test

**Intent**: Pin the guard's decisions and the capability every composed action declares. This is the action-level matrix F-401 deferred to S-403.

**Contract**:

- **Guard unit tests.** Cover every `{session, read, edit} × {granted admin/author/viewer, none, unavailable}` outcome, plus `42501 → FORBIDDEN`.
- **`action-boundary`.** Its fake locals gain `access: { status: "granted", role: "author" }`.
- **The capability map test.**
  - It walks every slice's action object; the generation actions come from `createGenerationActions` with a stub transport.
  - It asserts that exactly the four actions above are non-`edit`, and that every other action refuses a viewer and a role-less user before reaching `run`.
  - Compose it from the slice barrels, not `src/actions/index.ts`, which reads `astro:env/server`.

#### 7. No-role e2e account and spec

**File**: `e2e/author-credentials.mjs` (or a sibling credentials module), `scripts/provision-e2e-author.mjs`, `e2e/no-role.setup.ts` (new), `e2e/specs/no-access.no-role.spec.ts` (new), `playwright.config.ts`, `e2e/CLAUDE.md`

**Intent**: Prove FR-410 and the action guard on real workerd and cookie SSR, with a provisioned account that never holds a role.

**Contract**:

- **Credentials.** A fixed `e2e-no-role@example.test` and a password of at least 15 characters, beside the author's, in the same single-source pattern.
- **Provisioner.** It creates this account too (loopback-guarded) and **deletes any role row** for it on every run, so a stale grant can never make the spec pass.
- **Setup.** `no-role.setup.ts` signs in and writes `e2e/.auth/no-role.json`.
- **Projects.**
  - A `chromium-no-role` project uses that storageState with `testMatch: /.*\.no-role\.spec\.ts/` and depends on `setup`.
  - `chromium` ignores `*.no-role.spec.ts`.
- **The spec asserts:**
  - `/dashboard` shows the notice, with no Plans link in the tiles or the sidebar;
  - `/plans` and `/plans/<random uuid>` land on `/dashboard`;
  - `/account` renders its form;
  - `POST /_actions/createPlan` with a schema-valid body answers 403 `FORBIDDEN`, as `action-unauth.spec.ts` does.
- **What the spec must not do:** sign out or change the password.
- **`e2e/CLAUDE.md`:**
  - the projects list gains `chromium-no-role`;
  - the second provisioned account must never be given a role, and its password form is never submitted;
  - the UI-sign-in rule now names both setup files.

### Success Criteria:

#### Automated Verification:

- [ ] Unit suite passes (access model, nav filter, guard, `toDomainError`, capability map): `pnpm test`
- [ ] Type check passes with 0 errors: `pnpm check`
- [ ] Lint and FSD structure clean: `pnpm lint && pnpm steiger`
- [ ] Integration lane green, incl. `action-boundary`: `pnpm test:integration`
- [ ] E2E green, incl. the `chromium-no-role` project, with the existing `chromium` and `chromium-guard` specs unchanged: `pnpm test:e2e`
- [ ] Production build clean, including the postbuild Supabase-key assertion: `pnpm build`

#### Manual Verification:

- [ ] On `pnpm build && pnpm preview`, as a local account set to `none`: the dashboard shows the notice and no Plans entry; `/plans` and a plan URL redirect to `/dashboard`; `/account` saves a display name and changes the password; sign-out works
- [ ] As an author: everything as before; drag-drop feedback still feels instant
- [ ] As a viewer (`assign-role.mjs … viewer`), on a plan with no pending or running job: renaming a plan or dragging a chip shows a permission error and rolls back; a reload shows nothing changed
- [ ] Role change on the next action: with a board open as an author, demote to viewer from a shell; the next drag is refused without signing out; promote back; the next drag succeeds

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Docs and Rollout

### Overview

Fix every doc PR 2 makes false, record the role rules in CLAUDE.md, do the roadmap bookkeeping (including moving HC Fix 7 out), and run the PR 2 hosted checklist.

### Changes Required:

#### 1. CLAUDE.md role rules

**File**: `CLAUDE.md`

**Intent**: Turn this change's invariants into rules the next slice can't miss (drafted in `context/foundation/stack-assessment.md:296-310`, amended).

**Contract**: A short "Roles" block in § Database & auth:

- Every human-facing read policy requires `can_read()`, except the caller's own account rows (`profiles`, `user_roles`).
- Writes require `can_edit()`.
- Policies name capabilities, never roles.
- Helpers are always called wrapped in `(select …)`.
- Every policy names `to authenticated`.
- No gating inside RPC bodies.
- A new human table gets the four capability policies, and the structural matrix assertion will fail until it does.
- An access-control change starts as a diff to `role-matrix-expectations.ts`.

#### 2. README and runbooks

**File**: `README.md`, `docs/runbooks/solver-credential.md`, `docs/runbooks/calibration-campaign.md`

**Intent**: Remove claims the flip falsified.

**Contract**:

- **README.**
  - `:201`: the hook-off hazard becomes "no data".
  - `:487`: reachability now needs grant + RLS + a role.
- **`solver-credential.md`** at `:117`, `:183-188` and `:292-296`: "escalation to full database access" becomes "no data".
- **`calibration-campaign.md`** at `:25-29` and `:281`: the campaign account needs `author`, which the backfill gave it on hosted; a new campaign account gets it through `assign-role.mjs`. The local rehearsal (`CAMPAIGN_TARGET=local`) uses a hand-made `CAMPAIGN_EMAIL` account that clones, generates and delivers (`bench/campaign/main.ts:138`, `runner.ts:148-188`), so it needs `assign-role.mjs <email> author` after every local `db reset`.

#### 3. Test plan and roadmap bookkeeping

**File**: `context/foundation/test-plan.md`, `context/foundation/roadmap.md`

**Intent**: Keep the living foundation docs true.

**Contract**:

- **`test-plan.md`** at `:67` (Risk #5's "no access-control change"), `:139-142`, `:238`, `:332-336` and `:373`.
- **Roadmap.**
  - S-403's "16 `using (true)` policies" (`:173`) becomes 17 (16 `ALL` + `profiles`).
  - The `:81` baseline ("Auth: partial… **authorization absent**: 16 `using (true)` policies…") is restated as the pre-S-403 baseline, and points at S-403 for the fail-closed posture.
  - The `:301` tracker row's Notes drop HC Fix 7.
  - HC Fix 7 is recorded as its own follow-up item.
- **GitHub issues.** #144 and #153 get matching edits, made with `GH_TOKEN=$(gh auth token --user dobrek)` and only after the user's go-ahead. They are outward-facing.

### Success Criteria:

#### Automated Verification:

- [ ] No doc still claims the old posture. Multiline, because solver-credential.md wraps one phrase across two lines; before the edits it matches CLAUDE.md:47, README:201, roadmap.md:81/:173 and solver-credential.md:185-186/:294: ``rg -nU 'no migration defines a DEFINER|escalation\s+to\s+full\s+database|reaches\s+every\s+table|reaches\s+the\s+whole\s+database|16\s+`using \(true\)`' CLAUDE.md README.md docs context/foundation`` returns nothing
- [ ] Formatting clean: `pnpm exec prettier --check CLAUDE.md README.md docs e2e/CLAUDE.md context/foundation`
- [ ] Full local CI gate green: `/verify`

#### Manual Verification:

- [ ] PR 2 pre-merge, read-only on hosted: no solve running; list humans with no role row (`select u.email from auth.users u left join public.user_roles r on r.user_id = u.id where r.user_id is null and u.raw_app_meta_data->>'machine_role' is null`), and assign or deliberately confirm `none` for each
- [ ] PR 2 opened with the hosted checklist in its description, CI green, squash-merged; `deploy` green
- [ ] After deploy, on hosted as an author (and as the admin developer): edit a plan, Generate → solve → proposal → delivery lands on the board
- [ ] The role-less path on hosted, only if a deliberately role-less account already exists: it sees only the notice and its account. Never create a hosted user for this
- [ ] #144 and #153 updated (with the user's go-ahead)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- **`shared/lib/access`:**
  - `grants` over all role × capability pairs;
  - `allows` over the three access statuses;
  - `resolveAccess` over no user, user + rejected lookup, user + `null` and user + role (incl. no user + rejected lookup → `none`);
  - `decideRoleGate` over exempt, `/dashboard` and other paths × each status (incl. `unavailable` on `/account` → `allow`, and on `/dashboard` → `unavailable`);
  - `visibleNavItems`.
- **The action guard:**
  - every capability × access-state outcome;
  - `42501 → FORBIDDEN` in `toDomainError`;
  - the capability-map test (four non-`edit` actions, everything else refuses viewer and role-less before `run`).
- **The expectation table's invariants** (`role-matrix-expectations.test.ts`): self-grant rows evidenced by the service-role path.

### Integration Tests:

- **The role matrix.** Five principals; the own/others user-keyed reads; self-grant denials; the `own_app_role` value per principal; `private` catalog facts; the structural four-policies assertion. Judged by service-role read-back, never by `error` alone.
- **Unchanged suites that must stay green across the flip:** `account-self-service` (role-less own-profile upsert), `solver-credential` (hook on), `solver-transport`, `generation-proposal` (author Generate → board), `password-recovery`.
- **`action-boundary`:** the full wrapper with an author's `access`.

### Manual Testing Steps:

1. Local, after Phase 4 (`pnpm build && pnpm preview`): walk the role-less, viewer and author paths, and the live role change, as listed in Phase 4's manual criteria.
2. Hosted, after PR 1: the backfill set, the developer promoted, nothing changed for authors.
3. Hosted, after PR 2: the role-less humans list resolved before merge, then the author and admin Generate → delivery smoke.

## Performance Considerations

- **Policy helpers.** The `(select private.can_read())` wrapper makes each helper an InitPlan, run once per table reference. Measured cost: under 0.1 ms per read and about 0.35 ms per write RPC (research §2.6). The < 200 ms drag-drop budget is client-side validation (`entities/timetable`, guarded by `collisions.perf.test.ts`). The role check only adds server settle latency to the optimistic write.
- **Middleware.** It adds one RPC per gated request, run concurrently with `getUser()`, so the wall-clock cost is about max(GoTrue, PostgREST), not their sum.
- **Known, harmless today.** `enum_eq` is not leakproof, so once any RLS qual exists, `cohort = 'dp2'` drops out of index conditions. `course_groupings` then seq-scans, at a cost that grows with accumulated proposal clones. Watch `/plans/[id]` load times; no action now.

## Migration Notes

- **Two files, two PRs.** Each applies atomically, and `deploy` stops on any `raise exception`. Migration 1 is behaviour-neutral. Migration 2 is safe under the old Worker for backfilled authors.
- **No rollback by `DROP`.** Recovery rolls forward: a new migration that loosens or corrects policies. Hosted is never dropped and re-pushed.
- **Hosted assumptions are now asserted, not assumed:**
  - the helper owner's `bypassrls` (migration 1);
  - the rewrite count and the absence of literal `true` policies (migration 2).
  - A mismatch aborts the deploy before any human is locked out.
- **No emails in migrations.** The developer's admin role is the `assign-role.mjs` operator step.

## References

- Research: `context/changes/fail-closed-roles/research.md`
- Roadmap item: `context/foundation/roadmap.md` § S-403; PRD §Access Control Changes, FR-410/416/417/418
- Umbrella design: `context/changes/user-managment-research/research.md`
- Harness precedent: `context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/`
- `profiles` precedent and its S-403 notes: `context/archive/2026-10-16-account-self-service/`
- Migration style: `supabase/migrations/20261017170524_profiles.sql`
- Operator-script template: `scripts/provision-solver-user.mjs`
- HTTP action-boundary pattern: `e2e/specs/action-unauth.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Roles Schema, Types, and the Matrix Learns `user_roles`

#### Automated

- [x] 1.1 Migrations apply from scratch with migration 1's post-conditions passing — dc8857f
- [x] 1.2 Types regenerate with a diff limited to `app_role`, `user_roles`, `own_app_role` — dc8857f
- [x] 1.3 Type check passes with 0 errors — dc8857f
- [x] 1.4 Unit suite passes (incl. `role-matrix-expectations.test.ts`) — dc8857f
- [x] 1.5 Role matrix green, incl. the new catalog, `private` and `own_app_role` cells — dc8857f
- [x] 1.6 Full integration lane green — dc8857f
- [x] 1.7 Lint and FSD structure clean — dc8857f

#### Manual

- [ ] 1.8 Migration 1 read against the research: one DEFINER, exception recorded, no PII
- [ ] 1.9 `\df+ private.*` lists three functions, only `current_app_role` DEFINER

### Phase 2: Every Role as a Principal at Today's Posture, Assignment Tooling, PR 1 Docs

#### Automated

- [x] 2.1 Type check passes (completeness forces every principal × cell) — 7ba6470
- [x] 2.2 Unit suite passes, incl. the self-grant evidence invariant — 7ba6470
- [x] 2.3 Role matrix green with five principals at today's posture — 7ba6470
- [x] 2.4 Full integration lane green — 7ba6470
- [x] 2.5 E2E green, and green again on a second run (provisioner idempotent) — 7ba6470
- [x] 2.6 Operator tool round trip on local, with refusals — 7ba6470
- [x] 2.7 Provisioner refuses a non-loopback URL — 7ba6470
- [x] 2.8 Full local CI gate green — 7ba6470

#### Manual

- [ ] 2.9 Pre-merge hosted read-only check: backfill set, no solve running
- [ ] 2.10 PR 1 merged; `deploy` green
- [ ] 2.11 Hosted: every human holds `author`, solver user holds no row, `private` not exposed
- [ ] 2.12 Developer promoted to `admin` on hosted
- [ ] 2.13 Stale or test accounts reviewed and set to `none` where intended
- [ ] 2.14 Hosted app unchanged for an author

### Phase 3: The Flip

#### Automated

- [x] 3.1 Flipped matrix red against the Phase 2 schema (recorded in `change.md`) — 40c9c27
- [x] 3.2 Migration 2 applies from scratch with its post-conditions passing — 40c9c27
- [x] 3.3 Role matrix green, incl. the structural policy assertion — 40c9c27
- [x] 3.4 Full integration lane green — 40c9c27
- [x] 3.5 E2E green with the author unaffected — 40c9c27
- [x] 3.6 Type check and unit suite pass — 40c9c27

#### Manual

- [ ] 3.7 Expectations diff reviewed cell by cell
- [ ] 3.8 Migration 2 reviewed: shape-matched, wrapped, `to authenticated`

### Phase 4: The App Follows the Role

#### Automated

- [x] 4.1 Unit suite passes (access model, nav filter, guard, `toDomainError`, capability map) — a463575
- [x] 4.2 Type check passes with 0 errors — a463575
- [x] 4.3 Lint and FSD structure clean — a463575
- [x] 4.4 Integration lane green, incl. `action-boundary` — a463575
- [x] 4.5 E2E green, incl. the `chromium-no-role` project — a463575
- [x] 4.6 Production build clean — a463575

#### Manual

- [ ] 4.7 Role-less path walked on preview
- [ ] 4.8 Author path unchanged on preview
- [ ] 4.9 Viewer edits refused and rolled back
- [ ] 4.10 Role change takes effect on the next action

### Phase 5: Docs and Rollout

#### Automated

- [x] 5.1 No doc still claims the old posture — 29e139e
- [x] 5.2 Formatting clean — 29e139e
- [x] 5.3 Full local CI gate green — 29e139e

#### Manual

- [ ] 5.4 PR 2 pre-merge hosted check: no solve running, role-less humans resolved
- [ ] 5.5 PR 2 merged; `deploy` green
- [ ] 5.6 Hosted author and admin smoke: edit, Generate → delivery
- [ ] 5.7 Hosted role-less path checked only if such an account already exists
- [ ] 5.8 #144 and #153 updated
