# Test Plan Guide Refresh (post-demo domain-fidelity wave) — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-06-18/plan.md`
> Research: `context/changes/test-plan-refresh-2026-06-18/research.md`

## What & Why

Refresh `context/foundation/test-plan.md` — the phased test-rollout guide — so it reflects the
**post-demo domain-fidelity change wave**. The PRD and roadmap were rewritten 2026-06-18 (old
roadmap archived), Phase 2 of the rollout shipped and was archived, and a dep-bump + migration
wave landed. The guide is stamped 2026-06-15 and is stale on six fronts: drifted PRD cites, a
Risk #6 referencing the now-deleted roadmap slice "S-09", a Phase 2 still marked `implementing`,
stale counts/versions, and two unrecorded team decisions. **This change edits the guide only —
no tests, no code.**

## Starting Point

A 321-line, internally consistent guide whose sources have moved underneath it: PRD cites point
at the archived PRD, Risk #6 cites a roadmap slice (S-09) that no longer exists, Phase 2 reads
`implementing` though it's complete and archived, and §4 counts/versions/dates are a refresh
behind. Every replacement fact is already verified against commit `bb1a568` in `research.md`.

## Desired End State

The guide reflects the codebase + product docs at `bb1a568`: principle #4 points forward at the
enriched collision-core rewrite; §2 cites land on the new PRD with Risk #5 softened and Risk #6
reframed to the enriched-dimension false-positive family (plus a new bundle-durability Risk #7
and a sub-200ms note); §3 shows Phase 2 complete, Phase 3 next-active, and Phase 4 owning the
enriched wave; §4/§7/§8 carry corrected counts, two new exclusions, and a 2026-06-18 re-stamp.

## Key Decisions Made

| Decision                          | Choice                                                        | Why (1 sentence)                                                                  | Source   |
| --------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------- |
| Risk #6 reframe                   | S-09 → enriched-dimension family (S-02/S-03/S-04/S-06), High×High, no anchors | S-09 was deleted in the roadmap rewrite; the family is forward inference, unbuilt | Research |
| Risk table structure              | Preserve #1–#6 numbering, append bundle as #7, add ordering note | #N is cross-referenced in §2/§3/§5; renumbering risks breaking refs               | Plan     |
| Phase 4 harness sequencing        | Land convention **before S-02** (latest-acceptable: before S-03) | S-02 is the first `ready` touch of the protected core (`roadmap.md:103`)          | Plan     |
| sub-200ms representation          | Prose note in §2 + exclusion in §7 (no scored row)           | It's a budget + not-a-CI-gate decision, not a "false-positive passes" scenario    | Plan     |
| Risk #5 reframe                   | "Preserve author-only invariant; IDOR deferred to Phase 2.5" | New PRD makes **no** access-control change (`prd.md:379,434`)                     | Research |
| `S-09` code residue (`load.ts:14`)| Flag as follow-up in the plan; do not edit code              | Out of scope for a doc-only change; preserve the finding                          | Plan     |

## Scope

**In scope:**
- §1 principle #4 re-centred on the S-02→S-04 collision-core rewrite
- §2 PRD re-cites (L166/L173/L379/L434), Risk #5 softening, Risk #6 reframe, Risk #7 append, sub-200ms note
- §3 Phase 2 → complete, Phase 3 → next-active, Phase 4 → owns enriched wave + before-S-02 sequencing
- §4 counts (unit 55, integration 10, e2e 4, migrations 14) + exact dep versions + `checked:` → 2026-06-18
- §7 two new exclusions; §8 re-stamp + change-wave trigger

**Out of scope:**
- Any test or application code (this is a single Markdown file)
- The `S-09` code comment at `load.ts:14` (flagged for a follow-up code-cleanup change)
- Renumbering Risks #1–#6; a scored §2 row for sub-200ms; fixing the roadmap's own "13 migrations" drift

## Architecture / Approach

A single-file edit swept top-to-bottom in three cohesive phases (§1–§2 / §3–§5 / §4–§7–§8). Each
phase is verified by `grep`-based assertions (stale tokens gone, verified replacements present —
the guide is a doc, not built code) plus a coherence read-through. All facts come pre-verified
from `research.md`; the plan executes, it does not re-discover.

## Phases at a Glance

| Phase                              | What it delivers                                                        | Key risk                                                              |
| ---------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. §1 Strategy + §2 Risk Map       | Re-centred principle #4; corrected cites; Risk #5/#6 reframe; Risk #7; sub-200ms note | Mis-rating the forward-inference family or accidentally re-numbering risks |
| 2. §3 Rollout + §5 Gates           | Phase 2 complete; Phase 3 next-active; Phase 4 owns wave + before-S-02 sequencing | Garbling the status vocabulary or the sequencing recommendation       |
| 3. §4 Stack + §7 + §8              | Corrected counts/versions/dates; two new exclusions; re-stamp; residue flag | Transcribing a count/version wrong against research                   |

**Prerequisites:** None beyond the completed `research.md` (already present and verified).
**Estimated effort:** ~1 session, 3 small phases on one file.

## Open Risks & Assumptions

- Assumes `research.md`'s verified facts hold at the implementing commit; if the tree advanced
  materially (new migration/test), re-confirm the counts before stamping.
- The reframed Risk #6 (High×High) sits below the High×Medium #3–#5 because numbering is
  preserved — mitigated by an explicit approximate-ordering note, not a re-sort.
- The `S-09` code residue remains in source until a separate follow-up change picks it up.

## Success Criteria (Summary)

- The guide carries no `S-09`, no old PRD cites (L57/L130/L131/L158), and no non-archived
  Phase 2 folder reference; the new cites and corrected counts/versions/dates are all present.
- A read-through confirms Risk #5/#6 reframes, the Risk #7 addition, the Phase 2→complete /
  Phase 3→next-active / Phase 4 sequencing, and the §7/§8 additions read coherently end-to-end.
- The `load.ts:14` S-09 residue is preserved as a flagged follow-up, with no code touched.
