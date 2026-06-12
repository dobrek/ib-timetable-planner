<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Unify Navigation (Collapsible Sidebar)

- **Plan**: context/changes/unify-navigation/plan.md
- **Scope**: Full plan — Phases 1–3 of 3
- **Date**: 2026-06-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence summary

- All 10 planned contracts implemented as written (drift agent: 10× MATCH). `PlanDetailShell.astro` deleted with no dangling references; `src/_pages/plan-detail/model/` untouched across the commit range; all "NOT doing" guardrails respected.
- Deleting the shell removed the one `_pages` → `app` upward import — an architecture improvement.
- Automated gate (2026-06-12): `pnpm lint` ✅, `pnpm steiger` ✅, `pnpm test` ✅ (235/235), `pnpm build` ✅.
- Both new inline scripts are fully static (no interpolation → no XSS surface); all styling uses semantic tokens.
- Minor beyond-plan touches (platform-aware shortcut hint, plan-name truncate/title, centered collapsed footer rows) are within the plan's "e.g." latitude — not flagged.

## Findings

### F1 — Cmd/Ctrl+B handler also hijacks Shift/Alt variants

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/layouts/SidebarLayout.astro:195-198
- **Detail**: Keydown handler checks only meta/ctrl + "b" with unconditional preventDefault(), so Cmd+Shift+B (Chrome bookmarks bar) and Ctrl+Shift+B (Firefox/Edge bookmarks UI) are also captured and toggle the sidebar.
- **Fix**: Add `if (event.shiftKey || event.altKey) return;` before preventDefault() in the keydown handler.
- **Decision**: FIXED

### F2 — Storage failure defeats the below-lg force-collapse

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/layouts/BaseLayout.astro:32-38
- **Detail**: Pre-paint script's first statement is an unguarded localStorage.getItem(). Where storage access throws (blocked site data, legacy Safari private mode), the script aborts before the matchMedia check, so small viewports get the full 240px rail.
- **Fix**: Evaluate the matchMedia check before reading localStorage (or wrap the read in try/catch) so the mobile default survives storage failure.
- **Decision**: FIXED (try/catch around the read; failure treated as no preference)

### F3 — aria-expanded sync skipped if localStorage.setItem throws

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/layouts/SidebarLayout.astro:184-192
- **Detail**: In toggleSidebar the class flips, then setItem, then syncSidebarToggle(). If the write throws, the sync is skipped and aria-expanded/title go stale against the toggled class.
- **Fix**: Call syncSidebarToggle() before the persist step (or try/catch the write).
- **Decision**: FIXED (sync reordered before persist)

### F4 — Board-route collapsed default misses trailing-slash URLs

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/layouts/BaseLayout.astro:35
- **Detail**: `/^\/plans\/[^/]+$/` does not match `/plans/<id>/`, which Astro's default trailingSlash "ignore" serves, so the board-defaults-collapsed heuristic silently no-ops there. The regex is exactly what the plan specified — a plan flaw surfaced by review, not drift.
- **Fix**: Allow an optional trailing slash: `/^\/plans\/[^/]+\/?$/`.
- **Decision**: SKIPPED (fix applied during triage, then reverted — accepted as-is)

### F5 — SSR hardcodes aria-expanded="true" until end-of-body sync

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/layouts/SidebarLayout.astro:49
- **Detail**: Toggle button ships aria-expanded="true" in server markup; when the pre-paint script collapses the rail, the attribute is wrong until the end-of-body script runs syncSidebarToggle(). Window is effectively one paint cycle.
- **Fix**: Accept as-is, or run syncSidebarToggle from a small is:inline script immediately after the aside.
- **Decision**: SKIPPED (accepted as-is — one-paint sync window is negligible)
