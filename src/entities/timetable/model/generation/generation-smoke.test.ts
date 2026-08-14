import { describe, expect, it } from "vitest";
import { syntheticGeneratorSnapshot } from "./__fixtures__/synthetic-catalog";
import { generatePlanGreedy } from "./engines/greedy";
import { verifyGeneration } from "./verify";

/**
 * CI smoke (Phase 2): the greedy pipeline — snapshot → greedy engine → verify judge —
 * on the synthetic catalog, fast and deterministic. Nothing here asserts a real-catalog
 * quality bar: that is the CP-SAT calibration campaign's job (S-308), and this suite is
 * deliberately synthetic so it stays deterministic. The engine is pure TS, so the full
 * pipeline runs under Node — no browser lane needed.
 */
describe("generation pipeline smoke", () => {
  it("produces a complete, zero-blocking-violation board within seconds", async () => {
    const snapshot = syntheticGeneratorSnapshot();
    const startedAt = Date.now();

    const result = await generatePlanGreedy(snapshot, { budgetMs: 1_500 });
    const verdict = verifyGeneration(snapshot, result.placements);

    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(result.diagnostics.cohorts.dp1.unplaced).toEqual([]);
    expect(result.diagnostics.cohorts.dp2.unplaced).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});
