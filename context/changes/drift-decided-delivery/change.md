---
change_id: drift-decided-delivery
title: Drift decided delivery
status: implemented
created: 2026-08-25
updated: 2026-08-28
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

## Decisions

### 2026-08-28 — The proposal is a plan

Chosen over two alternatives that were live the same day:

- **(a) Merge / keep / discard with a drift gate** — the frame's landing, recorded in the first
  re-grounding of FR-307. Retired by explicit author decision, second round.
- **(b) Completion-time materialisation** — PRD Open Question 4's other branch. Rejected: the
  dispatch clone is the only T0-faithful copy of the *display* catalog (`generation_jobs.snapshot`
  carries no `name`/`level`/`group_index`), so a completion-time clone can fail natural-key
  translation whenever the catalog moved. A `pending_proposal` flag closes the editable window —
  the thing that actually made eager materialisation dangerous — without paying that price.

**The equivalence argument.** In the author's stated workflow the source is left alone during a
solve, so at delivery the source is byte-identical to the snapshot the board was solved for. In that
case "merge the proposal into the source" produces exactly the same two rows as "delete the source,
rename the proposal" — same board, same catalog, one name. Both acts already exist and are one hub
click each. In the drifted case merge was gated on the board re-verifying against the moved source,
which for a board-only drift is nearly always false. So the branch that justified the machinery was
also the branch that would almost never fire.

**What leaves with merge:** the T1 re-hash on every proposal visit (an ~18 round-trip
`loadCombinedPlannerData`), the TOCTOU window between re-hashing and a blind region replace, the
`isOptional` digest blind spot that made that window a safety hole, an `assembleSource` extraction,
an expected-hash RPC argument, a merge/keep/discard decision panel on the comparison page, three
actions, and a `delivery` CHECK vocabulary of three values (now one: `'proposal'`).

**What it costs — the one thing.** There is no fold-in path for the case merge would have served
honestly: the author edits the source during a 20-minute solve and wants both sets of changes. They
must re-apply those edits to the proposal by hand, or re-generate. Accepted deliberately — the author
reports not editing during a solve, and a fold-in that only works when nothing conflicts is not a
fold-in.

**Lineage:** Socrates (auto-apply) → 2026-08-28 first re-ground (author-decided merge-or-keep, from
`frame.md`) → 2026-08-28 second re-ground (proposal-is-a-plan, from `plan.md`). All three blocks are
preserved in PRD FR-307.

## Open at hand-off

Two Progress rows stay unchecked because both are observations of a **CI run on a PR**, which does
not exist yet — neither is code:

- **5.1 the e2e job is green on the PR.** The spec and the job's solver steps are in; the whole
  local E2E suite (34 tests) passes against a native solver, `generation.spec.ts` in ~16 s.
- **5.4 the e2e job's duration.** Measurable only against the CI baseline (~426 s). The added work is
  a cached `uv sync`, a uvicorn boot, and a ~1 s solve.

Both close on the first CI run. One more item is owed at PR time and is not a plan step:
**issue #103's title and body still describe auto-apply** (the roadmap's next-actions row says so).
