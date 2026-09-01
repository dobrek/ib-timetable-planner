# Hub-badge eviction + polling-store factory — Plan Brief

> Full plan: `context/changes/extract-share-polling-store/plan.md`
> Research: `context/changes/extract-share-polling-store/research.md`

## What & Why

Fix a day-old regression, then pay down queued review debt on the same file. The hub's poll store keeps remembered badges by union-merge, so a job whose row disappears server-side (source deleted → cascade; delivered proposal deleted → mapping-edge drop) leaves an open hub tab with either a stale "Ready — open" link to a deleted plan or a frozen "Generating" badge polling every 5 s forever. Then F6: the ~55 lines of timer/visibility/inFlight lifecycle machinery maintained twice across the hub and pending-proposal stores get extracted to one shared factory.

## Starting Point

`generation-deletion-integrity` (archived 2026-08-31) shipped the server-side halves — both read paths correctly omit dead rows — but the client store's `merge` ignores omission, which is exactly the gap. The two stores share 38 byte-identical lines and diverge at 9 sites (research D1–D9); both suites drive only the public store surface, so a behavior-preserving extraction is verifiable by "suites green unchanged". The pending store's visibility path has zero coverage today (node-env suite, no `document`).

## Desired End State

An open hub tab drops a badge on the tick after its job vanishes and goes quiet when nothing is active. `src/shared/lib/polling-store/` owns the shared lifecycle with its own suite (including the previously untested visibility machinery); both slice stores are thin wirings over it, with all observable behavior — 5 s, active-only, visibility-aware, idle-silent — unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope | Eviction first, then F6; provenance note parked | The regression fix must not be hostage to F6's abandon gate; the note is a UX decision with no shared file | Research |
| Eviction mechanism (Q8) | **Replace**: response = next snapshot, `merge` deleted | Fixes both stale orderings, and dissolves D6 so the factory's `read` seam needs no merge/evict hook | Plan |
| Refresh width | Query **all** remembered jobIds, not active-only | A terminal remembered entry is never queried today, so its absence proves nothing — eviction is impossible without this | Plan |
| Phase-1 verification | Unit-only, scripted fetcher | The defect is client RAM; the server halves are already integration-tested in the archived change | Plan |
| Packaging | One PR, two phase-ordered commits | One review/deploy cycle; a phase-2 WONTFIX just drops commit 2 | Plan |
| Factory surface | `{initial, isEqual, read, isActive, afterTick?, tickOnVisible?, intervalMs?}` at `src/shared/lib/polling-store/` (folder-with-barrel) | 4 required + 3 optional is the honest minimum over D1–D9; bare-file path would break house style | Research |
| WONTFIX gate (Q6) | Just do it; post-rebase readability is a phase-2 manual criterion | Phase 1 shipping independently makes abandoning the extraction cost nothing | Research |
| No `refresh` export | Dropped from the follow-up's spec | Neither store has one today; it would ship unused | Research |

## Scope

**In scope:** `job-progress-store.ts` semantics + tests; new `shared/lib/polling-store/` (factory, barrel, suite); rebasing both stores; docblock amendments (rule 4 becomes server-confirmed memory).

**Out of scope:** provenance note / acknowledgement / FR-308 (parked change); server read paths; the five localStorage clones; poll shape or interval; migrations; E2E specs.

## Architecture / Approach

Phase 1 changes semantics in place with the existing 15-test suite as the harness: tick queries all remembered jobIds (`refreshKnown` is status-unfiltered, so live rows always return — terminal memory becomes server-confirmed), and the deduped response replaces the snapshot. Phase 2 extracts `createPollingStore<T>` whose `read: (current) => Promise<T>` returns the next snapshot — phase 1's exact shape — so eviction semantics carry into shared code by construction. FSD forces the clean seam: `shared` can't import `entities`, so domain predicates arrive as closures.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Eviction | Stale-badge fix shipping as `fix(plans-list)` commit | Replace semantics silently breaking a rule-4 expectation an existing test doesn't pin |
| 2. F6 factory | Shared lifecycle + its suite; both stores rebased | `afterTick` ordering trap (both suites stay green if wrong); steiger's 15-child ceiling |

**Prerequisites:** none — gated on nothing, no migration, no solver involvement.
**Estimated effort:** ~1–2 sessions; phase 1 is small, phase 2 is mostly the new suite.

## Open Risks & Assumptions

- Assumes the existing 15 hub tests survive replace semantics (verified by reading each pin during planning; the rule-4 test fires only one tick). If one fails, it pins union semantics and gets an honest rewrite in phase 1 — not worked around.
- `fsd/shared-lib-grouping` fires above 15 children; `polling-store/` is child 15. Verified against the plugin source, but `pnpm steiger` is the arbiter — if it fires, stop and surface rather than regroup drive-by.
- The readability gate is a judgement call, made at phase-2 manual verification; WONTFIX is a sanctioned outcome that costs only the extraction.

## Success Criteria (Summary)

- Deleting a plan out from under an open hub tab removes its badge on the next tick and stops the poll — no stale links, no forever-loop.
- One `setInterval` in non-test `src/`; the factory suite covers the machinery both stores share.
- Both slice suites pass with zero edits in the extraction commit; all CI gates green.
