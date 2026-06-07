<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Authenticated App Shell & Navigation Convention

- **Plan**: context/changes/app-shell/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-06-07
- **Verdict**: NEEDS ATTENTION (all findings triaged & resolved)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria all green: `pnpm lint` (clean), `pnpm test` (58 passed), `astro sync` + `pnpm build` (complete), both grep guards (no hardcoded colors, no dangling component refs).

## Findings

### F1 — Active nav item uses bg-sidebar-primary, not the contracted bg-sidebar-accent

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/layouts/AppShellLayout.astro:38-39
- **Detail**: Plan specified `bg-sidebar-accent` for the active item and warned dark `--sidebar-primary` is a chromatic purple. Implementation used `bg-sidebar-primary`. Root cause: the original `--sidebar-accent` had near-invisible contrast in light mode (sidebar 0.985 vs accent 0.97 = 0.015 delta), so the implementer reached for primary.
- **Decision**: FIXED (Fix differently) — retuned the `--sidebar-accent` token in `global.css` for real contrast in both modes (light 0.97→0.922, delta 0.063; dark 0.269→0.32, delta 0.115; foregrounds unchanged), then reverted the markup to `bg-sidebar-accent text-sidebar-accent-foreground` (active) and `hover:bg-sidebar-accent/50` (hover). Aligned the sign-out and theme-toggle button hovers to the same accent token for consistency. Honors the plan's semantic-token choice while solving the original light-mode contrast problem.

### F2 — Unplanned theme toggle + no-flash script (client JS against "no client JS" contract)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: src/layouts/AppShellLayout.astro:55-63,84-89; src/layouts/Layout.astro:20-26
- **Detail**: Plan scoped the shell as pure SSR with "no client JS"; dark mode was only a manual verification step. Implementation added a footer theme-toggle button, an `is:inline` localStorage click handler, and a no-flash bootstrap script in the non-target `Layout.astro`.
- **Decision**: ACCEPTED — kept the feature (useful in-app override; small, self-contained, no hydration). Documented as a plan addendum in `plan.md` (`## Addenda`) recording the deliberate, one-off relaxation of the "no client JS" constraint.

### F3 — /plans Supabase select is unbounded (no .limit())

- **Severity**: ◽ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/plans/index.astro:11
- **Detail**: `.select("id, name").order("name")` was ordered but unbounded. Plan count is inherently small, so a current non-issue; flagged for future-proofing.
- **Decision**: FIXED — added `.limit(200)` as a safety cap.

### F4 — index.astro redirect uses Astro.response 302, not `return Astro.redirect()`

- **Severity**: ◽ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/index.astro:6-8
- **Detail**: Contract said frontmatter "returns Astro.redirect('/dashboard')". Implementation sets `Astro.response.status = 302` + Location header (a top-level frontmatter `return` trips `@typescript-eslint/no-misused-promises`; same pattern as plans/[id].astro). Behavior is identical and the rationale is documented inline.
- **Decision**: ACCEPTED as-is — documented, lint-driven, behavior-equivalent. No change.

## Post-fix verification

`pnpm lint` clean, `pnpm build` complete, grep guard clean after all edits.
