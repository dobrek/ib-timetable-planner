---
change_id: course-catalog
title: Course catalog
status: archived
created: 2026-06-07
updated: 2026-06-12
archived_at: 2026-06-12T10:43:00Z
last_note: "Impl review (full plan): APPROVED, all dimensions PASS, gate green (83 tests, build, lint, astro check). 3 low-impact observations, all fixed during triage — F1 defensive .limit(500) on course_merges/overlaps reads; F2 detokenized shadcn literals (text-white→text-destructive-foreground, bg-black/50→bg-overlay; added the tokens to global.css; recorded as a lesson); F3 plan cross-ref for the DS cursor-pointer touch to pre-existing primitives. Report: reviews/impl-review.md."
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

### Phase 4 deviations — overlaps UX (user-directed)

- **No page reload on overlap add/remove**: the plan wired `navigate(currentPath)` after each mutation, but that closed the dialog. Instead the island holds `courses` in state and overlap edits update it **in-memory** (the mutation is still persisted via the action), so the dialog stays open and the list updates live. Create/edit/delete still use `navigate()`.
- **Overlap indicator**: courses with overlaps show a clickable `Overlap: <full label>` badge beside the name (full label = name + level + group via `formatCourseLabel`); clicking it opens the overlap manager. (Iterated from an earlier count+tooltip design per review.)
- **"Hide merged" filter toggle** added next to the teacher filter.
- **4.9 accepted deviation**: the overlap-base picker excludes self, already-linked, and cross-cohort courses, but does **not** exclude composite merge parents — consistent with the merge-deferral decision (the plan's 4.9 wanted merge-involved excluded). User accepted.
