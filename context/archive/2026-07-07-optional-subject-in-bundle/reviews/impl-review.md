<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Optional Subject in Bundle

- **Plan**: context/changes/optional-subject-in-bundle/plan.md
- **Scope**: Full plan (Phases 1–4)
- **Date**: 2026-07-07
- **Verdict**: REJECTED at review time → all findings resolved in triage (2026-07-07). F1/F2 guards restored + pinned by new integration tests; F3 documented; F4 acknowledged. Post-fix: `supabase db reset` + full integration suite green (83 tests, incl. the 2 new guard pins).
- **Findings**: 2 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (26/28 MATCH, 0 drift, 0 missing) |
| Scope Discipline | PASS (0 scope creep; all "NOT doing" guardrails held) |
| Safety & Quality | FAIL (2 critical findings) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (all 9 automated gates re-run locally 2026-07-07: db reset, check, test, integration, e2e, lint, steiger, build — green) |

## Findings

### F1 — shelve_bundle re-create silently reverts the empty-cell guard

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260707120002_shelve_bundle_optional.sql
- **Detail**: The new body was copied from the ORIGINAL definition (20260626120001), but the live definition is 20260626120006_guard_empty_shelf.sql, which added an `if not exists (… placements at cell …) then raise exception` guard closing a race (rapid double lift-to-shelf) that minted orphan empty shelf cards. The create-or-replace drops that guard, reintroducing exactly the bug 20260626120006 fixes. No test pins the guard, so all suites stay green on the revert.
- **Fix**: Re-insert the guard block at the top of the new body; add an integration test in shelf.integration.test.ts asserting shelve_bundle on an empty cell errors and mints no shelf_bundles row.
- **Decision**: FIXED — guard restored + header comment corrected to cite live definition; pinning test added (empty-cell shelve raises, header count unchanged).

### F2 — shelve_courses re-create drops the empty course-set guard

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260707120003_shelve_courses_optional.sql
- **Detail**: Same root cause as F1: the DROP+CREATE body omits the `if p_course_ids is null or array_length(...) is null then raise exception 'shelve_courses: empty course set'` guard from 20260626120006. A null/empty course set still inserts and returns a shelf header — a DB-level ghost parked card. Zod `.min(1)` guards only the Action path; the DB guard was the race-proof backstop.
- **Fix**: Restore the guard before the header insert; pin with an integration test alongside the F1 test.
- **Decision**: FIXED — guard restored + header comment notes the live-definition source; pinning test added (empty-set shelve_courses raises, header count unchanged).

### F3 — place_course on-conflict converges is_optional but not week

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260707120001_place_course_optional.sql (~line 54)
- **Detail**: `on conflict … do update set … is_optional = excluded.is_optional` is intended (and integration-tested) for undo-replay convergence; every current caller is safe. But `p_is_optional default false` means any future caller omitting the arg on an existing row silently clears a pending optional decision. The upsert now carries two idempotency contracts: `week` is deliberately NOT converged on conflict, `is_optional` is.
- **Fix**: Document the asymmetry in the function's comment (why the flag converges but week doesn't, and that omitting p_is_optional on an existing row resets the flag).
- **Decision**: FIXED — asymmetry comment added to the placements upsert in the migration.

### F4 — Two benign plan/impl mismatches, for the record

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/_pages/plan-detail/api/shelf-client.ts (unchanged); src/_pages/plan-detail/ui/grid/slot-cell/ChipMenu.tsx
- **Detail**: (a) Phase 2 #4 listed shelf-client.ts but no edit was needed — it passes ParkedMember[] through, so the required-field extension re-typed it automatically; the real wire path (shelf.ts zod input + p_optionals zip) is implemented and integration-tested. (b) Phase 3 #6 specified the stopDrag helper on the menu trigger; the impl uses a bare onPointerDown stopPropagation because stopDrag's paired onClick would fight the Radix trigger's toggle. Same drag-inert intent, documented in the JSDoc.
- **Fix**: None required — recorded so future reviews don't re-litigate.
- **Decision**: ACKNOWLEDGED — no action; recorded for the record.

## Notes

- Branch unmerged at review time: F1/F2 never reached the hosted DB — pre-merge catches, not incidents.
- Root-cause pattern (lesson candidate): full-body SQL function re-creates copied from the original migration instead of the latest live definition; no test or tooling catches this class today.
