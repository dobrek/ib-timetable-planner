<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First Valid Drop with Validation (S-01)

- **Plan**: context/changes/first-valid-drop-with-validation/plan.md
- **Scope**: All 4 phases (complete)
- **Date**: 2026-06-07
- **Verdict**: NEEDS ATTENTION (all findings triaged and resolved)
- **Findings**: 0 critical · 3 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS (extra files are clean decomposition) |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | PASS (test 58✓ · lint✓ · build✓) |

## Findings

### F1 — PlannerBoard is a god-component (~209 lines, ~7 responsibilities)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: src/components/planner/PlannerBoard.tsx:24-209
- **Detail**: One component fused placement state + stale-ref bookkeeping, palette filter state, error state + banner, reactive derivations, persistence + optimistic-id reconciliation (addCourse/movePlacement/removePlacement each doing 4 things), DnD wiring + drop routing, and all rendering. Violated the project rule "each function does one thing."
- **Fix A ⭐ Recommended**: Extract usePlacements hook (state + persistence/reconciliation) and split PlanSummaryBar/ErrorBanner/PlannerPalette presentational components.
- **Decision**: FIXED via Fix A — created src/components/planner/usePlacements.ts (state + addCourse/movePlacement/removePlacement, ref guard, rollback), and PlanSummaryBar.tsx / ErrorBanner.tsx / PlannerPalette.tsx. PlannerBoard is now a ~95-line composition root. Stale-closure ref guard and insert-before-delete semantics preserved verbatim. lint/build/58 tests green.

### F2 — shadcn DS not adopted: raw <select>, raw <button>s, custom badge spans

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: GroupingFilter.tsx, SlotCell.tsx, GroupingBox.tsx, ErrorBanner.tsx
- **Detail**: shadcn is configured (components.json, new-york) but src/components/ui/ held only button.tsx + LibBadge.astro. The planner hand-rolled a native <select>, custom collision badge spans, and several raw <button>s instead of DS Select/Badge/Button.
- **Fix A ⭐ Recommended**: `pnpm dlx shadcn@latest add select badge`, then adopt Select in GroupingFilter, Badge in SlotCell, and reuse Button for the raw buttons.
- **Decision**: FIXED via Fix A — added src/components/ui/select.tsx + badge.tsx (radix-ui dep), adopted Select in GroupingFilter (sentinel "__all__" for the cleared filter), Badge variant="destructive" for the collision indicator in SlotCell, Button (ghost/icon/link) for the remove "×", grouping expand toggle, and ErrorBanner dismiss. Generated files reformatted to project Prettier style. dnd-kit refs unaffected (DS components are not drag targets). lint/build/58 tests green.

### F3 — Placements API has no tenancy/ownership scoping (IDOR)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/placements.ts:30-34, :69
- **Detail**: POST trusts client-supplied variant_id/cohort_id/course_id with no relationship check; DELETE removes by row id alone, so any authenticated user could delete any placement by UUID. RLS grants full access to the authenticated role (plan.md:12) and S-01 assumes a single trusted author.
- **Fix A ⭐ Recommended**: Accept as risk for S-01; record the assumption.
- **Decision**: ACCEPTED-AS-RISK — recorded under "Accepted risks" in change.md. Multi-tenant authz (user→plan ownership via RLS or explicit join) deferred; revisit before multiple staff use the planner.

### F4 — Semantic theme tokens already satisfied in the change

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/planner/* , src/styles/global.css:6-39
- **Detail**: Every new planner file is already semantic (bg-background, text-foreground, ring-destructive, …); zero hardcoded color/value utilities. Driving the app-wide light theme is just tuning :root oklch values in global.css. The one outlier was pre-existing: ui/LibBadge.astro hardcoded bg-blue-900/text-purple-200.
- **Fix**: No change needed in planner code; tune :root in global.css for the app-wide theme. (Optional: migrate LibBadge.astro.)
- **Decision**: ACCEPTED-AS-RULE: "Use semantic theme tokens, never hardcoded color/value Tailwind classes" appended to context/foundation/lessons.md. + FIXED — migrated ui/LibBadge.astro to semantic tokens (bg-secondary/text-secondary-foreground + bg-primary/text-primary-foreground).

### F5 — 409 unique-violation rolls back the optimistic chip

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/placements.ts (POST conflict path) / src/lib/planner/client.ts
- **Detail**: The route mapped placements_unique (23505) to a benign 409 returning only an error message, so createPlacement rolled back the optimistic chip even though the row exists server-side.
- **Fix**: Make the conflict path idempotent end-to-end.
- **Decision**: FIXED — on UNIQUE_VIOLATION the route now loads the existing row (by variant/cohort/course/day/period) and returns it as `{ placement }` with 200, so the client reconciles the real id through its normal success path (no rollback, no stuck temp-id). No client change required. lint/build/58 tests green.
