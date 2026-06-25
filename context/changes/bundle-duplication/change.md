---
change_id: bundle-duplication
title: Bundle duplication
status: implemented
created: 2026-06-25
updated: 2026-06-25
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- 2026-06-25 (post-review): removed the success-feedback **scroll-into-view** (`scrollIntoView` +
  the `SlotCell` node ref) as overengineering — testing showed it isn't needed. The transient
  highlight **pulse** on the target cell is retained (`lastDuplicated` → `useDuplicateHighlight` →
  `justDuplicated` → motion-safe ring). PR #61.
- 2026-06-25 (post-review): decomposed `SlotCell` into an orchestrator. The control strip is now an
  always-visible `SlotHeader` (any non-empty cell) composed of `SlotHeaderButton` sub-components —
  removing the duplicate-button duplication (header copy vs. single-occupant overlay) and the
  `relative`/absolute positioning hack. Single-occupant cells now show the duplicate in a top
  header instead of a bottom-right overlay.
