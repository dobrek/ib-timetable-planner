---
change_id: parity-harness-enriched-validators
title: Parity-harness convention for enriched validator classes (test-plan Phase 4)
status: implementing
created: 2026-06-22
updated: 2026-06-22
archived_at: null
---

## Notes

Test-plan §3 **Phase 4** — lock a convention + table-driven fixture harness so each
enriched validator class ships with a false-positive parity guard (the §2 Risk #6
response, scored High × High).

**Why now:** the sequencing flag said land this *before S-03's unified-rule rewrite*
(latest-acceptable bound). S-02 and S-03 have both already shipped without the formal
guard — so this is overdue. The immediate consumer is **S-04** (two-cohort
cross-cohort occupancy), the next enriched class; this harness must be in place before
S-04 ships. See test-plan §2 Risk #6, §3 Phase 4, §5 new-validator-class parity gate.

Oracle discipline: expected values come from **requirements**, never recomputed from
the validator under test (the oracle-problem trap called out in the Risk #1/#6 guidance).
