# Unify Navigation (Collapsible Sidebar) — Plan Brief

> Full plan: `context/changes/unify-navigation/plan.md`
> Research: `context/changes/unify-navigation/research.md`

## What & Why

The app maintains two navigation systems: a static 240px sidebar on catalog pages and a hand-inlined top bar on the planner (added to preserve grid space). The links are defined twice, styled differently, and the top bar lacks active-state styling. We replace both with one collapsible sidebar — a 64px icon rail with tooltips when collapsed (claude.ai-style) — which costs the planner grid almost nothing (~13px per day column) while returning ~90px of vertical space.

## Starting Point

`SidebarLayout.astro` is a zero-JS Astro sidebar used by dashboard, plans hub, and the three catalog pages; nav data (icons + labels) is already centralized in `nav.ts`. The planner wraps bare `BaseLayout` via `PlanDetailShell.astro` and carries its own header with duplicated links. The theme toggle's pre-paint `localStorage` script is the proven pattern for flash-free client state.

## Desired End State

Every authenticated page lives in one sidebar shell. The sidebar collapses/expands via a header button or Cmd/Ctrl+B with a 200ms animation, remembers the preference, starts collapsed on board routes (until a preference exists) and always below 1024px. The planner's top bar is gone; the plan name shares a slim row with the placement summary. `PlanDetailShell.astro` is deleted.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Nav architecture | Pure Astro + inline pre-paint script, no React island | MPA discards island state every navigation, and the pre-paint script is needed regardless; island would add cost for zero state to manage | Research |
| Board route default | Collapsed; sticky user preference wins thereafter | Maximizes grid space without fighting an expressed preference | Research |
| Tooltips | Native `title` attributes for v1 | Zero JS, upgradeable to CSS tooltips later; not an architecture driver | Research |
| Plan name placement | Slim row merged with `PlanSummaryBar` (name passed into the island) | Stays visible with rail collapsed; survives the empty-groupings branch | Research |
| Scope | Responsive sidebar in; `PlannerPalette` collapse deferred | Palette (320px) is the real space hog but belongs in its own change | Research |
| Mobile shape | Auto-collapse to rail below `lg`; no drawer | One mechanism, laptop-first PRD; phones out of scope | Plan |
| Toggle placement | Header row next to branding (PanelLeft icon) | Industry-standard spot, discoverable in both states | Plan |
| Keyboard shortcut | Cmd/Ctrl+B with typing guard | De-facto standard; ~5 lines in the existing script | Plan |
| Collapsed rail contents | Full icon column incl. theme + sign-out icons | Collapse never costs functionality | Plan |
| Animation | 200ms width transition, `prefers-reduced-motion` honored | Matches the polish that inspired the change; pure CSS | Plan |
| Shell ownership | Route file wraps layout; delete `PlanDetailShell.astro` | Mirrors `courses.astro` pattern and removes an `_pages` → `app` upward import | Plan |

## Scope

**In scope:** collapsible sidebar (toggle, persistence, shortcut, animation, tooltips), `fullWidth` layout mode, planner migration + top-bar deletion, slim plan-name row, board-route collapsed default, force-collapse below `lg`.

**Out of scope:** palette collapse, styled tooltips, off-canvas mobile drawer, view transitions, any `plan-detail/model/` (constraint logic) changes.

## Architecture / Approach

State = one `localStorage` key (`"sidebar-collapsed"`) materialized as a `sidebar-collapsed` class on `<html>` by a pre-paint head script (mirrors the theme mechanism). Styling = a Tailwind v4 `@custom-variant collapsed` so all collapse styles are inline `collapsed:*` utilities in the layout. Resolution at load: viewport < `lg` → collapsed; else stored preference; else board route → collapsed; else expanded. The planner enters the shell through a new `fullWidth` prop on `SidebarLayout` that skips the `max-w-5xl` wrapper.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Collapsible sidebar core | Catalog pages get collapse/expand, shortcut, animation, persistence | FOUC if pre-paint script mis-ordered; label wrap during animation |
| 2. Planner joins the shell | Top bar deleted; board in `fullWidth` shell; slim heading row; shell file removed | Height-ownership regressions (`h-screen` → flex child); nested `<main>` |
| 3. Responsive + verification | Force-collapse below `lg`; full manual matrix + CI gate | Preference clobbering from small-viewport toggles (guarded) |

**Prerequisites:** none — no schema, API, or dependency changes.
**Estimated effort:** ~2 sessions; Phase 1 is the bulk, Phases 2–3 are mechanical.

## Open Risks & Assumptions

- steiger doesn't parse `.astro` frontmatter imports today; the plan removes the one upward import anyway (shell deletion) so a future steiger upgrade stays green.
- Assumes no other consumer imports `PlanDetailShell.astro` (build verifies).
- The 200ms width animation causes a one-shot grid reflow if toggled mid-drag — accepted as rare and harmless.

## Success Criteria (Summary)

- One navigation system: every authenticated route renders the same sidebar; the planner top bar and `PlanDetailShell.astro` no longer exist.
- Collapse works everywhere (button + Cmd/Ctrl+B), persists without flash, defaults collapsed on board and small viewports.
- `pnpm lint && pnpm steiger && pnpm test && pnpm build` clean; drag-drop latency budget untouched.
