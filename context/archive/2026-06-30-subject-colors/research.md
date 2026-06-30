---
date: 2026-06-30T16:21:19+0200
researcher: Dobromir Kropielnicki
git_commit: b0a7078e0421dfabaa88301b7a9c402e727f24e3
branch: main
repository: dobrek/ib-timetable-planner
topic: "Feasibility of optional per-subject colors on the planner board"
tags: [research, codebase, courses, plan-detail, theming, feasibility]
status: complete
last_updated: 2026-06-30
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Added follow-up: full subject-chip render-site inventory (incl. shell), Tailwind v4 paired-token approach, swatch-picker recommendation"
---

# Research: Feasibility of optional per-subject colors on the planner board

**Date**: 2026-06-30T16:21:19+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: b0a7078e0421dfabaa88301b7a9c402e727f24e3
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

For the `subject-colors` change — let's check the feasibility of this feature. What kind of
changes in the **decision** need to be taken to make it implemented?

> From `change.md`: "optional colour information to the subject, enhancing its visibility on the
> planner board. This information is solely for visual purposes and does not affect the validation
> or collision system."

## Summary

**The feature is feasible and low-risk.** It is purely additive, provably isolated from the
constraint/collision core (so the <200ms drag-drop budget is untouched), and the codebase already
has every seam it needs: a side-map display pattern on the board, a single shared Zod schema for the
catalog form, and a config-enum + token convention for fixed visual sets.

There is **no `color` column, no color picker, and no per-identity color anywhere today** — this is
net-new data on the `courses` entity ("subject" in the change notes = the `courses` table; the word
"subject" only survives in CSV fixture filenames).

The implementation work is mechanical and well-bounded. **The real work is a few product/design
decisions, not code risk.** The dominant decision is the *representation*: a **constrained
token-keyed preset palette** (strongly favored by this codebase's conventions and lessons) versus a
**free-form hex picker** (more flexible, but contradicts the semantic-token lesson and needs a
contrast story). The other decisions — how the color composes with collision tones, and where it
surfaces (board chip / palette / catalog table) — flow from that.

## Decisions That Must Be Taken

These are the choices to settle before `/10x-plan`. Decision 1 shapes almost everything else.

### Decision 1 — Representation: token-keyed preset palette vs. free-form hex  ⭐ the big one

| | **A. Preset palette (token keys)** — *recommended* | **B. Free-form hex picker** |
|---|---|---|
| Stored value | An enum key, e.g. `subject-1`…`subject-N` (text) | A raw `#rrggbb` string (text) |
| Authoring UI | Existing `Select` with swatch options (mirrors `cohort`/`weekMode`/`groupIndex` already in the form) | New `<input type="color">` (the repo's first) |
| Rendering | Static class lookup → `bg-subject-N` token classes (Tailwind sees full class strings) | Inline `style` / CSS var + `color-mix` (only dynamic-value route) |
| Light/dark | **Free** — each `--color-subject-N` has a `:root` + `.dark` value, like every token | Same value both themes; can be illegible without a contrast helper |
| Contrast/a11y | Designed-in per palette entry; foreground stays a token | Needs a new luminance helper **or** a `color-mix` tint toward the card surface |
| Lessons fit | Satisfies *"semantic theme tokens, never hardcoded colors"* exactly (`lessons.md:12-16`) | Directly contradicts it unless mediated through `color-mix` |
| Cost | Add `--color-subject-*` tokens to `global.css` + a `shared/config/subject-colors.ts` enum | New primitive usage + a contrast/tint mitigation |
| Trade-off | Author picks from a curated set (less freedom) | Any color (more freedom), but theme/contrast burden moves onto us |

**Why the recommendation:** `src/shared/config/` is the established home for fixed enumerations
(`grid-presets.ts`, `cohorts.ts`, `availability-severity.ts` — each a `VALUES` tuple + display list
+ Zod `z.enum` gate). A preset palette copies that pattern verbatim, the stored data becomes a token
key (not a raw color), and the actual color resolves per light/dark from `global.css` — so it never
trips the semantic-token lesson and gets correct dark-mode contrast for free. There is **no color
library and no contrast helper** in the repo today (Decision-1B would require adding one or leaning
on `color-mix`).

If product wants true free-form color, the codebase-consistent mitigation is: store the hex as data
but render it only as a controlled tint —
`color-mix(in oklch, var(--chip-color) ~12%, var(--color-card))` for the fill, with a **token**
foreground — so every themed surface stays token-driven and the data color is just an accent
(precedent: the `bg-period-break` utility, `global.css:139-147`).

### Decision 2 — Composition with collision tones (a11y / safety)

The board tile (`PlacedChip`) **already overloads background/border/text color for validation
state**: `blocking` → red (`border-destructive bg-destructive/10`), `warning` → amber, `neutral` →
grey (`PlacedChip.tsx:129-138`). A subject color must **not** mask the red/amber collision signal.

Decide the composition rule:
- **Recommended:** collision tones keep precedence; the subject color shows as an *always-visible
  subtle accent* that does not fight them — e.g. a left **border stripe** or a small **swatch dot**,
  rendered on every tone. The subject color thus aids recognition without ever hiding a collision.
- **Alternative:** subject color fills the chip background **only in the `neutral` tone**, and is
  suppressed under `blocking`/`warning`. Simpler, but the color disappears exactly when a chip is in
  conflict.

### Decision 3 — Surface scope (where the color appears)

`change.md` requires the **board**. Decide whether to also surface it in:
- **Catalog table** (`CourseTable`) — a swatch cell so the author sees/confirms the color while
  editing. *Recommended* — needed for a coherent authoring loop.
- **Palette** (`PaletteCourseChip` + `GroupingBox` member rows) — so the author recognizes a subject
  *before* placing it. Nice-to-have; both spots are already name-driven and take a color the same way.

### Decision 4 — Clone & seed behavior

- **Clone (must decide → almost certainly "carry the color"):** the `clone_plan` SQL function copies
  courses with an **explicit column list** (`20260626120004_clone_plan_with_shelf.sql:97-98`). A new
  `color` column is silently dropped on plan-clone unless that INSERT…SELECT is updated. Decide
  explicitly; the obvious answer is to carry it.
- **Seed (minor):** a nullable column needs **no** seed change (it stays NULL). Decide whether dev
  fixtures should ship with colors — if yes, that touches the CSV columns + `catalog-transcode.mjs`
  + `gen-seed.mjs`'s hardcoded INSERT column list; if no, leave the seed untouched.

### Decision 5 — "No color" semantics (confirm)

Confirm the default: nullable column; absent color = today's `neutral` chip styling; visual-only,
never read by validation. This is already the stated intent — call it out so the plan encodes it as
an invariant.

## Detailed Findings

### "Subject" maps to the `courses` entity

The change notes' "subject" is the `courses` table. The term "subject" survives only in CSV fixture
filenames (`teachers_subjects.csv`, etc. under `data/dp1|dp2/`); everywhere in schema, types, and app
code the canonical entity is **course**, identity `courses.id` (`uuid`, surfaced as `id: string`).
The catalog is **plan-owned** and **cohort-scoped** (`dp1`/`dp2`).

- DB table: `supabase/migrations/20260602185012_minimal_domain_schema.sql:29`
- Catalog view-model: `src/_pages/courses/model/course.ts:14-31` (`CourseRow`)
- Board grouping projection: `GroupingCourse` in `src/shared/lib/catalog-hash/types.ts:10-17`

### Data model & persistence (additive, low-risk)

Effective `courses` columns today (after the reshaping migrations): `id, plan_id, cohort, name,
level, group_index, hours_per_week, week_mode, created_at, updated_at`. **No color/hex/style column
exists** in `supabase/` or `src/shared/api/database.types.ts:273-319`.

- **Schema:** a new additive migration `alter table courses add column color text` (nullable). The
  repo has an explicit precedent and rule that additive nullable/defaulted columns **inherit the
  table's grants and the column-agnostic RLS policy** — *no GRANT, RLS, or default-privileges change
  needed* (`20260621130000_bi_weekly_week_columns.sql:4-6`; RLS `... for all using (true)` at
  `20260602185012_minimal_domain_schema.sql:165`).
- **Generated types:** regenerate `src/shared/api/database.types.ts` via the manual CLI command
  (no package script): `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts`.
  The file is a committed artifact and must be re-committed.
- **Clone RPC (the one non-obvious persistence touch-point):** re-define `clone_plan` in a new
  migration to add `color` to both the INSERT column list and the SELECT
  (`20260626120004_clone_plan_with_shelf.sql:97-98`).
- **Seed:** nullable column works with the seed untouched; only needed if seeding real colors
  (`scripts/gen-seed.mjs:55-68`, `scripts/lib/catalog-transcode.mjs:411-426`, CSVs).

### Catalog CRUD edit path (write side)

The slice is `src/_pages/courses/`. A single shared Zod schema feeds both the action `input` gate and
the form resolver, so one field edit propagates to both validation surfaces.

- **Schema (one field):** add `color` to `courseInput` (`src/_pages/courses/model/schemas.ts:33-48`).
  `updateCourseInput`, `CourseFormValues`, `CourseInput` inherit it automatically.
- **Domain write (one line, covers create + update):** add `color: input.color` to `toCourseRecord`
  (`src/_pages/courses/api/course-record.ts:7-15`), used by both
  `create-course.ts:16` and `update-course.ts:15`.
- **Action layer: no change.** It rides `courseInput`/`CourseInput` end to end via
  `defineDomainAction` (`src/_pages/courses/api/actions.ts:26-35`,
  `src/shared/lib/actions/define-domain-action.ts:17-21`, barrel `src/actions/index.ts`).
- **Form UI:** add a `FormField` to `CourseFormDialog.tsx` (~line 113) and add `color` to **both**
  default-value helpers — `courseFormValues` (edit, `:269-278`) and `emptyCourseFormValues`
  (create, `:280-289`). `useForm` is `mode: "onTouched"` with `zodResolver(courseInput)` (`:246-250`).
- **Table UI:** add a head + swatch cell to `CourseTable.tsx:38-68` (reads `row.color`).
- **Read path (easy to miss):** add `color` to `CourseRow` (`model/course.ts:14-31`) and to the
  catalog page loader's SELECT + row mapping (`api/loader.ts:23,45-58`).
- **Primitives:** primitives live in `src/shared/ui/` (not `src/components/ui/`). **No color-picker
  primitive exists.** Lightest paths: reuse `Input` with `type="color"` (it already forwards `type`,
  `input.tsx:5-8`), a text hex `Input`, or a preset `Select` (per Decision 1A).
- **Tests:** extend `model/schemas.test.ts` (validation cases + `validCourse` fixture) and
  `api/update-course.test.ts` (input fixture).

### Planner board rendering (display side)

Tree: `PlannerBoard.tsx` → `PlannerGrid.tsx` → `SlotCell.tsx` → **`PlacedChip.tsx`** (the tile).
The subject label renders at `PlacedChip.tsx:72`; container/tone at `:58-71` via the `chipTone` CVA
(`:129-138`).

- **Display pattern = side map.** A placed tile never carries a course object — it carries an opaque
  `courseId` plus a `name` resolved from a `Record<courseId,string>` map
  (`model/collision/cell-occupants.ts:49`). **Color follows the identical pattern:** a parallel
  `colors: Record<courseId,string>` resolved into `CellOccupant` (`cell-occupants.ts:13-19`) right
  beside `name`.
- **Threading (mirror `names` exactly):** `PlannerBoardProps.names` (`model/drag.ts:54-55`) →
  assembled in `api/load.ts:110,122` → `PairedColumn.names` (`PlannerBoard.tsx:136`) → consumed in
  `PlannerGrid.tsx:79`.
- **Board read query (one line + a returned map):** the board's course data comes from
  `loadCohortCourses` — **a second, separate read path from the catalog page loader**.
  `fetchCourses` selects `"id, name, level, group_index, hours_per_week, week_mode"`
  (`src/shared/api/load-cohort-courses.ts:102-111`); add `color`, extend the `CourseRow` type
  (`:93-100`), and return a `colors` map alongside `names` (`CohortCatalog`,
  `shared/lib/catalog-hash/types.ts:28-33`).
- **Palette parity (optional, Decision 3):** `PaletteCourseChip.tsx:24-33` and `GroupingBox.tsx`
  member rows (`:79-86`) — both already name-driven.
- **Styling mechanism:** tiles are Tailwind-class-only; the **only** inline `style` on the board is
  the dynamic grid template (`PlannerGrid.tsx:88`) — the precedent that inline style is reserved for
  computed/data values. `color-mix` + CSS custom properties are already idiomatic here
  (`global.css:139-147`).

### Constraint/collision isolation (the safety guarantee)

Color provably stays out of the model layer:
- Collisions derive from `GroupingCourse` only — `{ id, teacherKeys, studentKeys, hours, weekMode }`,
  **no name, no color** (`shared/lib/catalog-hash/types.ts:10-17`; `model/use-board-derivations.ts:30-40`).
- The constraint contract carries opaque ids only and resolves display names "at the render edge …
  never baked in here" (`model/collision/constraints/types.ts:6,8-13,21-45`).
- Color must **not** be added to `GroupingCourse` or it would change the catalog hash / staleness
  fingerprint (`shared/lib/catalog-hash/compute-catalog-hash.ts`). It belongs on the display side
  map only.

**Boundary statement:** color enters only the display side map (`colors`, parallel to `names`),
resolved into `CellOccupant` and rendered in `PlacedChip`. It never reaches `model/collision/**`, the
catalog hash, or any guard/transition. The <200ms drag-drop validation budget is untouched.

## Code References

GitHub permalinks at commit `b0a7078`:

- [`src/_pages/courses/model/schemas.ts#L33-L52`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/_pages/courses/model/schemas.ts#L33-L52) — shared Zod `courseInput`/`updateCourseInput` (single field add)
- [`src/_pages/courses/api/course-record.ts#L7-L15`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/_pages/courses/api/course-record.ts#L7-L15) — `toCourseRecord` Insert/Update payload (one line)
- [`src/_pages/courses/ui/CourseFormDialog.tsx#L246-L289`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/_pages/courses/ui/CourseFormDialog.tsx#L246-L289) — form `useForm` + default-value helpers
- [`src/_pages/courses/ui/CourseTable.tsx#L38-L68`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/_pages/courses/ui/CourseTable.tsx#L38-L68) — catalog table columns (swatch cell)
- [`src/_pages/courses/model/course.ts#L14-L31`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/_pages/courses/model/course.ts#L14-L31) — `CourseRow` read view-model
- [`src/_pages/courses/api/loader.ts#L23`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/_pages/courses/api/loader.ts#L23) — catalog page SELECT
- [`src/shared/api/load-cohort-courses.ts#L93-L111`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/shared/api/load-cohort-courses.ts#L93-L111) — **board** read path `fetchCourses` (separate from catalog loader)
- [`src/_pages/plan-detail/model/collision/cell-occupants.ts#L13-L49`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/_pages/plan-detail/model/collision/cell-occupants.ts#L13-L49) — `CellOccupant` + `name` side-map resolution (color mirrors this)
- [`src/_pages/plan-detail/ui/grid/slot-cell/PlacedChip.tsx#L58-L138`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/_pages/plan-detail/ui/grid/slot-cell/PlacedChip.tsx#L58-L138) — the board tile + `chipTone` CVA (collision tones)
- [`src/_pages/plan-detail/model/drag.ts#L54-L55`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/_pages/plan-detail/model/drag.ts#L54-L55) — `PlannerBoardProps.names` (thread `colors` alongside)
- [`src/_pages/plan-detail/model/collision/constraints/types.ts#L6-L45`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/_pages/plan-detail/model/collision/constraints/types.ts#L6-L45) — constraint contract (display names resolved at the edge; color stays out)
- [`src/shared/lib/catalog-hash/types.ts#L10-L17`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/shared/lib/catalog-hash/types.ts#L10-L17) — `GroupingCourse` (must NOT gain color)
- [`src/app/styles/global.css#L8-L147`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/app/styles/global.css#L8-L147) — token theme (`:root`/`.dark`/`@theme inline`), `--color-overlay`, `color-mix` `bg-period-break` precedent
- [`src/shared/config/grid-presets.ts`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/src/shared/config/grid-presets.ts) — config-enum precedent for a preset palette (`VALUES` + display + `z.enum`)
- [`supabase/migrations/20260626120004_clone_plan_with_shelf.sql#L97-L98`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/supabase/migrations/20260626120004_clone_plan_with_shelf.sql#L97-L98) — clone RPC explicit column list (must add color)
- [`supabase/migrations/20260621130000_bi_weekly_week_columns.sql#L4-L6`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7078e0421dfabaa88301b7a9c402e727f24e3/supabase/migrations/20260621130000_bi_weekly_week_columns.sql#L4-L6) — additive-column-inherits-grants precedent

## Architecture Insights

- **Side-map display pattern.** The board deliberately keeps placements as opaque ids and resolves
  display data (`name`) from `Record<courseId,_>` maps at the render edge. A `colors` map slots in
  with zero new architecture — and it keeps color out of the model by construction.
- **Single shared schema = one-touch validation.** `courseInput` is the authoritative gate for both
  the form resolver and the action input, so one field add covers both surfaces (per the lessons'
  "Astro Actions are the single transport" rule).
- **Config-enum + token convention for fixed visual sets.** `shared/config/*` (`grid-presets`,
  `cohorts`, `availability-severity`) is the codebase's idiom for "a small fixed set gated by a Zod
  enum, with the DB column staying plain text." A preset palette is the same idiom — which is why it
  is the conventions-aligned choice.
- **Two read paths for courses.** The catalog page (`courses/api/loader.ts`) and the board
  (`shared/api/load-cohort-courses.ts`) load courses independently — both need the new column in
  their SELECT for the field to round-trip everywhere.
- **The clone RPC's explicit column list is the recurring "silent drop" trap** — any new `courses`
  column must be added there too.

## Relevant Lessons (from context/foundation/lessons.md)

- **`lessons.md:12-16` — semantic theme tokens, never hardcoded colors.** This is the lesson that
  makes Decision 1 a real decision. A token-keyed preset palette satisfies it; a free-form hex value
  is data that can't follow `.dark` and must be mediated via `color-mix` to comply in spirit.
- **`lessons.md:26-30` — detokenize on add / add missing tokens to `global.css`.** The procedure to
  follow if introducing `--color-subject-*` tokens (`:root` + `.dark` + `@theme inline` map).
- **`lessons.md:19-24` — Astro Actions as the single transport.** The color write rides the existing
  `courseInput` → action → `runDomain` path; no new endpoint.
- **`lessons.md:54-59` — `astro check` is the only type gate.** After regenerating
  `database.types.ts`, run `pnpm check` (not build/lint) to confirm `toCourseRecord` and the loaders
  typecheck against the new column.
- **`lessons.md:5-10` — keep identity opaque, display at the edges.** Reinforces putting `color` on
  the display side map, never in `GroupingCourse`/identity.

## Open Questions

1. **Decision 1** — preset palette (recommended) or free-form hex? Everything downstream (UI
   primitive, rendering mechanism, contrast story, token additions) hinges on this.
2. **Decision 2** — composition rule with `blocking`/`warning` collision tones (accent stripe/dot vs.
   neutral-only fill). Affects a11y.
3. **Decision 3** — surface scope: board only, or also catalog-table swatch (recommended) and palette
   chips?
4. **Seed** — ship dev fixtures with colors, or leave them NULL? (Clone-carry is effectively a yes.)
5. If free-form: do we add a tiny WCAG-luminance helper, or commit to the `color-mix`-tint approach
   (no helper, token foreground)?

## Follow-up Research 2026-06-30T16:33:03+0200

Triggered by three refinements: (a) color must show **everywhere a subject chip is used** — board,
grouping palette, and "the shell" — not just the board; (b) source colors from the **Tailwind accent
palette** with a **background + contrasted-foreground pair** (the existing `bg-X`/`text-X-foreground`
convention); (c) consider a **limited color picker** (a few options).

### A. Direction is settled: token-keyed paired preset palette from Tailwind accents

This resolves **Decision 1 toward option A**, with the pairing detail the user asked for. Each preset
is a **pair** of semantic tokens sourced from a Tailwind v4 accent hue, swapped per light/dark, and
the DB stores the **enum key** (e.g. `rose`), never a raw color.

Confirmed against current Tailwind v4 docs (Context7, `/websites/tailwindcss`):
- Tailwind v4 ships its full default palette as OKLCH theme variables — `--color-rose-100`,
  `--color-rose-900`, … — which are real CSS custom properties referenceable in our own declarations.
- The project's existing machinery (raw vars in `:root`/`.dark` → mapped via `@theme inline`,
  `global.css:8-130`) is exactly the v4-recommended pattern for theme-able, dark-swappable tokens. A
  paired subject palette drops in with **no new mechanism**:

  ```css
  /* :root (light) */
  --subject-rose: var(--color-rose-100);            --subject-rose-foreground: var(--color-rose-900);
  /* .dark */
  --subject-rose: var(--color-rose-900);            --subject-rose-foreground: var(--color-rose-100);
  /* @theme inline */
  --color-subject-rose: var(--subject-rose);
  --color-subject-rose-foreground: var(--subject-rose-foreground);
  ```
- **Contrast is designed-in**: a light shade background + same-hue dark shade foreground (flipped in
  dark mode) gives AA contrast by construction — no luminance helper, no `color-mix` tint needed.
  This is precisely the existing `bg-secondary`/`text-secondary-foreground` convention.
- **Tailwind only generates classes it sees as literal strings** → rendering must use a static
  lookup, not a constructed class. Store the key, resolve via a map:
  ```ts
  const SUBJECT_CHIP_CLASS: Record<SubjectColor, string> = {
    rose: "bg-subject-rose text-subject-rose-foreground",
    // …one literal entry per preset
  };
  ```
- This mirrors the config-enum precedents exactly: define `shared/config/subject-colors.ts` with a
  `VALUES` tuple + display list + `z.enum` gate (like `grid-presets.ts`/`cohorts.ts`), add the tokens
  to `global.css`. The Zod enum is shared by the form resolver and the action input (one gate).

### B. Picker: a limited swatch picker — recommended and idiomatic

A constrained swatch picker is the right UI and fits the literal-class constraint perfectly. Build it
from the existing primitives (no new dependency): a small grid of swatch buttons (or a
`toggle-group`, already in `shared/ui/`) inside the `CourseFormDialog`, one swatch per preset, plus a
"none" option (color is optional). Each swatch previews `bg-subject-<hue>`. This is lighter and
clearer than a `Select`, and avoids the repo's first `<input type="color">`.

### C. Visibility inventory — the scope is much wider than "board + palette", and the shell has no chip today

There is **no shared "subject chip" component** — the chip markup is **duplicated across ~10 distinct
render sites**. All of them resolve a course **name** (either a `name` prop or `names[courseId]`); a
color must ride the same plumbing (a parallel `colors` map for the board, or a `color`/key field on
the richer view-models for the catalog/students/teachers slices).

Subject-chip render sites (file:line → component):
- **Board** — `PlacedChip.tsx:58-72` (the tile; `chipTone` CVA at `:129-138`). Covers the flat cell
  render, A/B `WeekLane.tsx:20`, and the **single-course/placement drag preview** automatically
  (dnd-kit clones the source DOM).
- **Palette** — `PaletteCourseChip.tsx:24-38` (covers promoted filter chip + 1-member grouping +
  its drag preview); `GroupingBox.tsx:79-86` member rows.
- **Drag overlay** — `overlay/GroupDragOverlay.tsx:62-67` member rows (its own markup → needs color
  independently).
- **Shelf** — `shelf/ParkedBundleCard.tsx:74-80` member rows.
- **Catalog** — `courses/ui/CourseTable.tsx:49-56` name cell (+ overlap badge `:90-122`).
- **Students** — `students/ui/StudentTable.tsx:74-95` `ChoiceBadges`; `students/ui/CourseFilter.tsx`
  selected chips via shared `MultiSelect` (`multi-select.tsx:94-110`).
- **Teachers** — `teachers/ui/TeacherTable.tsx:117-129` `AssignmentBadges` (DP1 & DP2 columns).
- **Dialogs** — `MergeBuilderDialog.tsx` and `StudentFormDialog.tsx` course chips via `MultiSelect`.
- **Prose (exclude)** — `overlay/CollisionDetailsDialog.tsx` renders course names as inline text, not
  chips; coloring prose is likely undesirable.

**The app shell has NO subject chip today.** `SidebarLayout.astro`, `BaseLayout.astro`,
`SidebarNavLink.astro`, and `DashboardPage.astro` show only the **plan** name and nav section labels
— never a course/subject name. So "color in the shell" is **net-new UI** (e.g. a subject color
legend), not an existing chip to update. Either the user means a new legend, or "shell" was meant
loosely as "everywhere in the app" (covered by the sites above).

### D. New architectural decision raised by C: shared chip vs. patch-all

Because the markup is duplicated, "color on every subject chip" means either:
- **Extract a shared subject-chip / color resolver** (recommended) — one `SUBJECT_CHIP_CLASS` lookup
  + a tiny `SubjectChip`/`subjectChipClass(key)` helper consumed by every site. Color logic lives
  once; matches the team's "orchestration over patching" lesson. Larger up-front refactor.
- **Patch each of the ~10 sites inline** — smaller per-site change, but the bg+fg pairing logic gets
  duplicated and can drift; adding a future site silently misses color.

The shared resolver is strongly preferred given the user's "every time we use a subject chip" intent.

### E. Composition with collision tones (refines Decision 2)

`PlacedChip`'s neutral tone is `bg-secondary text-secondary-foreground` — the subject pair cleanly
**replaces the neutral tone's bg+fg**. `blocking` (red) and `warning` (amber) must keep precedence so
a collision stays unmistakable; the subject color is suppressed (or reduced to a thin side accent)
under those tones. Putting an arbitrary subject background behind the `destructive`/`warning`
foreground would risk failing contrast, so collision tones should fully override.

### Updated open decisions (supersede the list above)

1. **Representation — settled**: token-keyed **paired** preset palette (`bg`+`foreground`) sourced
   from Tailwind accent hues; DB stores the enum key. (Confirms Decision 1A with pairing.)
2. **Scope breadth**: which chip sites in v1 — board + palette only (the stated requirement), or
   *every* subject chip (board, palette, overlay, shelf, catalog, students, teachers, dialogs)?
3. **"Shell"**: there's no subject chip in the shell today — add a net-new color legend, or was
   "shell" meant loosely as "app-wide" (→ folds into #2)?
4. **Architecture**: extract a shared subject-chip/color resolver (recommended) vs. patch each site.
5. **Picker**: limited swatch picker (recommended) — confirm vs. a `Select`-with-swatches.
6. **Collision composition** (Decision 2): subject color fills the neutral tone; collisions override.

### Decisions — RESOLVED (2026-06-30)

1. **Representation**: token-keyed **paired** preset palette (`--color-subject-<hue>` +
   `-foreground`) sourced from Tailwind accent hues, light/dark via `:root`/`.dark` → `@theme
   inline`; DB stores the **enum key**; render via a static `subjectChipClass(key)` lookup.
2. **Scope = the plan-detail page only.** Color is visible on every subject chip **within the
   plan-detail page**; **NOT** on the CRUD pages (Courses/Students/Teachers tables are out of scope).
   In-scope display sites:
   - `PlacedChip.tsx` (board tile) — subject pair fills the **neutral** tone; covers the
     single-course/placement drag preview (dnd-kit clones the DOM).
   - `PaletteCourseChip.tsx` (palette draggable; also promoted-filter + 1-member grouping + its drag
     preview).
   - `GroupingBox.tsx` member rows.
   - `overlay/GroupDragOverlay.tsx` `OverlayCard` member rows (group/bundle/parked drag preview —
     own markup, colored independently).
   - `shelf/ParkedBundleCard.tsx` member rows.
   - **Out of scope (per decision):** `CourseTable`, `StudentTable` `ChoiceBadges`, `TeacherTable`
     `AssignmentBadges`, and the `MultiSelect`/dialog chips.
3. **Shell**: skipped — no shell/legend work.
4. **Architecture**: extract a single shared resolver (`subjectChipClass(key)` + the
   `SUBJECT_CHIP_CLASS` lookup) consumed by the ~5 in-scope plan-detail components, so the bg+fg
   pairing lives once.
5. **Picker**: a **swatch grid** (preset swatches + a "none" option) in `CourseFormDialog`.
6. **Collision composition**: subject pair replaces the `neutral` tone; `blocking`/`warning` tones
   keep precedence (subject color suppressed under collisions for legibility).

### Implementation note — read path still carries `color` despite tables being out of scope

Even though the **catalog table** won't render color, the catalog read path must still carry the
field so the **editor** can pre-fill the swatch when editing an existing course:
- `courses/model/course.ts` `CourseRow` + `courses/api/loader.ts` SELECT must include `color`
  (`CourseFormDialog`'s `courseFormValues` reads `course.color` for edit-mode defaults).
- The **board** read path (`shared/api/load-cohort-courses.ts` `fetchCourses`) adds `color` and
  returns a `colors` map alongside `names`, threaded to `CellOccupant` and the palette/overlay/shelf
  view-models.
- Write path: `color` (enum) in `courseInput` (`courses/model/schemas.ts`) + `toCourseRecord`
  (`courses/api/course-record.ts`); action layer unchanged.
- DB: nullable `color text` column (stores the enum key) + regen `database.types.ts` + add `color` to
  the `clone_plan` INSERT/SELECT.
- New config: `shared/config/subject-colors.ts` (enum + display + `z.enum` gate + class lookup) and
  `--color-subject-*` token pairs in `global.css`.
- Isolation invariant: `color` never enters `model/collision/**`, `GroupingCourse`, or the catalog
  hash — display side map only.

## Follow-up Research 2026-06-30T16:50:32+0200

Two confirmations requested before planning: (1) prove a color change can't trigger
grouping-staleness; (2) decide whether to plumb color as a parallel `colors` map or consolidate
`names` into one richer `{ name, color }` map.

### 1. Staleness — a color change CANNOT mark groupings stale (verified)

The fingerprint is built from an **explicit 5-field projection**, not raw rows or a spread:

```ts
// src/shared/lib/catalog-hash/compute-catalog-hash.ts:13-27
const canonical = JSON.stringify(
  snapshot.map((course) => ({
    id: course.id,
    teacherKeys: [...course.teacherKeys].sort(),
    hours: course.hours,
    studentKeys: [...course.studentKeys].sort(),
    weekMode: course.weekMode,
  })).sort(...),
);
const digest = await crypto.subtle.digest("SHA-256", ...);
```

- Input is `CatalogSnapshot = GroupingCourse[]` (`catalog-hash/types.ts`), the curated projection —
  `{ id, teacherKeys, studentKeys, hours, weekMode }`. No `name`, no `color`.
- The projection that builds it (`shared/api/load-cohort-courses.ts:60-84`) `.map()`s exactly those
  five fields from course rows; `color` is never read even if added to the row/select.
- Staleness compares `stored.catalog_hash` vs `computeCatalogHash(liveProjection)`
  (`plan-detail/api/staleness.ts:14-33`). Identical projection → identical hash → not stale.
- Teacher/student reactivity is by **identity UUIDs** (`teacherKeys`/`studentKeys` from junctions),
  not display attributes — confirming the hash is constraint-based, color is display-only.

**The single guardrail:** the hand-picking `.map()` at `compute-catalog-hash.ts:16-22` must keep
listing exactly those five fields and never add `color`. Because it hand-picks (no `...course`
spread, no `JSON.stringify(course)`), color is safe even if it were added to the `GroupingCourse`
type or the row. Belt-and-suspenders: `compute-catalog-hash.test.ts` pins a fixed digest, so any
change to the hashed field set fails CI. Adding a "color does not change the hash" test is optional.

### 2. `names` plumbing — recommend a parallel `colors` map (Option A), not consolidation

Footprint of the existing `names` map: **~23 typed sites + ~30 read sites**, prop-drilled
*independently* down three subtrees (grid via `PairedColumn`→`cell-occupants`; palette via
`PaletteCohortData`→`PaletteBody`; shelf/overlay/dialog via `overlayNames`), with the `names[id] ?? id`
fallback **duplicated ~9 times**. The root is a `Map<string,string>` (`catalog-hash/types.ts:31`,
built at `load-cohort-courses.ts:87`), converted to a `Record` at the board edge
(`load.ts:110,120`). The compute action (`grouping-compute.ts:49`) **ships the `Map` over the wire**
and an integration test asserts string ops on it (`names.get(id).startsWith("EE")`).

| | **A. Parallel `colors` map** — *recommended* | **B. Consolidate into `{ name, color }`** |
|---|---|---|
| Type sites changed | ~8 spine carriers | **all ~23** (value `string`→object) |
| Read sites changed | ~5 leaf painters only | **all ~30** (every `names[id]?.name ?? id`) |
| Existing `names` reads | **untouched** | all rewritten |
| Compute wire + integration test | **undisturbed** (stays a string `Map`) | perturbed (richer payload, test rewrite) |
| Text-only consumers (filter, dialog, error banner) | not touched | touched |

**Why A here:** `names` is not a single clean seam to "slot a color into" — it's three independent
prop-drills plus a string `Map` that also travels the compute action and tests. Color is needed by a
**strict subset** (the 5 painters), so a parallel map travels a shorter spine and leaves the
compute/wire/test surface alone. The usual argument *for* consolidation — avoiding drift between two
maps — is weak here: `names` and `colors` are **co-built from the same course rows at the same
assembly point** (`load-cohort-courses.ts:87`), so they can't realistically diverge.

`colors` shape: `Record<courseId, SubjectColor | null>` (the enum key, not a CSS string), resolved to
classes via the shared `subjectChipClass(key)` lookup at each painter.

**The real improvement the consolidation instinct points at** is the duplicated `?? id` resolution
(~9 sites). If we want to address that, the clean move is a dedicated `model/course-display.ts`
resolver returning `{ name, color }` and collapsing the 9 fallbacks — but that's a ~30-site refactor
touching the compute wire, so it should be **its own change**, not bundled into subject-colors.

**Orthogonal prerequisite (both options):** there is no color source today — `fetchCourses` selects
only `id, name, level, group_index, hours_per_week, week_mode` and `names` is derived via
`compositeName(...)`. Add `color` to that `select` + build the `colors` map in the same
`new Map(...)`/assembly at `load-cohort-courses.ts:87-90`.

### DECISION (overrides the recommendation above): consolidate `names` → `courseDisplay` + dedup resolver

User chose the fuller refactor (Option C): replace the bare-string display map with a richer
per-course display object **and** introduce a canonical resolver to collapse the ~9 duplicated
`names[id] ?? id` fallbacks. Rationale: the duplicated fallback is a genuine repeated-touch smell
(cf. the "orchestration over patching" lesson); fix it properly rather than leave a half-cleaned
seam. This enlarges the change, so it must be **sequenced as a pure refactor first, then color**.

**Resolved shape:**
- New `src/_pages/plan-detail/model/course-display.ts`:
  ```ts
  export type CourseDisplay = { name: string; color: SubjectColor | null };
  // canonical resolver — collapses the ~9 scattered `names[id] ?? id` fallbacks
  export const resolveCourseDisplay = (
    map: Record<string, CourseDisplay>, id: string,
  ): CourseDisplay => map[id] ?? { name: id, color: null };
  ```
- Rename the display map `names: Record<string,string>` → `courseDisplay: Record<string,CourseDisplay>`
  across the ~23 typed carriers and rewrite the ~30 reads through `resolveCourseDisplay(...)`
  (`.name` at text-only sites; `.name` + `.color` at the 5 painters).
- Root map: `CohortCatalog.names: Map<string,string>` → `Map<string, CourseDisplay>`
  (`catalog-hash/types.ts:31`), built at `load-cohort-courses.ts:87-90` with `name` (via
  `compositeName`) **and** `color` (from the new `color` column added to `fetchCourses`' select).
- `cell-occupants.ts` `toOccupant` and `leading-course-options.ts` resolve via the new helper;
  `CellOccupant` carries `color` for `PlacedChip`.

**Sub-decisions (recommended defaults — flag if you disagree):**
1. **Compute-path representation** (the one substantive sub-choice): `grouping-compute.ts:49` ships
   `names` as a `Map` over the `computeGroupings` action, and `endpoint.integration.test.ts:130-131`
   asserts `names.get(id).startsWith("EE")`. *Recommended:* carry the single `CourseDisplay`
   representation through the compute path too (one representation end-to-end), and update that test
   to `...get(id)?.name.startsWith("EE")`. *Lighter alternative:* keep the compute path name-only
   (`Map<string,string>`) since color is stable per-course and the board already holds it from
   load-time — less churn, but two representations persist. **Default: single representation.**
2. **Naming:** `courseDisplay` for the map, `CourseDisplay` for the value type. (Alt: `displayById`.)
3. **Color value in the object:** store the `SubjectColor` enum key (nullable), resolved to classes
   at the painter via `subjectChipClass(key)` — not a CSS string.
4. **Isolation unchanged:** `courseDisplay` stays a render-edge map; it never enters
   `GroupingCourse`/`computeCatalogHash`. Guardrail from §1 still holds.

**Plan sequencing implied:** (P1) pure refactor — introduce `CourseDisplay` + `resolveCourseDisplay`,
rename `names`→`courseDisplay`, dedup the ~9 fallbacks, **name-only, no behavior change**, green CI;
(P2) data layer — `color` column + migration + `clone_plan` + regen types + `subject-colors` config +
tokens; (P3) thread `color` into `courseDisplay` (select + assembly) and the swatch picker/write path;
(P4) paint the 5 plan-detail chip sites + collision-tone composition.
