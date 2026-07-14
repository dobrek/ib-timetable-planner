import { describe, expect, it } from "vitest";
import { type Candidate, type Objective, SEARCH_TIERS } from "../../objective";
import { DEFICIT_EVERY, DESTROY_OPERATORS, destroyFor } from "./search";

/**
 * The destroy cadence is **tuned, not derived** — and the change that introduced it paid three times
 * to learn that a tier is inert unless some operator reaches its improving moves. Every constant here
 * was set by measurement, and every nearby setting was measured and rejected: a flat 1-in-3 teacher
 * round cost slots *and* completeness, and merely lengthening the cycle cost dp2 a slot.
 *
 * Nothing else pins them. `pnpm bench:generation` is the only other guard, it is not in CI, and it is
 * wall-clock-driven — the same code on the same input walks a different plateau under different
 * machine load, so it fails intermittently on unmodified `main`. A silent edit to these constants
 * would therefore hide inside that noise. These tests are the loud failure instead: they do not claim
 * the cadence is *optimal*, only that it is what was measured. Retuning it means updating them
 * deliberately, with a fresh measurement — which is exactly the point.
 */

/** Only `objective[0]` (unplacedTotal) is read by `destroyFor` — the rest is scaffolding. */
const incumbent = (unplaced: number): Candidate => ({
  objective: [unplaced, 0, 0, 0, 0, 0, 0, 0, 0, 0] as Objective,
  placements: [],
  remaining: new Map(),
  slots: { dp1: 0, dp2: 0 },
  unplaced: { dp1: [], dp2: [] },
});

const COMPLETE = incumbent(0);
const OWES_AN_HOUR = incumbent(1);

const roundsOf = (count: number, board: Candidate) => Array.from({ length: count }, (_, i) => destroyFor(i + 1, board));

describe("the measured constants", () => {
  it("pins the cadence literally — the behavioural tests below read these, so only this one guards them", () => {
    // Every other test in this file derives its expectations FROM these constants, so a silent edit
    // would sail through them. This is the assertion that actually fails.
    expect(DESTROY_OPERATORS).toEqual(["random", "day", "random", "day", "teacher"]);
    expect(DEFICIT_EVERY).toBe(3);
  });

  it("pins the walk to tiers 1–6 — the shape tiers must not steer it", () => {
    // Searching all nine dropped the seed catalog's dp1 from complete-at-50-slots to 48 slots with an
    // hour unplaced: the shape tiers' improving moves are cheap and endless (there is always one more
    // single to pair), so they move the incumbent nearly every round and the rare completeness/slot
    // move never gets the repeated attempts from a stable board that finding it takes. They are
    // opened only in the budget's last 15%, where lexicographic acceptance makes a polish move
    // incapable of costing a higher tier.
    expect(SEARCH_TIERS).toBe(6);
  });
});

describe("destroyFor — the LNS destroy cadence", () => {
  it("cycles 4 cell-shaped rounds to 1 people-shaped one on a complete board", () => {
    // The tuple ranks completeness and the slot count above teacher compactness, so the
    // neighbourhood must not spend its budget on a tier that can never outbid them.
    const cycle = roundsOf(DESTROY_OPERATORS.length, COMPLETE);

    expect(cycle.filter((op) => op === "teacher")).toHaveLength(1);
    expect(cycle.filter((op) => op === "random" || op === "day")).toHaveLength(4);
  });

  it("never fires the deficit operator on a complete board", () => {
    // `deficit` is the completing move's operator. A complete board has nothing to complete, and
    // spending rounds there would cost the tiers below tier 1 for nothing.
    expect(roundsOf(30, COMPLETE)).not.toContain("deficit");
  });

  it("fires the deficit operator every DEFICIT_EVERY-th round while the board owes hours", () => {
    // The shape tiers pack the board tighter until a blind repair can no longer find room for the
    // hour it still owes — which cost the seed catalog's dp1 a whole hour it had been placing.
    const rounds = roundsOf(DEFICIT_EVERY * 4, OWES_AN_HOUR);

    for (const [index, operator] of rounds.entries()) {
      const round = index + 1;
      expect(operator === "deficit").toBe(round % DEFICIT_EVERY === 0);
    }
  });

  it("SUBSTITUTES the deficit round rather than lengthening the cycle", () => {
    // Load-bearing: making the cycle one round longer instead cost dp2 a slot. A deficit round
    // replaces the operator that round would have run — the underlying cycle keeps its phase, so a
    // complete and an incomplete board agree on every non-deficit round.
    const complete = roundsOf(DEFICIT_EVERY * 5, COMPLETE);
    const owing = roundsOf(DEFICIT_EVERY * 5, OWES_AN_HOUR);

    for (const [index, operator] of owing.entries()) {
      if (operator === "deficit") continue;
      expect(operator).toBe(complete[index]);
    }
  });
});
