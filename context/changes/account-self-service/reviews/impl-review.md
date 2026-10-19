<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Account Self-Service (S-401)

- **Plan**: context/changes/account-self-service/plan.md
- **Scope**: Full plan — Phases 1–5 of 5 (range `a86f52c..e817abd`; PR #160 rebase-merged 2026-10-18, epilogue on `chore/account-self-service-close-out`)
- **Date**: 2026-10-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

**Automated (re-run 2026-10-19 on `e817abd`):**

| Command | Result |
|---|---|
| `pnpm check` | 0 errors, 0 warnings (877 files) |
| `pnpm lint` | clean |
| `pnpm steiger` | No problems found |
| `pnpm test` | 220 files / 2107 tests passed |
| `pnpm build` | Complete |
| `prettier --check` on changed files | clean |
| `pnpm test:integration` account-self-service + role-matrix + solver-credential | 3 files / 97 tests passed |
| `pnpm test:e2e` account + auth-guard + auth | **Inconclusive locally**: a preview left running since 2026-10-17 served 500 for `/_astro/*.js` after the review's rebuild replaced `dist/`, so the sign-in island never hydrated (setup failed at the toggle gate; 2 guard tests passed). PR #160's CI `E2E tests` job is **SUCCESS** on identical source, which is the evidence of record for 4.1/4.3. |

**Manual:** every Progress row is `[x]`. 4.3 (CI E2E green) is confirmed by PR #160's checks. 5.4 was checked post-merge in the epilogue, which is correct, because `/account` exists on hosted only after the merge. `hosted-auth-settings.md` carries the 2026-10-17 "last verified" row for 1.9/5.3. Progress SHAs name the feature-branch commits, as the archived `ci-publishable-key-and-pinned-cli` plan does, so that matches house practice.

**Checked and clean:** RLS (insert/update `with check` on `(select auth.uid())`; upsert has INSERT+UPDATE+SELECT policies; no DELETE policy or grant). Grants verified live with `has_table_privilege` (anon none of 8, authenticated INSERT/SELECT/UPDATE, solver unreachable). The migration is additive, with `moddatetime` already in `extensions`. No invisible bytes in the migration or the schema source. `[:cntrl:]` matches all 64 C0/C1 code points under both the `C` and the ICU collation on PG 17.6, so it is not locale-dependent. XSS: the name renders only through Astro `{}`/`title={}` and React `value`, and no user value reaches an `is:inline` script. `signin.ts` redirects only to fixed paths. `updateUser` gets exactly `{ password }`. `TextEncoder` is used for the 72-byte cap, which is Workers-safe. Middleware is unchanged. No `SECURITY DEFINER`, no `ClientRouter`. `db-types.mjs` stages in the same directory and renames atomically, then cleans up on failure.

**Benign extras (Scope Discipline):** `CHECK_VIOLATION` in `shared/api/postgrest/sqlstates.ts` (follows the `UNIQUE_VIOLATION` precedent). `constants.ts` messages. `.nullable()` on `displayName` (needed: RHF submits the transformed `null`). `z-10` on the sign-in icon, `autoComplete="name"`, the `useId` fallback, `comment on table`, the `.editorconfig` extras. The roadmap's version line was amended in place rather than replaced, which keeps the history.

## Findings

### F1 — Plan not amended for two deliberate deviations (`aria-pressed`, schema names)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/shared/ui/password-input.tsx:26-34; src/_pages/account/model/schemas.ts:32,53,70-75
- **Detail**: The plan's Phase 2 §4 contract asks for `aria-pressed` on the toggle (also research.md:317). The code has only a changing `aria-label` plus `aria-controls`, and its docblock says "the toggle's label states what pressing it does". That is the better choice: ARIA guidance says a toggle that uses `aria-pressed` must not change its label. Separately, the Phase 3 §1 names `passwordInput` / `displayNameInput` / `PasswordInput` shipped as `updatePasswordInput` / `updateDisplayNameInput` / `UpdatePasswordInput`. Shipping the planned `PasswordInput` type would have collided with the shared component. Neither deviation is recorded, so a future reader of the plan sees drift where there is a decision.
- **Fix**: Add a short addendum under the plan's Phase 2 §4 / Phase 3 §1 recording both decisions and why. No code change.
- **Decision**: FIXED — implementation notes added under plan Phase 2 §4 and Phase 3 §1

### F2 — `saveDisplayName` doesn't wait for the second reload; the `finally` restore ignores its response

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/specs/account.spec.ts:64 (and :53)
- **Detail**: The helper ends with `page.waitForURL(/\/account\?saved=name$/)`. On the second call (clearing the name) the page is already on that URL, so `waitForURL` resolves at once, before the save. Line 50 (`toContainText(authorEmail)`) then passes on the stale page. The test is held up only by the retrying `not.toContainText(name)` on line 51. The helper's own doc ("then wait for the reload it causes") is false, so the next assertion someone adds will race. Separately, the `finally` cleanup `page.request.post("/_actions/updateDisplayName", …)` never checks the response. A failed restore would silently leave the shared author's name behind, which is the exact failure F5 of the plan review designed the restore to prevent.
- **Fix**: In the helper, wait on the reload itself (`Promise.all([page.waitForEvent("load"), click])`), or `gotoStable(page, "/account")` before the second save. In `finally`, assert `expect(response.ok()).toBe(true)`, or at least log a non-ok status.
- **Decision**: FIXED — helper waits on `load` then asserts the URL; `finally` uses `expect.soft(restored.ok())` so a failed restore is reported without masking the test's own failure

### F3 — Revocation test never shows the second session working before the change

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/account-self-service.integration.test.ts:72-81
- **Detail**: The test asserts `isAuthSessionMissingError(error)` from `otherDevice.auth.getUser()` after `updatePassword`. auth-js returns the same error class when the client holds no session and makes no request at all. Today that is mitigated: `user.client` comes from the same `createPublishableClient` (`persistSession: false`, in-memory session) and is shown to succeed after the change. But the claim "nobody can see this in review" rests on `otherDevice` alone, and there is no positive control for it.
- **Fix**: Add `expect((await otherDevice.auth.getUser()).error).toBeNull();` before `updatePassword(...)`.
- **Decision**: FIXED — positive control added; suite re-run green (6/6)

### F4 — Form and CHECK measure the 60-character cap differently; U+061C is in neither forbidden set

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/account/model/schemas.ts:62; supabase/migrations/20261017170524_profiles.sql:33,41
- **Detail**: Zod's `.max(60)` counts UTF-16 code units, while SQL `char_length` counts code points. A name of 31–60 code points that includes astral characters (emoji) is refused by the form but allowed by the CHECK. That is the safe direction, but the plan says the Zod rule "mirrors the DB CHECK". Also, U+061C (Arabic Letter Mark) is the same kind of invisible bidi mark as the blocked U+200E/U+200F and is not refused on either side. Low impact: the email always renders beneath the name in its own flex item, so a reordered name cannot spill into it.
- **Fix**: Measure with `[...value].length <= 60` in the Zod rule so form and CHECK agree, and note U+061C as a known gap for the next migration that touches `profiles` (an added constraint, never a drop).
- **Decision**: FIXED — Zod cap now counts code points (`Array.from`, since `no-misused-spread` refuses a string spread) with a 60/61-emoji test; U+061C queued in `follow-ups/review-fixes.md` and the plan's S-406 migration note

### F5 — No matrix cell pins "re-key my own row to another user"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/role-matrix-expectations.ts (PROFILE_WRITES); src/test/role-matrix-expectations.test.ts:22-23,35
- **Detail**: The UPDATE policy's `with check (user_id = (select auth.uid()))` is what stops a user moving their own row onto another user's id. Nothing tests it, and S-403 will rewrite these policies. Also, the "another user's profile … is evidenced by its own-row counterpart" test asserts exactly what the `ownProfileRows` test already asserts (both read `PROFILE_WRITES.own`), so it adds a row name but no protection. That is as the plan specified, so it is noted here, not a separate finding.
- **Fix**: Add a `rekey` cell (an UPDATE of the principal's own row setting a foreign `user_id`, `noRole: denied`) to `PROFILE_WRITES` with its probe in `role-matrix.integration.test.ts`. Per CLAUDE.md, access claims belong in the matrix.
- **Decision**: FIXED — added as a standalone `PROFILE_REKEY` cell beside `PROFILE_WRITES` (it exists only for the "others" side, so it doesn't fit that `own`/`others` × op shape), evidenced by `own.update` in the expectations test, probed by `profileRekeyProbe` against a fresh profile-less user. Deliberate-break verified locally: `with check (true)` turns the `noRole` cell red (`allowed`), restored after

### F6 — The weak-password nudge has no automated test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signin.ts:13-21; src/_pages/dashboard/ui/DashboardPage.astro
- **Detail**: The redirect choice (`data.weakPassword` → `/dashboard?notice=weak-password`) and the banner are proven only by manual row 4.4. The plan's Testing Strategy did not list a test, so this is not drift. Still, it is the one FR-facing behaviour of the slice with no regression guard, and a supabase-js change to the `weakPassword` field would remove the nudge silently.
- **Fix**: Extract the redirect choice into a small pure helper (e.g. `postSignInPath(data)`) beside `signin.ts`, with a unit test for both branches.
- **Decision**: FIXED — `postSignInPath` lives in `src/_pages/sign-in/model/post-sign-in-path.ts` (not beside `signin.ts`: Astro would route any `.ts` under `src/pages/`) with a two-branch unit test; `signin.ts` calls it

## Triage summary (2026-10-19)

| Decision | Findings |
|---|---|
| Fixed | F1 (plan addenda), F2, F3, F4 (+ U+061C queued in `follow-ups/review-fixes.md`), F5, F6 |
| Skipped / accepted / rule | — |

Gate after triage: `pnpm check` 0 errors, `pnpm lint` clean, `pnpm steiger` clean, `pnpm test` 221 files / 2111 tests, `pnpm build` complete, prettier clean; `account-self-service` (6/6) and `role-matrix` (81/81) integration suites green. E2E on a fresh preview: `account` + `auth` + `auth-guard` specs 6/6 green; `account.spec.ts --repeat-each=5 --workers=1` 11/11 green; the shared author's display name is empty afterwards. (A parallel `--repeat-each` fails by design: the copies race on the one shared author's name, which is why `e2e/CLAUDE.md` keeps footer text out of every other spec.)
