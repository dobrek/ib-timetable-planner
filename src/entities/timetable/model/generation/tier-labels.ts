/**
 * Author-facing names for the solver's ladder stages.
 *
 * `StageReport.name` is the engine's own identifier (`teacherHoles`, `goldenBandDistance`), chosen to
 * match the objective tiers in `cpsat_engine/objective.py` and frozen on the wire. It is not text for
 * a reader, so this map exists at the one place that shows it — the progress indicator — rather than
 * being pushed back into the engine, which must keep speaking its own vocabulary.
 *
 * An unknown name falls back to itself: a stage the engine gains before this map does should read
 * slightly raw, never blank.
 */
export const tierLabel = (name: string): string => TIER_LABELS[name] ?? name;

/**
 * How many stages a generation run reports — the denominator in "stage 4 of 10".
 *
 * It is `solve_complete`'s ladder length (tier 1 completeness plus tiers 2–10), and that is exact
 * because `solve_complete` is the **only** mode the app dispatches: `POST /jobs/{id}/solve` runs Mode
 * A, full stop. `solve_repair` emits two stages and `solve_staged` ten, but neither is reachable from
 * the app. S-307's solve policies PERMUTE the ladder's visit order and never shrink or grow it
 * (`SolveConfig.ladder` is validated as a permutation), so the constant holds under every policy;
 * the numerator beside it, `stage_index`, is the ladder position, so "stage N of 10" counts upward
 * whichever tier sits at position N. If a policy ever dispatched a subset ladder, this constant would
 * stop being a constant and the denominator would move onto the job row beside `stage_index`.
 */
export const LADDER_TIER_COUNT = 10;

/**
 * The longest a generation run can take on production, in whole minutes. It is the one number the UI
 * quotes ("up to about N minutes"), because a budget ceiling is a promise the page can keep and a
 * typical latency is not.
 *
 * Derived from the shipped container budgets (S-308, 2026-10-07): Mode A at most twice (60 s, run
 * again when clean mode's infeasibility fallback fires), plus nine ladder stages at 240 s:
 * 2 × 60 + 9 × 240 = 2280 s = 38 min. Seconds of overhead (cold start, claim, row writes) fit inside
 * "about". The campaign's typical run at these budgets took 22–28 minutes.
 *
 * **Coupled to `src/solver-container-env.ts` by hand.** The entities layer cannot import the
 * Worker's deployment wiring, so a change to `CONTAINER_STAGE_BUDGET_S` or
 * `CONTAINER_MODE_A_BUDGET_S` must revisit this number. `wrangler.jsonc`'s
 * `rollout_active_grace_period` is the same worst case in seconds.
 */
export const LADDER_CEILING_MINUTES = 38;

const TIER_LABELS: Record<string, string> = {
  completeness: "completeness",
  unplacedTotal: "unplaced",
  holes: "holes",
  totalSlots: "total slots",
  teacherHoles: "teacher holes",
  softHits: "soft hits",
  studentHoles: "student holes",
  doublesDeficit: "doubles",
  lateStarts: "late starts",
  fridayTail: "Friday tail",
  goldenBandDistance: "golden band",
};
