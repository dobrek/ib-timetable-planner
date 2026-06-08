---
change_id: course-catalog
title: Course catalog
status: implementing
created: 2026-06-07
updated: 2026-06-08
last_note: "P3 done (create/edit/delete via RHF+Actions). Refinements per review: level is optional free text (empty → 'none', shown as — in the list); hoursPerWeek floor relaxed to >=0 (DB-aligned); group options 0–3; list sorted by name; autoComplete=off on form/search inputs; cursor-pointer added at the DS level (button/tabs/select/dropdown/command). 3.10 title kept verbatim but superseded — merged rows are editable (see P2 deviation)."
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 2 deviation — merge coexistence (user-directed)

The plan specified merge-involved courses (parent **or** child) render read-only with no edit/delete/overlap affordance, enforced both in the UI and by a server-side `assertNotMergeParent`/merge guard. During Phase 2 manual verification the user redirected this:

- The "Merged" badge is **display-only** and now sits **next to the course name** (composite merge *parents* only), not in the actions cell.
- **All rows keep their actions kebab** — composite parents and atomic children are both fully editable (name, hours, teacher).
- The server-side merge guard was **removed**. Merge-specific edit/delete/overlap constraints are deferred to the future merge-builder slice (where the hours/direction invariant is settled).

### Phase 3 deviations — form/schema refinements (user-directed)

The plan framed the form as strictly atomic-course authoring. Manual review redirected several rules:

- **`level`** is **optional free text** (matching the permissive `courses.level` column), not the `{SL,HL,AB,none}` enum. An empty level normalizes to `"none"` and renders as `—` in the list. This lets composite merge-parent levels (`AB+SL`) round-trip through the editor.
- **`hoursPerWeek`** floor relaxed from `>= 1` to **`>= 0`** (mirrors the DB `check`), so 0-hour merge children edit cleanly.
- **Group index** options are **0–3** (was 0–2).
- The course list is **sorted by name** (was `group_index` then `name`) for findability.
- `autoComplete="off"` on the form and its text/search inputs (auth inputs keep autofill).
- `cursor-pointer` added at the **design-system level** to `button`, `tabs`, `select`, `dropdown-menu`, and `command` primitives.
