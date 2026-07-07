---
change_id: optional-subject-in-bundle
title: Optional subject in bundle
status: archived
created: 2026-07-07
updated: 2026-07-07
archived_at: 2026-07-07T18:02:50Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Currently, the user has the option to place a group of subjects into a slot or to place a single subject in a slot. This operation automatically creates a bundle. This bundle can then be ungrouped so that the user can remove a particular subject from it. The requested feature involves adding an additional option: allowing a user to mark a subject as optional instead of removing one. The feature aims to enhance the visibility of the options available to the user for creating a comprehensive plan. He intends to treat this optional subject as a temporary choice (which can be changed later on—truly removed or accepted). Thus, it should be visually different from the other subjects in the bundle and can be easily spotted. At the same time, it should be counted as an option in our summary counter.

### Decisions (2026-07-07, full detail in research.md)

- Optional = per-placement flag (`week` precedent); render-only for validation — conflicts still block, constraint core untouched.
- Counter headline unchanged; `CoursesLeftPopover` gains an "Optional" section.
- Undoable as a first-class edit — business key extended (and its duplicate spelling unified) so undo/redo and remove-undo restore the flag.
- Whole-slot verbs include optional members; flag survives shelf park/unpark and plan cloning.
- Perspective views render optional members visually distinct (via the shared `CellOccupant` seam).
- UI: per-chip actions consolidate into a "⋯" overflow dropdown (Mark optional / Accept / Remove — inline remove "×" migrates into it), available only when ungrouped, like remove today. Week A/B toggle stays inline.