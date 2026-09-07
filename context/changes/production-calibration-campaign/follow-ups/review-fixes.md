# Review follow-ups — impl review of Phases 1–2 (2026-09-07)

Source: `reviews/impl-review-phase-1-2.md`. All four findings were fixed in the tree; these are the loose ends the fixes created or exposed.

- [ ] **Revisit `OVERHEAD_ALLOWANCE_S` (30 s) in `bench/generation-jobs-report.ts` after Phase 3.** The flag's threshold is a guess at the fixed cost of a solve outside its stages (sign-in, snapshot parse, model build, terminal write). Phase 3 records the production numbers; read the `unaccounted` column of the Phase 3 runs and set the allowance from them. Owner: Phase 3.4 / 3.5.
- [ ] **Plan text at `plan.md:151` still specifies the Mode A budget as the flag threshold.** The threshold cannot be crossed by the cause it names (the fallback fires only on a proven INFEASIBLE, so the hidden solve is shorter than one Mode A budget). Annotate the Phase 2 contract with a dated note pointing at F2 rather than rewriting it, per the archive convention.
- [ ] **Phase 4 cell protocol: record the `unaccounted` value per run in the ledger**, not just whether the flag fired — the number is what lets the allowance be revised.
