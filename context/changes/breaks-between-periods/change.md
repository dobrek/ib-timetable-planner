---
change_id: breaks-between-periods
title: Breaks between periods
status: implementing
created: 2026-06-29
updated: 2026-06-29
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Users are asking about introducing breaks between periods on the plan board. The goal is to increase readability of the plan, so the breaks play only a visual role. They'd like to have a break between periods 2 and 3 and between 5 and 6.

## Decision — scope locked (2026-06-29)

After research (`research.md`), the scope is **locked to the minimal, visual-only break**:

- **In scope:** a purely visual gap/divider rendered after period 2 and after period 5, in `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx` only (the `periodList.map` row loop), as a `role="presentation"` / `aria-hidden` full-width spacer using semantic theme tokens. No coordinate, key, constraint, or `<200ms`-budget impact.
- **Break positions:** fixed at "after period 2 and 5", expressed as an **in-code constant** (e.g. `BREAK_AFTER = new Set([2, 5])`) — easy to change in source, but **not** user-configurable and **not** persisted.
- **Guard:** gate each spacer with `period < periods` so no trailing break renders below the last row (e.g. "after 5" is a no-op on a `5x6` grid).
- **Explicitly OUT of scope (deferred, documented in `research.md` §C):** per-plan persisted break positions (a new `plans` column), any create-plan form control, and any change to `slot_grid_preset` / the preset enum. Customizable presets remain a project non-goal — not reopened by this change.
- **Rationale:** YAGNI. The request is fixed positions shared across the one target school; a const satisfies it with zero schema/migration/form cost. Promote to the per-plan column (research.md §C — a single nullable column) only if a concrete second break pattern ever appears; that path stays cheap, so deferring it costs nothing.