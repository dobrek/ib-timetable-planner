<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Clean up & re-architect `shared/lib` (+ `shared/config` boundary)

- **Plan**: context/changes/clean-up-shared-lib/plan.md
- **Scope**: All 5 phases (full plan)
- **Date**: 2026-06-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 3 warnings, 1 observation
- **Triage**: F1–F4 all FIXED — `pnpm test` (387) / `lint` / `steiger` / `build` green
- **Post-review follow-up**: F4 (dead `lib/index.ts` barrel) surfaced by the author after triage; deleted.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Summary

The refactor is clean and faithful to the plan. All 5 phases match; the 5 documented
adaptations (A1 `@/shared/api` barrel routing, A2 `astro:env/server` Vitest stub, A3
`call-action`→`forms/`, A4 pure-barrel folder convention, A5 `cn/`→`class-names/`) were all
carried out as recorded in `change.md`. No scope creep — the 14 `shared/ui/*.tsx` edits and
`grid-presets.ts` change are just the documented `cn` import-path swap and a doc-comment
update. All 6 bugs are fixed and locked by tests. Two LOW-impact quality nits introduced by
the Phase-5 bug fixes (F1, F2) and one pre-existing latent asymmetry (F3) were found and all
three were fixed during triage.

All automated success criteria verified green across every phase: `pnpm steiger` ("No
problems found"), `pnpm lint`, `pnpm test` (387 passed / 50 files), `pnpm build`, plus all
grep criteria (lib/postgrest importers = 0, "never reach" comments = 0, config formatters =
0, `localeCompare` = 0, lib top-level children = 13, eslint-disable in shared/lib = 0).

## Findings

### F1 — Bug #5 fix throws plain Error, breaking DomainError currency

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/shared/api/load-cohort-courses.ts:63
- **Detail**: The Phase-5 bug #5 fix ("fail loudly on missing merge parent") threw
  `new Error(...)`. Every other throw in this file goes through `unwrapMany → DomainError`.
  `loadCohortCourses` runs inside `computeAndPersistGroupings`/`clonePlan`, both wrapped by
  `runDomain` (run-domain.ts:12) which translates ONLY `DomainError` → `ActionError`; a plain
  `Error` propagates untranslated, losing the `INTERNAL_SERVER_ERROR` code and the uniform
  action error surface. Contradicts the recorded lessons.md rule (domain functions throw
  `DomainError`; action layer translates).
- **Fix**: Throw `new DomainError("INTERNAL_SERVER_ERROR", ...)`, importing `DomainError` from
  `@/shared/lib/errors`.
- **Decision**: FIXED — swapped to `DomainError("INTERNAL_SERVER_ERROR", ...)` and added the
  import.

### F2 — Decoder error-path tests have no fail-guard (can pass silently)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/shared/api/postgrest/unwrap-many.test.ts:17-24 (same shape in
  unwrap-maybe-row.test.ts; weaker in unwrap-completed.test.ts / assert-no-query-errors.test.ts)
- **Detail**: The error cases used bare `try { fn() } catch (e) { expect(...) }` with no
  `expect.assertions(n)` and no `.toThrow`. If a decoder regressed to *returning* instead of
  *throwing* on `{error}`, the catch block would never run and the test would pass green — the
  exact regression these bug-lock tests are meant to catch. `unwrap-row.test.ts` does it right.
- **Fix**: Convert each error case to extract a `run` thunk and assert
  `expect(run).toThrow(DomainError)` before inspecting the code, matching unwrap-row.test.ts.
- **Decision**: FIXED — added `expect(run).toThrow(DomainError)` fail-guards to all four
  decoder error-path tests (void-returning thunks given braced bodies to satisfy
  `no-confusing-void-expression`).

### F3 — Virtual merge-parent studentKeys not deduped (latent, parity-safe)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/shared/api/load-cohort-courses.ts:68
- **Detail**: The regular-course path wraps `studentKeys` in `unique()` (line 56) but the
  virtual merge-parent path did not (line 68). A student enrolled in both a merge parent and
  one of its children is double-counted (flows into `score.ts` `.length` and the catalog
  hash). NOT a regression: the reference fixture is also non-deduped and the adapter-parity
  test compares as Sets, so it was parity-preserving. Separate from the bug #5 dedup fix
  (which was about course IDs across buckets, correctly fixed at lines 49-51).
- **Fix**: Wrap the virtual path in `unique([...])` for symmetry with the regular path.
- **Decision**: FIXED — wrapped the virtual `studentKeys` in `unique(...)`.

### F4 — Dead `shared/lib` barrel left behind by the Phase 2 migration

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/shared/lib/index.ts
- **Detail**: On `main` the barrel had 9 importers and re-exported the astro-coupled
  `actions`/`config-status`/`postgrest`/`loaders`. Phase 2 removed the astro-coupled
  re-exports and migrated every consumer to deep imports (`@/shared/lib/<folder>`), but left
  `errors`/`collections`/`result` re-exported. Result: a barrel with **0 importers** (all 20/8/5
  consumers of those symbols deep-import), **not required by steiger** (verified: removing it →
  "No problems found"), that can never be a complete public API by design (astro-coupling drove
  the Vitest-safe deep-import pattern, whitelisted by `fsd/no-public-api-sidestep`). It offered
  a dead second import path for three symbol groups — the exact "no symbol has two live import
  paths" invariant Phase 2 set out to enforce. Unlike `api`/`config`/`ui`, which ARE
  barrel-consumed (56/50/32×), `shared/lib`'s canonical surface is its per-folder deep paths.
- **Fix**: `git rm src/shared/lib/index.ts`.
- **Decision**: FIXED — deleted the dead barrel; re-verified steiger/lint/test(387)/build green.
