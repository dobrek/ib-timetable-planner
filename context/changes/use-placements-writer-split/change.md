---
change_id: use-placements-writer-split
title: Split usePlacements into a write-context + writer factories
status: impl_reviewed
created: 2026-06-29
updated: 2026-06-29
archived_at: null
---

## Notes

Identity file backfilled — this folder was created with `report.md` before `/10x-new` ran.

See [`report.md`](report.md): a draft proposal to extract the `usePlacements` forward write path into two plain factory modules (`board-writes.ts`, `shelf-writes.ts`) driven by a shared `WriteContext`, mirroring the shipped `useReconcileExecutor` extraction. Behavior-preserving; phased (Phase 0 "Move 1" through Phase 4). **Decision still open** — full split vs. Move 1 only (see report §11–12).
