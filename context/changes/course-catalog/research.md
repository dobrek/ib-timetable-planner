---
date: 2026-06-07T16:38:28+0200
researcher: Dobromir Kropielnicki
git_commit: 09fb5ff9c13df56102d2f495f33f48598e272378
branch: feat/course-catalog
repository: dobrek/ib-timetable-planner
topic: "S-02 course-and-dependency-catalog-ui — conventions & technology for the first CRUD feature"
tags: [research, codebase, crud, catalog, astro-actions, supabase, conventions]
status: complete
last_updated: 2026-06-07
last_updated_by: Dobromir Kropielnicki
---

# Research: S-02 Course Catalog — conventions & technology for the first CRUD feature

**Date**: 2026-06-07T16:38:28+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 09fb5ff9c13df56102d2f495f33f48598e272378
**Branch**: feat/course-catalog
**Repository**: dobrek/ib-timetable-planner

## Research Question

We are about to implement **S-02** from the roadmap (`course-and-dependency-catalog-ui`) — the project's **first CRUD-like feature**. Before planning, map the existing conventions/technology and decide the convention we want to adopt for CRUD going forward, across four dimensions: mutation/data layer, UI/form patterns, schema & types, and folder/file structure. Reach into current Astro 6 / supabase-js / shadcn docs, not just the codebase.

> Note: the change folder is `course-catalog`; it maps to roadmap **S-02 = `course-and-dependency-catalog-ui`** (FR-002, FR-003, FR-003A).

## Summary

**Two findings dominate and shape the whole plan:**

1. **The schema S-02 needs already exists.** F-02 (`minimal-domain-schema`) shipped `courses` (with `name`, `level`, `group_index`, **`hours_per_week`**), plus `course_overlaps` and `course_merges`. So S-02 is **almost pure UI + a mutation layer** — **zero new migrations** (the only thing that would force one is adding the deferred IB-group column). This is much smaller than the roadmap row implies.

2. **There is a real convention fork, and it's the heart of "what technology do we want".** S-01 established a **hand-rolled convention**: `src/pages/api/*.ts` endpoints, **manual validation functions** (no Zod), local `json()` helpers, server-side data loading in Astro frontmatter, and a React island doing optimistic mutations via `fetch`. The **idiomatic Astro 6 approach** for exactly this kind of internal CRUD is different: **Astro Actions + Zod + react-hook-form + shadcn `<Form>`/`<Table>`/`<Dialog>`**. None of those four libs are installed yet. **RESOLVED 2026-06-07:** adopt the Astro Actions path for catalog CRUD; keep S-01's API routes as the realtime hot path (see [Decisions](#decisions-resolved-2026-06-07)).

**The `level` column models merges, by design (corrected during follow-up).** `level` is `text` (not an enum) and the seed contains composite values (`AB+SL`, `SL+HL`, `AB+SL+HL`). These are **not dirty data or duplicates** — they are **merge-parent rows**. A merge is: 2+ atomic courses (clean levels, chosen by students) + one parent course whose `level` is the **derived join of the members' levels**, linked via `course_merges`. Verified with German B (Y1): atomic `German B SL` (h2) + `German B AB` (h2) are student-chosen; parent `German B AB+SL` (h4) is referenced only by `course_merges` (`gen-seed.mjs:121-131,333-351`; `merge_subjects.csv` rows like `German B,AB+SL,German B,AB`). **Consequence:** a DB-level enum on `level` would make every legitimate merge parent illegal — so the permissive text column is correct, and the `{SL,HL,AB,none}` enum belongs **only on the atomic-course form** (Zod), with composite levels produced as a *controlled output* of the merge builder.

Secondary findings: catalog tables have **no per-author owner column** (blanket-authenticated RLS); the **auth form components violate the semantic-token rule** (hardcoded colors) so they should not be copied verbatim; only `button`, `select`, `badge` shadcn primitives exist (no `input`, `label`, `dialog`, `table`, `toast`).

## Detailed Findings

### Schema & types — S-02's tables are already in place (F-02)

The `courses` table already carries everything FR-002 + FR-003A require, including weekly hours:

- `supabase/migrations/20260602185012_minimal_domain_schema.sql:28-48` — `courses(id, cohort_id, teacher_id, name, level text, group_index smallint default 0, hours_per_week smallint, …)`, with `constraint courses_unique unique (cohort_id, name, level, group_index)` and `constraint courses_hours_nonneg check (hours_per_week >= 0)`.
- Dependencies already modeled:
  - `course_overlaps` (`:50-57`) — directed `base_course_id` ← `dependent_course_id`, unique pair.
  - `course_merges` (`:59-66`) — `parent_course_id` groups `child_course_id`; merge-children carry `hours_per_week = 0` (the reason `0` is a valid hours value).

Key schema facts that affect the plan:

- **`level` is `text`, `group_index` is `smallint default 0` — NOT Postgres enums** (`:34-35`). Valid values are an app-layer concern. Seed even contains composite levels like `'AB+SL'`, `'SL+HL'`, `'AB+SL+HL'` beyond the PRD's `{SL,HL,AB,none}`. `group_index = 0` is the "none" sentinel. The grouping adapter encodes this at `src/lib/grouping/adapters/supabase.ts:151-156`.
- **No `owner`/`author_id` column** on any catalog table. RLS is blanket: `create policy "Authenticated users have full access" … for all to authenticated using (true) with check (true)` for all 12 tables (`:149-174`). Catalog is global to the instance — consistent with the PRD's single-school, single-Author model.
- **Generated types** live in `src/lib/database.types.ts` (e.g. `courses` Row/Insert/Update at `:205-255`). Helpers `Tables<>`, `TablesInsert<>`, `TablesUpdate<>` exported (`:487-599`). `Enums` is empty (`:474-476`) because there are no DB enums.
- **Domain-type projection pattern** (per `lessons.md` "port the mechanism, not the legacy shape"): code maps DB rows to app-native types rather than passing generated types around — e.g. `GroupingCourse` at `src/lib/grouping/types.ts:1-6` (`teacher_id`→`teacherKey`, `hours_per_week`→`hours`), and `loadPlannerData` maps rows to `PlannerGrouping` at `src/lib/planner/load.ts`.
- **Migration workflow** (`README.md:167-199`): `pnpm exec supabase migration new <name>` → edit SQL → `pnpm exec supabase db reset` (local, re-applies + seeds) / `pnpm exec supabase db push` (hosted). Seed `supabase/seed.sql` is **generated** by `scripts/gen-seed.mjs` from `data/dp1/` + `data/dp2/` CSVs. Types regenerate on `db push`/`reset`/`link` (no standalone npm script, no CI hook).

**Implication:** S-02 likely needs **no migration at all**, unless we decide to (a) add a DB-level CHECK/enum for `level`/`group_index` to harden validation, or (b) add the deferred IB-group attribute (roadmap S-02 Unknown / PRD Q4). Both are optional.

### Mutation / data layer — S-01's hand-rolled convention (no Zod, no Actions)

Existing write endpoints set a clear, repeated pattern (the routes even comment that they mirror each other):

- `src/pages/api/placements.ts:14-91` — `POST`/`DELETE` `APIRoute` handlers; body via `await context.request.json()`; validate with a pure function; respond with a **local `json(body, status)` helper** (`:89-90`). Status convention: `201` created, `200` idempotent/success, `400` bad input, `404` not found, `422` domain cap, `500` exception, `503` Supabase down. Unique-violation (`23505`) is handled **idempotently as 200**, not 409 (`:39-51`).
- `src/pages/api/grouping.ts:17-70` — same shape (`json()` helper duplicated at `:68-69`, manual UUID regex validation).
- **Validation = hand-rolled discriminated unions, no Zod anywhere.** `src/lib/placements/validate.ts:27-56`: `validatePlacementInsert(input): { ok: true; row } | { ok: false; error }`. `zod`/`yup`/`valibot` are **not in `package.json`**.
- **Supabase access**: `src/lib/supabase.ts:1-26` — single `createClient(headers, cookies)` using `@supabase/ssr` `createServerClient<Database>`, cookie-based session, returns `null` if env missing. Server-only env via `astro:env/server`. `src/middleware.ts:23-45` populates `context.locals.user` via `supabase.auth.getUser()` and gates non-public paths (redirect to `/auth/signin`). API routes re-create their own client; placements/grouping rely on the middleware gate rather than re-checking the user.
- **Read path = server-side in Astro frontmatter**, not via API routes. `src/pages/plans/[id].astro:7-10` calls `loadPlannerData(supabase, id)` (`src/lib/planner/load.ts:23-102`), which returns a **discriminated `{ kind: "ok" | "not-found" | "unavailable", … }`** and the page sets `Astro.response.status` accordingly. Mutations go through `/api/*`; initial reads do not.
- **Client mutation wrapper**: `src/lib/planner/client.ts:12-22` (`createPlacement`/`deletePlacement` = thin `fetch` wrappers, error extracted from `{ error }` envelope). The island hook `src/components/planner/usePlacements.ts:32-78` does **optimistic update with a temp `crypto.randomUUID()`**, reconciles the server id, rolls back on failure.

**No shared API helper module exists** — each route redefines `json()` locally. First CRUD is the moment to extract `src/lib/api.ts` if we keep this style.

### UI / form / component conventions

- **Installed shadcn primitives (only three):** `button` (`src/components/ui/button.tsx`, CVA variants), `select` (`select.tsx`, Radix), `badge` (`badge.tsx`), plus an Astro `LibBadge.astro`. **Missing and needed for CRUD:** `input`, `label`, `dialog`, `table`, `toast/sonner`, `textarea`, `checkbox`. `components.json` is `style: new-york`, `rsc:false`, `tsx:true`, aliases `@/components`, `@/lib`, `@/components/ui`, icons `lucide`.
- **No form stack installed:** `react-hook-form`, `@hookform/resolvers`, `zod` all absent from `package.json`.
- **Existing form precedent = auth (controlled inputs, native POST):** `src/components/auth/SignInForm.tsx:43` is a native `<form method="POST" action="/api/auth/signin">` with controlled inputs, an inline `validate()` (regex), `useFormStatus()` for the submit spinner (`SubmitButton.tsx:11-33`), errors in React state. **Caution:** these auth components **hardcode colors** (`FormField.tsx` `bg-white/10`, `text-blue-100/80`, `border-red-400`; `SubmitButton.tsx` `bg-purple-600`; `ServerError.tsx` red-*), which **violates `lessons.md` semantic-token rule**. Do **not** copy them verbatim — the planner components (`SlotCell.tsx`, `GroupingBox.tsx`) are the correct token-based examples (`bg-background`, `bg-secondary`, `ring-destructive`, `bg-accent`).
- **Astro→React island bridge:** `src/pages/plans/[id].astro` mounts `<PlannerBoard {...result.props} client:load />`; props are a typed object built server-side; `PlannerBoard.tsx:20-46` lifts state via a hook + `useMemo` derivations. A `/courses` page would follow the same shape (frontmatter load → island with `client:load`), or be largely server-rendered with small islands for the create/edit dialog.
- **Layout/shell:** `src/layouts/Layout.astro:1-50` is a thin wrapper (global CSS + config-missing `Banner`s + `<slot/>`). There is **no shared nav shell** — `Topbar.astro` exists but pages are mostly self-contained. A new catalog page needs to wire its own header/nav.
- **Theme** is fully token-driven: `src/styles/global.css` `:root`/`.dark` oklch vars + `@theme inline` mapping to `--color-*`; `@layer base` applies `bg-background text-foreground`. `cn()` in `src/lib/utils.ts:1-6` (clsx + tailwind-merge); Button/Badge use CVA.

### Idiomatic Astro 6 CRUD (docs research)

Version anchors: **Astro 6.0 stable (2026-03-10)** rebuilt `@astrojs/cloudflare` to run **workerd at every stage**; **Astro Actions stable since 4.15**, unchanged in 6; supabase-js v2 + `@supabase/ssr` current.

- **Mutations → Astro Actions** (`src/actions/index.ts`, `defineAction({ input: z…, handler })`, callable from islands via `import { actions } from 'astro:actions'` → `const { data, error } = await actions.createCourse(values)`). Gives typed client, automatic Zod validation, `isInputError()` field errors, `{data,error}` shape — i.e. what S-01 hand-rolls. **Works on the Cloudflare/workerd adapter**; the only Cloudflare-specific caveat is the advanced "persist action result across redirect" pattern (`getActionContext()`/`setActionResult()`) which would need a Workers KV store — **not needed for basic CRUD**.
- **Validation → Zod**, imported as `import { z } from 'astro/zod'` (version-aligned with Astro). Extract schema to `src/lib/schemas/course.ts` and share between the action `input` (authoritative server gate) and the client form resolver.
- **Form → react-hook-form + `@hookform/resolvers/zod` + shadcn `<Form>`**, call `actions.foo()` in the submit handler, map `error.fields` back via `form.setError`. **Do not** use React 19 `useActionState`/`useFormStatus` — those target React/Next server actions, not Astro Actions.
- **supabase-js on workerd**: edge-clean over HTTP/PostgREST. Pass platform `fetch` in client options to avoid a Node-shaped polyfill; use `@supabase/ssr` `createServerClient` **per request** (already done); `getUser()` for verified identity inside actions.
- **Revalidation**: MPA-style — **POST/Redirect/GET** (`Astro.getActionResult` + `Astro.redirect`) for plain form posts; for island calls, `navigate(currentPath)` from `astro:transitions/client` after success. **No `Astro.rerender()` API** exists.
- **shadcn Table**: use the **plain `<Table>` primitive** for a simple list — the TanStack `@tanstack/react-table` data-table recipe is **not** needed unless we later want client-side sort/filter/pagination. Pair with `<Dialog>` (create/edit) + `<AlertDialog>` (delete confirm).

## Code References

- `supabase/migrations/20260602185012_minimal_domain_schema.sql:28-48` — `courses` table (incl. `hours_per_week`, unique key, hours CHECK)
- `…minimal_domain_schema.sql:50-66` — `course_overlaps` + `course_merges` (S-02 dependencies, already present)
- `…minimal_domain_schema.sql:149-174` — blanket authenticated RLS, no owner columns
- `src/lib/database.types.ts:205-255` — generated `courses` Row/Insert/Update; helpers at `:487-599`
- `src/lib/grouping/types.ts:1-6`, `src/lib/grouping/adapters/supabase.ts:67-84,151-156` — domain projection + `level/group_index` encoding
- `src/pages/api/placements.ts:14-91` — hand-rolled CRUD endpoint convention (json helper `:89-90`, idempotent unique-violation `:39-51`)
- `src/lib/placements/validate.ts:27-56` — manual validation discriminated union (no Zod)
- `src/lib/supabase.ts:1-26`, `src/middleware.ts:23-45` — per-request SSR client + auth gate
- `src/pages/plans/[id].astro:1-35`, `src/lib/planner/load.ts:23-102` — server-frontmatter read + island mount
- `src/lib/planner/client.ts:12-22`, `src/components/planner/usePlacements.ts:32-78` — optimistic client mutation pattern
- `src/components/auth/SignInForm.tsx:43`, `FormField.tsx`, `SubmitButton.tsx:11-33` — auth form precedent (⚠ hardcoded colors, token-rule violations)
- `src/components/ui/{button,select,badge}.tsx`, `components.json` — installed shadcn surface
- `src/styles/global.css`, `src/lib/utils.ts:1-6` — theme tokens + `cn()`
- `README.md:167-199`, `scripts/gen-seed.mjs`, `supabase/config.toml:53-65` — migration + seed workflow

## Architecture Insights

**The central decision: hand-rolled (S-01 style) vs idiomatic Astro Actions for CRUD.** Both are viable; the trade-off:

- **Stay hand-rolled** (`/api/courses.ts` + manual validators + `fetch` from island): zero new deps, perfectly consistent with the *one* prior write feature (S-01). Cost: we re-implement what Actions give free (typed client, validation, field errors), and we duplicate `json()`/UUID checks again. Validation stays string-based and easy to drift from DB rules.
- **Adopt Astro Actions + Zod now** (the idiomatic path, and the one the user leaned toward by choosing "codebase + docs" depth): typed end-to-end, Zod schema shared client+server, less boilerplate per entity, scales better across the many CRUD slices ahead (S-03 teachers, S-04 students, S-05 import). Cost: introduces `zod`, `react-hook-form`, `@hookform/resolvers` + several shadcn components, and creates a *second* mutation style alongside S-01's API routes (mixed convention until/unless S-01 is migrated). Must verify a single Zod version in the island bundle (`pnpm why zod`).

**Recommendation (to confirm in `/10x-plan`):** Since S-02 is the first of a CRUD *family* (S-03/S-04/S-05 all repeat this shape) and the user explicitly wanted the idiomatic option researched, **adopt Astro Actions + Zod + react-hook-form + shadcn `<Table>`/`<Dialog>` as the catalog CRUD convention**, keep S-01's API routes as-is (they're a real-time mutation hot path, not form CRUD), and extract a shared `src/lib/schemas/` for Zod. This sets a clean, repeatable pattern for the catalog stream. If the user prefers minimal new tech / strict consistency, the fallback is hand-rolled `/api/courses.ts` mirroring `placements.ts`.

## Decisions (resolved 2026-06-07)

These were settled with the user during research and should flow straight into `/10x-plan`:

1. **CRUD convention → Astro Actions + Zod + react-hook-form + shadcn `<Table>`/`<Dialog>`.** Catalog mutations are Astro Actions (`src/actions/`) with a Zod `input`; the schema is shared from `src/lib/schemas/` between the action (server gate) and the RHF form resolver (client). S-01's `src/pages/api/*.ts` routes stay as-is (realtime hot path) — **no retrofit**. Durable rule recorded in `lessons.md` ("Two mutation styles, split by purpose").

   **Pinned dependency versions (verified on npm 2026-06-07 — use these, NOT the Zod-3-era defaults):**
   - **`zod@^4.4.3`** — Astro 6.3.7 already bundles **zod 4.4.3** (so `astro/zod` is Zod **4**). Add `zod@^4` as an explicit direct dep so pnpm dedupes to **one** runtime copy; import from `zod` in `src/lib/schemas/`. ⚠ Do **not** let the plan pin `zod@^3` — that creates a second Zod major and mismatches `astro/zod`.
   - **`react-hook-form@^7.77`** (React 19 supported).
   - **`@hookform/resolvers@^5.4`** — the **Zod-4-compatible** line (peer `react-hook-form: ^7.55`). ⚠ Do **not** use `@hookform/resolvers@^3` (Zod-3 era, common in tutorials). `zodResolver` imports from `@hookform/resolvers/zod`.
   - shadcn `input`/`label`/`dialog`/`table`/`form` — copied in via the shadcn CLI (`components.json` = `new-york` + Tailwind v4, compatible); not version-pinned.
   - Harmless: a `zod@3.25.76` already exists in the tree but is **dev-only** (via `eslint-plugin-react-compiler`) — never reaches the app bundle. After install, sanity-check with `pnpm why zod` that only **one** Zod 4.x reaches runtime.

2. **`level` / `group_index` validation → app-layer Zod enum on the atomic-course form only; NO DB CHECK/enum; IB-group deferred.**
   - Atomic course create/edit form: `level ∈ {SL, HL, AB, none}`, `group_index ∈ {1, 2, none}` enforced by Zod. **No free-text level.**
   - **No Postgres enum/CHECK on `level`** — composite levels (`AB+SL`, …) are legitimate merge-parent values; a DB enum would reject them.
   - IB Group (1–6) attribute (PRD Q4) **deferred** — it is the only thing that would force a migration. S-02 stays zero-migration.

3. **Merge UX → a dedicated "merge builder", composite level is derived, never typed.** A merge is created by selecting 2+ existing atomic courses; the user sets the merged session's teacher + hours; the system creates/updates the parent course with a **derived** composite level (`"AB+SL"` = members' levels joined) and the `course_merges` links. This is a distinct flow from the atomic-course form — *not* a course form with a locked level field. Overlaps follow the same "pick existing courses" relational pattern (directed base ← dependent). Deletion cascades.

**Other decisions to bake into the plan:**
- **Merge presentation in the list**: show a merge parent grouped with / tagged relative to its member courses, so an `AB+SL` entry never reads as a stray oddball next to dropdown-driven atomic courses. (Open sub-point, not a blocker.)
- **No owner column**: catalog is global; no per-author filtering needed (matches PRD single-Author model). Don't add scoping unless the plan deliberately changes the model.
- **Token discipline**: build new form components token-based from the start; do not reuse `auth/FormField.tsx` verbatim.
- **Cohort scoping**: `courses.cohort_id` is required — the catalog UI must operate within a cohort (Y1/Y2). Clarify how cohorts are selected/created in this slice (cohorts table exists; is there a cohort picker yet?).

## Historical Context (from prior changes)

- `context/changes/minimal-domain-schema/` (F-02) — produced the `courses`/`course_overlaps`/`course_merges` tables and `database.types.ts` this slice builds on. Schema is intentionally minimal + blanket RLS.
- `context/changes/first-valid-drop-with-validation/` (S-01) — established the hand-rolled API-route + optimistic-island mutation convention now under consideration as the CRUD baseline. PR #15 (`09fb5ff`).
- `context/changes/port-grouping-algorithm/` (F-03) — source of the domain-projection pattern and `lessons.md` rule #1.
- `context/foundation/lessons.md` — rule #1 (project domain types over legacy shapes) and rule #2 (semantic theme tokens, never hardcoded colors) both directly constrain this slice.

## Related Research

- None prior for this change. This is the first `research.md` under `context/changes/course-catalog/`.

## Open Questions

1. **CRUD convention (blocks plan shape):** ~~Astro Actions + Zod + RHF, or hand-rolled `/api/courses.ts` like S-01?~~ **RESOLVED 2026-06-07 — Astro Actions + Zod + react-hook-form + shadcn `<Table>`/`<Dialog>`** for catalog CRUD; S-01's API routes stay as-is (realtime hot path). Recorded as a durable rule in `context/foundation/lessons.md` ("Two mutation styles, split by purpose"). No retrofit of existing code required.
2. **Cohort selection in this slice:** courses are `cohort_id`-scoped; is there an existing cohort picker, or does S-02 also introduce minimal cohort selection/creation UI? Owner: user/design.
3. **`level`/`group_index` validation source of truth:** ~~app enum only or DB CHECK? allowed `level` set?~~ **RESOLVED 2026-06-07 — app-layer Zod enum (`{SL,HL,AB,none}` / `{1,2,none}`) on the atomic-course form only; NO DB CHECK** (composite levels are valid merge-parent values). See [Decisions](#decisions-resolved-2026-06-07).
4. **IB Group attribute (PRD Q4 / roadmap S-02 Unknown):** ~~add now or defer?~~ **RESOLVED 2026-06-07 — defer to v2** (keeps S-02 zero-migration). Owner: user.
5. **List vs page-per-entity UX:** single `/courses` table with create/edit `<Dialog>` (recommended), or separate routes? Owner: user/design. (Lean: single page + dialogs; confirm in `/10x-plan`.)
6. **Merge-parent presentation in the list:** how to group/tag a merge parent relative to its members so composite-level rows don't read as oddballs. Owner: design. (Open sub-point, not a blocker.)
