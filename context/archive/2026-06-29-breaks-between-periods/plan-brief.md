# Visual Breaks Between Periods — Plan Brief

> Full plan: `context/changes/breaks-between-periods/plan.md`
> Research: `context/changes/breaks-between-periods/research.md`

## What & Why

Add a purely visual break after period 2 and after period 5 on the planner board, so authors can scan the day as morning / mid / afternoon blocks. The break has no occupancy or constraint meaning — it exists only to improve board readability, which users have asked for.

## Starting Point

The board is one CSS Grid (`PlannerGrid.tsx`) whose period rows are produced by a single `periodList.map` (`PlannerGrid.tsx:125`) over `display:contents` rows placed by auto-flow. There is no `grid-template-rows` and drag-drop resolves from explicit `{day, period, cohort}` data, so an inserted spacer shifts no coordinates and breaks no drops. There is no concept of breaks anywhere today.

## Desired End State

A faint, hatched horizontal band appears between rows 2–3 and 5–6, framed by the existing gridlines, legible-but-muted in light and dark themes, spanning full width in both focus and combined (DP1 | DP2) views. On smaller grids no break renders below the last period. Drag-drop, collision highlighting, validation, and layout are unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope | Minimal, visual-only | Readability ask needs nothing more; avoids reopening parked scope. | Research / Decision |
| Break positions | Fixed in-code const `[2, 5]` | Concrete shared request; a const is easy to change but needs no schema/form. | Decision |
| Persistence / config | None | YAGNI — no second break pattern exists; the per-plan column stays a cheap future step. | Research / Decision |
| Preset model | Untouched | Customizable presets are a project non-goal; breaks are orthogonal to `slot_grid_preset`. | Research |
| Visual treatment | Gap band + subtle token-driven hatch | More contrast than a plain gap, no dominant color; follows theme. | Plan |
| Break logic home | Pure helper in `lib/` (+ unit test) | Cosmetic, not domain logic — keep it out of the constraint `model/`; testable guard. | Plan |
| Pattern home | `@utility bg-period-break` in `global.css` | Mirrors existing `bg-cosmic`; one class, token-driven light/dark. | Plan |

## Scope

**In scope:**
- `lib/period-breaks.ts` — fixed break set + `breaksAfterPeriod` guard, with co-located unit test.
- `@utility bg-period-break` in `global.css` — token-driven diagonal hatch.
- `PlannerGrid.tsx` — render a presentational spacer after each break period.

**Out of scope:**
- Persistence, migrations, `database.types` changes.
- Create-plan form controls / any per-plan or per-user configurability.
- Changes to `slot_grid_preset`, the preset enum, or `parseGridPreset`.
- "Real" breaks (a slot/occupiable cell consuming a period index).
- Constraint/model/API changes; mirroring into the teacher-availability dialog; a full PlannerGrid render-test harness.

## Architecture / Approach

Three additive, render/style-only changes: a framework-free predicate (`lib/`) decides where breaks go; a theme-token `@utility` paints the hatch; `PlannerGrid` wraps each period row in a `Fragment` and appends a `role="presentation"`/`aria-hidden`, `col-[1/-1]` spacer when the predicate is true. The spacer auto-flows onto its own implicit grid row — no `grid-row` math, no droppable, no impact on the `<200ms` validation path.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Visual period breaks | Helper+test, hatch utility, and spacer render on the board | Hatch legibility/contrast across light & dark (a visual-tuning detail, caught in manual verify) |

**Prerequisites:** None — locked scope, all files identified, runnable against the existing dev stack.
**Estimated effort:** ~1 short session, single phase.

## Open Risks & Assumptions

- The hatch's exact spacing/alpha is tuned during manual verification; the risk is purely "too faint / too busy," not behavioral.
- Assumes breaks after 2 and 5 are the desired fixed positions for the target school (per the request); changing them later is a one-line edit to `BREAK_AFTER_PERIODS`.

## Success Criteria (Summary)

- Hatched break bands render between rows 2–3 and 5–6 on the board, legible and muted in both themes.
- No trailing break below the last period on smaller grids; drag-drop, collisions, and layout unchanged.
- `pnpm check`, `pnpm test`, `pnpm lint`, `pnpm steiger`, and `pnpm build` all pass.
