<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Course Catalog (S-02)

- **Plan**: context/changes/course-catalog/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-06-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated gate (all green): `pnpm why zod` (single 4.4.3 reaches app; 3.x dev-only), `pnpm test` (83 passed), `astro check` (0 errors), `pnpm lint` (clean), `pnpm build` (complete). All 25 Progress checkboxes `[x]`; every deviation documented in `change.md` and faithfully reflected in code. Auth guard — the critical check given `/_actions/*` bypasses the middleware redirect — verified present on all 5 action handlers via `requireSession`.

## Findings

### F1 — Unbounded reads on course_merges / course_overlaps

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/courses.astro:28-29
- **Detail**: The `course_merges` and `course_overlaps` selects lacked the `.limit(500)` defensive cap that the `courses`/`teachers` selects two lines above use (matching the `plans/index.astro` precedent and the plan's "limit the fetches defensively" note).
- **Fix**: Added `.limit(500)` to both selects.
- **Decision**: FIXED

### F2 — Literal colors in stock shadcn primitives

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/button.tsx:14, badge.tsx:15, alert-dialog.tsx:24, dialog.tsx:31
- **Detail**: `text-white` on the destructive variant (button, badge) and `bg-black/50` overlays (dialog, alert-dialog) are literal colors that bypass the token system (lessons rule #2). Canonical shadcn output; the authored `src/components/courses/**` code was fully token-clean.
- **Fix**: Added `--destructive-foreground` and `--overlay` tokens to `global.css` (`:root` + `.dark` + `@theme inline` map); swapped `text-white` → `text-destructive-foreground` and `bg-black/50` → `bg-overlay`.
- **Decision**: FIXED + ACCEPTED-AS-RULE: "Detokenize shadcn primitives on add — the CLI ships literal colors" (appended to lessons.md)

### F3 — Extra UI primitives not in Phase 1's named list

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/ui/select.tsx, button.tsx (cursor-pointer DS touch)
- **Detail**: `select`/`button`/`badge` are load-bearing but were noted in the plan as pre-existing (`plan.md:99`). `badge.tsx` was not touched by this feature; `select`/`button`/`dropdown-menu`/`command` were modified only for the DS-level `cursor-pointer` addition (documented in `change.md` Phase 3 deviations). No "What We're NOT Doing" boundary crossed.
- **Fix**: Added a cross-reference in `plan.md:99` noting the pre-existing primitives were touched only for the DS-level `cursor-pointer` addition (see `change.md`).
- **Decision**: FIXED (documented in plan)
