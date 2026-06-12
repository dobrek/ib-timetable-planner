---
change_id: group-dragging
title: Group dragging
status: implemented
created: 2026-06-12
updated: 2026-06-12
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **Decision (2026-06-12, Phase 1 manual gate, two iterations): group-drag feedback = custom overlay + in-place "in use" box.** A header-only clone was uninformative; the whole-box default clone left an empty palette gap and a drop bounce-back. Final: `ui/GroupDragOverlay.tsx` (`<DragOverlay>`, compact header + member-name clone, disabled for non-group drags); a mounted overlay makes the Feedback plugin leave the source box in layout (dimmed + dashed via `isDragging`). Gotcha: `feedback: "none"` + `DragOverlay` is a broken combination — the overlay renders through the Feedback plugin, so `"none"` disables the overlay AND drop-target tracking.
- **Decision (2026-06-12): no integration test for the parallel fan-out** — the parallel idempotent `insertPlacement` pattern (incl. UNIQUE_VIOLATION recovery under concurrent duplicates) will be covered by end-to-end testing instead of a `*.integration.test.ts` in this change. See plan.md Testing Strategy.
- **Decision (2026-06-12): persistence for the group-drop fan-out is Option A — N parallel idempotent single inserts** (existing `createPlacement` per member, per-row reconcile/rollback). No new RPC/migration in this change. Option B (atomic `create_placements` RPC) stays a documented follow-up if partial-failure UX proves confusing. Rationale: accept-and-flag tolerates partial success; `insertPlacement` is already idempotent on `placements_unique`. See research.md §3 and Open Question 1.
