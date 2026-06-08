---
change_id: course-merge-builder
title: Course merge builder
status: impl_reviewed
created: 2026-06-08
updated: 2026-06-08
archived_at: null
last_note: "Research complete + open questions resolved. Merge model settled against seed/algorithm (parent = virtual composite holding derived level + teacher + authored hours, 0 choices; children = atomic, student-chosen, keep real hours). Decisions: many-to-many child sharing ALLOWED; single shared teacher REQUIRED; dissolve DELETES orphan parent; ship Option A (builder dialog) only. Folded defaults: same-cohort required, transactional parent create, child hours untouched, >=2 distinct-level children, group_index=0. No migration. See research.md."
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->
