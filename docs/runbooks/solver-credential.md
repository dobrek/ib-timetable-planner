# Solver credential runbook

How the CP-SAT solver container reaches the database, what it holds, how to provision and rotate it,
and how to prove the posture is still what this document claims.

Read this before F-302 wires the container: everything below already exists and is tested, so the
HTTP wrapper needs no fresh research on the credential question.

---

## What the container holds

Exactly three values, none of them privileged:

| Value                     | What it is                                                      |
| ------------------------- | --------------------------------------------------------------- |
| `SUPABASE_URL`            | The project URL.                                                |
| `SUPABASE_KEY`            | The **publishable** (anon) key — the same key the Worker holds. |
| `SOLVER_MACHINE_PASSWORD` | The machine Auth user's password.                               |

**No secret key. No service-role key. No JWT signing secret.** That is deliberate and preserves the
deployment decision of record (`context/deployment/deploy-plan.md`: _"Secret key NOT pushed"_). A
secret key cannot be scoped to a table, a schema, or a role — it bypasses RLS wholesale — so handing
one to the solver would give a component that only ever needs UUIDs a full read of every student and
teacher name in the database.

The container signs in with the password grant (`POST /auth/v1/token?grant_type=password`, or
`supabase.auth.signInWithPassword`) and uses the returned access token as its `Authorization: Bearer`.
`httpx` alone is enough — no Supabase SDK is required, which matters because the solver venv pins
protobuf/numpy tightly for ortools.

## How the narrow access works

```
machine Auth user           app_metadata.machine_role = 'solver_job_writer'
        │                   (admin-API-writable only — never by the user)
        ▼
Custom Access Token Hook    public.custom_access_token_hook(event jsonb)
        │                   rewrites claims.role for that user only
        ▼
access token                role: solver_job_writer
        │
        ▼
PostgREST                   set role solver_job_writer   (authenticator holds membership)
        │
        ▼
Postgres                    GRANT: select on generation_jobs; update on its
                                   progress COLUMNS only — and nothing else
                            RLS:   read any job; update only non-terminal ones,
                                   only into a state the solver may declare
```

Three locks, and all three are needed. The GRANT layer decides whether a table is **reachable at
all**; the column grant decides which **fields** are writable; RLS decides which **rows** are
visible. `solver_job_writer` has no `BYPASSRLS`, no `INSERT` (the Worker enqueues), no `DELETE` (a
job row is the record of a run), and no `alter default privileges` — so a table added tomorrow is
unreachable to it until someone deliberately grants it.

The column scope matters because RLS alone would not contain a bad write: a job sits inside the
policy's `status in ('queued','running')` window for its entire run, so a table-wide UPDATE would let
the container rewrite `snapshot`/`snapshot_hash` (the T0 drift baseline it is judged against),
`policy`, `plan_id`, or the `delivery`/`delivered_plan_id` fields the auto-apply path reads. The
solver may write only what it authors: `status`, `result`, `error`, the timestamps, and the
stage/checkpoint progress columns.

Files:

- `supabase/migrations/…_solver_job_writer_role.sql` — the role, the grant, the two policies.
- `supabase/migrations/…_custom_access_token_hook.sql` — the hook function and its execute grants.
- `supabase/config.toml` → `[auth.hook.custom_access_token]` — local enablement, repo-declared.
- `src/test/solver-credential.integration.test.ts` — the guard (see below).

---

## Provisioning and rotation

`scripts/provision-solver-user.mjs` creates the machine user, or rotates it if it already exists —
the same command does both, and it re-asserts `app_metadata.machine_role` every time.

**Locally** (service-role key comes from `.env.test.local` automatically):

```bash
SOLVER_MACHINE_PASSWORD='<strong-password>' node scripts/provision-solver-user.mjs
```

**Hosted** — export the project URL and its **secret** key in your shell (never a committed file):

```bash
SUPABASE_URL='https://<project-ref>.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<secret-key>' \
SOLVER_MACHINE_PASSWORD='<strong-password>' \
  node scripts/provision-solver-user.mjs
```

The email defaults to `solver@ib-timetable-planner.dev`; override with `SOLVER_MACHINE_EMAIL`.

**To rotate**: run the same command with a new password, then update the container's config. There is
no window where both passwords work — the old token keeps working until it expires, which is the
graceful part.

**To revoke immediately**: delete or ban the machine user in the dashboard
(**Authentication → Users**). The role and the hook stay in place; without a user carrying
`machine_role`, nothing can reach them.

### Token lifetime, and why the container re-signs-in rather than refreshes

`jwt_expiry` is 3600 s and a full solve can run ~20 minutes, so one token comfortably covers a solve.
When a token nears expiry the container should **re-run the password grant**, not the refresh grant.
The password grant demonstrably fires the hook; whether the refresh grant does was never verified,
and a refresh that silently returned an `authenticated` token would be the exact escalation this
design exists to prevent. Re-signing-in costs one request and removes the question.

---

## Hosted enablement — the one manual step (S-302, not F-302)

Hook configuration does **not** travel with `supabase db push`. The migrations create the function;
`config.toml` enables the hook locally. The hosted project needs a one-time:

```bash
pnpm exec supabase link --project-ref hwmuiymhjgewtymymbmb   # one-time
pnpm exec supabase config push
```

The CI `deploy` job deliberately runs `db push` only — extending it to push config is a separate
decision (it would let any merge change auth configuration), so this stays a deliberate manual step.
Alternatively, enable it in the dashboard under **Authentication → Hooks**, selecting
`public.custom_access_token_hook`.

**Verify after pushing**, before pointing a container at it: run the provisioning script against
hosted, sign in as the machine user, and decode the token — `role` must read `solver_job_writer`.

```bash
curl -s -X POST 'https://<project-ref>.supabase.co/auth/v1/token?grant_type=password' \
  -H 'apikey: <publishable-key>' -H 'Content-Type: application/json' \
  -d '{"email":"solver@ib-timetable-planner.dev","password":"<password>"}' \
  | python3 -c 'import sys,json,base64; t=json.load(sys.stdin)["access_token"].split(".")[1]; print(json.loads(base64.urlsafe_b64decode(t+"==")) ["role"])'
# Expect: solver_job_writer
```

---

## The failure mode, and the drill that proves we would catch it

If the hook is disabled or errors, GoTrue falls back to `role: authenticated`. Because
`alter default privileges` grants `authenticated` DML on every current and future public table and
every table carries `for all to authenticated using (true)`, that fallback is a **silent escalation
to full database access** — the spike returned real plan names through it. Nothing about it looks
broken: the container connects, reads its job, and solves.

`src/test/solver-credential.integration.test.ts` converts that into a red build. It asserts the
decoded `role` claim **and** `permission denied` on `plans`, because either check alone can
false-negative — a correct claim can sit beside an over-wide grant, and a `plans` denial can come
from RLS rather than from the grant layer. `has_table_privilege` settles the grant question from the
catalog rather than from the migration text.

**Kill-switch drill** — run it whenever the hook, the role, or the policies change:

```bash
# 1. Disable the hook.
#    supabase/config.toml -> [auth.hook.custom_access_token] enabled = false
pnpm exec supabase stop && pnpm exec supabase start

# 2. The guard MUST go red (last run: 5 of 8 assertions failed, including the role
#    claim and the plans denial).
pnpm test:integration src/test/solver-credential.integration.test.ts

# 3. Re-enable, restart, and confirm green again.
```

A guard test that has never been shown to fail is not yet a guard.

---

## Checklist for F-302 — the container's own behaviour

All of this is verifiable against the **local** stack, where the hook is already enabled
(`supabase/config.toml`, `[auth.hook.custom_access_token] enabled = true`) and the CI `integration`
job boots that same config. **F-302 needs no hosted setup** — it is local-fidelity tier 1 by
definition (native uvicorn + `SOLVER_URL` + local Supabase).

All three are **implemented and pinned** as of F-302 — the citations are what to re-read if any of
them is ever in question.

- [x] Container reads `SUPABASE_URL`, `SUPABASE_KEY` (publishable), `SOLVER_MACHINE_PASSWORD`.
      → `services/solver/src/cpsat_service/settings.py`. No secret key is read anywhere; startup
      succeeds without them so `/health` answers on a bare container, and the first job fails loudly.
- [x] Container re-runs the password grant near expiry; it never refreshes.
      → `JobRowClient.sign_in` (`cpsat_service/supabase.py`), re-granting past `TOKEN_MAX_AGE_S`
      (3000 s, inside the 3600 s `jwt_expiry`). Pinned by
      `test_an_aged_token_is_re_minted_with_the_password_grant_never_a_refresh`, which asserts both
      that the second call is a password grant and that no refresh token is ever sent.
- [x] Every poll uses a **narrow column projection** — `select()` with no argument drags the
      ~124 KB TOASTed snapshot on every request (see the `generation_jobs` migration header).
      → every request in `cpsat_service/supabase.py` carries `select=id`; asserted per-call in
      `test_successful_solve_claims_then_writes_the_result`.

Two behaviours worth knowing that the original checklist did not anticipate:

- **The claim is a compare-and-set**, `PATCH …?id=eq.{id}&status=eq.queued`. The RLS `WITH CHECK`
  window permits `running → running`, so the policy cannot stop a duplicate dispatch — the filter
  is what does, and it is the only guard that survives a container restart.
- **A sign-in failure leaves the row `queued` with nothing written**, because the container has no
  credential to write an error WITH. The service log is the entire trace (WARNING level, so it is
  not swallowed by uvicorn's root-logger default). S-304's heartbeat is what turns this into a
  detectable state rather than a silent one.

## Checklist for S-302 — hosted enablement, before the first hosted container run

Manual by design, and **not** required to implement or verify F-302. These two steps gate the first
moment a _hosted_ container authenticates against _hosted_ Supabase — S-302's deploy lane, and hard
required before S-308 runs calibration jobs on production.

Both need a human: `config push` rewrites the **whole** `config.toml` on the hosted project (which is
why the `deploy` job does not run it), and provisioning needs `SUPABASE_SERVICE_ROLE_KEY`, which CI
deliberately does not hold.

- [ ] `supabase config push` (or dashboard toggle) on the hosted project, then verify the claim.
- [ ] Provision the hosted machine user; store the password in the container's config, not the Worker's.

> **Verification is a gate, not a formality.** Skipping it fails _upward_: with no hook, the machine
> user does not lose access — it falls back to `authenticated` and reaches the whole database, with
> no error to notice. Decode the token and confirm `role` reads `solver_job_writer` **before**
> pointing any container at hosted.
