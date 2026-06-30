<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Subject Colors

- **Plan**: context/changes/subject-colors/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-06-30
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verification (re-run this review)

| Check | Result |
|-------|--------|
| `pnpm check` (astro type-check) | PASS — 0 errors (480 files) |
| `pnpm test` (unit) | PASS — 855 tests / 99 files |
| `pnpm test:integration` | PASS — 70 tests / 19 files |
| `pnpm lint` | PASS |
| `pnpm steiger` (FSD) | PASS |
| `pnpm build` | PASS |
| `pnpm test:e2e -- subject-color-isolation` | Not re-run here (needs workerd preview + auth stack); spec exists, Progress-marked at a087ea0; same isolation invariant also covered by unit + integration suites |

**Isolation invariant CONFIRMED end-to-end**: `color` is absent from `GroupingCourse`, the
catalog-hash projection (`compute-catalog-hash.ts`), and the GroupingCourse `.map()` in
`load-cohort-courses.ts:60-84` — it reaches only the display half (`courseDisplay`). The <200ms
drag-drop validation budget and the staleness path are provably untouched.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Courses-table color dot extends beyond "What We're NOT Doing"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/_pages/courses/ui/CourseTable.tsx:96-104 (vs plan.md "What We're NOT Doing")
- **Detail**: The plan's "What We're NOT Doing" listed `CourseTable` as out of scope ("No color on the CRUD pages"). Commit fc83f28 adds a decorative `aria-hidden` color dot before the course name (documented in the commit as an intentional follow-up, cleanly built — renders nothing when uncolored, reuses `subjectChipClass`, no accessible name). The only gap was that the plan document still contradicted the shipped behavior.
- **Fix**: Added a "Post-plan addendum (fc83f28)" note to the plan's "What We're NOT Doing" bullet recording the decorative dot; Students/Teachers tables remain uncolored.
- **Decision**: FIXED (plan.md updated)

### F2 — Colored palette chip loses its color on hover

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/ui/palette/PaletteCourseChip.tsx:34-36
- **Detail**: Line 34 emits the subject pair; line 36 unconditionally added `hover:bg-accent hover:text-accent-foreground`, so a colored palette/grouping chip reverted to the neutral accent on hover while the board tile (`PlacedChip`) kept its color — an inconsistent treatment across surfaces. Deterministic and cosmetic.
- **Fix**: Gated the neutral hover utilities on the uncolored case (`color ? "active:cursor-grabbing" : "hover:bg-accent hover:text-accent-foreground active:cursor-grabbing"`) so a colored chip keeps its subject pair on hover. Lint + unit suite green after the change.
- **Decision**: FIXED (PaletteCourseChip.tsx updated)
