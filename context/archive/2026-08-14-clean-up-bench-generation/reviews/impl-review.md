<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Retire the CI generation benchmark and the orphaned client generation path

- **Plan**: context/changes/clean-up-bench-generation/plan.md
- **Scope**: Full plan (Phases 1–4 of 4)
- **Date**: 2026-08-15
- **Verdict**: NEEDS ATTENTION → all 6 findings FIXED in triage (2026-08-15); gates re-run green
- **Findings**: 0 critical, 3 warnings, 3 observations

Gates re-run locally: `pnpm check` 0 errors · `pnpm lint` clean · `pnpm steiger` clean · `pnpm test` 178 files / 1582 passed · `pnpm build` ok. All nine grep-based criteria (1.1–1.3, 2.1–2.2, 3.1, 4.1–4.3) pass. CI run 31889689726 (66b32fc): verify / integration / e2e / solver green, deploy skipped, no bench job (1.8). Drift check: every planned item MATCH; the only unplanned file (`api/rpcs.ts`) is the adaptation documented in `change.md`.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Seed-id comments overstate what the identity test pins

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (lessons: "a convention that cites a code mechanism is coupled to it")
- **Location**: scripts/lib/seed-id.mjs:15-17, scripts/lib/catalog-transcode.mjs:372-374, scripts/lib/catalog-transcode.d.mts:97-98
- **Detail**: The re-anchored rationale says id identity "is pinned by `src/test/seed-transcode-identity.test.ts`, which … fails if a regeneration stops matching the committed seed." That test masks every UUID before comparing (`maskUuids`, test.ts:15,27) — it pins structure, not ids. The plan's premise (plan.md:192-193) carried the same overstatement.
- **Fix**: Reword the three comments — the test pins structural identity (UUIDs masked); by-id stability is a property of content-addressing itself, consumed by the integration factories rather than asserted by a test.
- **Decision**: FIXED

### F2 — Live conventions doc still cites deleted useCollisionInspection

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/ui-conventions.md:42
- **Detail**: "PlannerBoard … keeps handleDrop, the disclosure hooks, and useCollisionInspection in the component body". Phase 3 deleted the hook; PlannerBoard owns inspection with a plain `useState` (PlannerBoard.tsx:105). Phase 4's doc sweep missed this normative doc.
- **Fix**: Re-anchor to "the inspection `useState`" in ui-conventions.md:42.
- **Decision**: FIXED

### F3 — liveState orphaned by the excision, undocumented; docblocks still describe deleted flow

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/model/use-placements.ts:81-82, :194-197; change.md "Adaptations"
- **Detail**: change.md records stage/settle/failGenerated as "flagged, not deleted". `liveState()` lost its only caller too (`toSnapshotInput` inside the excised `applyGenerated`) but is not in that note; its docblock and `stageGenerated`'s narrate deleted code, and no flag exists in source.
- **Fix**: Add `liveState` to the Adaptations list and re-anchor both docblocks to "kept for a future client-side apply path (S-306); currently no caller".
- **Decision**: FIXED

### F4 — Roadmap baseline block half-updated

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/roadmap.md:71, :42
- **Detail**: :66 was corrected but :71 in the same Baseline block still lists "greedy Web Worker (generate.worker.ts:38)"; the S-309 slice-table outcome cell at :42 still says "greedy engine + Web Worker path are deleted", half-stale against the corrected S-309 section.
- **Fix**: Drop the Web Worker clause from :71; trim :42's outcome to "the greedy engine is deleted".
- **Decision**: FIXED

### F5 — vitest.config.ts comment names the retired *.bench.ts suffix

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: vitest.config.ts:24-26
- **Detail**: Suffix list still includes `*.bench.ts`; no such file exists.
- **Fix**: Drop `*.bench.ts` from the suffix list.
- **Decision**: FIXED

### F6 — Cosmetic leftovers from comment edits

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/entities/timetable/api/solver-config.ts:18 (172 cols), src/_pages/plan-detail/model/generation/use-generation-job.ts:13 (129 cols), src/_pages/plan-detail/model/use-cohort-board-state.ts:2-8
- **Detail**: Two re-anchored docblock lines exceed the 120-col printWidth; import pruning left two back-to-back `import … from "@/entities/timetable"` statements.
- **Fix**: Re-flow the two comment lines; merge the two imports.
- **Decision**: FIXED
