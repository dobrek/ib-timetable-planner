<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Bulk Course-Choice Editing for Multiple Students

- **Plan**: context/changes/changing-courses-for-multiple-students/plan.md
- **Mode**: Deep
- **Date**: 2026-07-12
- **Verdict**: REVISE → SOUND (all findings fixed in triage)
- **Findings**: 1 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL → fixed (F1, F2, F5) |
| Plan Completeness | WARNING → fixed (F3, F4, F6) |

## Grounding

14/14 paths ✓, 9/9 symbols ✓ (`useUrlSyncedFilters`, `submitForm.successMessage` + `refreshPage`, `radix-ui@^1.6.0` `Checkbox` namespace re-export with `indeterminate`, `cohortSchema`/`choiceCourseIds`, all six e2e support helpers, `...studentActions` barrel spread), brief↔plan ✓, Progress↔Phase contract ✓.

Deep verification also confirmed: jsonb id-list params are the house RPC majority (3 of 4 precedents); `replace_course_teachers` never amended by a later migration; blast radius clean (`StudentTable` has exactly one consumer; nothing but the named projection reads `student_choices` for logic; `clone_plan` only row-copies it); no existing row-selection or two-step-dialog pattern exists (greenfield justified); `use-catalog-dialogs.ts` extension is natural; the authenticated Playwright project is `chromium` with filename-convention routing (spec name needs no declaration).

## Findings

### F1 — Drift-hint toast is destroyed by the very refresh that follows it

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Desired End State · Phase 3 #5 (dialog) · Phase 3 #7 (E2E)
- **Detail**: `submitForm` fires the success toast then awaits `refreshPage()` (submit-form.ts:34-36) → `navigate()` (refresh-page.ts:5) with no `<ClientRouter />` anywhere in src/ → full browser navigation destroys the island-mounted Toaster (StudentCatalog.tsx:108). The drift hint — the decided sole drift mitigation — would be a sub-second flash, and the E2E "toast visible" assertion races the navigation (flaky CI gate). Zero existing specs assert a toast.
- **Fix A ⭐ (chosen)**: Move the drift hint into the dialog's confirmation step; E2E asserts it there (deterministic, pre-Apply); success toast stays a plain confirmation.
- **Fix B**: Navigation-surviving flash-message plumbing (sessionStorage handoff) — fixes the app-wide quirk but new shared plumbing.
- **Decision**: FIXED via Fix A — plan §Desired End State, Key Discoveries #3, Phase 3 #5/#7, Manual Verification, Testing Strategy; brief synced.

### F2 — The 2000-row "loud" cap can never fire: PostgREST silently truncates at 1000

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Key Discoveries · Performance Considerations · "NOT Doing"
- **Detail**: `supabase/config.toml:18` sets `max_rows = 1000`; the loader guard throws only at ≥2000 (loader.ts:18,70-76) so it is unreachable — silent truncation past 1000 choices (badges + confirmation counts quietly wrong). `load-cohort-courses.ts:145` (board-validation input) is unguarded with the same ceiling. Pre-existing; this feature accelerates toward it and the plan repeated the false "refuses to render" premise. Hosted max-rows unverified (blind spot noted).
- **Fix A ⭐ (chosen)**: Correct the premise + in-scope tripwire: `CHOICES_LIMIT` → 1000 so the guard fires at the real ceiling; `load-cohort-courses.ts` recorded as explicit follow-up.
- **Fix B**: Plan-text correction only; defer everything.
- **Decision**: FIXED via Fix A — new Phase 2 item #7; Key Discoveries #5, "NOT Doing", Performance Considerations rewritten; brief synced.

### F3 — Two "Critical Implementation Details" rest on a client-router model that doesn't exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries #4 · Critical Implementation Details #1, #4
- **Detail**: `use-url-synced-filters.ts` seeds once on mount and mirrors out via `history.replaceState` only — no popstate listener, no pushed entries; back/forward is a full page load (island remount), so setters are the only in-island filter-change source. And `refreshPage()` fully remounts the `client:load` island, so post-apply selection clearing is automatic. Both "must" rationales were false (lessons.md false-premise class).
- **Fix**: Rewrite both details — keep value-derived clearing justified as one-mechanism-for-all-sources (incl. `setActiveCohort`'s coupled `courseIds` reset); post-apply clearing comes free from the remount, explicit `clear()` optional.
- **Decision**: FIXED — Key Discoveries #4, Critical Details #1/#4, Phase 3 #2 hook contract rewritten.

### F4 — Phases 1–2 cited `pnpm build` as the type gate (recorded lessons.md anti-pattern)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 & 2 Success Criteria · Progress 1.2, 2.4
- **Detail**: esbuild strips types; the regenerated `database.types.ts` and new typed `rpc()` call would hide type errors until Phase 3's `/verify`. Phase 1's "(via /verify)" parenthetical wasn't a Phase 1 criterion and Progress dropped it.
- **Fix**: "Type-check clean: `pnpm check`" added to Phase 1 and Phase 2 automated criteria with matching Progress items (Phase 1 now 1.1–1.6, Phase 2 now 2.1–2.5).
- **Decision**: FIXED.

### F5 — Server gate permits merge-parent courses in the add set

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 #3 (domain fn) · Phase 3 #5 (dialog pickers)
- **Detail**: Pickers exclude merge-parents client-side only (`isMergeParent` on `CourseOption`); `assertChoicesInCohort` (assert-choices-in-cohort.ts:20-28) checks plan + cohort + existence. A crafted call can attach a merge-parent choice — identical gap in the single-student path (same gate); parity, not a new hole.
- **Fix**: Recorded as accepted parity in "What We're NOT Doing" (closing both paths noted as possible follow-up).
- **Decision**: FIXED.

### F6 — Stale `update-student.ts` docblock correction should be required, not optional

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: "What We're NOT Doing" (last bullet)
- **Detail**: The docblock claims the project "rules out … no new Postgres functions"; this change ships the direct counterexample in the same slice (lessons.md stale-mechanism propagation).
- **Fix**: Flipped to a required one-line correction — new Phase 2 item #8.
- **Decision**: FIXED.

## Triage Summary

- Fixed: F1 (Fix A), F2 (Fix A), F3, F4, F5, F6 — 6 of 6
- Skipped / Accepted / Dismissed: none
- Verdict after fixes: **SOUND**
