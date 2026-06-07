# Authenticated App Shell & Navigation Convention — Implementation Plan

## Overview

Introduce a minimal, token-based authenticated **app shell** so the app has a coherent navigation convention every future slice inherits, instead of each slice inventing its own nav or becoming an orphan island. Deliver a hand-rolled left-sidebar `AppShellLayout`, a real token-based home, walkable section stubs, a `/plans` index that makes the planner reachable, and remove the now-unwanted public marketing page (the app is authenticated-only).

## Current State Analysis

- **One thin layout, no chrome.** `src/layouts/Layout.astro:1-50` is HTML + global CSS + config `Banner`s + a single `<slot/>`. It wraps every page. There is **no authenticated shell**.
- **No navigation anywhere meaningful.** `Topbar.astro` is used **only** in marketing `Welcome.astro:2,28` (route `/`). The authenticated `/dashboard` and the planner have no nav at all.
- **`/dashboard` is a dead-end stub** (`src/pages/dashboard.astro:1-27`): "Welcome, {email}" + Sign out, links nowhere, and violates the semantic-token rule (`bg-white/10`, `from-blue-200 to-purple-200`, `text-blue-100/80`, … at `:9,10,13,16,20`).
- **`/plans/[id]` is an orphan** — zero inbound links; reachable only by typing a UUID. The planner renders **full-screen** inside the thin layout (`src/pages/plans/[id].astro` → `<main class="flex h-screen flex-col">` with its own `<header class="shrink-0 border-b px-6 py-4">`).
- **Auth gate already exists.** `src/middleware.ts:7,40-41` is deny-by-default; unauthenticated → `/auth/signin`. Identity is on `context.locals.user` (`:35`). Post-signin currently lands on `/` (`src/pages/api/auth/signin.ts:19`).
- **Marketing entry is `/`.** `src/pages/index.astro` renders `Welcome` (cosmic styling, `Topbar`). The product is authenticated-only, so this page is unwanted.
- **Assets ready:** `lucide-react@^1.16.0` is installed; `cn()` at `src/lib/utils.ts`; full semantic token set including the 8 `--sidebar-*` tokens already defined + mapped in `src/styles/global.css:31-38,65-72,103-110`. Token-correct examples: `src/components/planner/{SlotCell,GroupingBox}.tsx`.

## Desired End State

An authenticated author signing in lands on `/dashboard` — a real home rendered inside `AppShellLayout`, with a persistent left sidebar linking Home, Courses, Teachers, Students, Plans. Every nav target resolves: catalog sections show token-based "coming soon" stubs; **Plans** shows a list of real plans from Supabase, each opening the full-screen planner; the planner has a "Back to Plans" link. The marketing page is gone; `/` redirects to `/dashboard`. All new UI is semantic-token-based. The thin `Layout` is retained for the auth pages.

**Verify:** sign in → arrive at `/dashboard` in the shell; every sidebar link loads a real page (no 404); the active link is highlighted; `/plans` lists seeded plans and each opens `/plans/[id]`; the planner links back to `/plans`; visiting `/` redirects to `/dashboard`; `pnpm lint`, `pnpm build`, `pnpm test` pass.

### Key Discoveries:

- shadcn `sidebar` primitive is **rejected** (research Decision #1) — hand-rolled token Astro nav instead; tokens already exist so no theme pollution. (`research.md` §F, §G)
- Cohort is **not** a shell element — data-model-forced (`research.md` §D). The shell carries no cohort affordance.
- `lucide-react` already installed — icons need no new dep.
- Planner is a focused full-screen workspace → stays outside the sidebar shell (gets a back-link only).
- The 8 `--sidebar-*` tokens (`global.css:31-38,65-72,103-110`) are available for the nav surface.

## What We're NOT Doing

- **No shadcn `sidebar` primitive** (no React island, no `SidebarProvider`/context, no cookie/keyboard collapse).
- **No global cohort switcher** anywhere (the planner's eventual Y1/Y2 mode is a later slice; catalog cohort pickers belong to S-02+).
- **No live "currently editing Plan/Variant" switcher** — premature before Plans (S-07).
- **No collapse / mobile drawer** — static desktop sidebar only.
- **No auth-page restyle.** Aligning the login screen with the app theme is deferred to a **separate future change**; `/auth/*` stays as-is.
- **No CRUD** in the section stubs — they are placeholders only; real catalog UI is S-02–S-05.
- **No changes to the planner's internals** beyond adding a back-link in its header.

## Implementation Approach

Three incremental phases, each independently verifiable. Phase 1 builds the reusable `AppShellLayout` and proves it by rebuilding the dashboard home (the shell's first consumer). Phase 2 fills the catalog nav targets with stubs so the shell is fully walkable. Phase 3 makes plans reachable (killing the orphan) and removes the marketing page + fixes entry routing. The nav is a single source of truth (a typed section list) consumed by `AppShellLayout`; active state is computed server-side from `Astro.url.pathname`.

## Critical Implementation Details

- **Sidebar token usage.** Style the nav with the dedicated sidebar tokens (`bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent`/`text-sidebar-accent-foreground` for the active/hover item, `border-sidebar-border`) — they already resolve in light/dark. Note dark `--sidebar-primary` is a chromatic purple (`global.css:67`); only use `sidebar-primary` deliberately (e.g. an active accent), not as default text.
- **Active-link matching.** Home (`/dashboard`) must match exactly; section links should match on prefix (`pathname === href` for `/dashboard`, `pathname.startsWith(href)` for sections) so `/plans/[id]` still highlights "Plans". Set `aria-current="page"` on the active item.
- **`/` redirect.** `index.astro` becomes a server redirect to `/dashboard`; an unauthenticated hit to `/` is already intercepted by middleware → `/auth/signin`, so only authenticated users reach the redirect.

## Phase 1: Shell foundation + home

### Overview

Build the reusable `AppShellLayout` (token-based left sidebar nav + user/sign-out footer) and rebuild `dashboard.astro` as the real home rendered inside it.

### Changes Required:

#### 1. Navigation section list (single source of truth)

**File**: `src/lib/nav.ts` (new)

**Intent**: Define the top-level navigation sections once so `AppShellLayout` and any future consumer share one list. Keeps the route convention in one place.

**Contract**: Export a typed `readonly` array of `{ href, label, icon }` where `icon` is a `lucide-react` icon component. Sections in order: Home (`/dashboard`), Courses (`/courses`), Teachers (`/teachers`), Students (`/students`), Plans (`/plans`). Use `type` (not `interface`) for the item shape per project convention.

#### 2. The app shell layout

**File**: `src/layouts/AppShellLayout.astro` (new)

**Intent**: A persistent two-column authenticated shell — fixed-width left sidebar (brand + nav + user/sign-out footer) and a scrollable main content region rendering `<slot/>`. This is the convention every management page adopts. Pure Astro/SSR, no client JS.

**Contract**: Props `{ title?: string }`. **Composes `Layout.astro`** rather than duplicating its boilerplate — AppShellLayout renders `<Layout title={title}>` and places the two-column sidebar+main chrome inside its `<slot/>`. This keeps `<html>`/`<head>`/favicon/global-css and the `missingConfigs` `Banner` loop single-sourced in `Layout.astro` (the Banner renders where `Layout` already puts it, above the shell, so no extra placement decision). Renders the nav from `src/lib/nav.ts`, computing active state from `Astro.url.pathname` (exact match for `/dashboard`, prefix match for sections) with `aria-current="page"` and a `bg-sidebar-accent` active style. Footer shows `Astro.locals.user?.email` and a sign-out `<form method="POST" action="/api/auth/signout">`. All classes use semantic/sidebar tokens — no palette or arbitrary colors. Icons from `lucide-react` rendered as Astro-embedded components (or inline SVG if simpler under workerd). `.astro` file, not `.tsx`.

#### 3. Rebuild the dashboard as the home

**File**: `src/pages/dashboard.astro` (replace body)

**Intent**: Replace the token-violating dead-end stub with a real token-based home rendered inside `AppShellLayout`, greeting the user and linking into each section (entry cards or a simple list).

**Contract**: Uses `AppShellLayout` (not `Layout`). Greeting from `Astro.locals.user?.email`. Section entry links/cards reuse the same `src/lib/nav.ts` list (excluding Home). Zero hardcoded colors — `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-accent`, etc. Remove all `bg-white/*`, `from-blue-*`, `text-blue-*` classes.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- Type/content sync clean: `pnpm exec astro sync && pnpm build`
- No hardcoded color utilities in new files: `! grep -REn 'bg-white|from-blue|to-purple|text-blue-|text-purple-|slate-|gray-|bg-\[#' src/layouts/AppShellLayout.astro src/pages/dashboard.astro src/lib/nav.ts`

#### Manual Verification:

- Signing in and visiting `/dashboard` shows the sidebar shell with all five nav items and the user email + sign-out in the footer
- The active nav item is visually highlighted and carries `aria-current="page"`
- Sign-out from the footer works (returns to `/auth/signin`)
- Dashboard renders correctly in both light and dark with no palette colors

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks before Phase 2.

---

## Phase 2: Section stubs

### Overview

Create token-based placeholder pages for the catalog sections so every nav target resolves and the shell is fully walkable. Each slice (S-02–S-05) later replaces its stub.

### Changes Required:

#### 1. Catalog section stub pages

**File**: `src/pages/courses.astro`, `src/pages/teachers.astro`, `src/pages/students.astro` (new)

**Intent**: Minimal placeholder pages rendered in the shell, each stating the section name and that it's coming in its roadmap slice. Gives the nav real destinations and a consistent in-shell empty state for future slices to build on.

**Contract**: Each uses `AppShellLayout` with the appropriate `title`. Body = a token-based heading + short "coming in S-0x" muted note (Courses → S-02, Teachers → S-03, Students → S-04 incl. import S-05). Use `text-foreground`/`text-muted-foreground` only. Labels use "Year 1 / Year 2" terminology if any cohort wording appears.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- Build passes: `pnpm build`
- No hardcoded color utilities in stubs: `! grep -REn 'bg-white|from-blue|to-purple|text-blue-|text-purple-|slate-|gray-|bg-\[#' src/pages/courses.astro src/pages/teachers.astro src/pages/students.astro`

#### Manual Verification:

- Each of `/courses`, `/teachers`, `/students` loads inside the shell with the correct nav item highlighted
- No nav link 404s; navigation between sections preserves the sidebar

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 3.

---

## Phase 3: Plans entry + marketing removal

### Overview

Make plans reachable via a `/plans` index (killing the orphan), add a back-link in the planner, fix entry routing to land on `/dashboard`, and remove the public marketing page.

### Changes Required:

#### 1. Plans index page

**File**: `src/pages/plans/index.astro` (new)

**Intent**: List existing plans from Supabase, each linking to `/plans/[id]`, giving the planner a durable entry point and killing the orphan. Mirrors the server-frontmatter read pattern used by the planner page.

**Contract**: Renders in `AppShellLayout`. In frontmatter, create the Supabase client (`src/lib/supabase`, same pattern as `plans/[id].astro`) and select plans (id + name/identifying fields) ordered sensibly; handle the unavailable/empty cases (token-based empty state when no plans, 503-style note when Supabase is null). Each row is a link to `/plans/${id}`. No mutations (creating plans is S-07). Project DB rows to a small local view type rather than passing generated types around (per lessons rule #1).

#### 2. Planner back-link

**File**: `src/pages/plans/[id].astro` (edit header only)

**Intent**: Add a "Back to Plans" link in the existing planner header so the full-screen workspace is no longer a dead-end, without adopting the sidebar shell.

**Contract**: Insert a token-based `<a href="/plans">` (with a lucide back/chevron icon, optional) into the existing `<header class="shrink-0 border-b px-6 py-4">`. No other planner changes; the page keeps `Layout` and its full-screen `<main class="flex h-screen flex-col">`.

#### 3. Post-signin redirect → dashboard

**File**: `src/pages/api/auth/signin.ts` (edit)

**Intent**: Land authenticated users on the real home instead of the (removed) marketing page.

**Contract**: Change the success redirect at `:19` from `/` to `/dashboard`. Error redirects unchanged.

#### 4. `/` redirects to dashboard; remove marketing

**File**: `src/pages/index.astro` (replace), delete `src/components/Welcome.astro`, delete `src/components/Topbar.astro`

**Intent**: The app is authenticated-only — the marketing page is unwanted. `/` becomes a redirect to `/dashboard` (unauthenticated `/` is already intercepted by middleware → `/auth/signin`). Deleting `Welcome`/`Topbar` also removes their token violations.

**Contract**: `index.astro` frontmatter returns `Astro.redirect("/dashboard")` with no body. Confirm no remaining imports of `Welcome.astro` or `Topbar.astro` anywhere (`grep -REn 'Welcome\.astro|Topbar\.astro|<Welcome|<Topbar' src/` should return nothing after deletion — scoped to component usage so it doesn't match the word "Welcome" in greeting copy).

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- Build passes: `pnpm build`
- Tests pass: `pnpm test`
- No dangling references to removed components: `! grep -REn 'Welcome\.astro|Topbar\.astro|<Welcome|<Topbar' src/`
- No hardcoded color utilities in new/edited files: `! grep -REn 'bg-white|from-blue|to-purple|text-blue-|text-purple-|slate-|gray-|bg-\[#' src/pages/plans/index.astro`

#### Manual Verification:

- `/plans` lists seeded plans; clicking one opens the full-screen planner at `/plans/[id]`
- The planner header shows a working "Back to Plans" link
- Signing in lands on `/dashboard`
- Visiting `/` while authenticated redirects to `/dashboard`; while unauthenticated redirects to `/auth/signin`
- The marketing page is gone and nothing references the deleted components

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks.

---

## Testing Strategy

### Unit Tests:

- No new pure logic is introduced that warrants unit tests (shell is presentational; nav list is static data). The existing Vitest suite must remain green (`pnpm test`).

### Integration Tests:

- Out of scope — no DB writes added. The `/plans` index read is exercised via manual verification against the local Supabase stack.

### Manual Testing Steps:

1. Run `pnpm env:local` + local Supabase + `pnpm dev`; sign in → confirm landing on `/dashboard` in the shell.
2. Click each sidebar item → all resolve, active item highlights, sidebar persists.
3. Open `/plans` → see seeded plans → open one → planner loads full-screen → "Back to Plans" returns to the list.
4. Visit `/` (authenticated) → redirected to `/dashboard`; sign out → `/auth/signin`; visit `/` (unauthenticated) → `/auth/signin`.
5. Toggle dark mode → shell + home + stubs render with no palette colors.

## Performance Considerations

Shell is pure SSR with zero added client JS (no island, no hydration), so no runtime cost on navigation. The `/plans` index adds one lightweight Supabase select per visit — well within budget and unrelated to the <200ms placement path.

## Migration Notes

No data or schema changes. Deletions (`Welcome.astro`, `Topbar.astro`, marketing `index.astro` body) are safe — `Topbar` is only used by `Welcome`, and `Welcome` only by `index`. The auth pages and planner internals are untouched.

## References

- Research: `context/changes/app-shell/research.md` (Decisions section: nav pattern, cohort placement, home, route convention, label)
- Related: `context/changes/course-catalog/research.md` (catalog list/dialog conventions S-02 will use; cohort picker is per-section)
- Token rule: `context/foundation/lessons.md` ("Use semantic theme tokens, never hardcoded color/value Tailwind classes")
- Token-correct examples: `src/components/planner/SlotCell.tsx`, `src/components/planner/GroupingBox.tsx`
- Server-frontmatter read pattern: `src/pages/plans/[id].astro`, `src/lib/planner/load.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shell foundation + home

#### Automated

- [x] 1.1 Lint passes: `pnpm lint` — 47047ad
- [x] 1.2 Type/content sync clean + build: `pnpm exec astro sync && pnpm build` — 47047ad
- [x] 1.3 No hardcoded color utilities in new files (grep guard) — 47047ad

#### Manual

- [x] 1.4 `/dashboard` shows the sidebar shell with all five nav items + user email/sign-out — 47047ad
- [x] 1.5 Active nav item highlighted with `aria-current="page"` — 47047ad
- [x] 1.6 Footer sign-out works (returns to `/auth/signin`) — 47047ad
- [x] 1.7 Dashboard renders in light + dark with no palette colors — 47047ad

### Phase 2: Section stubs

#### Automated

- [x] 2.1 Lint passes: `pnpm lint` — da917a8
- [x] 2.2 Build passes: `pnpm build` — da917a8
- [x] 2.3 No hardcoded color utilities in stubs (grep guard) — da917a8

#### Manual

- [x] 2.4 `/courses`, `/teachers`, `/students` each load in the shell with correct active item — da917a8
- [x] 2.5 No nav link 404s; sidebar persists across navigation — da917a8

### Phase 3: Plans entry + marketing removal

#### Automated

- [x] 3.1 Lint passes: `pnpm lint`
- [x] 3.2 Build passes: `pnpm build`
- [x] 3.3 Tests pass: `pnpm test`
- [x] 3.4 No dangling references to removed components (grep guard)
- [x] 3.5 No hardcoded color utilities in `src/pages/plans/index.astro` (grep guard)

#### Manual

- [x] 3.6 `/plans` lists seeded plans; each opens `/plans/[id]`
- [x] 3.7 Planner header has a working "Back to Plans" link
- [x] 3.8 Sign-in lands on `/dashboard`
- [x] 3.9 `/` redirects: authenticated → `/dashboard`, unauthenticated → `/auth/signin`
- [x] 3.10 Marketing page gone; no references to deleted components
