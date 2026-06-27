<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Combined-view park-to-shelf gap

- **Plan**: context/changes/combined-view-park-gap/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-06-27
- **Verdict**: APPROVED
- **Findings**: 0 critical · 0 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (e2e not re-run in this review — see F1) |

## Summary

Tight, behavior-preserving bug fix. Parallel drift + safety/quality passes came back essentially clean:
every planned change is implemented as described, no scope creep, no CRITICAL/WARNING safety findings.

Live automated gates run during review (all green): `pnpm check` (0 errors/warnings/hints), `pnpm lint`
(clean), `pnpm steiger` (no problems), `pnpm test` (659 passed / 79 files), `pnpm build` (clean). The
Playwright e2e gate was not re-run here (needs the local Supabase stack + workerd preview); Progress
records it green at 067a7f1 including the fail-on-revert check (3.4).

Notable correctness confirmations: router stays pure of catalog data (carries IDs + cohort; board resolves
members via the shared helper); `parked-members.ts` reuses the app's own `ParkedMember`/`PlacementWeek`
types and is fully declarative (no accumulator loops) — satisfying the relevant `lessons.md` rules;
cohort routing is provably safe (the combined palette renders only the active cohort, so `paletteCohort`
cannot mis-tag); the empty-park guard is double-covered (`parkToShelf` early-return + `persistParkMembers`
guard); the <200ms drag budget is untouched (one `find` + one `map`, async persist).

## Findings

### F1 — E2E suite not re-executed in this review

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: e2e/specs/combined-shelf-park.spec.ts
- **Detail**: check/lint/steiger/test/build run live (all green). The Playwright e2e gate (Progress 3.1–3.4) was not re-run here — it needs the local Supabase stack + workerd preview. The spec exists, adheres to e2e/CLAUDE.md conventions, and Progress records it green at 067a7f1 incl. the fail-on-revert check (3.4). Coverage gap in this review, not a known defect.
- **Fix**: If a fresh green is wanted before the PR, run `pnpm exec playwright test combined-shelf-park` (stack up) or rely on CI's e2e job. Otherwise no action.
- **Decision**: SKIPPED — trust 067a7f1 green + CI e2e job.

### F2 — Two e2e helpers kept local, diverging from plan §3.1 text

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Scope Discipline
- **Location**: e2e/support/board.ts, e2e/specs/shelf-durability.spec.ts
- **Detail**: Plan §3.1 listed `parkedBadge` + `parkGroupingFromPalette` among helpers to promote into support/board.ts; they were kept local. Justified: the combined view has no summary-bar badge (so `parkedBadge` still has a single consumer), and the combined park needs a different post-park signal (the shelf's collapsed "Open shelf (N parked)" tab), so the combined spec uses its own `parkGroupingToCombinedShelf` — a genuinely different helper, not a copy. Promoting would violate the repo's "promote only on a 2nd consumer" rule. No duplication.
- **Fix**: Add a plan addendum noting the justified deviation so a future review doesn't re-flag it.
- **Decision**: FIXED — plan addendum appended under §3.1 (impl-review 2026-06-27).

### F3 — Minor naming / micro-redundancy notes

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/ui/CombinedPlannerBoard.tsx:151-155
- **Detail**: (a) Plan named the local helper `parkMembers`; impl calls it `parkToShelf` — actually better (avoids a clash with `actions.parkMembers` and mirrors the single board). (b) `parkToShelf(cohort, members)` re-looks-up `byCohort[cohort]` though `handleDrop` already resolved `state`; harmless, and the standalone signature deliberately mirrors the single board.
- **Fix**: Leave as-is — both are deliberate, defensible choices.
- **Decision**: SKIPPED — accepted as intentional.
