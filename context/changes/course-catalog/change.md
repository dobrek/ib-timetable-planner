---
change_id: course-catalog
title: Course catalog
status: implementing
created: 2026-06-07
updated: 2026-06-08
last_note: "P2 done. Deviation from plan's merge-coexistence rule (user feedback): the 'Merged' badge is display-only and sits beside the course name; merge involvement no longer gates mutations — both composite parents and atomic children are fully editable, and assertNotMergeParent guard was removed. Merge-specific edit/delete/overlap constraints deferred to the merge-builder slice."
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 2 deviation — merge coexistence (user-directed)

The plan specified merge-involved courses (parent **or** child) render read-only with no edit/delete/overlap affordance, enforced both in the UI and by a server-side `assertNotMergeParent`/merge guard. During Phase 2 manual verification the user redirected this:

- The "Merged" badge is **display-only** and now sits **next to the course name** (composite merge *parents* only), not in the actions cell.
- **All rows keep their actions kebab** — composite parents and atomic children are both fully editable (name, hours, teacher).
- The server-side merge guard was **removed**. Merge-specific edit/delete/overlap constraints are deferred to the future merge-builder slice (where the hours/direction invariant is settled).
