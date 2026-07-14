---
change_id: comparing-plans
title: Comparing plans
status: implementing
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
