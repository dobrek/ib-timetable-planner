---
change_id: comparing-plans
title: Comparing plans
status: implemented
created: 2026-07-14
updated: 2026-07-14
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **This is the deferred "Option C"** from `plan-quality-analyzer` (`research.md:135-138`, deferred at `plan.md:33` *"until after the expert session validates which features matter"*). That gating condition was met by `generation-quality-tuning` — the block is lifted.
- **Feasibility verdict (2026-07-14, [research.md](research.md)): green.** The compute core (`analyzePlan`) is built, pure, and Workers-safe *by design for this feature*; the plan-id → analyzer-input loader already exists in `bench/` and moves into `src/` verbatim; two-plan loading already runs today. This is a UI change, not an engine change. **~1–2 sessions.**
- **The one real trap**: the existing `catalog_hash` **cannot** detect cross-plan catalog drift — it digests course/teacher/student **UUIDs**, which `clone_plan` re-mints, so even a clone and its own source hash differently. A new *natural-key* content fingerprint is the only genuinely new design work.
- Scope decisions (author, 2026-07-14): picker allows **any two plans, flag drift** (no restriction); output is a **scoreboard table**; delta needs a **baseline** plan.
- **N-plan comparison is architecturally free** — `analyzePlan` has zero pairwise coupling and `bench/plan-report.ts` already renders N side-by-side columns. Model as `plans[] + baselineId` from day one; ship the UI comfortable at N=2–4 (the scoreboard is per-cohort, so N plans = 2N columns).
- Hard invariants inherited from the analyzer, to carry into React: **feature vector, never a score** (no "Plan A wins"); **no slot count without completeness beside it**; render `emptyDays` beside day-edge metrics; render catalog `warnings` beside the numbers.
- **Plan review (2026-07-14, [reviews/plan-review.md](reviews/plan-review.md)): REVISE → SOUND**, all 6 findings fixed in-plan. The one that mattered: `CohortCatalog.courses` is a *filtered* projection (it omits merge children with no direct choices), so the planned deletion of the three app loaders' `courses` queries would have regressed the board / teacher view / student view to **UUID card titles** — the exact failure this change exists to remove. Phase 1.5 was cut; that cleanup is now a **follow-up change** and must key its identity map over the full `courses` row set.

## Implementation notes (2026-07-14)

- **Implemented, all 6 phases** (`5c1aed3`, `20734c1`, `29c599a`, `43b77f6`, `5f823da`, `fc1d0b3`). Full `/verify` gate green; 33/33 e2e; 112/112 integration. The UI's numbers were cross-checked against `ANALYZE_PLAN_A=<golden> pnpm analyze:plans` and agree **digit-for-digit** (13 metrics × both cohorts, plus the Chemistry overlap annotations) — they now share one loader and one metric catalog, so that is a property, not a coincidence.
- **Progress row 6.4 (CI `e2e` job passes on the PR) is intentionally left open** — the author chose to close out locally rather than push a branch/PR. `/10x-archive` will surface it as an informational warning. Everything 6.4 would confirm has been verified locally against the real workerd preview.
- **The `bench/` → `_pages` ESLint guardrail has a sharp edge worth knowing.** The obvious spelling — `group: ["@/_pages/*", "!@/_pages/plan-comparison/api"]` — silently permits *nothing*: ESLint matches these gitignore-style, and a `!` cannot re-include a path whose **parent directory** an earlier pattern excluded. The slice-root ban therefore lives in `paths` (exact match, no subtree semantics) and the carve-out in its own group. Verified against the real matcher and against a deliberate violation, not assumed.
- **`api/index.ts` is deliberately narrow and must stay so.** It is `bench/`'s entire contract with `src/`. `load-comparison` is *not* re-exported from it: that module value-imports `@/entities/timetable` for `analyzePlan`/`verifyGeneration`, and the entity barrel re-exports `CollisionDetailsDialog` (a React component) — so exporting it there drags all of `shared/ui` into `pnpm analyze:plans`, a Vitest **node** run. The Astro route imports it by direct path instead. This regressed once mid-implementation and was caught by walking the barrel's import graph; re-run that walk if the barrel ever grows.
- **Known local-stack flake, not a code defect.** The integration lane intermittently fails an *unrelated* suite with `An invalid response was received from the upstream server` — a 502 from the local Kong/PostgREST, whose logs show `Warp server error: Thread killed by timeout manager`. It is request-load saturation against a long-running local `supabase_rest` container: this change's loader fires ~15 concurrent queries per plan, which tips it over. **Restarting the container clears it** (`docker restart supabase_rest_<project>`), after which the suite ran 4/4 and then 3/3 green. CI boots a fresh stack per run, so it should not see the stale-container condition.
