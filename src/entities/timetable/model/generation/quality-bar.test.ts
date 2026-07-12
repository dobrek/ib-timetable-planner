import { describe, expect, it } from "vitest";
import { DESCENT_OPTIMAL_SLOTS, descentGeneratorSnapshot } from "./__fixtures__/descent-catalog";
import { syntheticGeneratorSnapshot } from "./__fixtures__/synthetic-catalog";
import { createGreedyEngine } from "./engines/greedy";
import { verifyGeneration } from "./verify";

/**
 * The CI quality guard: unlike the fuzz/oracle suite (which protects *validity*), this asserts the
 * engine keeps its *slot-minimization capability*. Two guards, both black-box through
 * `createGreedyEngine` + `verifyGeneration` (no engine internals):
 *   (a) the crafted descent instance whose construction overshoots the clique-proven optimum by one
 *       slot — only working descent/LNS closes the gap, so deleting stage 6 + LNS turns this red
 *       (verified during implementation: 15 vs the pinned 14 — see `descent-catalog.ts`);
 *   (b) the synthetic catalog's per-cohort occupied-slot bars, pinned empirically (20/20 local runs
 *       landed at dp1 = 7, dp2 = 7 with construction alone, so the ≤ 8 bars are a stable envelope).
 *
 * Fast tuning (small `stagnationMs`, ~1 s budget) keeps both solves well under a second without
 * stubbing `Date.now` — the engine keeps real time, so shrinking the window is the only lever.
 */

/** Per-cohort occupied-slot ceiling for the synthetic catalog (observed 7; +1 headroom, never flaky). */
const SYNTHETIC_SLOT_BARS = { dp1: 8, dp2: 8 };

describe("generation quality bar", () => {
  it("reaches the proven slot optimum on the crafted descent instance (capability guard)", async () => {
    const snapshot = descentGeneratorSnapshot();
    const engine = createGreedyEngine({ stagnationMs: 250 });

    const result = await engine(snapshot, { budgetMs: 1_500 });

    const { dp1, dp2 } = result.diagnostics.cohorts;
    expect(dp1.unplaced).toEqual([]);
    expect(dp2.unplaced).toEqual([]);
    expect(dp1.occupiedSlotsAfter + dp2.occupiedSlotsAfter).toBe(DESCENT_OPTIMAL_SLOTS);
    expect(verifyGeneration(snapshot, result.placements).ok).toBe(true);
  });

  it("keeps the synthetic catalog within its empirical per-cohort slot bars", async () => {
    const snapshot = syntheticGeneratorSnapshot();
    const engine = createGreedyEngine({ stagnationMs: 250 });

    const result = await engine(snapshot, { budgetMs: 1_500 });

    const { dp1, dp2 } = result.diagnostics.cohorts;
    expect(dp1.unplaced).toEqual([]);
    expect(dp2.unplaced).toEqual([]);
    expect(dp1.occupiedSlotsAfter).toBeLessThanOrEqual(SYNTHETIC_SLOT_BARS.dp1);
    expect(dp2.occupiedSlotsAfter).toBeLessThanOrEqual(SYNTHETIC_SLOT_BARS.dp2);
    expect(verifyGeneration(snapshot, result.placements).ok).toBe(true);
  });
});
