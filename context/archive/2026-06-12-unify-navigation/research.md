---
date: 2026-06-12T13:40:31+02:00
researcher: Claude (Fable 5)
git_commit: da1c1f21e3b4c5a928fbaa33ed398616c5f07d5b
branch: main
repository: ib-timetable-planner
topic: "Unify sidebar + planner top-bar navigation into a single collapsible sidebar"
tags: [research, codebase, navigation, app-shell, sidebar, plan-detail, layouts]
status: complete
last_updated: 2026-06-12
last_updated_by: Claude (Fable 5)
last_updated_note: "Added follow-up research resolving the open questions (nav architecture, board default, tooltips, plan-name placement, scope)"
---

# Research: Unify navigation — collapsible sidebar replacing the dual sidebar/top-bar split

**Date**: 2026-06-12T13:40:31+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: `da1c1f2`
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Most pages use sidebar navigation; the planner page uses a top bar instead. Maintaining both is extra effort and confusing for users. Can a single sidebar with a collapse/expand option (icons + tooltips when collapsed, claude.ai-style) replace both — and would the collapsed rail actually save more horizontal space than the top bar approach does today?

## Summary

**The unification is very feasible, and the user's space intuition is correct.** Key facts:

1. **The dual navigation is real duplication.** The plan-scoped links (Courses / Teachers / Students) are defined twice: once centrally in `src/shared/config/nav.ts` (consumed by the sidebar) and once hand-inlined in `PlanDetailPage.astro`'s top bar — with diverging styling and *no active-state styling at all* in the top bar.
2. **The planner's top bar is ~90% navigation.** The only content that must survive its removal is the plan-name `<h1>` — and the sidebar layout already renders an equivalent plan-name breadcrumb on catalog pages. There is no save indicator, variant switcher, or undo control to relocate.
3. **A collapsed icon rail (~64px) is essentially free for the grid.** The dominant horizontal consumer on the planner is *not* navigation — it's the `PlannerPalette` at a fixed 320px (`lg:grid-cols-[20rem_1fr]`) plus ~72px of gaps/padding. On a 1440px viewport, a 64px rail shrinks day columns from ~200px to ~187px, far above their 112px (`minmax(7rem,1fr)`) floor. Even a fully **expanded** 240px sidebar fits without horizontal scroll down to ~1240px viewports — and the grid gracefully falls back to `overflow-auto` below that.
4. **History explains the split, and the premise has shifted.** The app-shell change (2026-06-07) explicitly kept the planner outside the shell ("focused full-screen workspace… preserves grid real-estate") and explicitly rejected the shadcn `sidebar` primitive because its collapse feature forced a `client:load` React island the app didn't need then. The collapse requirement now *is* needed — but it can still be met with the codebase's existing zero-hydration pattern (inline pre-paint script + `localStorage`, exactly like the theme toggle).
5. **Two primitives are missing**: there is no tooltip component and no shadcn sidebar component in `src/shared/ui/`. Tooltips for the collapsed rail can start as native `title` attributes (zero JS, matching the Astro sidebar) or a shadcn Tooltip if richer styling is wanted (requires islandizing nav items).
6. **The Y12/Y13 dual-cohort board (S-09) is coming**, which will roughly double horizontal pressure on the grid — strengthening the case for collapsed-by-default (or auto-collapsed on the board route) rather than re-litigating it later.

**Recommended direction** (for the plan phase): extend the hand-rolled `SidebarLayout.astro` with a collapse toggle (inline script + `localStorage`, pre-paint applied), add a `fullWidth` mode that bypasses the `max-w-5xl` content wrapper, move the planner into it (collapsed by default on the board route), and delete the top-bar nav from `PlanDetailPage.astro`. This keeps the SSR-first/zero-JS philosophy the app-shell change established while removing the duplication.

## Detailed Findings

### 1. The sidebar implementation (catalog pages)

- `src/app/layouts/SidebarLayout.astro:30` — hand-rolled Astro `<aside>`, **fixed `w-60` (240px)**, `shrink-0`, `bg-sidebar` tokens, zero client JS for nav. Wraps `BaseLayout`.
- Nav data is centralized in `src/shared/config/nav.ts`:
  - `GLOBAL_NAV_ITEMS` (lines 14–17): Home → `/dashboard`, Plans → `/plans`.
  - `planNavItems(planId)` (lines 20–25): Board → `/plans/{id}`, Courses, Teachers, Students.
  - **Every item already carries a `LucideIcon` and a label** — the config is icon-rail-ready with no changes.
- Active state: server-side via `Astro.url.pathname`, exact match for `/dashboard` and the board, prefix match otherwise; `aria-current="page"` (`SidebarLayout.astro:19-21`).
- Footer: user email, theme toggle (Sun/Moon, persists `"theme"` to `localStorage` via inline script, `SidebarLayout.astro:96-113,136-141`), sign-out.
- Content area: `<main class="flex-1 overflow-y-auto">` with an `mx-auto max-w-5xl px-8 py-10` wrapper (`SidebarLayout.astro:117-118`) — this wrapper is the main obstacle for hosting the full-bleed planner.
- **No responsive breakpoints at all** — the 240px sidebar is always visible, even on mobile.

### 2. The planner top bar (plan-detail)

- Route chain: `src/pages/plans/[id]/index.astro:11` → `PlanDetailShell.astro:2,13` (wraps **`BaseLayout`**, not `SidebarLayout`) → `PlanDetailPage.astro`.
- The header (`PlanDetailPage.astro:22-47`): `flex shrink-0 items-center gap-2 border-b px-6 py-3` (~52–56px tall) containing:
  - "← Plans" back link (lines 24–31) — redundant with the sidebar's Plans item.
  - Breadcrumb `/` + plan-name `<h1>` (lines 32–33) — **the only content that must survive**; read-only, no inline editing.
  - `<nav>` with Courses / Teachers / Students links (lines 35–46), hand-inlined at lines 15–19 — duplicating `planNavItems` minus Board. A comment at lines 13–14 documents the intent: "the board is the full-screen page, so it carries its own links."
  - **No active-state styling** on these links (the sidebar has `aria-current` + accent styling) — a concrete UX inconsistency.
- Below the header, inside the React island: `PlanSummaryBar` ("N courses left to place", `PlanSummaryBar.tsx:9`, ~37px) — unaffected by header removal.
- Nothing else lives in the top bar: no save indicator (placements save optimistically via `usePlacements`; failures surface in `ErrorBanner`, `PlannerBoard.tsx:60`), no variant tabs, no undo, no cohort switcher.

### 3. Horizontal-space arithmetic on the planner

- Board layout: `PlannerBoard.tsx:56` — `grid min-h-0 flex-1 gap-6 p-6 lg:grid-cols-[20rem_1fr]`. The **palette takes a fixed 320px** at `lg`; with gap + padding, ~392px of width goes to non-grid chrome already.
- Grid: `PlannerGrid.tsx:24-27` — `w-max min-w-full` wrapper, `gridTemplateColumns: auto repeat(${days}, minmax(7rem, 1fr))`. Hard minimum ≈ **600px** (label col + 5 × 112px); scrolls horizontally via the `overflow-auto` container (`PlannerBoard.tsx:61`). Presets: 5×6 / 5×8 / 5×10 (`src/shared/config/grid-presets.ts:10,21`).
- **Single cohort today**: `plan-detail/api/load.ts:13` — "The board is single-cohort for now (S-01 scope): Year 1. Year 2 arrives with S-09."
- Width budget on common viewports (palette visible, `lg`):

  | Viewport | Grid width today (no sidebar) | With 64px collapsed rail | With 240px expanded sidebar |
  |---|---|---|---|
  | 1440px | ~1048px (day cols ~200px) | ~984px (~187px) | ~808px (~152px) |
  | 1280px | ~888px (~168px) | ~824px (~155px) | ~648px (~120px) |
  | Scroll threshold | ~1000px viewport | ~1064px | ~1240px |

  A collapsed rail costs ~13px per day column — imperceptible. The expanded sidebar only bites on sub-1280px laptops, where the grid's existing `overflow-auto` fallback handles it. **Conclusion: the user's hypothesis holds — a collapsible sidebar more than replaces the top bar, and also returns ~90px of vertical space (header + its border) to the grid.**

### 4. What unification would touch

1. `src/app/layouts/SidebarLayout.astro` — add collapse state (icon-only + tooltips; persist preference in `localStorage` with a pre-paint inline script mirroring the theme pattern at lines 136–141, to avoid layout flash); add a `fullWidth` prop (or named slot) bypassing the `max-w-5xl px-8 py-10` wrapper at line 118.
2. `src/_pages/plan-detail/ui/PlanDetailShell.astro:2` — swap `BaseLayout` → `SidebarLayout`, pass `plan={{ id, name }}` for the plan sub-nav + breadcrumb.
3. `src/_pages/plan-detail/ui/PlanDetailPage.astro` — delete the back link and nav links (lines 15–19, 24–46); keep (or fold into the layout breadcrumb) the plan-name `<h1>`; change `h-screen` (line 22) to `h-full`/flex-child sizing since the layout now owns the viewport.
4. `src/_pages/plan-detail/ui/PlanDetailError.astro:6` — same height-ownership fix (`min-h-screen`).
5. `src/shared/config/nav.ts` — **no data changes needed**; icons + labels already exist per item.
6. `src/app/styles/global.css:33-40,69+` — sidebar tokens already exist; no new tokens needed (unless a Tooltip primitive is added — then audit per the detokenize-shadcn lesson).

### 5. Missing primitives & state mechanism

- `src/shared/ui/` inventory (16 shadcn primitives): alert-dialog, badge, button, command, dialog, dropdown-menu, form, input, label, multi-select, number-field, popover, select, table, tabs, sonner. **No `tooltip.tsx`, no `sidebar.tsx`.**
- Tooltip options for the collapsed rail:
  - **Native `title` attribute** — zero JS, works in the pure-Astro sidebar, consistent with the existing `title` usage on the user email (`SidebarLayout.astro:93-94`). Adequate for v1.
  - **shadcn Tooltip** (Radix) — richer visuals/delay control, but requires turning nav items into a React island, cutting against the app-shell decision's zero-hydration rationale.
- Persistence pattern already proven in-repo: theme is read from `localStorage` and applied **before first paint** via an inline script in `BaseLayout.astro:22-25` / `SidebarLayout.astro:139`. A `"sidebar-collapsed"` key can use the identical pattern (e.g. a class on `<html>` or the aside) so the rail renders collapsed without FOUC.

## Code References

Permalinks at commit `da1c1f2`:

- [`src/app/layouts/SidebarLayout.astro:30`](https://github.com/dobrek/ib-timetable-planner/blob/da1c1f21e3b4c5a928fbaa33ed398616c5f07d5b/src/app/layouts/SidebarLayout.astro#L30) — fixed `w-60` sidebar aside
- [`src/app/layouts/SidebarLayout.astro:117-118`](https://github.com/dobrek/ib-timetable-planner/blob/da1c1f21e3b4c5a928fbaa33ed398616c5f07d5b/src/app/layouts/SidebarLayout.astro#L117-L118) — `max-w-5xl` content wrapper (needs `fullWidth` bypass)
- [`src/shared/config/nav.ts:14-25`](https://github.com/dobrek/ib-timetable-planner/blob/da1c1f21e3b4c5a928fbaa33ed398616c5f07d5b/src/shared/config/nav.ts#L14-L25) — centralized nav config (icons + labels, rail-ready)
- [`src/_pages/plan-detail/ui/PlanDetailShell.astro:2`](https://github.com/dobrek/ib-timetable-planner/blob/da1c1f21e3b4c5a928fbaa33ed398616c5f07d5b/src/_pages/plan-detail/ui/PlanDetailShell.astro#L2) — planner wraps `BaseLayout`, not `SidebarLayout`
- [`src/_pages/plan-detail/ui/PlanDetailPage.astro:13-47`](https://github.com/dobrek/ib-timetable-planner/blob/da1c1f21e3b4c5a928fbaa33ed398616c5f07d5b/src/_pages/plan-detail/ui/PlanDetailPage.astro#L13-L47) — duplicated top-bar nav (no active state)
- [`src/_pages/plan-detail/ui/PlannerBoard.tsx:56-61`](https://github.com/dobrek/ib-timetable-planner/blob/da1c1f21e3b4c5a928fbaa33ed398616c5f07d5b/src/_pages/plan-detail/ui/PlannerBoard.tsx#L56-L61) — `lg:grid-cols-[20rem_1fr]` palette + `overflow-auto` grid container
- [`src/_pages/plan-detail/ui/PlannerGrid.tsx:24-27`](https://github.com/dobrek/ib-timetable-planner/blob/da1c1f21e3b4c5a928fbaa33ed398616c5f07d5b/src/_pages/plan-detail/ui/PlannerGrid.tsx#L24-L27) — `minmax(7rem,1fr)` day columns, `w-max min-w-full`
- [`src/_pages/plan-detail/api/load.ts:13`](https://github.com/dobrek/ib-timetable-planner/blob/da1c1f21e3b4c5a928fbaa33ed398616c5f07d5b/src/_pages/plan-detail/api/load.ts#L13) — single-cohort note; Y2 arrives with S-09
- [`src/app/layouts/BaseLayout.astro:22-25`](https://github.com/dobrek/ib-timetable-planner/blob/da1c1f21e3b4c5a928fbaa33ed398616c5f07d5b/src/app/layouts/BaseLayout.astro#L22-L25) — pre-paint `localStorage` theme script (pattern to reuse for collapse state)
- [`src/shared/config/grid-presets.ts:10-21`](https://github.com/dobrek/ib-timetable-planner/blob/da1c1f21e3b4c5a928fbaa33ed398616c5f07d5b/src/shared/config/grid-presets.ts#L10-L21) — 5×6/5×8/5×10 grid presets

## Architecture Insights

- **SSR-first, zero-hydration nav is a deliberate convention**, not an accident: the app-shell change rejected the shadcn sidebar primitive specifically to avoid a `client:load` island for navigation. A collapsible version should honor this — an inline class-toggle script (like the theme toggle) achieves collapse without hydrating the nav.
- **Nav config and presentation are already separated** (`nav.ts` data, layout renders) — the planner top bar is the one place that violates this by inlining its own links. Unification removes the violation rather than adding abstraction.
- **The layout currently conflates "app shell" with "centered content page"** (`max-w-5xl` wrapper). Splitting these (shell vs. content-mode) is the structural prerequisite for hosting the full-bleed planner.
- **Height ownership** moves from page to layout: `PlanDetailPage`'s `h-screen` works only because it owns the viewport under `BaseLayout`; inside `SidebarLayout` it must become a flex child.
- Lessons that constrain implementation: semantic theme tokens only (sidebar tokens already exist); detokenize any newly scaffolded shadcn primitive (relevant if Tooltip is added).

## Historical Context (from prior changes)

- `context/archive/2026-06-07-app-shell/research.md` (Decision 1) — chose a "hand-rolled token-based Astro nav, left-sidebar layout. NOT the shadcn `sidebar` primitive… it forces the whole nav into a `client:load` React island… buying collapse/mobile-sheet/cmd+b that a laptop-first tool with ~5 flat sections doesn't need." → The cost-benefit has now flipped on *collapse* specifically, but the island objection can still be honored with an inline script.
- `context/archive/2026-06-07-app-shell/plan.md` (Key Discoveries) — "Planner is a focused full-screen workspace → stays outside the sidebar shell (gets a back-link only)"; plan-brief.md: "Preserves grid real-estate for the drag-drop authoring surface." → This is the decision the current research revisits, with arithmetic showing a collapsed rail costs the grid almost nothing.
- `context/archive/2026-06-07-app-shell/research.md` (Decision 2) — cohort switching is page-local, never a shell element (the planner must show both cohorts at once, per `prd.md` FR-009/FR-012). → The unified sidebar must not grow a cohort switcher.
- `context/archive/2026-06-08-architecture-refactor/research.md` — renamed `AppShellLayout` → `SidebarLayout`; confirmed the planner stays in the thin layout at that time.
- `context/foundation/prd.md:109-115` (FR-009, FR-012) — two cohorts share the slot grid and teacher pool; cross-cohort validation on every drop. The S-09 dual-cohort board will increase horizontal pressure, favoring collapsed-by-default on the board route.
- `context/foundation/ui-conventions.md` — no navigation/shell conventions recorded yet; this change would effectively set one.

## Related Research

- `context/archive/2026-06-07-app-shell/research.md` — original shell/navigation research (the decisions this change revisits).
- `context/archive/2026-06-08-architecture-refactor/research.md` — layout file naming and FSD placement of layouts.

## Open Questions

All resolved with the author on 2026-06-12 — see "Follow-up Research" below for decisions and rationale.

1. ~~**Default state on the board route**~~ → Resolved: collapsed by default on the board, sticky preference thereafter.
2. ~~**Tooltip fidelity**~~ → Resolved: native `title` tooltips for v1; nav stays Astro (no React island).
3. ~~**Plan-name placement after header removal**~~ → Resolved: slim board heading row (merge with `PlanSummaryBar`).
4. ~~**Mobile**~~ → Resolved: responsive sidebar behavior is **in scope** for this change.
5. ~~**Palette as the real space hog**~~ → Resolved: `PlannerPalette` collapse is **deferred** to a follow-up change.

## Follow-up Research 2026-06-12T13:55+02:00

The open questions were discussed with the author and resolved as follows.

### Decision 1 — Nav architecture: stay Astro; no React island for the nav

The central question was whether a React island for the nav is something to avoid or something that helps build the app better. **Decision: keep the nav a pure Astro component with an inline pre-paint script for collapse state.** Rationale:

- **Astro's MPA model removes React's payoff here.** Every navigation is a full page load; a React sidebar would mount, hydrate, live for one page view, and be discarded. The nav's only two pieces of state are better handled elsewhere: active route is known server-side (`Astro.url`), and collapse state *must* be applied by a pre-paint inline script regardless of approach (SSR cannot read `localStorage`; correcting at hydration causes a 240px→64px layout jump on every load). After those two, a React island manages nothing.
- **The inline-script pattern is established precedent, not a new paradigm** — the theme toggle (`BaseLayout.astro:22-25`, `SidebarLayout.astro:136-141`) does exactly this. The collapse toggle is ~10 lines following it.
- **Future interactivity doesn't require flipping the whole nav.** The app-shell research adopted "island-per-widget" as the grain: if the sidebar later needs a plan-switcher dropdown or command-palette trigger, that *widget* becomes a `client:load` island embedded inside the Astro sidebar; the links around it stay static HTML. Migration cost of a full flip later is also near zero (nav data centralized in `nav.ts`; Astro markup converts to JSX mechanically).
- **Re-evaluation triggers** (documented so the plan/impl phases know what would change this): (a) adopting Astro view transitions with `transition:persist`, making the sidebar long-lived across navigations; (b) collapse needing JS coordination with page content (today flexbox reflows the board automatically); (c) the sidebar accumulating 2–3 interactive widgets such that Astro-plus-embedded-islands seams cost more than one React tree.

### Decision 2 — Board route default: collapsed, sticky preference

First visit to `/plans/[id]` shows the icon rail; once the user toggles anywhere, their persisted `localStorage` preference wins everywhere. One persisted state, one route-level default override — no per-route memory.

### Decision 3 — Tooltips: native `title` for v1

Tooltips are nice-to-have, not a driver of the architecture. Start with native `title` attributes (zero JS, consistent with existing usage on the user email). Upgrade path if they feel lacking: CSS-only pseudo-element tooltips (themed, instant, still zero JS); a Radix/shadcn Tooltip island remains possible per Decision 1's widget pattern but is not planned.

### Decision 4 — Plan name: slim board heading row

Keep a minimal plan-name heading on the board page, merged with `PlanSummaryBar` into a single slim row (~40px), so the plan name stays visible even with the rail collapsed. The rest of the current top bar (back link, Courses/Teachers/Students links) is deleted outright.

### Decision 5 — Scope: include responsive sidebar; defer palette collapse

- **In scope:** the nav unification itself + mobile/responsive sidebar behavior (auto-collapse or off-canvas below `lg`) — today the 240px sidebar is always visible even on small screens.
- **Deferred to a follow-up change:** a collapse affordance for the 320px `PlannerPalette`, despite it being the dominant horizontal consumer on the board — keeping this change's blast radius to navigation only.
