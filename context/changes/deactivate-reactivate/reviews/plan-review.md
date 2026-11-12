<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Deactivate and reactivate (S-408)

- **Plan**: context/changes/deactivate-reactivate/plan.md
- **Mode**: Deep
- **Date**: 2026-11-12
- **Verdict**: SOUND
- **Findings**: 0 critical · 2 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

Grounding: 35/35 paths ✓, 9/9 symbols ✓, brief↔plan ✓

Verified:
- **Live bodies:** the three bodies the plan names are the latest live definitions (`must_change_password.sql:69-85, 128-179`; `role_management.sql:242-280`). No later migration re-creates them.
- **Access reads:** every one goes through `own_app_role`: `load-own-role.ts:16`, the middleware, and the Edge Function's `requireAdmin` (`handler.ts:284-290`).
- **Users page:** nothing counts admins client-side (`needsConfirmation` reads only `targetIsSelf` and `newRole`). Nothing holds an exhaustive map of record kinds, and `LastChange.tsx` ignores `kind`.
- **Two records from one write:** the "latest record" choice breaks ties by `id` (`loader.ts:32-33`, `user-rows.ts:127-131`), so the later-written one wins.
- **Upserts:** every role write sends a single object, so `deactivated_at` survives a role change (`@supabase/postgrest-js@2.116.0` sets `columns` only for arrays).
- **Factory:** writing the flag in `assignRole`'s INSERT is correct. An UPDATE would fire the guard while principals are created concurrently.

## Findings

### F1 — The e2e provisioner is a role writer the plan misses

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Current State Analysis ("Every role write sends only…"); Phase 3 §1
- **Detail**: `scripts/provision-e2e-author.mjs:99` (`pretest:e2e`) upserts `{ user_id, role }` for e2e-author, e2e-viewer and e2e-admin, so it never clears `deactivated_at`. The local `/users` page lists those accounts. One deactivated during Phase 2's manual checks stays deactivated on every later run, and its e2e project lands on the notice. e2e/CLAUDE.md's "the provisioner resets it" then stops being true. It is the same trap the plan fixes in `assign-role.mjs`.
- **Fix**: Add the provisioner to Phase 3 §1 (upsert `{ user_id, role, deactivated_at: null }`) and to Current State's list of role writers.
- **Decision**: FIXED

### F2 — Criterion 1.2 expects red cases that will pass

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §5 and Success Criteria 1.2
- **Detail**:
  - Two of the five new access-record cases pin behaviour the old recorder already has, so they pass before the fence: a role change on a deactivated row records only `role_changed`, and moving the timestamp records nothing. The criterion said every new case fails.
  - Before the fence, `deactivatedAdmin` is a real admin, so its "drop own role" cell really deletes its row. Its later RPC cells then pass as noRole, which lowers the matrix's red count.
- **Fix**:
  - Name the red cases (deactivated, reactivated, combined write) in §5 and criterion 1.2.
  - Mark the other two as green on both sides.
  - Note the lower matrix count.
- **Decision**: FIXED

### F3 — The combined write leaves the record's role undecided

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details — Recorder semantics
- **Detail**: "old_role = new_role = the held role" is ambiguous when one UPDATE changes both the role and `deactivated_at`. That happens with `assign-role.mjs` on a deactivated person given a different role, and in the service-role test case, which compares whole rows.
- **Fix**: `deactivated`/`reactivated` carry `new.role` in both columns, the role held after the write. The test case uses that.
- **Decision**: FIXED

### F4 — Three small touch-points the plan doesn't name

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §5; Phase 3 §2
- **Detail**:
  - (a) `e2e/support/sign-in.ts:3-8` repeats the "one sanctioned exception" rule, and the plan did not update it (lessons.md: a doc that names a mechanism is coupled to it).
  - (b) In `access-changes.integration.test.ts`, the last case demotes the shared admin (`:105`), so the new cases must go above it.
  - (c) The spec checked the own row's missing Deactivate button in a test of its own. The rule is to check an absence in the same test as a presence.
- **Fix**:
  - Add `sign-in.ts` to Phase 3 §2.
  - Add a placement line to Phase 1 §5.
  - Fold the absence check into the main E2E test, beside the throwaway row's `Deactivate`.
- **Decision**: FIXED
