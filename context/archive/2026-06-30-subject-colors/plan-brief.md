# Subject Colors — Plan Brief

> Full plan: `context/changes/subject-colors/plan.md`
> Research: `context/changes/subject-colors/research.md`

## What & Why

Add an **optional, visual-only per-course color** that paints every subject chip on the plan-detail
page, to improve at-a-glance recognition. The color is purely cosmetic — it does **not** affect
validation, collision detection, or grouping. Stored as a token-key enum (e.g. `rose`), it resolves
to a paired light/dark theme token at the render edge.

## Starting Point

There is no color anywhere today — no column, no picker, no per-course color. The board resolves each
placed chip's display **name** from a side map (`names`), threaded through the plan-detail UI in two
forms (a `Map` that also crosses the compute-action wire, and a `Record` in the UI) with a
`names[id] ?? id` fallback duplicated across 10 sites. The catalog write path is one shared Zod
schema; courses are read by two independent paths (board + editor).

## Desired End State

An author picks one of 8 swatch colors (or "none") in the course form. That course's chip then renders
in the chosen color across the board tile, palette chip/grouping box, group drag overlay, and parked
shelf card — in both light and dark. A chip in a collision keeps its red/amber tone (color suppressed).
Color survives a plan clone and never touches the constraint core. CRUD tables and the app shell are
unchanged.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Representation | Token-key paired preset palette; DB stores the enum key | Satisfies the semantic-token lesson; correct dark-mode contrast for free | Research |
| Scope | Plan-detail page only (5 chip painters) | Stated requirement; CRUD tables + shell explicitly excluded | Research |
| Architecture | Consolidate `names` → `courseDisplay: {name,color}` + `resolveCourseDisplay` resolver | Collapses the 10 duplicated `?? id` fallbacks (orchestration-over-patching) | Research |
| Picker | Swatch grid (built on existing `ToggleGroup`) + "None" | Idiomatic, no `<input type=color>`, fits the literal-class constraint | Research |
| Collision composition | Subject pair replaces neutral tone; blocking/warning override | A collision must stay unmistakable; arbitrary bg behind red/amber risks failing contrast | Research |
| Palette set | 8 distinct hues: rose, amber, emerald, sky, violet, teal, orange, indigo | Enough variety without a busy picker; clean 100/900 pairs; all chromatic so none reads as the uncolored neutral | Plan |
| Compute wire | Single `CourseDisplay` representation end-to-end | One shape everywhere — no two-representations drift | Plan |
| Seed fixtures | Stay uncolored (NULL) | Smallest diff; seed pipeline untouched; clone still carries color | Plan |

## Scope

**In scope:** nullable `color` column + `clone_plan` carry + regen types; `shared/config/subject-colors.ts`
enum/resolver + `--color-subject-*` tokens; swatch picker + write path; both read paths; the `names`→
`courseDisplay` refactor; painting the 5 plan-detail chip sites.

**Out of scope:** free-form hex; CRUD-page tables (Courses/Students/Teachers); app shell / legend;
coloring prose (collision dialog, error banners, filter labels); auto-assignment; seed colors;
renaming `studentNames`/`teacherNames`; any change to `GroupingCourse` / catalog hash / constraint core.

## Architecture / Approach

Color enters **only the display side map**. A new `CourseDisplay = { name; color }` replaces the bare
`names` string map; a `resolveCourseDisplay()` helper collapses the scattered fallbacks. The board's
`fetchCourses` select gains `color`, fed into the display half of `courseDisplay` — never into the
`GroupingCourse` projection or the hash (which hand-picks 5 fields). Painters call a static
`subjectChipClass(key)` lookup that maps to `bg-subject-<hue> text-subject-<hue>-foreground` utilities,
generated from paired `:root`/`.dark` tokens sourced from Tailwind v4's built-in palette.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Palette foundation | Config enum + resolver + `--color-subject-*` tokens | Tailwind only generates classes it sees as literal strings (static lookup, no template classes) |
| 2. Display-map refactor | `names`→`courseDisplay` + resolver, single wire shape; no behavior change | ~24 typed carriers + 10 reads + wire + tests; must not sweep `studentNames`/`teacherNames` |
| 3. Data + write/read | Column + migration + `clone_plan` + types; swatch picker; both read paths fill real color | `clone_plan` silently drops new columns unless its explicit list is updated |
| 4. Paint the chips | Color on all 5 plan-detail painters; collision precedence | Cannot layer two `bg-*` utilities — subject pair must replace the base background |

**Prerequisites:** local Supabase running for `db reset` + integration tests; `ToggleGroup` primitive
(already present).
**Estimated effort:** ~4 sessions, one per phase (Phase 2 is the largest — a wide mechanical rename).

## Open Risks & Assumptions

- **Tailwind class precedence**: layering `bg-secondary`/`bg-background` with a `bg-subject-*` is
  non-deterministic; the plan resolves the background to a single value per chip (Critical
  Implementation Details). If a painter is patched by appending instead of replacing, color may not
  show — verify each of the 5 sites visually.
- **The `clone_plan` column-list trap** is the one easy-to-miss persistence touch-point.
- **Assumption**: stored color keys are always valid (write-gated by Zod); a defensive
  `toSubjectColor()` coercion guards against manual DB edits → unknown values render as no color.

## Success Criteria (Summary)

- An author sets a course color and sees it on all five plan-detail surfaces (light + dark); "None"
  reverts to neutral.
- A collision tone always wins over the subject color; clearing it restores the color.
- Color survives a plan clone; drag-drop validation stays instant (color never entered the constraint
  core); CRUD tables stay uncolored.

## Test Posture

- **Unit** owns visual correctness — the color×tone precedence matrix (collision always overrides) +
  the config/resolver mapping.
- **Integration** owns the cross-layer seams that pass type-check but break at SQL/SSR — color
  round-trip through both loaders, `clone_plan` carry, and the isolation invariant (a color-only edit
  ⇏ stale). These are mandatory harness tests, never manual sign-off.
- **E2E** is a single isolation spec (color edit ⇏ stale through real SSR). Chip color itself is
  unit-tested and deliberately not asserted in the browser, per `e2e/CLAUDE.md`.
