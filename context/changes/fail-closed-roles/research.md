---
date: 2026-10-28T10:39:25+01:00
researcher: Claude (Opus 5.5)
git_commit: 30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f
branch: main
repository: ib-timetable-planner
topic: "Feasibility of S-403 fail-closed roles: challenges, and a recommended option"
tags: [research, codebase, rls, roles, user-roles, security-definer, middleware, astro-actions, role-matrix, e2e, migrations, supabase, fail-closed-roles]
status: complete
last_updated: 2026-10-28
last_updated_by: Claude (Opus 5.5)
---

# Research: Feasibility of S-403 fail-closed roles

**Date**: 2026-10-28T10:39:25+01:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: [`30c46e8`](https://github.com/dobrek/ib-timetable-planner/tree/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f)
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

> Check the feasibility of implementing S-403 (fail-closed roles, `context/foundation/roadmap.md:164-174`).
> Check what kind of challenges we could face and suggest a possible option.

Scope agreed with the author before research:

- **Verify + delta.** The design from `context/changes/user-managment-research/research.md` (2026-10-10, at `6eb1569`) is re-checked against today's code. Decided choices (global roles, a live lookup rather than JWT claims) are reopened only where evidence contradicts them. F-401, F-402, S-401 and S-402 have landed since.
- **Probe the local stack.** Risky claims are tested on the local Supabase stack (PG 17.6), inside `BEGIN … ROLLBACK`. Nothing was committed. The end state was verified: 21 public policies, no `private` schema, no `user_roles`.

## Summary

### Verdict: feasible, with no platform blocker; the risk is in silent failure, not in the mechanism

The whole database design was prototyped on all 17 human-facing tables in a rolled-back transaction.

- **Authors and admins:** all 29 probe outcomes matched today's baseline row for row, `clone_plan`'s `RETURNING` and every Generate/stop/reclaim/deliver write included.
- **Viewers:** read everything; every insert-path write is refused.
- **Role-less users:** read nothing.
- **The solver:** unchanged with the token hook on. With the hook off it is now denied everything; today it reads 12 plans and 614 students. So S-403 also closes the hook's documented "silent escalation to full database read" hazard.
- **Cost:** under 0.1 ms per read and about 0.35 ms per write RPC, against a 200 ms budget that the client-side validation core owns anyway.

**Size: L, about four phases.** The SQL is small and mechanical. The work sits around it:

- extending the F-401 role matrix, which needs code changes, not just data;
- giving every account created *after* the migration a role;
- the "no access yet" gate;
- an action-level guard;
- the docs and runbooks the change makes false.

### The challenges that matter, ranked

1. **Denials are silent, so an over-tight policy would not be noticed.**
   - RLS denies an UPDATE or DELETE as "0 rows, no error".
   - At least 15 app write paths and 5 RPCs treat 0 rows as success.
   - So an author policy that was too tight would show up as a phantom edit, not an error. The guardrail "no edit silently becomes a no-op" could be broken with every CI lane green.
   - Only the role matrix, which judges writes by a service-role read-back, can prove authors are untouched. Its author column is the core evidence of this slice.
2. **The migration auto-applies to live school data, and the old Worker can outlive it.**
   - The window between `db push` and the new Worker is about 45 s. A failed or rolled-back `wrangler deploy` makes it unbounded.
   - So the migration must be correct for *today's* app, on its own. The probe shows it is, for backfilled authors.
   - Three things still need guarding inside the migration:
     - policy DDL takes `AccessExclusiveLock` on 17 tables;
     - hosted policy names may have drifted;
     - the post-conditions need asserting.
3. **Every account created after the migration has no role.** The backfill covers only users who exist when it runs. That leaves out:
   - the e2e author, which CI creates after migrations;
   - every test factory user;
   - every local account after `db reset`;
   - every hosted account created from the dashboard until S-406 ships a Users page.
   Each path needs an explicit role, or `e2e` goes red and blocks `deploy`.
4. **The role helper must be SECURITY DEFINER, and verified as such.** An INVOKER helper works for S-403 alone. But once S-406 adds an admin-reads-all policy on `user_roles`, it fails with `stack depth limit exceeded`, and **only after the table is analyzed**: green locally, broken on hosted once autovacuum runs. The roadmap's DEFINER exception is therefore necessary, not just conventional.
5. **`profiles` is a 17th `using (true)` table, and its SELECT policy must keep an own-row clause.** With a role-only SELECT policy, a role-less user cannot save their display name. The upsert fails with an RLS violation, because `ON CONFLICT DO UPDATE` checks the existing row against the SELECT policy, even with no `RETURNING`. That breaks FR-410.
6. **A role-less user must still reach their account.** `/account` must stay open, including `?notice=recovery`, which S-402's reset lands on. So must the two account actions and sign-out. A blanket action guard or page gate would break FR-410 and two existing suites.

### Recommended option, in one paragraph

- **Data.** Store human roles in `public.user_roles`:
  - `user_id` is the primary key, with `on delete cascade`;
  - the role is a `public.app_role` enum (`admin` / `author` / `viewer`).
- **The one DEFINER function.** It is `private.current_app_role()`, which reads only the caller's own row.
- **Capability helpers.** `private.can_read()`, `private.can_edit()` and `private.is_admin()` are INVOKER wrappers around it. `authenticated` gets USAGE on the unexposed `private` schema, as in the Supabase docs' own example.
- **Policies.**
  - Each of the 16 `ALL using (true)` policies becomes four per-command policies on `(select private.can_read())` / `(select private.can_edit())`.
  - They are matched by shape, not by name.
  - `profiles` SELECT becomes "own row, or a role that can read".
- **Migration.** Backfill every non-machine user as `author` in the same migration, and assert the post-conditions before commit.
- **App.**
  - Middleware reads the role live, concurrently with `getUser()`, on every non-public path including `/_actions/*`, and sets `locals.role`.
  - Role-less users are redirected to a notice rendered on `/dashboard`; `/account` and sign-out stay open.
  - `defineDomainAction` gains a `requires` capability that defaults to `edit` (fail-closed), plus a `FORBIDDEN` error code.
- **Tests, CI and ops.**
  - The F-401 matrix gains `admin`, `author` and `viewer` principals and then flips to the new posture.
  - The e2e provisioner and the test factory assign roles.
  - A `scripts/assign-role.mjs` operator tool covers the developer-admin step and the hosted users created before S-406.

[§ Recommended option](#recommended-option) gives the details and a phase plan.

---

## Detailed Findings

### 1. What changed since the 2026-10-10 design

| Earlier claim (`user-managment-research/research.md`) | Today (`30c46e8`) | Consequence |
|---|---|---|
| "16 `using (true)` policies" (§1.4) | **17 human-facing tables.** S-401 added `profiles` with `"Authenticated users read every profile" … using (true)` ([`profiles.sql:56-57`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/supabase/migrations/20261017170524_profiles.sql#L56-L57)). There are 21 public policies: 16 human `ALL`, 2 solver, 3 `profiles`. | The roadmap's and #144's "16" is stale. `profiles` needs its own policy, not the generic rewrite. |
| "No identity use in app code" (§1.3) | `user.id` is read by `SidebarLayout.astro:47` (`loadOwnProfile`) and `account.astro:12`. `profiles.user_id` defaults to `auth.uid()`. | The shell reads the caller's own profile on every page, so the own-row read must survive fail-closed. |
| `run(supabase, input, { userId })` must grow (§8) | **Not needed.** S-401 settled self-service writes on the `auth.uid()` column default (`update-display-name.ts:9-14`). | One less contract change in `shared`. |
| Middleware allowlist: sign-in only (§1.1) | +`/auth/forgot` and +`/auth/confirm` ([`middleware.ts:9-13`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/middleware.ts#L9-L13)). S-402's reset lands on `/account?notice=recovery` (`password-recovery/model/email-link.ts:36-38`). | `/account` must sit in a role-less tier. |
| `DomainErrorCode` has no `FORBIDDEN` (§1.3) | Still none. `UNAUTHORIZED` and `TOO_MANY_REQUESTS` were added ([`domain-error.ts:9-16`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/shared/lib/errors/domain-error.ts#L9-L16)). | `FORBIDDEN` is still S-403's to add. |
| No role-aware harness (§8a) | F-401 shipped `createSignedInUser` and the role matrix (`Principal = "anon" \| "noRole"`, [`role-matrix-expectations.ts:29`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/test/role-matrix-expectations.ts#L29)). It has an extension point for S-403 ([`create-signed-in-user.ts:31`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/test/factories/create-signed-in-user.ts#L31)). | The flip mechanism exists. It needs code changes (§4.1). |
| CI on legacy keys, unpinned CLI | F-402: `sb_publishable_` / `sb_secret_` keys, and the CLI comes from the lockfile. Local and CI run the same images. | The matrix result means the same thing locally and in CI. |
| A2 (live lookup) beats A1 (JWT claim) | **Holds.** Probe 2 of the earlier research showed a claim changes only on refresh, up to 3600 s later. The NFG requires "next action". | Not reopened. |
| Helpers `can_read` / `can_edit` / `is_admin`, all DEFINER (§5) | **Refined.** One DEFINER function plus INVOKER wrappers. Wrappers need USAGE on `private` (probe G, §2.3). | Keeps stack-assessment's "single sanctioned exception" (`stack-assessment.md:296-299`) literally true. |

### 2. Database

#### 2.1 Live inventory (local, `pg_catalog`)

- **Tables.** 17 `public` tables. All have RLS on, none FORCE, all owned by `postgres`. No views, no Realtime publication, no pg_graphql.
- **The 16 human `ALL` policies.** Each is named `"Authenticated users have full access"` and is `ALL to {authenticated} using (true) with check (true)`. They are on:
  - `bundles`, `bundles.sql:41`;
  - ten tables in [`minimal_domain_schema.sql:163-174`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/supabase/migrations/20260602185012_minimal_domain_schema.sql#L163-L174): `course_grouping_members`, `course_groupings`, `course_merges`, `course_overlaps`, `courses`, `placements`, `plans`, `student_choices`, `students`, `teachers`;
  - `course_teachers`, `course_teachers.sql:33`;
  - `generation_jobs`, `generation_jobs.sql:117`;
  - `shelf_bundles` and `shelf_bundle_courses`, `shelf_bundles.sql:51,55`;
  - `teacher_availability`, `teacher_availability.sql:33`.
- **Solver policies, which stay.** Both are on `generation_jobs`, scoped `to solver_job_writer`:
  - SELECT, `20260820075348_solver_progress_select_grants.sql:30`;
  - UPDATE on non-terminal rows, `20260810200931_solver_job_writer_role.sql:96`.
- **`profiles`.** Read-all, insert-own and update-own (`profiles.sql:56-65`).
- **Grants.**

  | Role | Holds |
  |---|---|
  | `authenticated` | all 8 privileges on 15 tables; SELECT, INSERT and UPDATE on `profiles` |
  | `anon` | TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on 15 tables (F-401 left this residue in place on purpose) |
  | `solver_job_writer` | column grants on `generation_jobs` only |

- **Default privileges.** `pg_default_acl` for `postgres` in `public` hands every new table `anon=Dxtm, authenticated=arwdDxtm`.
- **Functions.** All 13 `public` functions are INVOKER with `search_path=''`. **None needs re-creating for S-403**: they inherit the new policies. So the lesson about re-creating functions from the latest live definition does not apply.
- **Roles.** `postgres` is not superuser, and has `rolbypassrls = t`.

#### 2.2 Prototype results (all 16 `ALL` tables plus `profiles`, rolled back)

The prototype rewrote policies **by shape**, not by name: `cmd='ALL' and roles='{authenticated}' and qual='true' and with_check='true'`. It printed `rewrote 16 tables`.

| Principal | Reads | Writes |
|---|---|---|
| **admin / author** | Same as today: plans 12, placements 2000, students 614, jobs 14 | Same as today on all 29 probes. These cover: <br>• `INSERT plans … RETURNING`, so the RETURNING-vs-SELECT trap does not bite, because the author can also read <br>• `clone_plan` <br>• `place_course`, `shelve_bundle`, `apply_generated_placements`, `bulk_edit_student_choices` <br>• the `generation_jobs` insert used by `startGeneration` <br>• every human `generation_jobs` UPDATE path: stop CAS, request-stop, reclaim to `interrupted`, `markDelivered`, `notified_at`, `failJob` |
| **viewer** | Everything | **INSERT paths raise `42501`**: <br>• plans, `generation_jobs` <br>• `clone_plan`, `place_course`, `shelve_bundle` <br>• `bulk_edit` add <br>**These change nothing and report success**: <br>• UPDATE/DELETE: 0 rows <br>• delete-only and update-only RPCs: `remove_bundle_members`, `bulk_edit` remove-only, `apply_generated_placements` clear-cell, `replace_cohort_groupings(…, '[]')`, whole-bundle `move_bundle_members` |
| **no role** | 0 rows everywhere, `generation_jobs` and other users' profiles included | Same as viewer. `clone_plan` raises `P0001 … source plan … not found`; `shelve_bundle` raises a misleading `P0001 no placements at cell` |
| **machine, hook on** (`solver_job_writer`) | Its 5 `generation_jobs` columns | claim, heartbeat, stage, terminal write and stop poll all OK. Untouched, because the new policies are `to authenticated` only |
| **machine, hook off** (`authenticated`, no role row) | **0 rows.** Today: 12 plans, 614 students and every profile | All refused |

**Self-promotion.** `INSERT` or `UPDATE` on `user_roles` by an author is refused at the grant layer: `42501 permission denied for table user_roles`.

#### 2.3 The helper: INVOKER vs DEFINER, and one DEFINER vs three

Probes run by me after the agent, with author `8aca557e…` (the e2e author) and the role-less user `cbd125fc…`. `user_roles` is backfilled; the plans SELECT policy is `(select private.can_read())`.

| Probe | Setup | Result |
|---|---|---|
| A | INVOKER helpers; `user_roles` has the read-own-row policy only | author sees 12 plans ✓ |
| B | A + `admin_all` policy on `user_roles` using an INVOKER `is_admin()`; **not analyzed** | author sees 12 plans ✓ (planner uses the PK index) |
| C | B + `analyze public.user_roles` | **`ERROR: stack depth limit exceeded … SQL function "is_admin" statement 1` (repeated)**, on a plain `count(*) from plans` |
| D | C with both helpers `alter function … security definer` | author sees 12 plans ✓ |
| G1 | One DEFINER `private.current_app_role()`, INVOKER wrappers `can_read` / `can_edit`, **no USAGE** on `private` | **`ERROR: permission denied for schema private`** inside `can_read` |
| G2 | G1 + `grant usage on schema private to authenticated` | author sees 12 plans ✓. `anon` has no EXECUTE on the DEFINER function; `authenticated` has SELECT but no INSERT on `user_roles` |

Conclusions:

- **DEFINER is required no later than S-406, and the failure is plan-dependent.**
  - An inline policy subquery is caught at rewrite time with `infinite recursion detected in policy`.
  - A function hides the recursion from the rewriter. It then surfaces only when the planner picks a seq scan.
  - Shipping INVOKER in S-403 would leave S-406 a trap that passes local tests. **Ship DEFINER in S-403**, as the roadmap says.
- **Why DEFINER is safe here.** On Supabase the function owner is `postgres`, which has `bypassrls` (Supabase docs: "a `security definer` function only skips RLS when its owner can"). If hosted ownership were ever different, the helper would see zero rows: **total denial, which fails closed, not open.** A migration post-condition should assert the owner.
- **One DEFINER function, not three.**
  - Policies only need EXECUTE, not USAGE (the agent's probe): a policy stores the function's OID.
  - An INVOKER wrapper's *body*, though, resolves `private.current_app_role()` by name as the caller (probe G1).
  - So the single-DEFINER shape needs `grant usage on schema private to authenticated`. That is the Supabase docs' own pattern ("Break recursive RLS cycle with security definer function").
  - It is safe because `private` is not an exposed schema: `[api] schemas = ["public","graphql_public"]`, `supabase/config.toml:13`. The only direct caller would be SQL running as `authenticated`, and that learns only its own role.
  - The alternatives cost more:
    - three DEFINER functions triple the exception surface;
    - policies calling `current_app_role()` with inline role lists spread the capability map across 68 policies.
- **`alter function … security definer` keeps the OID**, so switching does not require rewriting policies.

#### 2.4 `profiles`: the own-row clause is mandatory

| Probe | `profiles` SELECT policy | Role-less user upserts their own display name (`on conflict (user_id) do update`, as `update-display-name.ts:14` does) |
|---|---|---|
| E | `(select private.can_read())` | **`ERROR: new row violates row-level security policy for table "profiles"`**, with no `RETURNING` involved |
| F | `user_id = (select auth.uid()) or (select private.can_read())` | ✓. They read 1 profile (their own) and 0 plans |

- **What this means.** "Every read policy requires a role row" (`stack-assessment.md:305`) needs a carve-out for the caller's own account data. The S-401 research anticipated exactly this (`archive/2026-10-16-account-self-service/research.md:243-246`).
- **Display names.** A role-less user no longer reads others' names. Today, even the hook-off machine user reads every profile; F closes that too.

#### 2.5 `user_roles` grant and RLS posture

- **Default grants on a new table.** `{anon=Dxtm, authenticated=arwdDxtm}`, the lesson's trap.
- **Exact revokes** (verified with `has_table_privilege`):
  ```sql
  revoke all on public.user_roles from anon;
  revoke insert, update, delete, truncate, references, trigger, maintain on public.user_roles from authenticated;
  ```
  Result: `anon` holds nothing; `authenticated` holds SELECT only; `service_role` keeps all 8, which the factory and provisioner need.
- **Rows.** `for select to authenticated using (user_id = (select auth.uid()))`.
  - S-403 needs only self-read. S-409's Edge Function also needs it, for the admin check under the caller's RLS (`stack-assessment.md:343`).
  - Writes stay service-role-only until S-406 adds admin write policies.
  - S-406 must then add the policies, not just grants, and its admin-reads-all policy must go through the DEFINER helper (§2.3).

#### 2.6 Performance

Measured as the author, on a warm second run. "Wrapped" means the helper call is written `(select private.can_read())`.

| Query | `using (true)` | Wrapped DEFINER | Unwrapped DEFINER |
|---|---|---|---|
| placements by plan+cohort (134 rows) | 0.035 ms | 0.098 | 1.022 |
| course_groupings + embedded members (495 rows) | 1.323 | 1.170 | 11.875 |
| `place_course` (avg of 200) | 0.06–0.07 | 0.41–0.42 | 0.40 |
| `apply_generated_placements`, 1 cell (avg of 50) | 0.32–0.36 | 0.89–1.02 | 5.3 |

How many times each helper runs (`can_read` / `can_edit`):

| Operation | Wrapped | Unwrapped |
|---|---|---|
| any read | 1 per table reference | one per row scanned |
| `clone_plan` | 18 / 12 | 10540 / 4510 |

- **The `(select …)` wrapper is mandatory.** With it, the helper runs as an InitPlan, once per table reference, even inside correlated SubPlans. Supabase recommends the same.
- **The budget is safe.** The < 200 ms budget is client-side validation. Validation is pure, in `entities/timetable` composed by `plan-detail/model/use-board-derivations.ts`, guarded by `collisions.perf.test.ts`. A role check adds only server-side settle latency to the optimistic write (`board-writes.ts:166-188`).
- **Known cost, harmless today: `enum_eq` is not leakproof.** `cohort` is an enum (`proleakproof = f` for `enum_eq`, `t` for `uuid_eq`). So once any RLS qual exists, `cohort = 'dp2'` drops out of the index condition:
  - `placements` falls back to the `plan_id` index plus a filter;
  - `course_groupings` flips to a seq scan.
  Cost grows with the total row count, since proposal clones accumulate at about 500–700 groupings per clone per cohort. Record it, and watch it if `/plans/[id]` load times creep.

#### 2.7 Migration safety on live data

- **Each file applies atomically.** The Supabase CLI applies each migration file as one batch with its `schema_migrations` row. So a `raise exception` post-condition aborts cleanly, nothing is recorded, and `deploy` stops before `wrangler deploy`.
- **The backfill.** `insert … select id, 'author' from auth.users where raw_app_meta_data->>'machine_role' is null` inserted 9 of 11 local users.
  - Both machine users were excluded.
  - No user had null or `{}` metadata, a JSON-null `machine_role`, or an unrecognised `machine_role`. An unrecognised value would get no row, which fails closed and matches the hook treating such a user as human.
  - Local residue: 6 leftover `auth-user-<uuid>@example.test` factory users would also become `author`. Local only.
- **Locks.** `DROP` and `CREATE POLICY` take `AccessExclusiveLock` on each table, held until commit, across 17 tables. The DDL takes milliseconds, but it can queue behind a long `clone_plan` and stall every request. Use `set local lock_timeout = '5s'`, so a busy moment fails and can be re-run. The existing "no merge mid-solve" rule already covers the solver.
- **Policy-name drift.** It has happened before (`20260812141459_solver_select_column_scope.sql:55-62`), and hosted names cannot be checked from here. Match by shape, as the prototype did, and assert afterwards:
  - no `authenticated` or `public` policy in `public` still has `qual='true'` or `with_check='true'`;
  - every RLS table has a `can_read` SELECT policy;
  - exactly 16 tables were rewritten;
  - the DEFINER function's owner owns `user_roles` or bypasses RLS.
- **The old Worker under the new policies.** For backfilled authors it behaves identically, which is proven by the 29-probe author baseline. So the migration is safe however long the window lasts.

### 3. Application layer

#### 3.1 Where the role read goes

- **Middleware.** [`middleware.ts:31-53`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/middleware.ts#L31-L53) runs `getUser()` on every request that reaches the Worker, then the public-path check. `/_actions/*` passes through by the `/_` prefix (`:18`), so **a middleware path gate never sees actions**. Actions must answer `FORBIDDEN` themselves; a redirect would return HTML to `actions.x()`.
- **Concurrency is safe on the installed versions.**
  - `auth-js@2.116.0`'s client is lockless when no `lock` is passed (`GoTrueClient.js:200-211`), and refresh is single-flighted (`:4186-4193`).
  - `@supabase/ssr` writes cookies only on `TOKEN_REFRESHED`.
  - PostgREST takes its token from `getSession()`.
  - So a role read concurrent with `getUser()` costs about max(GoTrue, PostgREST) in wall-clock, not their sum.
- **Caveats for the concurrent read.**
  - Skip it on public paths. With no session it runs as `anon`.
  - Use its result only if `getUser()` returned a user. The JWT alone is not revocation-checked.
  - Treat a lookup *error* differently from "no row": show an error page or answer 503, never "no access yet", so an author is not told they lack access during a blip. Both outcomes are fail-closed.
- **Round trips today.** Every dynamic request pays one GoTrue call. Every `SidebarLayout` page adds a `profiles` read on a separate client (`SidebarLayout.astro:43-53`). The role read can't share that query, because `profiles` rows exist only for users who set a name.

#### 3.2 What a role-less user meets without a gate

RLS filters cleanly, so there are no crashes or leaks, but FR-410 is not met:

| Route | What a role-less user gets |
|---|---|
| `/dashboard` | a Plans tile (`DashboardPage.astro:6`) |
| `/plans` | "No plans yet — create your first plan." Create fails with raw `42501` text (`PlansHub.tsx:109-112`) |
| deep links | 404 (`PlanScopedError`) |

- **The gate is for FR-410, not data safety.**
- **One exception:** a helper that *errors*, instead of filtering, would turn every loader into a 500, because loaders throw on error.
- **What must stay reachable without a role:**
  - `/account`, including `?notice=recovery`;
  - the notice page;
  - `POST /api/auth/signout`, `/auth/*`, `/api/auth/*`, `/_astro/*`;
  - the `updatePassword` and `updateDisplayName` actions.
- **`/api/solver/container`** reads no plan data and keeps its email allowlist ([`api/solver/container.ts`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/pages/api/solver/container.ts)). Leave it out of any role map.

#### 3.3 The action guard is required, not decorative

`src/actions/index.ts:20-30` registers exactly 40 actions, all through `defineDomainAction` (`requireSession` → `requireSupabase` → `runDomain`).

`toDomainError` maps only `23505` to `CONFLICT` and `PGRST116` to `NOT_FOUND`; everything else becomes `INTERNAL_SERVER_ERROR`. About 15 call sites build an `INTERNAL_SERVER_ERROR` directly, so a `42501` mapping in `toDomainError` alone would not reach them.

What a non-editor gets back today when RLS refuses a write:

| Shape | Examples | Result |
|---|---|---|
| INSERT / upsert / RPC insert | `create*`, `placeCourse`, `clonePlan`, `startGeneration` | raw `42501` text, as `INTERNAL_SERVER_ERROR` |
| `.update().select().single()` | `updateCourse`, `renamePlan`, week/optional toggles (`placements.ts:183-201`) | "X not found" (`PGRST116`) |
| CAS with `.select("id")` | `stopGeneration` (`generation-stop.ts:72-115`), reclaim | read as a benign race: "already-finished" while the job keeps running |
| **Silent success** | the delete actions; `clearAvailability*`; `removeBundleMembers`; `deleteShelfBundle`; `bulkEditChoices` remove-only; `computeGroupings` with no results; `moveBundleMembers` whole-bundle; `markPending`; `refreshCatalogHash` | an optimistic board state that never rolls back (`board-writes.ts:183-187`), a phantom edit until reload |

So for viewers and role-less users, **only an action-level check gives a clear, correct error and triggers rollback**. RLS stays the enforcement; the guard gives the error.

Implementation:
- `requires` on `defineDomainAction`, with values `session` / `read` / `edit`.
- **Default `edit`**, so a future action that forgets to declare a capability is fail-closed.
- Exceptions:
  - `accountActions` declare `session`;
  - `readGenerationJobStatuses` declares `read`;
  - `checkPlan` declares `read`, because its writes are author behaviour that S-405 settles.
- Add `FORBIDDEN` to `DomainErrorCode`.
- Add `INSUFFICIENT_PRIVILEGE = "42501"` beside `sqlstates.ts:2-8`, mapped to `FORBIDDEN`.

`action-boundary.integration.test.ts:40-46` fakes `locals.user`. Under the guard it must also set `locals.role`.

#### 3.4 Page-load writes stay author behaviour

`/plans/[id]` runs `checkPlan` (reclaim, deliver, `markNotified`) and then `releaseOrphanProposal` under the visitor's session (`index.astro:48-71`, `generation-delivery.ts:221-583`).

| Visitor | What happens |
|---|---|
| Role-less | `loadPlanSummary` returns null, so the page 404s before any write |
| Viewer | Reclaim and `notified_at` no-op; delivery's apply raises `42501`, which is caught; the proposal stays pending. Nothing is corrupted |

That case is PRD Open Question 1 and belongs to S-405. Until S-406, no viewer can exist except through a manual SQL insert.

#### 3.5 Nav, dashboard and FSD placement

- **Nav.** `NavItem = { href, label, icon }` (`shared/config/nav.ts:4-8`). `GLOBAL_NAV_ITEMS` drives both the sidebar and the dashboard tiles (`DashboardPage.astro:6`).
- **For a role-less user**, three changes:
  - hide Plans in both places;
  - render the notice in the dashboard body, keeping the weak-password banner (`DashboardPage.astro:9-21`), which sign-in already routes there (`sign-in/model/post-sign-in-path.ts:8-10`);
  - keep the account link and sign-out.
- **Per-item gating for viewers is S-405's** (`roadmap.md:199`).
- **Placement**, following the barrel-plus-concept-file convention:
  - a pure, client-safe role type and capability predicates in `src/shared/lib/access/`, typed from `Database["public"]["Enums"]["app_role"]`, so the TS role type is a projection of the generated types;
  - the read in `src/shared/api/load-own-role.ts`, beside `load-own-profile.ts`;
  - the guard in `src/shared/lib/actions/require-capability.ts`;
  - `locals.role` in `src/env.d.ts`.
- **Why the guard can't be middleware-only.** Middleware, `src/actions/` and `src/pages/` are outside steiger's graph; middleware already imports `@/shared/api`.
- **Keep role checks out of `src/entities/timetable/`** (`stack-assessment.md:329-331`).

### 4. Tests, CI and provisioning

#### 4.1 The role matrix needs code changes, not just data

F-401 meant the flip to be cheap. It mostly is, but five things need code:

1. **Factory.** `createSignedInUser(admin)` takes no options. It needs `role?: AppRole`: a service-role insert after `registerUser`, so a failed insert does not leak the user. `teardown` already assumes `user_roles` cascades from `auth.users` ([`teardown.ts:29`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/test/factories/teardown.ts#L29)), so the foreign key **must** be `on delete cascade`.
2. **Probe.** `fixtureKey` falls back to `plan_id` for unknown tables (`access-probe.ts:141-145`), so `user_roles` needs `user_id`. `buildFixture` must add a `user_roles` row.
3. **Classifier.** `classifyRead` throws "partial visibility" when a principal sees rows but none of the fixture's (`access-probe.ts:79-87`). Every own-row read policy (`user_roles`, `profiles` for role-less users) trips it. So user-keyed tables need an own/others read dimension, as flagged in the S-401 research (`:258`). Today's `noRole` read of `profiles` passes only because reads run before its own-profile write cells: an order dependency the file's docblock forbids.
4. **Invariant.** Every write row needs at least one allowed principal (`role-matrix-expectations.test.ts:34-36`). `user_roles` writes are denied to every app principal until S-406, so they need an exception like `othersProfileRows`, evidenced by the service-role path. The cells worth pinning are self-grant denials:
   - a role-less user inserting their own `admin` row;
   - an author or viewer updating their own row to `admin`.
5. **Catalog.** `livePosture` scans `public` only. Add `pg` assertions for `private`:
   - the DEFINER function: `prosecdef`, `proconfig` containing `search_path=`, its owner;
   - no `anon` EXECUTE (functions default to PUBLIC EXECUTE);
   - `private` absent from the exposed schemas.

   `pnpm db:types` covers `public` only, so `private` never reaches the generated types. That is correct.

**Size.** The matrix has 81 tests today. With 5 principals and an 18th table it grows to about 209, before the `user_roles` and own-row cells. Sign in the four principals with `Promise.all`, keep it one sequential file, and judge a red run against the integration lane's known ~1-in-5 baseline of transient 502s.

**The structural check.** The policy DO block rewrites all 16 tables uniformly, but behavioural cells cover only 5 representatives. Add a catalog assertion that every human table has exactly the four expected per-command policies. That is the structural proof for the other 11.

#### 4.2 Other suites

- **`account-self-service.integration.test.ts`** signs in role-less users and upserts their own profile. It stays green only with the own-row clause (§2.4).
- **`forgot-password-unauth.spec.ts`** ends on `/account?notice=recovery` as a role-less throwaway. It is already a de facto e2e check that `/account` must not redirect to the notice.
- **`password-recovery.integration.test.ts`** touches Auth only, so it is unaffected.
- **`solver-credential.integration.test.ts`** asserts nothing about the hook-off fallback, so it stays green. Its docblock (`:16-21`) becomes false: the fallback is now "no data", not "full read".
- **Service-role factories** call RPCs as `service_role`, which has no `auth.uid()`. **Keep all gating in RLS, never inside RPC bodies**, or every factory breaks.

#### 4.3 E2E and CI ordering

- **The e2e author is created after migrations, in CI and locally.** The `supabase-stack` action applies migrations and the seed; `pnpm test:e2e` then runs `pretest:e2e` → `scripts/provision-e2e-author.mjs` (`ci.yml:278`, `package.json:28`). So the backfill never sees the e2e author.
- **What the provisioner needs** (HC Fix 2, `health-check.md:281-302`):
  - take `data.user.id`;
  - on `email_exists` ([`provision-e2e-author.mjs:61-62`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/scripts/provision-e2e-author.mjs#L61-L62)), resolve the id with `findUserIdByEmail` from `provision-solver-user.mjs:53-62`;
  - upsert `{ user_id, role: "author" }`;
  - add a **loopback guard**. Once the script grants data access, a mis-pointed `SUPABASE_URL` would mint a hosted author whose password is a public literal.
- **No spec exercises the notice.** Covering it needs a role-less account with its own setup project and storageState. `e2e/CLAUDE.md:38-49` currently forbids UI sign-in in tests, outside password flows.
- **Deploy order** (`ci.yml:361-429`): build → `supabase db push` → `wrangler deploy`. Measured on 2026-08-18: about 45 s between migrations and the new Worker (`archive/2026-08-15-solver-deploy-lane/change.md:124-134`).

#### 4.4 Operations

- **Local dev.** After `db reset` there are zero users, because the seed creates none. Every local account made afterwards has no role. That includes Studio accounts and the developer's own.
- **Hosted, between S-403 and S-406.** A user created from the dashboard (`author-provisioning.md:91-102`) gets no access until someone assigns a role, and there is no in-app way to do that.
- **The operator tool.** `scripts/assign-role.mjs <email> <admin|author|viewer|none>`: Node with the service-role key, run from a human shell. It must refuse any account with `app_metadata.machine_role`. It follows the `provision-solver-user.mjs` precedent (`solver-credential.md:262-265`). It covers the developer-admin step and the gap until S-406.
- **Keep emails out of migrations.** A developer email inside a migration would commit PII, and the seed never reaches hosted.
- **No hosted auth-config change is needed.** Never `config push`.

### 5. Docs that become false

- **`CLAUDE.md:47`:** "No `SECURITY DEFINER` … no migration defines a DEFINER function today." It needs the recorded exception, plus the role rules drafted in `stack-assessment.md:296-310`, amended with the own-row carve-out from §2.4.
- **`CLAUDE.md:57`:** the factory needs the role option.
- **`README.md`:**
  - `:201`: the hook-off hazard;
  - `:487`: grants plus RLS now need the role layer;
  - `:500`: manual provisioning now needs a role;
  - Getting Started: local accounts need a role.
- **`docs/runbooks/author-provisioning.md`:** `:30-31`, `:45`, `:57-64`, `:91-102` (add a role step to the hosted flow), `:135-139`.
- **`docs/runbooks/solver-credential.md`:** `:117`, `:183-188`, `:292-296`, where "escalation to full database access" becomes "no data".
- **`docs/runbooks/calibration-campaign.md`:** `:25-29`, `:281`. The campaign account needs `author`.
- **`context/foundation/test-plan.md`:** `:67` (Risk #5 says "no access-control change"), `:139-142`, `:238`, `:332-336`, `:373`.
- **`e2e/CLAUDE.md:30-31`:** the provisioned author now gets the `author` role.
- **Bookkeeping:**
  - the roadmap and #144 say "16 policies" (now 17);
  - roadmap `:301` still says S-403 isn't ready for `/10x-plan`;
  - tracker #153 says the open questions block planning.

---

## Recommended option

### Shape

```sql
-- One role per user. Enum, so a new role is an additive ALTER TYPE … ADD VALUE, and TS derives
-- its Role type from the generated Database["public"]["Enums"]["app_role"].
create type public.app_role as enum ('admin', 'author', 'viewer');

create table public.user_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade, -- teardown relies on it
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()          -- moddatetime, as on profiles
);
-- RLS on; read own row only; anon: revoke all; authenticated: SELECT only (writes: S-406).

create schema private;                                  -- never in [api] schemas
grant usage on schema private to authenticated;         -- wrappers resolve the inner call by name

-- The single SECURITY DEFINER exception: reads only the caller's own row; owner postgres
-- (bypassrls), so it never re-enters user_roles' policies (probe C/D).
create function private.current_app_role() returns public.app_role
  language sql stable security definer set search_path = ''
  as $$ select role from public.user_roles where user_id = (select auth.uid()) $$;

-- Capability wrappers, INVOKER. Policies name capabilities, never roles; S-408's `active` flag
-- later changes current_app_role() alone.
create function private.can_read()  returns boolean language sql stable set search_path = ''
  as $$ select private.current_app_role() is not null $$;
create function private.can_edit()  returns boolean language sql stable set search_path = ''
  as $$ select private.current_app_role() in ('admin', 'author') $$;
create function private.is_admin()  returns boolean language sql stable set search_path = ''
  as $$ select private.current_app_role() = 'admin' $$;
-- revoke execute … from public; grant execute … to authenticated (all four).
```

**Policies.**
- **The 16 human `ALL` tables.** A DO block matches them by shape and creates four policies per table, all `to authenticated`:
  - `select using ((select private.can_read()))`;
  - `insert with check ((select private.can_edit()))`;
  - `update using / with check ((select private.can_edit()))`;
  - `delete using ((select private.can_edit()))`.
- **`profiles`.** SELECT becomes `user_id = (select auth.uid()) or (select private.can_read())`. Its own-row insert and update stay role-free.
- **Untouched:** the solver's two policies and `custom_access_token_hook`.

**Migrations.** Two files in one PR. Each applies atomically, and either order of failure is safe.
1. **`…_user_roles.sql`.** The enum, the table, grants and RLS, `private` and the four functions, and the backfill (`… where raw_app_meta_data->>'machine_role' is null`). Alone, it changes nothing for anyone, because the policies are still `using (true)`. So it is independently deployable if the PR needs splitting.
2. **`…_fail_closed_policies.sql`.** It contains, in order:
   - `set local lock_timeout = '5s'`;
   - an idempotent re-backfill (`on conflict do nothing`), covering users created between the two files if they ever apply in separate pushes;
   - the shape-matched rewrite and the `profiles` policy;
   - the post-condition asserts from §2.7;
   - a comment recording the DEFINER exception, as CLAUDE.md requires.

**App.**
- **Middleware.**
  - The role read runs concurrently with `getUser()` on non-public paths, `/_actions/*` included.
  - `locals.role: AppRole | null`.
  - A failed lookup gives an error page, never the notice.
  - Role-less page requests go to `/dashboard` (the notice), except `/account` and `/dashboard` themselves.
- **Shell.** `DashboardPage` renders the notice and hides Plans for a role-less user; `SidebarLayout` hides Plans too.
- **Actions.** `defineDomainAction({ requires = "edit" })`, with `FORBIDDEN` and `42501` mapped to it.

**Tests and ops.**
- The matrix: new principals, the classifier/probe/invariant changes in §4.1, the flip, and the `private` catalog checks.
- `createSignedInUser({ role })`.
- The e2e provisioner upsert plus its loopback guard.
- `scripts/assign-role.mjs`.
- A role-less e2e account and a no-access spec.

### Phases (proposal for `/10x-plan`)

| Phase | Delivers | Lanes |
|---|---|---|
| **1. Roles exist, nothing enforces them** | migration 1; `pnpm db:types`; factory `role`; provisioner upsert and loopback guard; `assign-role.mjs`; matrix gains `admin` / `author` / `viewer` pinned to **today's** posture, plus `user_roles` and own-row cells | all green |
| **2. The flip** | matrix expectations flipped (viewer writes denied, role-less denied, own-row cells, self-grant denials, the structural policy assertion) → **red**; then migration 2 → **green**; deny-drill evidence recorded in `change.md` | integration red → green, inside the PR |
| **3. The app follows the role** | `locals.role`, the page gate, the notice and nav, `requires` + `FORBIDDEN`, unit tests, `action-boundary` fix, role-less e2e account and no-access spec | all green |
| **4. Docs and rollout** | CLAUDE.md exception and role rules; README; three runbooks; test-plan; roadmap and #144 bookkeeping; the hosted checklist below | — |

**Hosted checklist** (in the PR description; nothing automated):
1. **Before merge, read-only, in the dashboard SQL editor.** Check:
   - the backfill set (`select email, raw_app_meta_data->>'machine_role' from auth.users`);
   - that `postgres` owns the public tables and has `rolbypassrls`;
   - that no solve is running.
2. **After deploy.** Check:
   - every human holds `author`;
   - the solver user holds nothing;
   - a hosted Generate → delivery smoke passes.
3. **Promote the developer.** `node scripts/assign-role.mjs <email> admin`, with the hosted key in a human shell.
4. **Until S-406:** every newly created hosted user gets a role through the same script, per the updated `author-provisioning.md`.

### Alternatives considered

- **Roles as JWT claims (A1).** Rejected again. A role change waits up to 3600 s for the next refresh, against an NFG of "next action". And a hook that reads a table fails every sign-in when it errors.
- **INVOKER helper now, DEFINER in S-406.** It works today (probe A). But it hands S-406 a seq-scan-dependent stack overflow (probe C) that local tests may not catch, to save one CLAUDE.md paragraph. Not recommended.
- **Three DEFINER helpers.** No USAGE grant is needed. But it is three exceptions instead of the one sanctioned exception (`stack-assessment.md:296-299`).
- **Policies call `current_app_role()` with inline role lists.** One DEFINER and no USAGE grant, but the capability map is copied into 68 policies, and any role change means rewriting them. A fallback if a USAGE grant on `private` is unwanted.
- **A `requires` field that must be declared, with no default.** Stronger typing, but it touches all 40 actions in the riskiest PR. The `edit` default is equally fail-closed and touches about 4.
- **RLS alone, no page gate or action guard.** No data leaks, but FR-410 fails (empty states inviting create, raw `42501`) and viewers get silent no-ops.

## Code References

- [`src/middleware.ts:9-19,31-53`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/middleware.ts#L31-L53): allowlist with reasons; `getUser()` then the public check; `/_` exempts actions.
- [`src/shared/lib/errors/domain-error.ts:9-16`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/shared/lib/errors/domain-error.ts#L9-L16): no `FORBIDDEN`.
- `src/shared/api/postgrest/to-domain-error.ts:15-19`, `sqlstates.ts:2-8`: only `23505` and `PGRST116` are mapped.
- `src/shared/lib/actions/define-domain-action.ts:13-26`, `require-session.ts:8-12`: the action wrapper; presence-only guard.
- [`src/actions/index.ts:20-30`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/actions/index.ts#L20-L30): the 40 actions, composed per slice.
- `src/app/layouts/SidebarLayout.astro:43-53`: own-profile read on every page.
- `src/_pages/dashboard/ui/DashboardPage.astro:6,9-21`: tiles from `GLOBAL_NAV_ITEMS`; the weak-password banner.
- `src/_pages/plan-detail/model/board-writes.ts:166-188`: optimistic write; rollback only on error.
- `src/_pages/plan-detail/api/generation-stop.ts:72-115`, `generation-reclaim.ts:49-76`, `generation-delivery.ts:221-583`: the human `generation_jobs` writes, incl. page-load ones.
- [`supabase/migrations/20261017170524_profiles.sql:56-76`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/supabase/migrations/20261017170524_profiles.sql#L56-L76): the 17th `using (true)`; the eight-privilege revoke precedent.
- [`supabase/migrations/20260602185012_minimal_domain_schema.sql:163-174`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/supabase/migrations/20260602185012_minimal_domain_schema.sql#L163-L174): the policy template being replaced.
- `supabase/migrations/20260810200934_custom_access_token_hook.sql:25-30`: the hook-off hazard S-403 closes; `:33-34` still says `config push` (applied, left as is).
- [`src/test/role-matrix-expectations.ts:29,44-162`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/test/role-matrix-expectations.ts#L29): principals, cells, grants.
- `src/test/access-probe.ts:79-87,141-145`: the partial-visibility throw; the `fixtureKey` fallback.
- [`src/test/factories/create-signed-in-user.ts:31`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/test/factories/create-signed-in-user.ts#L31), [`teardown.ts:29`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/src/test/factories/teardown.ts#L29): S-403's extension points.
- [`scripts/provision-e2e-author.mjs:53-71`](https://github.com/dobrek/ib-timetable-planner/blob/30c46e8018e0a41bb22fd1fb064f4da5e46f4b3f/scripts/provision-e2e-author.mjs#L53-L71): create-only; the `email_exists` path has no id.
- `scripts/provision-solver-user.mjs:53-62,86-111`: `findUserIdByEmail`; the operator-script template.
- `.github/workflows/ci.yml:210-278,361-429`: e2e provisioning after migrations; deploy order.

## Architecture Insights

- **Silent denial is the defining hazard of this change.**
  - RLS answers "no" to UPDATE and DELETE with zero rows, and the app reads zero rows as success in about 20 places.
  - So the proof that authors are untouched must come from read-back-judged tests (the matrix) and structural catalog assertions, never from "the lanes stayed green".
  - The same fact makes the action guard necessary for viewers.
- **One mechanism, two layers, one source of truth.**
  - Enforcement is RLS through `private.current_app_role()`; the action guard and page gate only give clean errors and UX.
  - The role→capability map exists twice, in SQL wrappers and in `shared/lib/access`. The matrix (SQL side) and unit tests (TS side) pin both. The enum's generated type keeps the role *names* single-sourced.
- **Fail-closed covers misconfiguration too.**
  - A missing role row, an unrecognised `machine_role`, a disabled hook, and a helper owner without bypass all degrade to "no data", never "all data".
  - That is the reverse of today's hook-off behaviour, and consistent with the repo's other fail-closed gates: the hook allowlist, the solver's `assert_role`, launcher guards.
- **Capability-named policies are the seam for later slices:**
  - S-408 (`active` flag) changes `current_app_role()` alone;
  - S-405 changes only UI;
  - S-406 adds `user_roles` write policies through `is_admin()`;
  - a per-plan model (B) could grow a `plan_id` argument.

## Historical Context (from prior changes)

- `context/changes/user-managment-research/research.md`: Model A (global roles) and A2 (live lookup) chosen; probe 2 settled claim staleness; the backfill and bootstrap decisions (`:500-503`).
- `context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/`: the flip recipe (`plan.md:7-9,107-108,354`; `research.md:263-277`); deferred to S-403: `anon` residue, default ACL on new tables, action-level rows / `FORBIDDEN`, e2e roles, SQL lint (`plan.md:110-124`); "no write-only cells" (`reviews/impl-review.md:129`); the deny drill as the shape S-403 must produce (`change.md:21-27`).
- `context/archive/2026-10-16-account-self-service/`: `profiles` shares `user_roles`' key; own-row reads must stay role-free (`research.md:243-246`); the classifier needs an "own" outcome (`:258`); `/account` and the account actions need a role-less tier (`plan.md:553`); "S-403 introduces the first, recorded" DEFINER exception (`plan.md:47`).
- `context/archive/2026-10-19-forgot-password-by-email/plan.md:841`: `/account?notice=recovery` must stay reachable without a role.
- `context/foundation/stack-assessment.md:296-310,329-331,343` and `health-check.md:257-302,386-401`: the drafted CLAUDE.md role rules; HC Fix 1/2/7.
- `context/archive/2026-08-20-job-aware-container-lifecycle/research.md:587-589`: an earlier RLS narrowing was shipped and reverted over `RETURNING`; "any RLS change here must re-run that probe". Re-run here (§2.2): clean for authors.
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/`: probe 8 (a hook misfire returns real plan names), which S-403 turns into "returns nothing"; "a role-less policy scopes to PUBLIC" (`reviews/plan-review.md:62`), so every policy names `to authenticated`.
- `context/archive/2026-06-01-minimal-domain-schema/plan.md:471-478`: `rls_policy_always_true` was accepted "until multi-tenant or anonymous sign-ins". S-403 retires that warning for human tables.

## Related Research

- `context/changes/user-managment-research/research.md`: the umbrella feasibility study this one verifies.
- `context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/research.md`: harness design, rate limits, the probe classifier.
- `context/archive/2026-10-16-account-self-service/research.md`: `profiles` design and its S-403 notes.
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md`: the machine credential and hook spike.

## Open Questions

Decisions for `/10x-plan`. Each has a recommendation; none blocks planning.

1. **Helper shape.** One DEFINER function plus INVOKER wrappers, with USAGE on `private` (recommended), or policies calling `current_app_role()` directly?
2. **Role type.** Enum `public.app_role` (recommended: additive extension, generated TS type) or `text` + CHECK? Widening a CHECK means dropping it, which strains the additive-only rule.
3. **Guard default.** `requires` defaulting to `edit` (recommended) or a mandatory field on all 40 actions?
4. **Notice location.** Render it on `/dashboard` (recommended: sign-in and `/` already land there, and it keeps the weak-password banner) or a dedicated `/no-access` route, which needs its own reason line?
5. **Role-lookup failure.** An error page (recommended) or treat it as no role?
6. **HC Fix 7 (SQL lint gate).** The roadmap hands it to S-403 (`:301`). It must lint `private` too, and first handle `clone_plan`'s temp-table false positive. Recommend a separate small PR, to keep the riskiest diff on policies.
7. **E2E no-access coverage.** A provisioned role-less account with its own setup project (recommended; needs an `e2e/CLAUDE.md` rule) or integration-level coverage only?
8. **`user_roles` columns now.** Only `user_id`, `role` and timestamps (recommended). S-406 owns the access-change record ("who made it and when"), and S-408 owns `active`.
9. **Hosted assumptions to confirm before merge, read-only:** `postgres` owns the public tables and has `rolbypassrls`, and the backfill set is as expected. A mismatch fails closed, which still locks authors out, so check first.

## Probe evidence

- **Environment.** Local stack, PG 17.6, Supabase CLI 2.117.0. Accessed through `docker exec supabase_db_ib-timetable-planner psql -U postgres`, simulating PostgREST with `set local role authenticated` plus `request.jwt.claims`.
- **Scripts.** In the session scratchpad (temporary, not committed): `setup.sql`, `run_proto.sql`, `run_p4.sql`, `run_p5*.sql`, `run_perf.sql`, `verify2.sql` (probes A–F), `verify3.sql` (probe G).
- **Isolation.** Every probe ran in `BEGIN … ROLLBACK`, with writes inside always-rolled-back subtransactions.
- **End state verified.** 21 public policies; `to_regnamespace('private')`, `to_regclass('public.user_roles')` and `to_regtype('public.app_role')` all null; row counts unchanged.
- **Docs.** Supabase RLS documentation (Context7 `/supabase/supabase`): DEFINER helpers belong in a non-exposed `private` schema with `search_path = ''`; the owner `postgres` has `bypassrls`; `grant usage on schema private to authenticated` in the recursion-breaking example; wrap helpers in `(select …)` for initPlan caching; always name `to authenticated`.
