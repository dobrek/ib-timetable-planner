import { describe, expect, it } from "vitest";
import { deriveCleanLabel, describeCleanLabel, softHitsAchieved } from "./clean-label";
import { DEFAULT_SOLVE_POLICY, type SolvePolicy } from "./policy";
import type { StoredStageReport } from "./stage-report";

const CLEAN = DEFAULT_SOLVE_POLICY;
const CANONICAL: SolvePolicy = { preset: "canonical" };
const STUDENT_FIRST: SolvePolicy = { preset: "student-first" };

const stage = (tier: number, best?: number): StoredStageReport => ({
  tier,
  name: `tier-${String(tier)}`,
  status: "OPTIMAL",
  ...(best === undefined ? {} : { best }),
  wallClockS: 1,
});

/** A full ten-tier ladder with tier 5 carrying `softHits`. */
const ladder = (softHits?: number): StoredStageReport[] =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((tier) => stage(tier, tier === 5 ? softHits : 0));

describe("deriveCleanLabel", () => {
  it("calls a board with zero soft hits clean", () => {
    expect(deriveCleanLabel(ladder(0), 0, CLEAN)).toEqual({ kind: "clean" });
  });

  it("names the residue when the board sits exactly on a non-zero pinned floor", () => {
    // The honesty decision: this is clean-AS-PERMITTED, not clean. The solve added nothing, but the
    // author's own pins occupy soft cells, and calling that "clean" would overclaim.
    expect(deriveCleanLabel(ladder(2), 2, CLEAN)).toEqual({ kind: "clean-at-floor", pinnedHours: 2 });
  });

  it("reports not-clean when the solve exceeded the floor — the fallback fired", () => {
    expect(deriveCleanLabel(ladder(5), 2, CLEAN)).toEqual({
      kind: "not-clean",
      softHits: 5,
      floor: 2,
      cleanRequested: true,
    });
  });

  it("records that clean was NOT requested under the canonical policy", () => {
    // Under canonical a not-clean board is the policy doing what it said, not a fallback firing.
    expect(deriveCleanLabel(ladder(5), 2, CANONICAL)).toEqual({
      kind: "not-clean",
      softHits: 5,
      floor: 2,
      cleanRequested: false,
    });
  });

  it("treats student-first as requesting clean — it holds soft hits at the floor too", () => {
    expect(deriveCleanLabel(ladder(5), 2, STUDENT_FIRST)).toMatchObject({ kind: "not-clean", cleanRequested: true });
  });

  it("keeps clean and clean-at-floor policy-independent", () => {
    for (const policy of [CLEAN, CANONICAL, STUDENT_FIRST]) {
      expect(deriveCleanLabel(ladder(0), 0, policy)).toEqual({ kind: "clean" });
      expect(deriveCleanLabel(ladder(2), 2, policy)).toEqual({ kind: "clean-at-floor", pinnedHours: 2 });
    }
  });

  it("finds tier 5 by its tier NUMBER, never by array position", () => {
    // `stages` is variable-length and sparse: repair mode emits tiers 1 and 4 only, and an
    // infeasible run emits a single completeness report. Index 4 would read the wrong tier here.
    const sparse = [stage(1, 0), stage(4, 7), stage(5, 3)];

    expect(deriveCleanLabel(sparse, 3, CLEAN)).toEqual({ kind: "clean-at-floor", pinnedHours: 3 });
  });

  it("is unavailable — never a throw — when no tier-5 entry exists", () => {
    expect(deriveCleanLabel([stage(1, 0)], 0, CLEAN)).toEqual({ kind: "unavailable" });
  });

  it("is unavailable when tier 5 reported no best (the stage found no solution)", () => {
    expect(deriveCleanLabel([stage(5)], 0, CLEAN)).toEqual({ kind: "unavailable" });
  });

  it("is unavailable on an empty ladder", () => {
    expect(deriveCleanLabel([], 0, CLEAN)).toEqual({ kind: "unavailable" });
  });

  it("degrades to clean-at-floor rather than not-clean if our floor undercounts the engine's", () => {
    // Arithmetically impossible (the floor is irreducible), so reaching it means THIS side's formula
    // drifted from the engine's — in which case blaming the board would be the wrong call.
    expect(deriveCleanLabel(ladder(2), 5, CLEAN)).toEqual({ kind: "clean-at-floor", pinnedHours: 2 });
  });
});

describe("softHitsAchieved", () => {
  it("returns tier 5's best, and undefined when it is absent", () => {
    expect(softHitsAchieved(ladder(4))).toBe(4);
    expect(softHitsAchieved([stage(1, 0)])).toBeUndefined();
  });
});

describe("describeCleanLabel", () => {
  it("gives each branch a sentence an author can act on", () => {
    expect(describeCleanLabel({ kind: "clean" })).toMatch(/^Clean —/);
    expect(describeCleanLabel({ kind: "clean-at-floor", pinnedHours: 2 })).toContain("2 pinned hours");
    expect(describeCleanLabel({ kind: "clean-at-floor", pinnedHours: 2 })).toMatch(/Unpin them/);
    expect(describeCleanLabel({ kind: "not-clean", softHits: 5, floor: 2, cleanRequested: true })).toMatch(
      /^Not clean/,
    );
    expect(describeCleanLabel({ kind: "unavailable" })).toMatch(/could not be determined/);
  });

  it("blames the catalog only when clean was requested, and the policy when it was not", () => {
    const requested = describeCleanLabel({ kind: "not-clean", softHits: 5, floor: 2, cleanRequested: true });
    const notRequested = describeCleanLabel({ kind: "not-clean", softHits: 5, floor: 2, cleanRequested: false });

    expect(requested).toBe(
      "Not clean — 5 hours sit on soft cells (2 of them pinned). No clean board was possible for this catalog.",
    );
    expect(notRequested).toBe(
      "Not clean — 5 hours sit on soft cells (2 of them pinned). The canonical order policy does not require a clean board.",
    );
  });

  it("says 'hour' for one and 'hours' for many", () => {
    expect(describeCleanLabel({ kind: "clean-at-floor", pinnedHours: 1 })).toContain("1 pinned hour ");
    expect(describeCleanLabel({ kind: "clean-at-floor", pinnedHours: 3 })).toContain("3 pinned hours ");
  });
});
