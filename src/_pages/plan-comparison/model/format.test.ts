import { describe, expect, it } from "vitest";
import type { CohortFeatures, Distribution, PlanQualityFeatures } from "@/entities/timetable";
import { distributionLine, num, pct, pooledMean, subjectLabel, sumCohorts } from "./format";

const dist = (count: number, mean: number): Distribution => ({
  count,
  min: 0,
  p10: 0,
  median: mean,
  mean,
  max: 0,
  variance: 0,
});

/** Only the fields the formatters read — cast at the boundary so the test states its own dependencies. */
const featuresWith = (dp1: Distribution, dp2: Distribution): PlanQualityFeatures =>
  ({
    cohorts: {
      dp1: { students: { hoursPerStudentDay: dp1, gapSlots: 3 } },
      dp2: { students: { hoursPerStudentDay: dp2, gapSlots: 4 } },
    },
  }) as unknown as PlanQualityFeatures;

describe("num", () => {
  it("prints an integer as-is and everything else to 2dp", () => {
    expect(num(48)).toBe("48");
    expect(num(2.3456)).toBe("2.35");
    expect(num(0)).toBe("0");
  });
});

describe("pct", () => {
  it("rounds a share to a whole percent", () => {
    expect(pct(0.1)).toBe("10%");
    expect(pct(0.666)).toBe("67%");
    expect(pct(0)).toBe("0%");
  });
});

describe("distributionLine", () => {
  it("prints the five-number summary the bench prints", () => {
    const values: Distribution = { count: 4, min: 1, p10: 1, median: 2, mean: 2.5, max: 6, variance: 0 };

    expect(distributionLine("teacher gaps", values)).toBe("teacher gaps: min 1 · p10 1 · median 2 · mean 2.50 · max 6");
  });
});

describe("sumCohorts", () => {
  it("adds a metric across both cohorts", () => {
    const features = featuresWith(dist(1, 1), dist(1, 1));

    expect(sumCohorts(features, (cohort: CohortFeatures) => cohort.students.gapSlots)).toBe(7);
  });
});

describe("pooledMean", () => {
  /**
   * The load-bearing one. Pooling SAMPLES weights each cohort by its size; averaging the two cohort
   * MEANS would weight a 27-student cohort the same as a 34-student one — inventing a number that
   * describes no actual population. This test exists to make that "simplification" impossible.
   */
  it("pools samples, not means — a bigger cohort pulls the mean toward itself", () => {
    // 30 samples at mean 2, 10 at mean 6. Pooled: (30·2 + 10·6) / 40 = 3. Mean-of-means: (2+6)/2 = 4.
    const features = featuresWith(dist(30, 2), dist(10, 6));

    const pooled = pooledMean(features, (cohort: CohortFeatures) => cohort.students.hoursPerStudentDay);

    expect(pooled).toBe(3);
    expect(pooled).not.toBe(4);
  });

  it("returns 0 rather than dividing by zero when neither cohort has samples", () => {
    const features = featuresWith(dist(0, 0), dist(0, 0));

    expect(pooledMean(features, (cohort: CohortFeatures) => cohort.students.hoursPerStudentDay)).toBe(0);
  });
});

describe("subjectLabel", () => {
  it("drops the `none` level sentinel", () => {
    expect(subjectLabel("Chemistry", "HL")).toBe("Chemistry HL");
    expect(subjectLabel("Theory of Knowledge", "none")).toBe("Theory of Knowledge");
  });
});
