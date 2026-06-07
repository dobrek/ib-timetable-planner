---
date: 2026-06-07T17:45:00+0200
researcher: Dobromir Kropielnicki
git_commit: 12b2ee20e502196d2a5d0bcf2e70c9f56e8023ef
branch: feat/app-shell
repository: dobrek/ib-timetable-planner
topic: "app-shell — authenticated app shell & navigation convention: needs-first IA, nav pattern, cohort placement"
tags: [research, codebase, navigation, app-shell, layout, ia, cohort, shadcn-sidebar]
status: complete
last_updated: 2026-06-07
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Added Decisions section — nav pattern, cohort placement, home, route convention, label all resolved with user."
---

# Research: Authenticated app shell & navigation convention

**Date**: 2026-06-07T17:45:00+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 12b2ee20e502196d2a5d0bcf2e70c9f56e8023ef
**Branch**: feat/app-shell
**Repository**: dobrek/ib-timetable-planner

## Research Question

Introduce a minimal, token-based authenticated **app shell + navigation convention** so there's a coherent journey to reach the catalog and every future CRUD section (Teachers S-03, Students S-04, Import S-05, Plans) instead of each slice inventing its own nav or becoming an orphan island.

**Reframed during scoping (user steer):** *don't decide the chrome first.* Lead with **navigation needs** — every destination and every piece of globally-present state the shell might carry — then let the pattern (sidebar / topbar / hybrid) and the cohort-switcher question fall out of those needs. The cohort switcher is **one candidate element** in the inventory, not the framing.

Two original open questions from `change.md`:
1. Nav pattern — sidebar vs topbar vs other.
2. Cohort context placement — global switcher vs per-page.

Output mode (user-selected): **trade-offs + a lean, not a locked decision.** shadcn `sidebar` primitive: **evaluate cost vs hand-rolled.**

## Summary

**The needs-first lens changes the shape of the answer.** Three findings dominate:

1. **The IA is shallow two-level, ~4–5 top-level sections, and the planner is the deep branch** — not a flat list of peers. Catalog (Students, Teachers, Courses) are flat equal-weight peers; **Plans → Variant → Planner grid → {Groupings, Y1/Y2 mode, Finalize, Export}** is a container with heavy nested workspace state. Import is a child of Students, not a peer. (`prd.md`, `roadmap.md`.)

2. **Cohort is NOT a global shell-level switch — the data model forbids it.** A plan/variant **spans both cohorts on one shared slot grid simultaneously**; `placements`/`course_groupings` are keyed `(variant_id, cohort_id, …)` and the validator's whole job is the **cross-cohort** constraint (a Y1-busy teacher blocks the same Y2 slot). A global "current cohort" toggle would *hide exactly the data the planner must show at once.* Cohort is a **per-section scoping attribute** (`courses`/`students`/`placements`/`course_groupings` each carry NOT-NULL `cohort_id`; `plans`/`plan_variants`/`teachers` are cohort-agnostic). So: cohort belongs **page-local** — a picker on the catalog screens (one cohort at a time there), a **Y1/Y2 mode/layer toggle inside the planner** (both loaded, one active for dropping) — **not** in the global shell. (`…minimal_domain_schema.sql:6-142`, `src/lib/planner/load.ts:34-68`, `prd.md:109-121`.)

3. **The shadcn sidebar's headline cost is already paid.** The bootstrap scaffold **pre-installed all 8 `--sidebar-*` tokens** (raw values in `:root`/`.dark` *and* `@theme inline` mappings) at `src/styles/global.css:31-38,65-72,103-110`, matching exactly what current shadcn ships. So "adopt sidebar" does **not** mean polluting the theme with a parallel token namespace — that namespace already exists and is unused. The remaining real cost is the **React-island hydration boundary** (provider/context wraps the whole nav, re-hydrates per full-page nav unless `transition:persist` + `<ClientRouter />`), which fights Astro's island-per-widget grain.

**What the shell must carry (the persistent-state inventory):** (a) **author identity + sign-out** (single-Author, single-school — no org/team/multi-tenant nav); (b) **navigation to ~4–5 sections** with the Plans branch going deeper; (c) **active Plan / active Variant** indicator+switcher is a strong shell-level candidate (variants are the unit of work and the PRD surfaces switching them, S-07). **What it must NOT carry:** a global cohort switch.

**Current state is a clean slate with violations to not copy.** One thin `Layout.astro` (no chrome) wraps everything; `Topbar` is used **only** in marketing `Welcome.astro`; `/plans/[id]` is a confirmed orphan (zero inbound links); `dashboard.astro` is a dead-end stub that **violates the semantic-token rule** (hardcoded `bg-white/10`, `from-blue-200`, …). There is **no PRD-mandated home/dashboard** — designing one is a shell decision, not a requirement. Only 3 shadcn primitives installed (button/select/badge); **no sidebar primitive yet** (but its tokens are ready).

**Naming to reconcile:** PRD/roadmap say **"Year 1 / Year 2"**; CLAUDE.md says **"Year 12 / Year 13"**; seed rows are **"Diploma Programme Year 1/2"**. Pick one label set for nav.

## Decisions (resolved 2026-06-07)

Settled with the user after research; these flow straight into `/10x-plan` as the implementation contract.

1. **Nav pattern → hand-rolled token-based Astro nav, left-sidebar layout.** NOT the shadcn `sidebar` primitive. The primitive's token cost is already paid (§F), but it forces the whole nav into a `client:load` React island + provider/context (re-hydrating per page), buying collapse/mobile-sheet/cmd+b that a laptop-first tool with ~5 flat sections doesn't need. A plain `<aside><nav>` in the layout, active state via `Astro.url.pathname` + `aria-current`, ships zero JS and is correct on first paint — aligned with the app's SSR-first, island-per-widget grain. Left sidebar (not topbar) because the IA is shallow-two-level (catalog group + plans group). Reserve a tiny island only for an optional user/account dropdown. *Revisit only if mobile/tablet is a hard requirement.*
2. **Cohort placement → page-local, NO shell element.** Forced by the schema (§D): the planner must show both cohorts at once, so a global switch would hide its core data. Catalog screens (Courses, Students) get a per-page cohort picker; the planner gets an internal Y1/Y2 mode toggle (a later slice); teachers get none; the shell carries no cohort affordance. Also resolves `course-catalog` open Q2.
3. **Home → rebuild `dashboard.astro` as a real token-based home** that links every section and **links to plans** (kills the orphan), built token-based from scratch (the current stub is the anti-example). **Redirect post-signin to `/dashboard` instead of `/`** — landing an authenticated author on the marketing page is the incoherence this change fixes (update `src/middleware.ts` / `src/pages/api/auth/signin.ts`).
4. **Route convention + `AppShellLayout` now; variant switcher deferred.** Establish `/courses`, `/teachers`, `/students`, `/plans` and ship `AppShellLayout` wrapping authenticated pages (thin `Layout.astro` retained for public/auth). Do NOT build the live "currently editing Plan/Variant" switcher — Plans (S-07) doesn't exist yet; that's gold-plating. The shell needs only a `/plans` nav entry today.
5. **Cohort label → "Year 1 / Year 2"** (match PRD/roadmap, not CLAUDE.md's "Year 12/13").

**Scope guard — explicitly OUT:** global cohort switcher (wrong primitive), live variant switcher (premature, pre-S-07), shadcn `sidebar` install (unnecessary weight). Highest-leverage decision is #2 (expensive to get wrong; the data model already decided it).

## Detailed Findings

### A. Navigation needs — destination inventory

Routes are **inferred** (no domain routes exist yet; only auth pages + the orphan planner do). Source: `prd.md` FRs + `roadmap.md` slices.

| Destination | Purpose | Slice | Exists? | Inferred route | Cohort-scoped? |
| --- | --- | --- | --- | --- | --- |
| Auth (signin/up/out) | Gated author provisioning | F-01 (FR-001) | **Yes** | `/auth/signin`, `/auth/signup` | — |
| **Courses & dependencies** | CRUD courses, hours, overlaps/merges | S-02 (FR-002/003/003A) | Planned | `/courses` | **Yes** (`courses.cohort_id`) |
| **Teachers & availability** | CRUD teachers, assignments, availability | S-03 (FR-004/005) | Planned | `/teachers` | **No** (cohort-agnostic) |
| **Students & choices** | CRUD students + per-cohort choices | S-04 (FR-006) | Planned | `/students` | **Yes** (`students.cohort_id`) |
| CSV import | Bulk-import choices, no silent overwrite | S-05 (FR-007) | Planned | child of Students (`/students/import`) | Yes (via students) |
| Groupings (recommendations) | Compute + view ranked groupings | S-06 (FR-013) | Planned | panel/action **inside planner**, not a peer | Yes (`course_groupings.cohort_id`) |
| **Plans / Variants** | Create plan, pick slot-grid, manage draft variants, mark final | S-07 (FR-008/010/014) | Planned | `/plans` | **No** (plan spans both) |
| **Planner / Grid editor** | Drag-drop placement + live validator; Y1 then Y2 | S-01/08/09 (FR-009/011/012) | Planned (orphan stub) | `/plans/:id/…` | per-row (`placements.cohort_id`) |
| Export | Master-grid CSV of final variant | S-10 (FR-015) | Planned | action on finalized variant | both cohorts in output |

**IA scale & shape:** ~4–5 top-level sections, **shallow two-level**, not flat. Flat catalog peers (Students, Teachers, Courses) + a deep Plans/Planner branch that owns Variants, the grid, the Groupings panel, the Y1/Y2 mode, Finalize, and Export. Import nests under Students. (Needs-inventory agent; `roadmap.md:162,178,186-253`.)

**No PRD-mandated dashboard/home** — the reference first session (`prd.md:41-48`) goes signin → seed catalog → create plan, with no landing page. A home is a net-new shell decision.

### B. Persistent (shell-candidate) state

- **Author identity + sign-out.** Single role **Author**, single school, no cross-school tenancy (`prd.md:161-167,176`). Variants carry per-author attribution (`prd.md:85`), and multiple authors may run parallel variants (`prd.md:29`) — but there is **no org/team/workspace switcher need.** Shell needs a "who am I / sign out" corner only.
- **Active Plan + active Variant.** A plan is a top-level object the author creates/selects (`prd.md:44`); it owns **multiple draft variants** the author switches between (`prd.md:110`, FR-010); S-07 surfaces variant switching (`roadmap.md:200-211`). **Strong candidate for a shell-level "currently editing: Plan X / Variant Y" indicator + switcher.**
- **Slot-grid preset** — set once at plan creation, fixed for life (`prd.md:107`). Property of the plan, **not** a live selector.
- **No term/year/school selectors.** "Year 1/Year 2" are IB cohorts within one programme, not selectable academic years.
- **Cohort (Y1/Y2)** — see §D. **Not** a shell-global switch.

### C. Primary user journeys (what the nav must connect, in order)

- **Journey A — first plan end-to-end** (`prd.md:41-48`, US-01): signin → seed catalog (students+choices, teachers+availability, courses+dependencies; order-flexible among themselves) → create plan + pick slot-grid + open variant → place **Year 1** groupings (live validation) → **switch to Year 2** within same variant (Y1 now fixed constraints) → mark variant final → export CSV.
- **Journey B — parallel variants** (`prd.md:74-78`, US-02): create a 2nd draft variant of the same plan; edit both independently; switch between them; only one is "final."
- **Journey C — north-star micro-journey** (`roadmap.md:26-28`, S-01): seeded catalog → open plan → drag one pre-seeded Y1 grouping onto a slot → see live student-collision feedback.

**Nav implication:** the journey is **Catalog → Plan → Variant → Planner**, so the shell must make the catalog sections reachable *and* make the active plan/variant reachable as a distinct, always-present context once you're editing.

### D. Cohort — the deciding data-model fact (kills the global switcher)

- `cohorts` is a thin lookup (`id`, unique `name`) with exactly **2 seed rows** "Diploma Programme Year 1/2" (`…minimal_domain_schema.sql:6-11`, `seed.sql:4-6`). No `year`/`order` column — ordering relies on the name sorting Y1 before Y2.
- **`cohort_id` is NOT NULL on** `courses` (`:31`), `students` (`:71`), `placements` (`:119`, part of unique key `:124`), `course_groupings` (`:134`). **Absent (cohort-agnostic) on** `teachers` (`:17`), `plans` (`:91`), `plan_variants` (`:103`).
- **A plan/variant spans BOTH cohorts on one shared grid.** `placements` unique key is `(variant_id, cohort_id, day, period, course_id)` — the same variant holds Y1 and Y2 placements side by side. PRD: a plan "spans two cohorts… that share the slot grid and the teacher pool"; "each variant captures placements for both cohorts" (`prd.md:109-110,121`).
- **The validator is inherently cross-cohort:** every drop checks "teacher collisions against the **other cohort's fixed placements**" (`prd.md:114`, FR-012). Both cohorts must be loaded while you edit one.
- **Current planner is single-cohort by an explicit S-01 scope cut**, not the target: `src/lib/planner/load.ts:34-42` hardcodes the alphabetically-first cohort ("S-01 is single-cohort"); `PlannerBoardProps.cohortId` is a single scalar (`src/components/planner/types.ts:38`). cohort id originates only in `load.ts` and is threaded → props → API bodies → rows.
- **No cohort-selection UI exists anywhere** (no picker, dropdown, or route param). The domain projection types drop cohort entirely (`src/lib/grouping/types.ts` has no cohort field — it's a pure upstream filter).

**Verdict:** cohort is a **per-section scoping attribute**, not a global session selection and not a per-plan attribute. Correct placement:
- **Catalog screens (Courses, Students):** genuinely one-cohort-at-a-time → a **page-local cohort picker** fits. (This also answers `course-catalog` open Q2.)
- **Planner:** must ultimately show **both cohorts together** → a **Y1/Y2 mode / layer toggle inside the planner** (which cohort am I dropping into; the other stays visible as fixed constraints) — **not** an exclusive global switch.
- **Teachers:** cohort-agnostic → no cohort control at all.
- If the shell offers any cohort affordance, it must be a non-exclusive default/hint a section can override or ignore — never an app-wide exclusive selection.

### E. Current shell / nav / layout state (the clean slate)

- **One layout, no chrome.** `src/layouts/Layout.astro:1-50` = HTML shell + global CSS + config-missing `Banner`s + single `<slot/>`. Wraps **all** pages (index, dashboard, signin, plans/[id]). **No `AppLayout` exists.**
- **Routes:** `/` (public, renders `Welcome`→`Topbar`), `/dashboard` (auth, dead-end), `/auth/signin` (auth), `/plans/[id]` (auth, **orphan**). API: `/api/auth/{signin,signout}`, `/api/placements`, `/api/grouping`.
- **`/plans/[id]` confirmed orphan** — zero inbound links anywhere; reachable only by typing a UUID URL.
- **`Topbar.astro` used only in `Welcome.astro`** (imported line 2, rendered line 28) → only on `/`. Itself token-violating (`border-white/10`, `bg-white/5`, `text-blue-100/70`, `text-purple-300`).
- **`dashboard.astro` is a dead-end stub** ("Welcome, {email}" + Sign out, links nowhere) and **violates the token rule**: `border-white/10 bg-white/10` (`:9`), `from-blue-200 to-purple-200` (`:10`), `text-blue-100/80` (`:13`), `text-blue-100/50` (`:16`), `border-white/20 bg-white/10 hover:bg-white/20` (`:20`). Do **not** copy.
- **Auth/protection** (`src/middleware.ts:1-45`): deny-by-default; public = `/auth/signin`, `/api/auth/*`, internals, static. Unauth → redirect `/auth/signin` (`:41`). Identity via `context.locals.user` from `supabase.auth.getUser()` (`:28-35`). **Post-signin lands on `/`** (index), which shows the auth-aware Topbar — i.e. today the authenticated entry point is the marketing page, not a real app home.
- **shadcn surface:** `components.json` = new-york, tailwind v4 (no config file), lucide, `cssVariables: true`. Installed: `button.tsx`, `select.tsx`, `badge.tsx`, `LibBadge.astro`. **No `sidebar` primitive.**

### F. Theme tokens — sidebar namespace already present

`src/styles/global.css` is fully token-driven (oklch `:root`/`.dark` + `@theme inline` → `--color-*`; base layer applies `bg-background text-foreground`). Available: background/foreground, card, primary, secondary, muted, accent, popover, destructive, border, input, ring, chart-1..5, **and the full `--sidebar*` set**.

**Verified directly (`global.css:31-38,65-72,103-110`):** all 8 sidebar tokens — `--sidebar`, `--sidebar-foreground`, `--sidebar-primary(-foreground)`, `--sidebar-accent(-foreground)`, `--sidebar-border`, `--sidebar-ring` — are defined in **both** `:root` and `.dark` with the exact oklch values current shadcn ships, **and** mapped in `@theme inline`. They are currently **unused**. (Note dark `--sidebar-primary: oklch(0.488 0.243 264.376)` is a chromatic purple, not neutral — a visual choice to be aware of if the sidebar uses `primary`.)

### G. Nav pattern & shadcn-sidebar cost (docs research, 2026)

**shadcn `sidebar` (`pnpm dlx shadcn@latest add sidebar`):**
- **~19 sub-components** (Provider, Sidebar, Header/Content/Footer, Group*, Menu*, Trigger, Rail, Inset, …) — a composition kit, not one component.
- Requires a **`SidebarProvider` context** wrapping the shell, a `useSidebar()` hook, **cookie-based collapse persistence** (`sidebar_state`), a global **cmd/ctrl+b** shortcut, and **mobile = `Sheet`** (pulls Radix Dialog).
- **Token cost = already paid** (§F) — the headline "add 8 tokens × 2 modes" does not apply here.
- **Real remaining cost = the hydration boundary.** State lives in React context, so the **whole nav becomes one `client:load` island** (can't keep most of the shell as static Astro + sprinkle one widget). In an MPA it **re-hydrates per full-page navigation** unless you add `<ClientRouter />` + `transition:persist`. This inverts Astro's island-per-widget grain.
- Tailwind v4 + new-york + React 19 supported (Feb 2025; `data-slot`, forwardRef removed); a known minor v4 sidebar layout/collapse-width quirk may need a small fix.

**Hand-rolled token-based Astro nav:** a plain `<aside><nav>` in the layout, active state via `Astro.url.pathname` + `aria-current`. **Zero client JS, zero hydration, zero new tokens** (reuses existing semantic tokens), correct on first paint. You build collapse-to-icon and mobile drawer yourself (small CSS/`<details>` or one tiny dedicated island), and there's no free cmd+b / cookie persistence.

**Astro shell patterns:** nested layouts + named slots for a shared `AppShellLayout`; `Astro.url.pathname` for active-link (SSR, no flash); `<ClientRouter />` upgrades to SPA-like nav and `transition:persist` keeps an island mounted across swaps. Idiomatic Astro = **static shell + small island only where interactivity lives** (e.g. a user dropdown), which the shadcn sidebar's context model works against.

| Dimension | shadcn `sidebar` | Hand-rolled token Astro nav |
| --- | --- | --- |
| Client JS / hydration | Whole nav = one island; re-hydrates per nav unless `transition:persist` | None (SSR); optional tiny island for one widget |
| New CSS tokens | **0 — already in `global.css`** | 0 |
| Dependencies | Provider/context, useSidebar, Sheet (Radix), cookie, cmd+b, ~19 parts | A `.astro` file (+ lucide icons) |
| Out-of-box | Collapsible, mobile sheet, persistence, keyboard, submenus, badges, skeletons | Active-link only; build collapse/mobile yourself |
| Fit for ~5 flat sections | Rich; much of the kit unused | Right-sized |
| Astro idiom | Inverts island-per-widget | Aligned |

## Code References

- `src/layouts/Layout.astro:1-50` — sole layout, no chrome, single slot
- `src/components/Topbar.astro:1-35` — only nav component; used only in `Welcome.astro` (token-violating)
- `src/components/Welcome.astro:2,28` — sole Topbar usage (route `/`)
- `src/pages/dashboard.astro:9-20` — dead-end stub; token violations (`:9,10,13,16,20`)
- `src/pages/plans/[id].astro:9` — orphan planner; `[id]` is the **plan** id (never cohort)
- `src/middleware.ts:7,28-35,41` — auth gate; `locals.user`; post-signin → `/`
- `src/components/ui/{button,select,badge}.tsx`, `components.json` — installed shadcn surface (no sidebar)
- `src/styles/global.css:31-38,65-72,103-110` — **all 8 `--sidebar*` tokens already defined + mapped**
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:6-11,17,31,71,91,103,119-134` — cohorts table + `cohort_id` propagation (scoped vs agnostic)
- `supabase/seed.sql:4-6` — exactly 2 cohorts
- `src/lib/planner/load.ts:34-42,62-68` — hardcoded single-cohort (Y1) S-01 scope cut
- `src/components/planner/types.ts:38` — `cohortId` single scalar in board props
- `src/pages/api/{placements,grouping}.ts` — cohort id arrives in request body, threaded from props
- `src/lib/grouping/types.ts` — domain projection drops cohort entirely
- `context/foundation/prd.md:41-48,85,107-121,153,161-167,176` — journeys, single-Author, cross-cohort, slot-grid-once
- `context/foundation/roadmap.md:26-28,63-66,162,178,186-253` — slices, current baseline, IA nesting

## Architecture Insights

- **Needs-first reframing pays off:** the cohort question is *answered by the schema*, not by UI taste — a global cohort switch is structurally wrong because the planner's core value (cross-cohort validation) requires both cohorts loaded at once. This is the single most decision-shaping finding.
- **The shell has two distinct zones, not one nav:** (1) **section navigation** (flat catalog peers + Plans) and (2) **active-plan/variant workspace context** (only meaningful once editing). A naive "put everything in one sidebar" misses that the planner is a focused workspace with its own internal state (Y1/Y2 mode, variant switch) that doesn't belong in the global nav.
- **shadcn sidebar is cheaper than it looks on tokens but costlier on architecture:** tokens are pre-installed (free), but it forces a whole-shell React island + provider/context in an otherwise SSR-first Astro MPA — the opposite of the island-per-widget idiom and of the token-discipline-but-static-first grain the rest of the app follows.
- **Token discipline (`lessons.md` rule #2) applies directly:** the existing `dashboard.astro`/`Topbar.astro` are the *anti-examples*; new shell UI must be built token-based from scratch. The planner components (`SlotCell`, `GroupingBox`) are the in-repo positive examples (per `course-catalog/research.md:78`).
- **Convention to set, minimally:** route convention `/courses`, `/teachers`, `/students`, `/plans` (catalog flat, plans deep), one `AppShellLayout` wrapping authenticated pages, the thin `Layout` retained for public/auth pages — exactly the `change.md` intended scope, now backed by evidence.

## Historical Context (from prior changes)

- `context/changes/course-catalog/research.md` — decided CRUD conventions (Astro Actions + Zod 4 + RHF + shadcn `<Table>`/`<Dialog>`); its **open Q2 "is there a cohort picker?"** is answered here: **none exists; cohort is per-section** (catalog screens get a page-local picker). Also notes `Layout.astro` has no shared nav (`:80`) and the planner components are the token-correct examples (`:78`).
- `context/changes/minimal-domain-schema/` (F-02) — produced `cohorts` + the `cohort_id` scoping this analysis rests on; "teachers are cohort-agnostic… each course belongs to one cohort."
- `context/changes/first-valid-drop-with-validation/` (S-01) — the single-cohort planner scope cut (`load.ts:34`) and the orphan `/plans/[id]` route.
- `context/foundation/lessons.md` — rule #2 (semantic tokens, never hardcoded colors) directly governs all new shell UI; rule #1 (project domain types) explains why cohort is a filter, not a carried field.

## Related Research

- `context/changes/course-catalog/research.md` — S-02 conventions; directly coupled via cohort-picker open question (now resolved here as per-section).

## Open Questions / Decisions to settle in `/10x-plan`

These are **leans**, not locked decisions (per the chosen trade-offs-only output mode):

1. **Nav pattern.** *Lean:* **hand-rolled token-based Astro nav** (sidebar OR topbar layout) for the section nav — SSR, token-pure, Astro-idiomatic, right-sized for ~5 flat sections; reserve a tiny island only for an interactive widget (user dropdown). The shadcn `sidebar` primitive is viable (tokens already installed) **if** rich collapse/mobile-sheet/keyboard behavior is wanted and the whole-shell-island + `transition:persist` cost is accepted. **Sidebar-vs-topbar layout** itself is a visual choice — a left sidebar scales better to a shallow-two-level IA (catalog group + plans group) on a laptop authoring tool; a topbar is simpler but cramped for grouped sub-nav. *Owner: user/design.*
2. **Cohort placement.** *Resolved by data model:* **page-local**, not global. Catalog screens → per-page cohort picker; planner → internal Y1/Y2 mode/layer toggle; teachers → none. Confirm the planner's eventual both-cohorts view is in-scope for a later slice (it's an S-01 scope cut today), so the shell makes no global cohort commitment now. *Owner: user — confirm we don't add a global switch.*
3. **Home/dashboard.** No PRD requirement. *Lean:* turn the `dashboard.astro` stub into a real token-based home that links into each section and **finally links to plans** (kills the orphan). Decide whether post-signin should redirect to this home instead of `/` (`middleware`/`api/auth/signin` currently land on the marketing page). *Owner: user/design.*
4. **Active-plan/variant context.** Is a shell-level "currently editing Plan/Variant" indicator+switcher in scope for *this* shell change, or deferred until Plans (S-07) exists? *Lean:* lay the route convention now, defer the live variant switcher to S-07 to avoid gold-plating before the plans section is real. *Owner: user.*
5. **Cohort label.** Reconcile "Year 1/Year 2" (PRD) vs "Year 12/Year 13" (CLAUDE.md) vs "Diploma Programme Year 1/2" (seed). Pick one for nav/UI copy. *Owner: user.*
6. **Token alignment for sidebar `primitive`-path only:** if shadcn sidebar is chosen, note dark `--sidebar-primary` is chromatic purple (`global.css:67`) — confirm intended or neutralize.
