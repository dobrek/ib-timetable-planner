---
change_id: dnd-single-course-from-palette
title: Dnd single course from palette
status: impl_reviewed
created: 2026-06-15
updated: 2026-06-15
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **Accepted trade-off (impl-review F1):** when a selected leading course is itself a
  1-member grouping, the palette shows two identical chips — the promoted single chip
  (`CourseDrag → addCourse`) and the singleton grouping chip (`GroupDrag → addGroup([member])`).
  Both place the same single course, so the redundancy is benign and left as-is rather than
  adding conditional render logic for a narrow case.
