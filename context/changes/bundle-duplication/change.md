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
