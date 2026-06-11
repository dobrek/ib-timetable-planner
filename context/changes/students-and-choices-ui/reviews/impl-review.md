<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Students and Choices UI (S-04)

- **Plan**: context/changes/students-and-choices-ui/plan.md
- **Scope**: Full plan (Phases 1–3)
- **Date**: 2026-06-11
- **Verdict**: REJECTED at review time (rubric-driven by the single critical data-safety finding) → **resolved in triage**: all findings fixed or queued except F9 (skipped); full CI gate green afterward (217 unit + 3 integration, lint, steiger, build)
- **Findings**: 1 critical, 4 warnings, 4 observations

## Triage summary (2026-06-11)

- Fixed in code: F1 (truncation guard, choices query), F2 (docstring corrected), F3 (student-actions.test.ts, 10 tests), F5 (schema max+dedupe, 23505→CONFLICT), F6 (cohort-scoped URL course ids), F7 (formatter promoted to shared/lib/course-label; apply-action-errors grouped under shared/lib/actions for the steiger cap), F8 (stale-choice pruning on edit prefill)
- Queued as follow-up: F4 (updateCourse cohort-change guard → follow-ups/review-fixes.md)
- Skipped: F9 (benign extras; documented in commit messages)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Context

Plan adherence is exemplary: all three load-bearing details (insert-before-delete diff ordering, authoritative cohort guard, handler-scoped cohort reset) match the plan exactly. The R054 rename stat on write-parent-with-links is an artifact — the function body is byte-identical to the old writeMergeAtomic. All automated criteria verified live on 2026-06-11: 204/204 unit tests, lint, steiger, build clean, integration suite 3/3 against local Supabase.

## Findings

### F1 — Loader truncation silently deletes choices on edit

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/_pages/students/api/loader.ts:23 + src/_pages/students/api/update-student.ts:27-48
- **Detail**: `student_choices` loads with `.limit(2000)` and no `.order()` — above 2000 rows PostgREST silently returns an arbitrary subset. The edit dialog prefills `choiceCourseIds` from that truncated projection; on save, `updateStudent` diffs it against a fresh full read, so truncated-away choices land in `toRemove` and are silently deleted. Limits are mutually inconsistent (500 students × ~6 choices = 3000 > 2000); loss begins around ~333 students. Violates the module's own docstring guarantee and the plan's "silent loss is not acceptable" rule. Plan-inherited flaw (the plan specified the 2000 limit).
- **Fix A ⭐ Recommended**: Fail loudly on truncation — detect a maxed-out result in the loader (`data.length === limit` or `count: "exact"`) and throw the standard loader error.
  - Strength: Few lines; converts silent data loss into a visible 503 beyond design scale; consistent with assertNoQueryErrors posture.
  - Tradeoff: Page hard-fails at >2000 choices until limits are raised.
  - Confidence: HIGH — mechanism verified first-hand in both files.
  - Blind spot: 500-row students/courses limits also truncate silently (read-only); same guard could cover them.
- **Fix B**: Fetch fresh choices when opening the edit dialog (per-student read so the form never trusts the catalog projection).
  - Strength: Removes the destructive path entirely, independent of limits.
  - Tradeoff: New action + loading state for a scale the PRD says won't be reached.
  - Confidence: MEDIUM.
  - Blind spot: Table badges still render from the truncated set.
- **Decision**: FIXED via Fix A (choices query only — `assertChoicesNotTruncated` guard in loader.ts; user opted not to guard the read-only students/courses/merges limits)

### F2 — Cohort change can persist cross-cohort choices on partial failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/_pages/students/api/update-student.ts:14-51
- **Detail**: The row update commits `cohort_id = B` first; a subsequent choice insert/delete failure leaves cohort-A choices attached to a cohort-B student — the state assertChoicesInCohort exists to prevent and that S-06 grouping would choke on. The docstring's "can only leave a visible superset" claim is false across cohorts. No reordering fixes this without a transaction (project rule: no client transactions, no new Postgres functions).
- **Fix A ⭐ Recommended**: Document the residual window and correct the docstring (narrow claim to same-cohort edits; note the state is visible/re-editable; note S-06 should be defensive).
  - Strength: Honest about an unclosable window under the no-transaction rule; corrupt state is visible and self-healing on re-save.
  - Tradeoff: Window stays; S-06 inherits a defensive obligation.
  - Confidence: HIGH.
  - Blind spot: Concurrent readers see the transient state on the success path too.
- **Fix B**: Move the multi-table write into a Postgres function (rpc) for true atomicity.
  - Strength: Eliminates the window and the F5 race class.
  - Tradeoff: Reverses an explicit project rule; schema-adjacent change scoped out of this plan.
  - Confidence: MEDIUM.
  - Blind spot: workerd/supabase-js rpc error-mapping untested in this codebase.
- **Decision**: FIXED via Fix A (docstring corrected in update-student.ts; residual window documented, S-06 defensive obligation noted)

### F3 — Load-bearing server behavior has no CI-gated tests

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/students/api/ (missing unit test file)
- **Detail**: Guard rejection, insert-before-delete ordering, and create's compensating-cleanup wiring are covered only by the integration suite (describe.skip without env, excluded from `pnpm test`; CI runs `pnpm test` only). The courses sibling unit-tests its domain functions with a chainable fake Supabase (merge-actions.test.ts). A regression in the load-bearing ordering would pass CI today.
- **Fix**: Add student-actions.test.ts reusing the fake-Supabase harness: guard rejection, cleanup-on-link-failure, add-before-remove ordering.
- **Decision**: FIXED (student-actions.test.ts added — 9 tests covering create happy/cleanup/guard/empty-set and update ordering/no-op/guard/NOT_FOUND; suite 213/213)

### F4 — Cohort invariant unenforced on the course side

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/_pages/courses/api/update-course.ts (pre-existing)
- **Detail**: The invariant is enforced only at student-write time. updateCourse can move a course to another cohort with existing student_choices attached, silently invalidating the invariant for every student who picked it. Pre-existing, but load-bearing only now that students exist; S-06 consumes this data next. No DB constraint backs it.
- **Fix A ⭐ Recommended**: Guard in updateCourse rejecting cohort changes for courses with existing choices (follow-up change in the courses slice).
  - Strength: App-side, consistent with project rules; small and testable.
  - Tradeoff: App-side only; belongs to a follow-up, not this PR.
  - Confidence: HIGH.
  - Blind spot: TOCTOU between guard select and write remains (tiny, single-author tool).
- **Fix B**: DB trigger enforcing course-cohort vs choice consistency.
  - Strength: Closes the invariant for every write path incl. S-05 CSV import.
  - Tradeoff: Schema change + migration; project averse to DB logic.
  - Confidence: MEDIUM.
  - Blind spot: Trigger errors surface as raw Postgres errors the action layer doesn't translate.
- **Decision**: FIXED via Fix A (queued in follow-ups/review-fixes.md — updateCourse guard, courses-slice follow-up)

### F5 — choiceCourseIds lacks input hardening

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/students/model/schemas.ts:13
- **Detail**: Array is neither deduplicated nor bounded. A duplicate id (crafted call) survives diffChoices and hits the UNIQUE constraint as a 500 instead of a 4xx; same for two concurrent editors racing on overlapping toAdd. Unbounded array flows into `.in("id", …)` (URL-length blowup) and a bulk insert.
- **Fix**: `.max(64)` + `.transform(ids => [...new Set(ids)])` in the schema; optionally map Postgres 23505 to CONFLICT in the choice insert.
- **Decision**: FIXED (schema bounded + deduped; 23505→CONFLICT mapped in updateStudent's toAdd insert with CHOICES_CONFLICT_MESSAGE; 3 new tests)

### F6 — Stale URL course filter silently empties the table

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/students/model/filter-params.ts:32-35
- **Detail**: Course ids in the URL are validated against the global catalog but not the resolved cohort. `?cohort=B&courses=<cohort-A-course>` shows an empty table with a count badge of 1 but no visible chip; only "Clear" recovers.
- **Fix**: During parse, drop course ids whose cohortId doesn't match the resolved cohort.
- **Decision**: FIXED (readFilterParams now scopes course ids to the resolved cohort; tests updated + new cross-cohort case; 217/217)

### F7 — Badge-label formatter now duplicated verbatim

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/_pages/students/lib/labels.ts vs src/_pages/teachers/lib/labels.ts
- **Detail**: The plan declined promotion because teachers (compact) vs courses (verbose) formats differ — but the students copy is near-verbatim identical to the teachers one incl. CIRCLED_DIGITS. Two identical copies is the same "second consumer" threshold this plan used to justify promoting write-parent-with-links.
- **Fix**: Promote the compact formatter to shared/lib on next touch (no action in this PR).
- **Decision**: FIXED (promoted to `shared/lib/course-label/` as `formatCourseBadgeLabel`; both slice-local copies deleted, teachers + students consumers updated. Knock-on: hit steiger's 15-module shared/lib cap — grouped `apply-action-errors` under `shared/lib/actions/`; `call-action` stays flat to avoid a public-API sidestep and server-only imports in island bundles)

### F8 — Stale prefilled choice is counted but invisible in the picker

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/students/ui/StudentFormDialog.tsx:53-60,140
- **Detail**: A previously-chosen course that later becomes a merge parent (or moves cohort, see F4) is excluded from choiceItems: the trigger counts it but no chip renders and it can't be individually deselected; it round-trips on save (guard checks cohort only, not merge-parentness). Low likelihood today.
- **Fix**: Prune field.value to known picker items on dialog open (or render unknown ids as removable chips).
- **Decision**: FIXED (studentFormValues now prunes choice ids to renderable courses — same-cohort, non-merge-parent — on edit prefill)

### F9 — Unplanned-but-benign extras outside the plan's file list

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/shared/ui/multi-select.tsx, src/shared/lib/postgrest/, src/app/styles/global.css
- **Detail**: Four extras, all verified benign: (1) multi-select opt-in `modal` prop — required for the planned in-dialog usage, backward-compatible, documented in commit 05306d2; (2) same one-liner retrofitted to MergeBuilderDialog; (3) postgrest folderized to stay under steiger's shared/lib module cap (documented in same commit); (4) 4-line cosmetic cursor rule in global.css — the only undocumented, unforced extra. No token-rule violations.
- **Fix**: No code action; optionally note (1)–(4) as a plan addendum.
- **Decision**: SKIPPED (commit messages already document the substantive extras)
