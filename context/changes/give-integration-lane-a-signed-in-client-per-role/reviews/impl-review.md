<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Signed-in Client per Role for the Integration Lane

- **Plan**: context/changes/give-integration-lane-a-signed-in-client-per-role/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-10-12
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

**About the verdict.** Every warning is cheap to fix and none of them weakens what the change set out
to prove. The implementation matches the plan file for file, and nothing listed under "What We're
NOT Doing" was done.

The plan-drift and safety scans found no path where a denial, or a fault in the harness, scores as
the expected outcome:
- No probe write chains `.select()`.
- Each write cell gets its own target.
- Every UPDATE sentinel differs from the value it replaces.
- A failed read-back throws.
- Users are registered before they sign in, and clones as soon as `clone_plan` returns.

### Verification evidence (2026-10-12)

**Passed:**
- `pnpm check`: 0 errors.
- `pnpm lint`: clean.
- `pnpm steiger`: clean.
- `pnpm test`: 2078 of 2078.
- `pnpm build`: clean.
- `pnpm audit --audit-level=high`: one high-severity finding, already reviewed and marked ignored.
- Role matrix, factory smoke and solver guard together: 83 of 83. The role matrix runs 69 tests in about 2 s, which is 32 reads, 30 writes, 2 RPC cells, the fixture check, the catalog check and 3 sanity rows.
- No `f401 drill%` policy remains in `pg_policies`.
- After all runs, `auth.users` holds 0 `signed-in-%` users.

**The full `pnpm test:integration` was red twice. Every failure was a Kong "invalid response from
upstream server" (502) in suites this change does not touch:**
- At default parallelism: 14 failures in 9 files.
- At CI's `--maxWorkers=2`: 1 failure, in `generation-lifecycle`.

That matches the known transient-502 baseline on `main`. The new and changed suites were green in
every run.

**Manual rows:** the drill record in `change.md` is detailed, and the cell counts match the live run,
so none of the manual rows reads as rubber-stamped.

## Findings

### F1 — `clone_plan`'s `deniedWhen` would score a harness fault as "denied"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/role-matrix.integration.test.ts:67 (used at :352)
- **Detail**:
  - The pattern `CLONE_SOURCE_HIDDEN = /source plan .* not found/` matches the "not found" error for **any** plan id.
  - `clone_plan` raises the same P0001 for a source hidden by RLS as for a source that doesn't exist. So a wrong or deleted `planId` would classify as "denied".
  - That breaks the plan's rule that a non-access error is never "denied" (Critical Implementation Details).
  - It can't happen today. `anon` is stopped earlier with 42501, and `noRole` expects "allowed".
  - It goes live the moment S-403 adds a principal that expects "denied" on `clone_plan`.
- **Fix**: Build the matcher inside `cloneProbe` from the cell's own id, anchored at both ends: `` new RegExp(`^clone_plan: source plan ${planId} not found$`) ``. Then drop the module-level constant.
- **Decision**: FIXED. The matcher is now built per cell in `cloneProbe`, and `CLONE_SOURCE_HIDDEN` is gone. Checked live: PostgREST returns `P0001 | clone_plan: source plan <id> not found`, which the anchored matcher accepts for the matching id and rejects for any other.

### F2 — The catalog check runs 32 queries at once on one `pg` client

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/role-matrix.integration.test.ts:163-174
- **Detail**:
  - `livePosture` does `Promise.all(rows.map(async … await heldPrivileges(pg, …)))` against a single `pg.Client`.
  - pg 8.23 queues those queries internally, but every run prints `DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0`.
  - I reproduced the warning on this branch, and it comes from this function.
  - On pg@9 the catalog check breaks.
- **Fix**: Query the tables one after another, still through `heldPrivileges`. For example, use a sequential `for … of` that builds the entries array, or chain the work with `reduce` over a promise.
- **Decision**: FIXED. `livePosture` now chains the tables through a `reduce` over a promise, so each step awaits the previous one before issuing its two queries. A comment explains why. The re-run is 69/69 with no `DeprecationWarning`.

### F3 — Fixture state is built in the suite, not in `src/test/factories/`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/test/role-matrix.integration.test.ts:5, :375-379, :396-423
- **Detail**:
  - `jobRow` and `insertTerminalJob` are now the **third** copy of the generation-job row builder. The other two are `solver-credential.integration.test.ts:256-283` and `generation-jobs.integration.test.ts:151-186`, whose `insertJob(…, overrides)` already covers `{ status: "failed" }`.
  - The suite deep-imports `shelveCourses` from `@/_pages/plan-detail/api/shelf` and calls it directly. The barrel doesn't export it.
  - For comparison, `place-course.ts` and `compute-groupings-for.ts` wrap page-slice API calls inside a factory.
  - CLAUDE.md says integration suites build state "through the builders in `src/test/factories/`".
- **Fix A ⭐ Recommended**: Add `addGenerationJob(admin, planId, overrides?)` and `shelveCourse(admin, …)` to `factories/` as concept files, and point the role matrix at them now.
  - Strength: Restores the factories rule for the suite S-403 will edit next. Both factories follow existing precedents (`place-course.ts` already deep-imports a page api).
  - Tradeoff: Two new files. `generation-jobs` and `solver-credential` keep their own copies until they're next touched, unless you also migrate them now, which the plan scoped out for `solver-credential` ("change nothing else").
  - Confidence: HIGH — `generation-jobs` already has the overrides shape to lift.
  - Blind spot: The two older copies differ slightly (the snapshot shape and the budget). Check them before you unify all three.
- **Fix B**: Leave as is and log it as a follow-up for S-403, which rewrites this suite's principals anyway.
  - Strength: Keeps F-401's diff closed.
  - Tradeoff: S-403 copies the helpers forward, or inherits the debt.
  - Confidence: MEDIUM — depends on S-403's scope discipline.
  - Blind spot: None significant.
- **Decision**: FIXED (via Fix A).
  - New concept files in `src/test/factories/`, all re-exported from the barrel:
    - `generation-job-row.ts`: `generationJobRow(planId)`, the payload alone, for the matrix's client-side INSERT cell;
    - `add-generation-job.ts`: `addGenerationJob(supabase, { planId, status? })`, which inserts the row with the service role and returns its id;
    - `shelve-courses.ts`: `shelveCourses(supabase, { planId, cohort, courseIds })`, which wraps the domain function the way `place-course.ts` does, with every member on `both` weeks and not optional.
  - The role matrix no longer imports `@/_pages/…` or `computeSnapshotHash`. A one-line local `addFinishedJob` keeps the "terminal, so it never holds the active-job slot" intent at its three call sites.
  - Correction to the blind spot: the three copies were identical, apart from `generation-jobs`' `overrides` parameter.
  - `generation-jobs` and `solver-credential` still have their own copies, as Fix A scoped.
  - Gates: `pnpm check` 0 errors; lint, steiger and prettier clean; matrix plus lifecycle smoke 71/71.

### F4 — The probe docblock claims more isolation than Postgres gives UPDATE and DELETE

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/access-probe.ts:22-24 (the same claim appears in plan.md, Critical Implementation Details)
- **Detail**:
  - The docblock says that leaving out `.select()` stops a read denial from masquerading as a write denial.
  - That holds for INSERT only. When an UPDATE or DELETE reads columns in its `WHERE`, as `.eq("id", id)` does, Postgres also applies the SELECT (or ALL) policies (PG `CREATE POLICY` docs).
  - So a principal that may write but not read still affects 0 rows and scores "denied".
  - That answer is honest about what the app can do, so it is not a false green. But S-403 should not plan a "write-only" cell on the strength of this sentence.
- **Fix**: Narrow the paragraph to INSERT and RETURNING, and add one line saying that UPDATE and DELETE stay bound to the SELECT policy through their `WHERE`.
- **Decision**: FIXED. The docblock now says the RETURNING isolation is INSERT's alone. It notes that UPDATE and DELETE filtering in their `WHERE` stay held to the SELECT policy, so a write-only cell can't be expressed. The historical copy of the claim in `plan.md` was left as written.

### F5 — `afterAll` skips `pg.end()` when teardown throws

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/role-matrix.integration.test.ts:91-94
- **Detail**:
  - The hook runs `await teardown(admin); await pg.end();`.
  - `teardown` now throws one aggregated error for failures in both the plans and the users registries, and when it does, the socket stays open.
  - If `connectPostgres()` fails in `beforeAll`, `pg` is undefined, and `pg.end()` adds a TypeError on top of the real error.
  - The same shape exists in `solver-credential` and `generation-jobs`, so this is not a regression.
- **Fix**: `try { await teardown(admin); } finally { await pg?.end(); }`
- **Decision**: FIXED, in part.
  - `afterAll` now runs `try { await teardown(admin) } finally { await pg.end() }`, so the socket closes even when teardown throws.
  - The `pg?.` half was dropped. `@typescript-eslint/no-unnecessary-condition` rejects it while `pg` is typed `Client`, and widening it to `Client | undefined` would add null checks at every use site for a cosmetic gain: Vitest still reports the real `beforeAll` error first.
  - The sibling suites were not touched.

### F6 — The write-probe table repeats three shapes across about 150 lines

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/test/role-matrix.integration.test.ts:185-333
- **Detail**:
  - 13 of the 15 `WRITE_PROBES` builders are one of three shapes:
    - INSERT: client id, insert, read back that the id exists.
    - UPDATE: admin row, sentinel, read back that column.
    - DELETE: admin row, delete, read back that the row is gone.
  - Only the `placements` INSERT (through `place_course`) and the job rows differ.
  - Each read-back is written by hand per cell, so every edit is another chance to read back the wrong table or column. Today the `noRole`-allowed cell would catch that; once S-403 adds denied-only cells, it might not.
- **Fix**: Extract `insertProbe(table, row)`, `updateProbe(table, id, patch, column, sentinel)` and `deleteProbe(table, id)`, typed through the same untyped-client cast `access-probe.ts:126` already uses. Keep the RPC and job-row builders bespoke.
  - Strength: The read-back is derived from the attempt, so it can't drift. The table becomes data, which is easier for S-403 to extend.
  - Tradeoff: It loses per-table generated typing on the payloads, and the shared cast moves type errors to runtime.
  - Confidence: MED — the three shapes are clear. Whether the typing loss is worth it is a judgement call.
  - Blind spot: Haven't checked whether `@supabase/postgrest-js` generics allow a typed generic helper without the cast.
- **Decision**: FIXED.
  - **What changed:** the suite now has `insertProbe`, `updateProbe` and `deleteProbe`. 13 of the 15 cells are one-line calls to them; only the `placements` INSERT (`place_course`) stays bespoke. The job-row cells became generic as well, through `generationJobRow` and `addFinishedJob`.
  - **Typing kept:** the helpers take their clients as the untyped `SupabaseClient` supertype, so there is no cast helper. The row (`Tables[T]["Insert"] & { id }`), the column (`keyof Tables[T]["Update"]`) and the sentinel (`Tables[T]["Update"][C]`) stay typed, so `pnpm check` still checks the call sites. Most of the predicted typing loss was avoided.
  - **Results:** `pnpm check` 0 errors, lint clean, matrix 69/69.
  - **Deny drill re-run on the refactored probes:** 32 red, all `noRole`, all "expected 'denied' to be 'allowed'". 37 green. No probe threw. Restored to 0 drill policies. That matches the drill recorded in `change.md`.

### F7 — Small helpers duplicated across signed-in suites

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/test/role-matrix.integration.test.ts:434-439, :83-85; src/test/factories/create-signed-in-user.ts:44-46
- **Detail**:
  - `claimsOf` re-implements `decodeClaims` (`solver-credential.integration.test.ts:250-254`).
  - The no-session publishable-key client (`createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })`) is built both in the factory and for the matrix's `anon` principal.
  - Separately, `cloneProbe.effectLanded` both checks for clones and registers them for teardown. That's a useful safety net, but the name reads as a pure check.
- **Fix**: Move a `decodeAccessClaims(token)` and a `publishableClient()` helper into `src/test/` beside `publishable-key.ts`, and add a one-line comment on `effectLanded`'s registration side effect.
- **Decision**: FIXED.
  - New `src/test/access-claims.ts` (`decodeAccessClaims`, `AccessClaims`) and `src/test/publishable-client.ts` (`createPublishableClient`).
  - The no-session client was actually built in three places, not two (`solver-credential` too). All three now use the helper.
  - `solver-credential` swapped its local `decodeClaims` for the shared one. That edits a file Phase 1 said to leave alone, but this fix is aimed at exactly that duplication.
  - `cloneProbe.effectLanded` has a comment naming its registration side effect.
  - Gates: `pnpm check` 0 errors, lint clean, matrix plus smoke plus solver guard 83/83.

### F8 — The roadmap row says "signs in a real user per test"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/roadmap.md:46
- **Detail**:
  - The F-401 row, written in pre-plan commit 88e960f, says the lane "signs in a real user per test".
  - The implementation, CLAUDE.md, the `test-plan.md` §6.2 entry and the roadmap's own Risk line all teach once per principal per file, because of GoTrue's rate limits.
  - A reader of the row would copy the wrong pattern.
  - The row's status, `in-progress`, also trails `change.md`'s `implemented`. That's ordinary archive-time bookkeeping.
- **Fix**: Reword the row to "signs in a real user per principal (once per file)".
- **Decision**: FIXED. The F-401 row now says "signs in a real user per principal (once per file)". The status column was left at `in-progress` for `/10x-archive` to settle.

## Triage summary (2026-10-12)

- **Fixed:** F1, F2, F3 (via Fix A), F4, F6, F7 and F8.
- **Partly fixed:** F5. The `try/finally` is in; the `pg?.` half was rejected by lint.
- **Skipped, accepted or lessons:** none.

### Checks after the fixes

- `pnpm check`: 0 errors.
- `pnpm lint`, `pnpm steiger` and prettier: clean.
- `pnpm test`: 2078/2078.
- Role matrix plus lifecycle smoke plus solver guard: 83/83, with no `pg` deprecation warning.
- Deny drill re-run on the refactored probes: 32 `noRole` cells red for the right reason and 37 green. Restored to 0 drill policies.
