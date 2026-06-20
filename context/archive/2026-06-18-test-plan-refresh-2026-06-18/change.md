---
change_id: test-plan-refresh-2026-06-18
title: Refresh test-plan.md guide for the post-demo domain-fidelity change wave
status: archived
created: 2026-06-18
updated: 2026-06-20
archived_at: 2026-06-20T16:14:18Z
---

## Notes

Open a change folder to REFRESH context/foundation/test-plan.md (the guide) so it reflects the post-demo domain-fidelity change wave. This change EDITS THE GUIDE ONLY — it writes no tests. The final plan sub-phase re-stamps §8 and reconciles §3.

Why now: PRD + roadmap rewritten 2026-06-18 (old roadmap archived); forward risk surface shifted; §3 Phase 2 shipped but guide still says "implementing"; §2 Risk #6 cites a non-existent "S-09"; PRD line cites drifted; dep-bump wave + a migration landed.

Apply (full brief — confirm exact lines/counts in /10x-research):
- KEEP §1 principles 1-4 (principle #4 "tests are the refactor safety net" becomes MORE central: the S-02→S-04 collision-core rewrite, esp. S-03's unified-rule rewrite, is the next refactor the 55 unit tests must survive). Keep §2 Risks #1-#4, §6.1/6.2/6.3, §7 exclusions.
- §2 PRD cites: L57→L166 (no-false-positive), L130→L173 (durability), L131/L158→L379/L434 (new PRD = NO access-control change → soften Risk #5 PII framing). Research confirms exact lines.
- §2 reframe Risk #6/S-09 → the enriched-dimension false-positive FAMILY: S-02 co-teaching (both teachers occupied), S-03 bi-weekly opposite-week overlap, S-04 cross-cohort symmetric teacher occupancy, S-06 both-cohorts-at-once. Impact High × Likelihood High. Label as refresh inference / not-yet-live (slices unbuilt); response = parity harness per slice, NOT a testable-today defect. No file anchors.
- §2 add bundle/parked-bundle durability risk (S-05/S-07): High × Medium (Q1 fear #2 + Q3). Forward inference.
- §2 record sub-200ms budget risk WITH the team decision: NOT a CI gate — manual/feel verification (Q5); capture the why (avoid a flaky perf gate).
- §3 Phase 2 → complete (folder 2026-06-15-testing-auth-actions-boundary-rls).
- §3 Phase 4 (parity harness) → sharpen + elevate to own the whole enriched-dimension wave; flag sequencing for /10x-plan: harness convention should land BEFORE S-03's rewrite.
- §3 Phase 3 (drag→validate→feedback + reload-restore) = next-active, endorsed by interview Q3+Q4 (optimistic loop = #1 under-tested worry); fold bundle-persistence durability in as S-05/S-07 ship.
- §4 stack: integration 9→10, e2e 4 specs counted, migrations →14, re-verify dep versions (astro 6.4.8, vitest 4.1.9, @playwright/test 1.61, wrangler 4.102), checked:→2026-06-18.
- §7 add: sub-200ms-not-CI-gated + cross-author-IDOR-deferred (Q5).
- §8 re-stamp 2026-06-18 + record change-wave trigger.

Interview signal (Phase 2, 2026-06-18): Q1 fears = false-positive in a new dimension + bundle work loss; Q2 = no past burn ("so far so good"); Q3 low-confidence = optimistic loop + bundle persistence; Q4 under-tested = optimistic reconciliation; Q5 = keep §7, don't CI-gate sub-200ms, defer cross-author IDOR.

Hot-spot scope (src/, 30d): plan-detail 212, courses 131, shared/lib 88, teachers 85 — likelihood evidence, NOT anchors.

After creating the folder, follow the downstream continuation rule (suggest /10x-research next).
