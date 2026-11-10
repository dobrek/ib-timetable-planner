---
date: 2026-11-08T10:07:11+01:00
researcher: Claude (Opus 5.5)
git_commit: e2c8b2742aedbe42e705234477ec120d80900cb0
branch: s-409-admin-creates-an-account-with-a-temporary
repository: ib-timetable-planner
topic: "Feasibility of S-409: an admin creates an account with a temporary password that must be changed at first sign-in"
tags: [research, codebase, auth, users, edge-function, supabase-server, gotrue, rls, access-changes, ci, create-account-fallback]
status: complete
last_updated: 2026-11-08
last_updated_by: Claude (Opus 5.5)
---

# Research: Feasibility of S-409, create an account with a temporary password

**Date**: 2026-11-08T10:07:11+01:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: [`e2c8b27`](https://github.com/dobrek/ib-timetable-planner/tree/e2c8b2742aedbe42e705234477ec120d80900cb0)
**Branch**: s-409-admin-creates-an-account-with-a-temporary
**Repository**: ib-timetable-planner

## Research Question

> Please check the feasibility of implementing this feature: name the challenges we could face and suggest solutions.

The feature is roadmap slice **S-409** ([`roadmap.md:239-250`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/context/foundation/roadmap.md#L239-L250), issue [#150](https://github.com/dobrek/ib-timetable-planner/issues/150), PRD FR-403): as a fallback when an invitation cannot reach someone, an admin creates an account with a temporary password from the Users page. The person must change it at first sign-in, and the account appears in the Users list.

## Summary

**Verdict: feasible, with no blocker on the local stack.** A throwaway stack ran the whole flow, using CI's own start command and every real migration plus the proposed one: 51 of 51 checks passed ([§ Spike evidence](#spike-evidence)). Prerequisites S-401, S-406 and F-402 are done. Hosted cannot be proven from here, so the first step is a short hosted check ([C1](#c1-hosted-behaviour-cannot-be-proven-from-the-repo)).

The feature itself is small. Most of the cost is around it: a second TypeScript runtime, CI and deploy changes, and the role-matrix tests.

**Three things the existing documents get wrong or leave open:**

1. **The flag should not live in `app_metadata`.** S-401's research says it should ([`research.md:232`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/context/archive/2026-10-16-account-self-service/research.md#L232)). RLS cannot read it live, and clearing it needs the secret key. A column on `user_directory` avoids both ([C2](#c2-where-the-flag-lives)).
2. **Admin `createUser` does not enforce the 15-character floor** on GoTrue v2.196.0. S-401's research says it does ([`research.md:165`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/context/archive/2026-10-16-account-self-service/research.md#L165)). A 12-character password was accepted with `GOTRUE_PASSWORD_MIN_LENGTH=15` set. Server-generated passwords make this moot ([C6](#c6-account-creation-is-not-atomic)).
3. **Two runbooks promise something the slice does not include.** They say an admin-triggered reset moves off the dashboard "until S-409", while FR-403 and the roadmap only mention creation ([D1](#decisions-needed)).

**Challenges, most consequential first:**

| # | Challenge | Failure if ignored | Suggested solution | Confidence |
|---|-----------|--------------------|--------------------|------------|
| C1 | Hosted behaviour cannot be proven from the repo | Green CI, every create fails in production | Check hosted first, with a throwaway function | Open until run |
| C2 | Where the flag lives | Flag is stale, or cleared and then restored | `user_directory.must_change_password` | Run, source |
| C3 | Clearing the flag only on a real change | If hosted has DB encryption on, first sign-in lifts the flag | Trigger on the password write, plus a hosted check | Run, source; hosted open |
| C4 | Middleware alone is not enforcement | A pending user reaches data around the app | `private.current_app_role()` returns null while pending | Run |
| C5 | The last-admin guard counts a pending admin | School left with an admin who never signed in | Exclude pending admins from the guard's count | Reasoned, not run |
| C6 | Creation spans several writes, not one transaction | An account holds a known password but no flag | Generate the password server-side and reveal it last | Run |
| C7 | Dead ends: lost password, timed-out create | Admin is stuck on `email_exists`, developer needed | Re-issue for pending accounts only | Run |
| C8 | `auth: 'user'` does not mean "human", and `verify_jwt` is no gate | The solver's token could create accounts | Live admin check before the admin client | Run |
| C9 | Audit records attribute secret-key writes to the Operator | Wrong actor on the Users page | Write the role under the admin's own session | Run |
| C10 | A second runtime enters the repo | `pnpm check` and ESLint break on Deno files | Toolchain boundary, before the first function file | Docs |
| C11 | CI excludes the edge runtime | Passes locally, fails in CI | Re-include it; add a warm-up request | Partly run |
| C12 | No rollback, and dependencies can float | A routine merge changes what holds the secret | Exact pins; deploy before the Worker | Docs; lockfile open |
| C13 | Access claims must go through the role matrix | Large test diff, easy to under-scope | One new principal: a pending admin | Counted |
| C14 | Handling the password itself | It leaks through logs or browser state | One-time reveal, never logged or stored | Reasoned |
| C15 | Temporary passwords never expire | One sits in a chat message indefinitely | Accept it, and show the state on the Users page | Decision |
| C16 | Overlap with S-408 and S-411 | One slice reverts the other's function body | Re-create from the latest live definition | Recorded rule |

"Run" means observed in the probes below. "Source" means read in GoTrue or SDK source. "Docs" means read only.

## Recommended design

Each part below was run in the spike unless marked otherwise.

```
Users page island
  └─ callAction(createAccount)              JSON, never a form post
       └─ Astro Action, requires: manage_users    a courier: no secret, no new Worker env
            └─ supabase.functions.invoke("admin-users")    sends the admin's own JWT
                 └─ Edge Function (Deno, @supabase/server)
                      1. withSupabase({ auth: "user" })    verifies the JWT against JWKS
                      2. ctx.supabase.rpc("own_app_role")  live check, must be "admin"
                      3. supabaseAdmin: createUser         generated password
                      4. supabaseAdmin: set the flag       user_directory
                      5. supabaseAdmin: account_created    explicit verified actor
                      6. ctx.supabase: grant the role      S-406's trigger attributes it
                      7. return the password               only now; on failure, undo
```

The migration, as run in the spike, minus its logging:

```sql
alter type public.access_change_kind add value if not exists 'account_created';

alter table public.user_directory add column must_change_password boolean not null default false;

-- Re-create from the latest live definition (lessons.md). S-408 changes this function too.
create or replace function private.current_app_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select r.role
    from public.user_roles r
   where r.user_id = (select auth.uid())
     and not exists (
       select 1 from public.user_directory d
        where d.user_id = r.user_id and d.must_change_password
     )
$$;

create function private.clear_must_change_password()
returns trigger language plpgsql set search_path = ''
as $$
begin
  update public.user_directory set must_change_password = false
   where user_id = new.id and must_change_password;
  return null;
end;
$$;

create trigger user_directory_clear_must_change
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.clear_must_change_password();
```

A real migration also needs `lock_timeout`, a revoke of `EXECUTE` on the trigger function, a comment update and post-conditions, following [`user_directory.sql:50-55`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/supabase/migrations/20261105073614_user_directory.sql#L50-L55) and its neighbours.

**App side (reasoned from the code, not run):**

- **Access state.** Add `{ status: "password_change_required" }` to [`access-state.ts:9`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/shared/config/access-state.ts#L9). Because the role read returns null while pending, the middleware reads the caller's own flag only in that null branch, so a person holding a role pays nothing extra. A failed flag read means `unavailable`, never `none`.
- **Page gate.** Add a redirect decision to [`role-gate.ts:19-24`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/shared/config/role-gate.ts#L19-L24), sending every gated page to `/account`. `/account` is already exempt ([`:30`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/shared/config/role-gate.ts#L30)). No public route is added, and `updatePassword` already declares `session`.
- **Account page.** Show a banner beside [`AccountPage.astro:27`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/_pages/account/ui/AccountPage.astro#L27), driven by `locals.access` rather than a query string, so it shows however the person arrives.
- **Users page.** Add the flag to the read at [`loader.ts:21`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/_pages/users/api/loader.ts#L21), a third state at [`user-rows.ts:30`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/_pages/users/model/user-rows.ts#L30) and [`UserTable.tsx:46-47`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/_pages/users/ui/UserTable.tsx#L46-L47), and a secondary "create account" control, so S-410's invite can become the primary path without rework (PRD: fallback only).
- **No Worker change beyond the action.** No new secret, no `wrangler.jsonc` change, no composition-root injection, because the session client already reaches the function. The decision of record at [`deploy-plan.md:141`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/context/deployment/deploy-plan.md#L141) stands. This is simpler than the `getAdminTransport` injection the earlier research sketched.

## Detailed Findings: challenges and solutions

### C1. Hosted behaviour cannot be proven from the repo

**Challenge.** CI runs a local stack, so these stay open until someone checks hosted:

- whether the default secret key is named `default`, which the SDK's admin client needs, or it fails with `MISSING_DEFAULT_SECRET_KEY`;
- hosted's Deno version (local is 2.1.4-compatible);
- how `verify_jwt` behaves there. Supabase's docs conflict: `functions/auth.mdx` says leave it on, while `migrating-to-new-api-keys.mdx:136,147` and `auth/signing-keys.mdx:44` say turn it off;
- whether DB encryption is on ([C3](#c3-clearing-the-flag-only-on-a-real-change));
- whether region pinning works on this plan;
- the roadmap's standing unknown, that ES256 is the current key and the new API keys are enabled ([`roadmap.md:248`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/context/foundation/roadmap.md#L248)).

Checked here: hosted's JWKS publishes exactly one ES256 key. That does not show it is the current signing key.

**Solution.** A short developer-run check before building the UI:

1. In the dashboard, confirm the current signing key and the secret key's name.
2. Run a read-only count, which returns no hash content: `select count(*) filter (where encrypted_password like '{%') from auth.users;`.
3. Read hosted's GoTrue version from `/auth/v1/health` ([`hosted-auth-settings.md`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/docs/runbooks/hosted-auth-settings.md)).
4. Deploy a throwaway function that returns `Deno.version` and which env names are present. Call it with no token, a viewer's token and an admin's token, then delete it.

After the real merge, run one hosted smoke test: a created account's flag must survive its first sign-in, then clear on the change.

### C2. Where the flag lives

**Challenge.** GoTrue has no forced-change concept at all (grep across v2.196.0 and master finds nothing). The flag needs a home that only the system can write and that RLS can read live.

| Option | Problem |
|---|---|
| `user_metadata` | Writable by the user (`updateUser({ data })`), so the user could clear it. |
| `app_metadata` (S-401's note) | The JWT claim is stale for up to an hour, and `auth.users` is not exposed, so RLS cannot read it live. Clearing needs the secret key, so the pending user would need a "clear my flag" endpoint that cannot verify a real change. |
| `app_metadata`, stripped by a BEFORE trigger | Unsafe: GoTrue writes the whole in-memory map back ([`user.go:246-259`](https://github.com/supabase/auth/blob/v2.196.0/internal/models/user.go#L246-L259)), from `/verify` ([`verify.go:174,276`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/verify.go#L174)) and from `adminUserUpdate` ([`admin.go:353`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/admin.go#L353)), which can restore a stripped key. The S-406 mirror would also miss it: its trigger is `OF email, raw_app_meta_data` ([`user_directory.sql:125-133`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/supabase/migrations/20261105073614_user_directory.sql#L125-L133)), and the password write names neither column. |
| A new user-keyed table | Works, but needs its own policies and matrix entries for one boolean. |
| **`user_directory.must_change_password`** | **Recommended.** System-owned, and `authenticated` holds SELECT only. The owner reads their own row and an admin reads every row. The mirror's upsert names its columns ([`:108-111`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/supabase/migrations/20261105073614_user_directory.sql#L108-L111)), so it leaves this one alone (run: the flag survived an email change). |

**Accepted side effect.** RLS is row-level, so every role holder can read a colleague's flag, as they can already read the email. Run: a viewer read it. It is low-sensitivity.

The table's comment says only its Auth trigger writes it, so the function becomes a recorded second writer, under the secret key.

### C3. Clearing the flag only on a real change

**Challenge.** Clearing must cover both ways of choosing a password (account page, reset link) without letting the user clear it any other way. A trigger on the password write does that, except for one trap. GoTrue can rewrite the hash at sign-in, and its own comment says "this is not a password change, just encryption change" ([`token.go:139-150`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/token.go#L139-L150)). That write fires only when `Security.DBEncryption.Encrypt` is true ([`user.go:506`](https://github.com/supabase/auth/blob/v2.196.0/internal/models/user.go#L506)), and in that mode a newly created account's first sign-in triggers it. The default is false.

Under default config this cannot misfire. Run: the first sign-in left both hash and flag alone. Hosted's setting is unknown.

**Solution.** Use `AFTER UPDATE OF encrypted_password` with the `WHEN` comparison above, and record the assumption in the migration. C1's count (a `{`-prefixed hash means encryption is on) and the hosted smoke test verify it.

If hosted does have encryption on, switch to `AFTER UPDATE OF reauthentication_token ... WHEN (hash changed)`. Only `UpdatePassword` names that column and changes the hash ([`user.go:449`](https://github.com/supabase/auth/blob/v2.196.0/internal/models/user.go#L449)), and it also fired on the real change in the spike. It stays second choice because it couples to an internal column list. If upstream changed that list, pending users could never clear the flag.

**Keep the trigger non-raising.** A raising trigger on `auth.users` fails GoTrue's write ([`user_directory.sql:29-37`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/supabase/migrations/20261105073614_user_directory.sql#L29-L37)), which here means every password change, the solver's included. Creating it also takes a lock on `auth.users` that holds up sign-ins, so cap the wait as that migration does.

### C4. Middleware alone is not enforcement

**Challenge.** A redirect only covers pages. Actions sit under the public `/_` prefix ([`middleware.ts:22-24`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/middleware.ts#L22-L24)), and the `@supabase/ssr` cookies are not HttpOnly ([`hosted-auth-settings.md:17`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/docs/runbooks/hosted-auth-settings.md#L17)). CLAUDE.md also says RLS is the enforcement and app checks only make a denial clear.

**Solution.** Have [`private.current_app_role()`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/supabase/migrations/20261028140939_user_roles.sql#L88-L96) return null while pending. Every capability wrapper reads through it, so one function change fails everything closed. `allows()` already returns false for the new state, so actions refuse without any new code.

Run, with tables analyzed so a seq scan was possible (the condition under which S-403 saw recursion):

- A pending admin reads 0 plans, cannot write, and gets 403 from the function.
- They can read their own directory row, which is how the middleware tells pending from role-less.
- They cannot clear their own flag (`42501`) or change their own role.
- After a real change, **the same session** holds the role without signing in again.
- The role lookup took about 0.1 ms, so the <200 ms budget is unaffected.

Forcing a change does not stop whoever first holds the password. What it guarantees is that the admin no longer knows the password once the person is in.

### C5. The last-admin guard counts a pending admin

**Challenge.** The guard counts `user_roles` rows only ([`role_management.sql:168-172`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/supabase/migrations/20261105080343_role_management.sql#L168-L172)). An admin can create a second admin, then step down, leaving an admin who has never signed in. If that temporary password is lost and email is the reason for the fallback, recovery falls to the operator. FR-408 says "active admin".

**Solution.** Exclude pending admins from the guard's count, re-creating the function from its latest definition. S-408 must already change the same guard for deactivated admins. **Not exercised in the spike**, so it needs its own test.

### C6. Account creation is not atomic

**Challenge.** `createUser` is one transaction ([`admin.go:491-565`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/admin.go#L491-L565)), but the flag, record and role writes follow separately. The worst case is an account with a known password and no flag.

**Solution.** Generate the password inside the function and return it **last**. On any failure, delete the account and return no password, so even a failed delete leaves a password nobody holds. Run: with the flag write forced to fail, the answer held no password and the account was gone.

That depends on server-side generation, so an admin-typed password is out. Generation also settles the floor: there is no strength check in `adminUserCreate` on v2.196.0, and v2.197.0 adds one. Use 24 characters from an unambiguous alphabet, with rejection sampling. The spike's modulo version has a small bias and should not be copied.

### C7. Dead ends

**Challenge.** The fallback exists for people email cannot reach, so "forgot password" cannot rescue them, and delete arrives only with S-411. Three realistic failures then have no in-app way out:

- The person loses the temporary password.
- The Worker times out after the function succeeded, so the password is lost and a retry returns `email_exists`.
- The admin mistypes the email.

**Solution.** Add a re-issue operation, **for accounts still pending only**. Run:

- The old password stopped working and the new one works.
- The flag ended on, even though the password write clears it in between. Set it after the password write.
- It was refused on an account that has already chosen a password, on a machine user and on an active admin, so it cannot be used to take over an account. Machine users are protected by construction, because they are never pending.

For a mistyped email, echo the address in a confirmation and document dashboard deletion until S-411. See [D1](#decisions-needed) for the scope decision.

### C8. `auth: 'user'` does not mean "human", and `verify_jwt` is no gate

**Challenge.** The SDK verifies the signature and has no `role` check. Run: the solver's machine token passed the SDK and reached the handler. Separately, a function with `verify_jwt = true` let a request with no user token through on the local stack. A runtime log line suggests local Kong swaps the publishable key for a legacy anon JWT (inferred, not confirmed).

**Solution.** Call `ctx.supabase.rpc("own_app_role")` first and require `admin` before touching `ctx.supabaseAdmin`. Run: the machine token got `42501` and then 403. Prefer this to the stack assessment's "query `user_roles`" ([`stack-assessment.md:343-346`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/context/foundation/stack-assessment.md#L343-L346)), written before S-406 let an admin read every role row.

Set `verify_jwt = false` explicitly in `config.toml`: if the key is absent, an existing function keeps its remote value. Tests should assert on status, not body shape, because the platform and the SDK use different error bodies.

Machine users stay untouchable: creating with a machine user's email returns `email_exists`, and nothing changes (run). Never accept `app_metadata` from input.

### C9. Audit attribution

**Challenge.** The record's trigger takes the actor from `auth.uid()`, so a secret-key write shows as Operator ([`role_management.sql:268`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/supabase/migrations/20261105080343_role_management.sql#L268)). The roadmap therefore says this component must write its own records ([`roadmap.md:249`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/context/foundation/roadmap.md#L249)).

**Solution.** Most of this does not need solving. Write the role through `ctx.supabase`, the admin's own session, and S-406's trigger records the right actor. Write only the new `account_created` record through the secret key, with `actor_id` taken from the verified token. An admin's direct insert is refused (`42501`) by design. Run: the two records read `account_created|user|<admin>` and `role_granted|user|<admin>`, and neither shows Operator.

`LastChange` reads "Changed by <who>" and works unchanged. "Created by" wording would need the loader to read `kind`.

### C10. A second runtime enters the repo

**Challenge.** `tsconfig.json` includes everything but `dist` ([`:4`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/tsconfig.json#L4)), so `npm:` imports would break `pnpm check` and ESLint. Nothing type-checks Deno code today.

**Solution.** Health-check Fix 6 already lists this ([`health-check.md:366-384`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/context/foundation/health-check.md#L366-L384)): exclude `supabase/functions` from tsconfig and ESLint, pin Deno in `mise.toml`, and add a script and a CI `verify` step. Three additions:

- `lefthook.yml:6` hands staged `.ts` files to ESLint, so exclude functions there too.
- Update the `/verify` skill.
- Don't paste the stack assessment's CLAUDE.md text verbatim: its last bullet is stale on Mailpit, which CI now keeps.

### C11. CI excludes the edge runtime

**Challenge.** [`action.yml:48`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/.github/actions/supabase-stack/action.yml#L48) excludes it, and the action serves both the integration and e2e lanes. The image is 686 MB, and the runtime likely fetches `npm:` dependencies on the first request, which would add flakiness to an already flaky lane.

**Solution.** Remove it from `-x`. Run with that exact change: boot took 28 s with cached images, every migration applied, and `supabase start` served the function without `functions serve`. Add a warm-up request to the action, so a suite's first call doesn't pay for the download. **Not measured:** an empty-cache first request, and the image pull on a runner. Measure both in the first CI run. The function list is reported as fixed at bring-up (CLI source, not run), so note in the README that adding a function needs a stack restart.

### C12. No rollback, and dependencies can float

**Challenge.** No function rollback was found, so plan on rolling forward. Because the workflow has no path filters, every merge would re-deploy the function. Without a lockfile, its transitive dependencies could change on any merge, including on the one component holding the secret key. A lockfile may not be simple either: the runtime embeds Deno 2.1.4, whose lockfile parser reportedly handles up to v4, while current Deno writes v5.

**Solution.**

- Add `pnpm exec supabase functions deploy admin-users --project-ref <ref>` after `db push` and before Wrangler ([`ci.yml:378-384`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/.github/workflows/ci.yml#L378-L384)). Name the function, and avoid `--prune`. A failed function deploy then stops the job before the Worker ships, which is safe because the migrations are additive.
- Pin exact versions in `deno.json`, and add a Dependabot `deno` entry. `pnpm audit` cannot see these dependencies.
- **Open:** whether a lockfile written by Deno 2.1.4 works with real imports, and what deploy does with it. The spike's v5 file was served beside a function with no npm imports, which settles nothing. Decide this during the toolchain work.

CLI 3.0.0 shipped on 2026-11-02, and the docs have moved with it; `^2.117` holds it off. Read deploy flags from the installed CLI.

### C13. Access claims must go through the role matrix

**Challenge.** CLAUDE.md says an access change starts as a red diff to `role-matrix-expectations.ts`. A new principal touches [`Principal`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/test/role-matrix-expectations.ts#L58), `PRINCIPAL_NOTES` and 14 tables, about 70 cells, all compile-enforced, plus the sign-in harness.

**Solution.** Add one principal, `pendingAdmin`: a user holding an `admin` row and the flag. It is the strongest claim available, and its outcomes should match `noRole`'s closely, so most cells are mechanical. Extend `createSignedInUser` with the flag.

For e2e, a throwaway user pattern already exists (`users.admin.spec.ts`), but the rules name only password-changing unauth specs and role-changing admin specs ([`e2e/CLAUDE.md:92-97`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/e2e/CLAUDE.md#L92-L97)), and only setup files may drive the sign-in UI (`:60-62`). This spec needs both, so amend that file.

### C14. Handling the password itself

- **Transport.** Call through the island's JSON path (`callAction`), not a form-post action, whose result Astro can carry across a redirect. Check Astro 7's docs at plan time.
- **Logs.** Never log the body, in the function or the action. Keep it out of `DomainError` messages.
- **Browser.** Hold it in component state only, show it once with a copy button, and clear it on close. Say plainly that it won't be shown again.
- **Email side effect.** The change sends a "your password was changed" email on hosted, which counts against Resend's daily cap ([`hosted-auth-settings.md:42`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/docs/runbooks/hosted-auth-settings.md#L42)). A failed send doesn't block the change ([`user.go:231-235`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/user.go#L231-L235)), which matters for exactly these people.

### C15. Temporary passwords never expire

**Challenge.** GoTrue has no password expiry, and the PRD asks for none. Real expiry would need a scheduled scramble or a sign-in block, because refusing data access alone doesn't stop the holder changing the password and getting in.

**Solution.** Accept it for a one-school product, limit exposure through the role chosen, and show "Waiting for first sign-in" on the Users page so the admin can see stale accounts. See [D3](#decisions-needed).

### C16. Overlap with S-408 and S-411

S-408 is also planned to change `private.current_app_role()` and the guard, and it can run in parallel ([`user_roles.sql:14`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/supabase/migrations/20261028140939_user_roles.sql#L14), [`lessons.md`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/context/foundation/lessons.md)). Whichever lands second must copy the body the first one left. S-410 and S-411 should add routes to the same function: Supabase's guidance favours a "fat" function, and the function's `op` shape allows it.

The merge deploys, so the no-solve-running rule applies. A function deploy itself does not roll the container.

## Decisions needed

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| D1 | Does S-409 cover re-issuing and resetting? The runbooks say an admin-triggered reset waits for S-409 ([`hosted-auth-settings.md:24`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/docs/runbooks/hosted-auth-settings.md#L24), [`author-provisioning.md:131`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/docs/runbooks/author-provisioning.md#L131)); FR-403 and the roadmap don't. | (a) create only, and fix the runbooks; (b) add re-issue for pending accounts; (c) also reset any confirmed account | **(b)**, moving (c) explicitly to S-411 and correcting both runbook lines. (a) leaves C7's dead ends. (c) lets an admin take over a colleague's account, a trade-off that deserves its own decision. |
| D2 | Is the role chosen at creation? | (a) in the create form; (b) created role-less, then assigned on the page | **(a)**, matching S-410. With (b), someone can finish first sign-in and hit "no access yet". Role-less should remain selectable. |
| D3 | Do temporary passwords expire? | (a) no, with the state visible; (b) yes | **(a)**, per C15. It should be recorded as an accepted residual in the PRD. |

C3's trigger form follows from C1's hosted check and is not a preference.

## Suggested order

1. **Hosted check** (C1), developer-run. It can change C3 and C12.
2. **Toolchain and CI** (C10, C11, C12), with a function skeleton.
3. **Access model:** matrix diff red, then the migration and guard (C2 to C5, C13).
4. **The function** with its integration suite, at the HTTP surface (C6 to C9).
5. **The app:** action, middleware state, account banner, Users page, e2e.
6. **Docs:** CLAUDE.md's function section, README, both runbooks, roadmap status; then the hosted smoke test.

## Spike evidence

**Isolation.** Two local-only probes:

1. Against the running stack: throwaway users, deleted afterwards (0 left), and a SQL spike inside `BEGIN … ROLLBACK` (column and trigger confirmed absent afterwards).
2. A separate stack with its own project id and ports, booted with CI's `supabase start -x` list minus `edge-runtime`. It was fully removed afterwards (0 containers, 0 volumes), and the running stack stayed up throughout.

**Versions.** CLI 2.117.0, GoTrue v2.196.0, edge-runtime v1.74.3 (Deno 2.1.4 compatible), `@supabase/server` 1.9.2. The caller was an `@supabase/ssr` server client with an in-memory cookie jar, running under Node.

| Area | Observed |
|---|---|
| Boot | 28 s with cached images; all migrations plus the proposed one applied; `alter type … add value` is fine in a migration that doesn't use the value |
| Runtime | `export default { fetch }`, per-function `deno.json`, and `SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_JWKS` all present; `SUPABASE_URL` is `http://kong:8000`, so don't pin `issuer` from it |
| Refused | Publishable key alone or as Bearer (401 `UNUSABLE_CREDENTIAL`), forged token (401 `INVALID_JWT`); role-less, viewer, author (403); machine token (403, via `42501`) |
| Errors | `functions.invoke` surfaces `FunctionsHttpError`, with a readable `context` |
| Create | Password returned once; flag set; two correct records; visible in the Users read; duplicate returns 409 `email_exists`, with the existing and machine accounts untouched |
| Pending user | Sign-in works; hash and flag unchanged by it; `own_app_role` null; 0 plans; no writes; can't clear the flag, change own role or reach the function |
| Change | Same password refused (`same_password`); short password refused (`weak_password`); real change clears the flag; same session gains the role; old password fails |
| Reset path | `/verify` leaves the flag on; choosing a password clears it |
| Pending admin | 403 until the change, 200 after |
| Re-issue | Works on pending; refused on confirmed, machine and active admin accounts |
| Failure | Forced flag failure: 500, no password, account gone |
| Latency (warm) | 6 to 50 ms for a role check; 96 ms for a create. Not a cold start |
| Admin floor | 12-character password accepted by `createUser` with `GOTRUE_PASSWORD_MIN_LENGTH=15` |
| Password write | GoTrue's `UPDATE` names `encrypted_password` and `reauthentication_token`, and not `raw_app_meta_data` (read from `pg_stat_statements`) |

## Not verified

- **Everything on hosted** (C1).
- **The last probe round was declined**, so these are unmeasured: an empty-cache cold start, a lockfile with real imports (Deno 2.1.4's or current), `deno check` and `deno lint` over the function, a `region` option, and adding a function after boot.
- **`functions.invoke` inside workerd.** It ran under Node. The risk looks low, since PostgREST calls use the same fetch wrapper, and e2e would prove it.
- **The DB-encryption rewrite path.** Read in source, not executed.
- **The app-side changes and the guard change** (C5). Reasoned from the code, not run.

## Code References

- [`src/middleware.ts:43-67`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/middleware.ts#L43-L67): role read and page gate.
- [`src/shared/config/access-state.ts:9-15`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/shared/config/access-state.ts#L9-L15): the states the new one joins.
- [`src/shared/config/resolve-access.ts:14`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/shared/config/resolve-access.ts#L14): whose input widens.
- [`src/shared/api/load-own-role.ts:15`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/shared/api/load-own-role.ts#L15): the single role read.
- [`src/_pages/account/api/update-password.ts:13`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/_pages/account/api/update-password.ts#L13): the write the trigger observes.
- [`src/_pages/account/ui/PasswordForm.tsx:100`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/_pages/account/ui/PasswordForm.tsx#L100): where the person lands after changing it.
- [`src/_pages/users/api/actions.ts:7`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/src/_pages/users/api/actions.ts#L7): where the new action sits.
- [`supabase/migrations/20261105080343_role_management.sql:48-62`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/supabase/migrations/20261105080343_role_management.sql#L48-L62): the record and its kinds.
- [`supabase/migrations/20261105080343_role_management.sql:223-229`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/supabase/migrations/20261105080343_role_management.sql#L223-L229): why an admin cannot insert a record directly.
- [`supabase/migrations/20261105073614_user_directory.sql:16-21`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/supabase/migrations/20261105073614_user_directory.sql#L16-L21): who writes the directory.
- [`supabase/config.toml:379`](https://github.com/dobrek/ib-timetable-planner/blob/e2c8b2742aedbe42e705234477ec120d80900cb0/supabase/config.toml#L379): the edge-runtime block.
- GoTrue v2.196.0: [`admin.go:239`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/admin.go#L239) (the strength check, on update only), [`admin.go:268`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/admin.go#L268) (update writes the password, then metadata).

## Architecture Insights

- **The Worker stays a courier.** Keeping the secret out means the Action holds no privilege, and a compromised Worker can at most replay an active admin's JWT. The function's fixed `op` set bounds what that JWT can do.
- **Two identities in one function is the pattern.** Use `ctx.supabase` for anything RLS or a trigger should judge, and `ctx.supabaseAdmin` only for what truly needs the secret. This also shrinks the secret key's use.
- **One function change closes every door.** The capability wrappers funnel through `current_app_role()`, so pending users inherit fail-closed behaviour on every table with no policy edits. S-403's design pays off here.
- **A column-specific trigger sees the SET list, not the data.** The PostgreSQL docs say a trigger `OF` a column ignores changes made by BEFORE triggers. This rules out the strip-and-mirror design for `app_metadata`.
- **Reveal last is a security property, not a UI choice.** It turns a multi-write sequence with no shared transaction into one that fails safely.

## Historical Context (from prior changes)

- `context/changes/user-managment-research/research.md` §6: the Edge Function was decided here, with `createUser` plus a `must_change_password` flag. The flag's location was left open.
- `context/archive/2026-10-16-account-self-service/plan.md:48`: "the forced flow is S-409's". `research.md:232` placed the flag in `app_metadata` (superseded by C2). `research.md:165` claims the floor applies to admin `createUser` (not on v2.196.0).
- `context/archive/2026-10-19-forgot-password-by-email/plan.md:169`: "No admin-triggered reset. That stays the dashboard until S-409." The source of D1.
- `context/archive/2026-11-03-users-page-roles/plan.md:107,111`: each later slice adds its own status, and S-409 writes its own records with an explicit actor. `research.md:174`: the role INSERT policy is "also needed by S-409"; it was used here.
- `context/archive/2026-10-14-ci-publishable-key-and-pinned-cli/research.md:146-151`: a secret key bypasses RLS only without a user token, and returns 401 to a browser-like User-Agent.
- `context/foundation/stack-assessment.md:333-352` and `health-check.md:366-384`: the Edge Function rules and Fix 6.

## Related Research

- `context/changes/user-managment-research/research.md`
- `context/archive/2026-11-03-users-page-roles/research.md`
- `context/archive/2026-10-28-fail-closed-roles/research.md`
- `context/archive/2026-10-16-account-self-service/research.md`
- `context/archive/2026-10-14-ci-publishable-key-and-pinned-cli/research.md`

## Stale or inconsistent docs found along the way

None were fixed here; each needs a follow-up in the slice.

- `docs/runbooks/hosted-auth-settings.md:24` and `docs/runbooks/author-provisioning.md:131`: promise an S-409 reset (D1).
- `context/foundation/stack-assessment.md:350-352`: stale on Mailpit. `:343-346`: predates S-406's admin read.
- `context/archive/2026-10-16-account-self-service/research.md:165,232`: archived, so leave them; this document supersedes both.
- `supabase/migrations/20261105080343_role_management.sql:62`: names S-408, S-410 and S-411 as adding kinds, not S-409. Applied migrations aren't edited.
- `supabase/migrations/20261105073614_user_directory.sql:16`: "Only the Auth trigger" stops being true. Update the table comment in the new migration.

## Open Questions

1. D1, D2, D3 above. Owner: user.
2. C1's hosted answers. Owner: developer. They can change C3's trigger form.
3. How to pin transitive function dependencies (C12). Owner: plan phase.
