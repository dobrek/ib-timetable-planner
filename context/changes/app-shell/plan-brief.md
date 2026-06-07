# Authenticated App Shell & Navigation Convention — Plan Brief

> Full plan: `context/changes/app-shell/plan.md`
> Research: `context/changes/app-shell/research.md`

## What & Why

The app currently has no navigation: the planner is an orphan reachable only by UUID, `/dashboard` is a dead-end stub, and the only nav (`Topbar`) lives on a marketing page. We're introducing a minimal, token-based authenticated **app shell** + route convention so there's a coherent journey to reach every section — and so future slices (Courses S-02, Teachers S-03, Students S-04, Plans S-07) inherit a convention instead of each inventing its own nav.

## Starting Point

One thin `Layout.astro` (no chrome) wraps every page. `Topbar` is used only in marketing `Welcome.astro`; `/dashboard` is a token-violating stub that links nowhere; `/plans/[id]` is a full-screen orphan. Auth gating already works (middleware → `/auth/signin`; `locals.user`). `lucide-react` and the full semantic token set (incl. 8 `--sidebar-*` tokens) are already present.

## Desired End State

An author signs in and lands on `/dashboard` — a real home inside `AppShellLayout` with a persistent left sidebar (Home, Courses, Teachers, Students, Plans). Every nav target resolves: catalog sections show "coming soon" stubs; **Plans** lists real plans from Supabase, each opening the full-screen planner (which now has a "Back to Plans" link). The marketing page is gone; `/` redirects to `/dashboard`. All new UI is semantic-token-based.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Nav pattern | Hand-rolled token Astro left sidebar | shadcn `sidebar` forces a whole-shell React island; hand-rolled is SSR, token-pure, right-sized for ~5 flat sections | Research |
| Cohort in shell | None | A plan spans both cohorts at once; a global switch would hide the planner's core data | Research |
| Unbuilt section links | Token-based stub pages | Nav never 404s; each future slice just fills its stub | Plan |
| Plans reachability | `/plans` index listing Supabase plans | Durable entry point that kills the orphan; matches the list pattern S-02 will use | Plan |
| Planner in shell? | No — stays full-screen + back-link | Preserves grid real-estate for the drag-drop authoring surface | Plan |
| Sidebar collapse | Static, no collapse/mobile | Laptop-first; avoid gold-plating | Plan |
| Marketing page | Removed; `/` → `/dashboard` | App is authenticated-only; the marketing page is unwanted | Plan |
| Auth-page restyle | Deferred to a future change | Keeps this change tight; login alignment is its own slice | Plan |
| Cohort label | "Year 1 / Year 2" | Matches PRD/roadmap | Research |

## Scope

**In scope:** `AppShellLayout` (sidebar nav + user/sign-out); real token-based `/dashboard` home; `/courses` `/teachers` `/students` stub pages; `/plans` index; planner back-link; post-signin → `/dashboard`; `/` → `/dashboard` redirect; delete `Welcome.astro` + `Topbar.astro` + marketing index body.

**Out of scope:** shadcn `sidebar` primitive; global cohort switcher; live Plan/Variant switcher; sidebar collapse/mobile; auth-page restyle; any catalog CRUD; planner internals.

## Architecture / Approach

A single typed nav list (`src/lib/nav.ts`) feeds `AppShellLayout.astro` (pure SSR, two-column: fixed sidebar + scrollable `<slot/>`). Active state is computed server-side from `Astro.url.pathname` (exact for Home, prefix for sections). Management pages (home, stubs, plans index) render inside the shell; the planner keeps its full-screen layout with only a back-link added. Styling uses the existing `--sidebar-*` and semantic tokens — no new deps, no client JS, no hydration.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shell foundation + home | `AppShellLayout` + nav list + rebuilt token-based `/dashboard` | Active-link matching edge cases (Home vs prefix) |
| 2. Section stubs | `/courses` `/teachers` `/students` placeholder pages in the shell | Trivial — keep stubs genuinely minimal |
| 3. Plans entry + marketing removal | `/plans` index, planner back-link, signin → dashboard, `/` redirect, delete marketing | Plans index empty/unavailable states; dangling refs after deletion |

**Prerequisites:** local Supabase stack + seed (for verifying the `/plans` list); nothing else — all deps present.
**Estimated effort:** ~1–2 sessions across 3 phases (small, mostly presentational).

## Open Risks & Assumptions

- Assumes seeded `plans` rows exist to verify the `/plans` index; if empty, the token-based empty state is what's shown.
- `lucide-react` icons must render cleanly under workerd in `.astro` (inline SVG is the fallback if any icon import misbehaves).
- Removing the marketing page assumes no external/bookmarked reliance on the cosmic landing — acceptable for an authenticated-only internal tool.

## Success Criteria (Summary)

- Author signs in → lands on `/dashboard` in the shell; every sidebar link resolves (no 404) with correct active highlighting.
- Plans are reachable via `/plans` and the planner links back — the orphan is gone.
- Marketing page removed, `/` redirects to `/dashboard`, and all new UI passes the no-hardcoded-color guard; `pnpm lint`/`build`/`test` green.
