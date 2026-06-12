# Unify Navigation (Collapsible Sidebar) Implementation Plan

## Overview

Replace the app's dual navigation — a static 240px sidebar on catalog pages and an ad-hoc top bar on the planner — with a single collapsible sidebar. Collapsed, it becomes a 64px icon rail with native `title` tooltips. The planner page joins the sidebar shell in a new full-bleed content mode, its top-bar navigation is deleted, and the plan name merges with the summary bar into one slim row. The sidebar stays a pure Astro component; collapse state is applied by a pre-paint inline script (the established theme-toggle pattern), with no React island.

## Current State Analysis

- `src/app/layouts/SidebarLayout.astro` — hand-rolled Astro sidebar, fixed `w-60`, zero client JS for nav; theme toggle uses an inline script + `localStorage` (`SidebarLayout.astro:136-141`). Content area hardcodes `mx-auto max-w-5xl px-8 py-10` and a plan breadcrumb (`SidebarLayout.astro:117-131`). No responsive behavior.
- `src/_pages/plan-detail/ui/PlanDetailPage.astro` — full-screen `<main class="flex h-screen flex-col">` with a header containing a back link, plan-name `<h1>`, and three nav links hand-inlined at lines 15-19, duplicating `planNavItems` minus Board, with no active state.
- `src/_pages/plan-detail/ui/PlanDetailShell.astro` — wraps `BaseLayout` (an `_pages` → `app` upward import that steiger tolerates only because it doesn't parse `.astro` frontmatter). The catalog routes establish the correct pattern: the route file owns the layout wrap (`src/pages/plans/[id]/courses.astro:23`).
- `PlannerBoard.tsx:43-49` — returns `ComputeGroupingsEmptyState` **without** `PlanSummaryBar` when groupings are empty; any plan-name rendering inside the island must cover both branches.
- Nav config is rail-ready: every item in `src/shared/config/nav.ts` already has a `LucideIcon` + label.
- `global.css:4` has `@custom-variant dark (&:is(.dark *));` — the exact pattern to mirror for a `collapsed` variant. All `--sidebar-*` tokens exist for light + dark.
- Pre-paint pattern: `BaseLayout.astro:20-26` applies the persisted theme to `document.documentElement` before first paint.

## Desired End State

One navigation system. Every authenticated page (dashboard, plans hub, catalog pages, planner board) renders inside `SidebarLayout`. The sidebar collapses to a 64px icon rail via a header toggle button or Cmd/Ctrl+B, animates over ~200ms, persists the preference in `localStorage`, defaults to collapsed on the board route (until the user expresses a preference) and on viewports below `lg`. The planner's top bar is gone; the plan name lives in a slim row with the placement summary. `PlanDetailShell.astro` no longer exists.

Verify by: `pnpm lint && pnpm steiger && pnpm test && pnpm build` clean, plus the manual checklist per phase.

### Key Discoveries:

- `@custom-variant` is the idiomatic Tailwind v4 mechanism for state-scoped styling — `@custom-variant collapsed (&:is(.sidebar-collapsed *));` lets all collapse styles live inline as `collapsed:*` utilities (`global.css:4` precedent).
- The route-file-owns-layout pattern (`courses.astro:23`) means Phase 2 can delete `PlanDetailShell.astro` entirely instead of perpetuating its upward import.
- `PlannerBoardProps` (`plan-detail/model/drag.ts`) is a domain type; `planName` is presentation-only and should be a separate component prop, not added to the domain type.
- Nested `<main>` is invalid HTML: once `SidebarLayout` owns `<main>`, `PlanDetailPage`'s root must become a `<div>`.

## What We're NOT Doing

- No collapse affordance for the 320px `PlannerPalette` (deferred follow-up — it is the dominant horizontal consumer, but out of this change's blast radius).
- No React island, no shadcn `sidebar`/`tooltip` primitives, no styled tooltips (native `title` only; CSS-tooltip upgrade is a possible follow-up).
- No off-canvas drawer / phone-optimized mode — below `lg` the rail force-collapses; that's the entire mobile story.
- No Astro view transitions / `transition:persist`.
- No changes to constraint logic, placements, palette, grid internals, or anything in `plan-detail/model/`.
- No per-route collapse memory — one global preference plus the board-route and small-viewport defaults.

## Implementation Approach

Three phases, each independently shippable. Phase 1 makes the existing sidebar collapsible (catalog pages only — planner untouched, so risk is isolated). Phase 2 migrates the planner into the shell and deletes the top bar. Phase 3 adds the small-viewport behavior and runs the full verification matrix.

State contract used throughout:

- `localStorage` key `"sidebar-collapsed"`, values `"true"` / `"false"`, absent = no preference.
- Collapsed state = class `sidebar-collapsed` on `document.documentElement` (mirrors `.dark`).
- Resolution order at load (final form after Phase 3): viewport `< lg` → collapsed; else stored preference if present; else collapsed iff board route (`/^\/plans\/[^/]+$/`); else expanded.
- Toggle (click or Cmd/Ctrl+B) flips the class and persists — except below `lg`, where it flips the class for the current page view without persisting (Phase 3).

## Critical Implementation Details

**Pre-paint, not hydration.** The collapse class must be applied by an `is:inline` script in `BaseLayout`'s `<head>` (extend the existing theme script's location, keep it a separate small script for clarity) so the sidebar renders at the correct width on first paint. Applying it any later produces a visible 240px→64px jump on every navigation.

**Label clipping during animation.** The width transition animates the aside; text labels must not wrap mid-transition. Put `overflow-hidden` + `whitespace-nowrap` on label-bearing elements so text clips during the 200ms animation, with `collapsed:hidden` as the resting state. Use `transition-[width] duration-200 motion-reduce:transition-none` on the aside.

**Keyboard shortcut guard.** Cmd/Ctrl+B must not fire while the user types: skip when `event.target` matches `input, textarea, select, [contenteditable]`. Keep `aria-expanded` on the toggle button in sync when toggling from either path.

**Height ownership moves to the layout.** `PlanDetailPage`'s `h-screen` works only because it owns the viewport under `BaseLayout`. Inside `SidebarLayout`'s `fullWidth` main (`flex min-w-0 flex-1 flex-col overflow-hidden`), the page root must be a `<div class="flex h-full min-h-0 flex-1 flex-col">` — and not a `<main>`, which the layout now provides.

---

## Phase 1: Collapsible Sidebar Core

### Overview

Make `SidebarLayout` collapsible on all pages that already use it. Planner untouched.

### Changes Required:

#### 1. Tailwind collapsed variant

**File**: `src/app/styles/global.css`

**Intent**: Enable `collapsed:*` utilities scoped to the html-level collapse class, so all collapse styling stays inline in the layout markup.

**Contract**: Add next to the dark variant (line 4):

```css
@custom-variant collapsed (&:is(.sidebar-collapsed *));
```

#### 2. Pre-paint collapse script

**File**: `src/app/layouts/BaseLayout.astro`

**Intent**: Apply the persisted collapse state to `<html>` before first paint, mirroring the theme script.

**Contract**: A second `is:inline` head script. Phase 1 form: if `localStorage.getItem("sidebar-collapsed") === "true"`, add `sidebar-collapsed` to `document.documentElement.classList`. (Board-route default lands in Phase 2; viewport override in Phase 3.) Harmless on pages without a sidebar (signin).

#### 3. Sidebar collapse UI + toggle script

**File**: `src/app/layouts/SidebarLayout.astro`

**Intent**: Rework the aside for two visual states and add the toggle mechanism. Expanded is today's 240px layout; collapsed is a 64px icon rail where every control keeps working.

**Contract**:

- Aside: `w-60` → add `collapsed:w-16`, `transition-[width] duration-200 motion-reduce:transition-none`, `overflow-hidden`.
- Header row becomes flex with the branding link (text gets `collapsed:hidden`) and a new toggle button: lucide `PanelLeft` icon, `aria-label="Toggle sidebar"`, `aria-expanded`, `aria-controls` pointing at the aside's `id`, `title` hint including the shortcut (e.g. `"Collapse sidebar (⌘B)"`).
- Nav links: add `title={item.label}`; label `<span>` gets `collapsed:hidden`; link gets `collapsed:justify-center collapsed:px-0` (icon centered). Active-state classes unchanged.
- Plan section: the uppercase plan-name `<p>` gets `collapsed:hidden`; the section keeps a visual separator in collapsed mode (e.g. `collapsed:border-t collapsed:border-sidebar-border` on the section wrapper). `role="group"`/`aria-label` unchanged.
- Footer: email `<p>` gets `collapsed:hidden`; theme toggle unchanged (already icon-only); sign-out button gains a lucide `LogOut` icon and `title="Sign out"`, with the text label `collapsed:hidden` and icon-only centered rendering when collapsed (form POST semantics unchanged).
- Extend the existing inline script (lines 136-141): toggle handler flips `sidebar-collapsed` on `document.documentElement`, persists to `localStorage`, syncs `aria-expanded`; `keydown` listener for Cmd/Ctrl+B with `preventDefault` and the typing guard (see Critical Implementation Details).

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- FSD check passes: `pnpm steiger`
- Unit tests pass: `pnpm test`
- Build passes: `pnpm build`

#### Manual Verification:

- Toggle collapses/expands on dashboard, plans hub, and all three catalog pages; state persists across reloads and cross-page navigation with no width flash on load
- Cmd/Ctrl+B toggles; does NOT fire while typing in a catalog form input or dialog
- Collapsed rail: all nav icons + plan-section separator + theme/sign-out icons reachable; `title` tooltips appear on hover; active item still highlighted
- Animation is smooth ~200ms; disabled under reduced-motion; correct in light and dark themes

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Planner Joins the Shell

### Overview

Move the board into `SidebarLayout` via a new full-bleed content mode, delete the top-bar navigation, merge plan name + summary into one slim row, and retire `PlanDetailShell.astro`.

### Changes Required:

#### 1. `fullWidth` content mode

**File**: `src/app/layouts/SidebarLayout.astro`

**Intent**: Let a page opt out of the centered `max-w-5xl` wrapper and breadcrumb to fill the content area edge-to-edge.

**Contract**: New optional prop `fullWidth?: boolean`. When true, `<main>` renders the slot directly with `class="flex min-w-0 flex-1 flex-col overflow-hidden"` (no wrapper div, no breadcrumb). When false/absent, markup is unchanged.

#### 2. Board-route collapsed default

**File**: `src/app/layouts/BaseLayout.astro`

**Intent**: First visit to a board (no stored preference) starts collapsed; an explicit preference always wins.

**Contract**: Pre-paint script becomes: stored preference if present, else collapsed iff `/^\/plans\/[^/]+$/.test(location.pathname)`.

#### 3. Route file owns the layout wrap

**File**: `src/pages/plans/[id]/index.astro`

**Intent**: Mirror the catalog-route pattern (`courses.astro`): wrap in `SidebarLayout` at the routing layer, branching on the load result. Removes the `_pages` → `app` upward import.

**Contract**: Success branch: `<SidebarLayout title={planName} plan={{ id: result.value.props.planId, name: result.value.planName }} fullWidth>` around `<PlanDetailPage>`. Error branch: `<SidebarLayout title={…}>` (normal mode, no `plan`) around `<PlanDetailError>`. Titles preserved from current `PlanDetailShell` logic.

#### 4. Delete the shell

**File**: `src/_pages/plan-detail/ui/PlanDetailShell.astro` (delete)

**Intent**: Superseded by change 3. Remove the file and any barrel export referencing it.

**Contract**: `git rm`; `pnpm build` confirms no dangling imports.

#### 5. Strip the top bar

**File**: `src/_pages/plan-detail/ui/PlanDetailPage.astro`

**Intent**: Delete the header (back link, breadcrumb, nav links — all redundant with the sidebar) and hand the plan name to the island.

**Contract**: Remove the `<header>`, `planLinks` array, and `ArrowLeft` import. Root element becomes `<div class="flex h-full min-h-0 flex-1 flex-col">` (not `<main>` — the layout owns it). Render `<PlannerBoard {...boardProps} planName={planName} client:load />`.

#### 6. Plan name into the island

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Accept the plan name and render it in both board branches so it survives the empty-groupings state.

**Contract**: Component props become `PlannerBoardProps & { planName: string }` (domain type in `model/drag.ts` unchanged). Pass `planName` to `PlanSummaryBar`; in the empty-groupings branch, render a heading row with the plan name above `ComputeGroupingsEmptyState`.

#### 7. Slim heading row

**File**: `src/_pages/plan-detail/ui/PlanSummaryBar.tsx`

**Intent**: One slim row carrying page identity + placement rollup, replacing the deleted header.

**Contract**: Props become `{ planName: string; incompleteCount: number }`. Renders `<h1>` (e.g. `text-base font-semibold`) left, the existing incomplete-count copy right (`ml-auto`). Keep `data-slot="plan-summary"` and `data-incomplete` (tests/tooling may reference them).

#### 8. Error page height fix

**File**: `src/_pages/plan-detail/ui/PlanDetailError.astro`

**Intent**: It now renders inside the layout's centered content mode, not the bare viewport.

**Contract**: Root `<main class="flex min-h-screen …">` becomes a non-`main` block without viewport sizing (e.g. a padded, centered `<div>` — visually consistent with `PlanScopedError.astro`).

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- FSD check passes: `pnpm steiger`
- Unit tests pass: `pnpm test`
- Build passes: `pnpm build`

#### Manual Verification:

- Board first visit (cleared `localStorage`): sidebar renders as collapsed rail with no flash; after the user expands it anywhere, the board respects the expanded preference
- All sidebar links work from the board; Board item shows active state; plan section shows the plan name when expanded
- Plan name + "N courses left to place" share one slim row; empty-groupings board still shows the plan name
- Not-found and unavailable plan states render inside the sidebar shell
- Drag-and-drop placement still feels instant (<200ms budget untouched); grid usable at 1280px and 1440px with rail collapsed and expanded; exactly one `<h1>` and one `<main>` in the DOM

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Responsive Behavior + Final Verification

### Overview

Force-collapse below `lg`, guard preference writes, and run the full verification matrix.

### Changes Required:

#### 1. Viewport override at load

**File**: `src/app/layouts/BaseLayout.astro`

**Intent**: Below `lg` (1024px) the sidebar always starts collapsed, regardless of stored preference.

**Contract**: Pre-paint script final form: `!window.matchMedia("(min-width: 1024px)").matches` forces collapsed; otherwise stored-pref-else-board-route logic from Phase 2. Evaluated at load only — no resize listener (MPA: every navigation re-evaluates).

#### 2. Preference write guard

**File**: `src/app/layouts/SidebarLayout.astro`

**Intent**: Toggling on a small viewport peeks the sidebar open for the current page view without overwriting the desktop preference.

**Contract**: In the toggle handler, persist to `localStorage` only when `window.matchMedia("(min-width: 1024px)").matches`; always flip the class and `aria-expanded`.

### Success Criteria:

#### Automated Verification:

- Full local CI gate passes: `pnpm lint && pnpm steiger && pnpm test && pnpm build`

#### Manual Verification:

- At <1024px: every page loads with the rail collapsed; toggle expands it for that page view; navigating re-collapses; desktop preference unchanged afterward
- At ≥1024px: behavior matrix from Phases 1–2 still holds (preference, board default, no flash)
- Sweep all routes in both themes and both sidebar states: dashboard, plans hub, board (with and without groupings), courses, teachers, students, signin (unaffected), not-found plan

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the manual matrix passed.

---

## Testing Strategy

### Unit Tests:

- No new unit tests: the changes are Astro markup + `is:inline` scripts (not importable into Vitest) and trivial prop threading. Existing suites must stay green (`pnpm test`).
- If the implementer extracts any pure helper (none planned), co-locate a `*.test.ts` per convention.

### Integration Tests:

- None — no data, API, or action changes.

### Manual Testing Steps:

1. Clear `localStorage`; visit `/dashboard` → expanded sidebar; toggle → collapses, animates, persists across reload and navigation to `/plans`.
2. Cmd/Ctrl+B on a catalog page; then focus a form input and press Cmd/Ctrl+B → no toggle.
3. Clear `localStorage`; visit a board URL directly → collapsed rail, no flash; expand → navigate to courses → still expanded; return to board → still expanded.
4. Board with no groupings → plan name visible above the empty state.
5. Narrow window below 1024px → reload → collapsed; toggle open → navigate → collapsed again; restore wide window → original preference honored.
6. Dark mode pass over collapsed + expanded states; reduced-motion (OS setting) disables the width animation.

## Performance Considerations

The <200ms drag-drop validation budget is untouched (no constraint-logic changes). The width transition is a 200ms one-shot CSS layout animation on navigation chrome — not in the drag hot path. The pre-paint scripts add ~10 lines of synchronous head JS, same class of cost as the existing theme script.

## Migration Notes

No data or schema changes. `PlanDetailShell.astro` is deleted; any external reference would fail the build. Users' existing `localStorage` has no `sidebar-collapsed` key, which correctly means "no preference."

## References

- Related research: `context/changes/unify-navigation/research.md` (incl. follow-up decisions, 2026-06-12)
- Catalog route layout pattern: `src/pages/plans/[id]/courses.astro:23`
- Pre-paint script pattern: `src/app/layouts/BaseLayout.astro:20-26`
- Theme toggle script pattern: `src/app/layouts/SidebarLayout.astro:136-141`
- Custom variant precedent: `src/app/styles/global.css:4`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Collapsible Sidebar Core

#### Automated

- [x] 1.1 Lint passes: `pnpm lint` — 2a7f653
- [x] 1.2 FSD check passes: `pnpm steiger` — 2a7f653
- [x] 1.3 Unit tests pass: `pnpm test` — 2a7f653
- [x] 1.4 Build passes: `pnpm build` — 2a7f653

#### Manual

- [x] 1.5 Toggle works on all sidebar pages; persists; no load flash — 2a7f653
- [x] 1.6 Cmd/Ctrl+B toggles; guarded while typing — 2a7f653
- [x] 1.7 Collapsed rail fully functional (icons, tooltips, active state, footer) — 2a7f653
- [x] 1.8 Animation smooth; reduced-motion honored; both themes correct — 2a7f653

### Phase 2: Planner Joins the Shell

#### Automated

- [x] 2.1 Lint passes: `pnpm lint` — 2c78cdf
- [x] 2.2 FSD check passes: `pnpm steiger` — 2c78cdf
- [x] 2.3 Unit tests pass: `pnpm test` — 2c78cdf
- [x] 2.4 Build passes: `pnpm build` — 2c78cdf

#### Manual

- [x] 2.5 Board defaults collapsed on first visit; sticky preference wins thereafter — 2c78cdf
- [x] 2.6 Sidebar nav works from board; Board item active; plan section labeled — 2c78cdf
- [x] 2.7 Plan name + summary in one slim row; survives empty-groupings state — 2c78cdf
- [x] 2.8 Error states render in shell — 2c78cdf
- [x] 2.9 Drag-drop unaffected; grid usable at 1280/1440; single h1/main — 2c78cdf

### Phase 3: Responsive Behavior + Final Verification

#### Automated

- [x] 3.1 Full local CI gate passes: `pnpm lint && pnpm steiger && pnpm test && pnpm build` — cc08858

#### Manual

- [x] 3.2 Below-lg force-collapse + non-persisting peek verified — cc08858
- [x] 3.3 Desktop matrix from Phases 1–2 still holds — cc08858
- [x] 3.4 Full route sweep in both themes and both sidebar states — cc08858
