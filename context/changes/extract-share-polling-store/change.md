---
change_id: extract-share-polling-store
title: Shared polling-store factory, and the proposal provenance note's lifecycle
status: preparing
created: 2026-08-31
updated: 2026-08-31
archived_at: null
---

## Notes

@context/archive/2026-08-25-drift-decided-delivery/follow-ups/review-fixes.md

Scope widened 2026-08-31 (research): F6 (the polling-store factory) plus the proposal
provenance note — when it should stop being visible. See `research.md`.

Narrowed again the same day: the deletion-integrity defects the research turned up were split
into `context/changes/generation-deletion-integrity/` (a delivered proposal's deletion flips its
job to `failed`; a stale-running source's deletion strands the clone pending). They share no code
with either half of this change, and neither is fixed by an acknowledgement.
