import { describe, expect, it } from "vitest";
import { catalog, course, placement } from "./__fixtures__/builders";
import {
  buildLensOptions,
  buildLensUniverse,
  combineLensCounts,
  criterionId,
  deriveLensMatches,
  mergeEffectiveCriteria,
  pruneCriteria,
  type LensCohortSource,
  type LensCriterion,
  type LensMatches,
} from "./lens";
import type { LocalPlacement } from "./placement/placement";

// Two math courses share teacher "kk"; student "s2" takes both maths; "bio" is disjoint.
const byId = catalog(
  course("math-aa", "kk", ["s1", "s2"]),
  course("math-ai", "kk", ["s2"]),
  course("bio", "ll", ["s3"]),
);

const placed: LocalPlacement[] = [
  placement("p1", "math-aa", 1, 1),
  placement("p2", "math-ai", 2, 1),
  placement("p3", "bio", 3, 1),
];

const crit = (kind: LensCriterion["kind"], key: string): LensCriterion => ({ kind, key });

describe("deriveLensMatches", () => {
  it("returns null when no criteria are active (lens off, not zero hits)", () => {
    expect(deriveLensMatches(placed, byId, [])).toBeNull();
  });

  it("matches a course criterion by placement courseId", () => {
    const matches = deriveLensMatches(placed, byId, [crit("course", "math-aa")]);
    expect(matches?.matched).toEqual(new Set(["p1"]));
    expect(matches?.countsByCriterion.get("course:math-aa")).toBe(1);
  });

  it("matches a teacher criterion via the catalog course's teacherKeys", () => {
    const matches = deriveLensMatches(placed, byId, [crit("teacher", "kk")]);
    expect(matches?.matched).toEqual(new Set(["p1", "p2"]));
    expect(matches?.countsByCriterion.get("teacher:kk")).toBe(2);
  });

  it("matches a student criterion via the catalog course's studentKeys", () => {
    const matches = deriveLensMatches(placed, byId, [crit("student", "s2")]);
    expect(matches?.matched).toEqual(new Set(["p1", "p2"]));
  });

  it("unions criteria with OR — an overlap appears once in matched but in each criterion's count", () => {
    const matches = deriveLensMatches(placed, byId, [crit("course", "math-aa"), crit("teacher", "kk")]);
    expect(matches?.matched).toEqual(new Set(["p1", "p2"]));
    expect(matches?.countsByCriterion.get("course:math-aa")).toBe(1);
    expect(matches?.countsByCriterion.get("teacher:kk")).toBe(2);
  });

  it("counts an unknown key as 0 without matching anything", () => {
    const matches = deriveLensMatches(placed, byId, [crit("teacher", "ghost")]);
    expect(matches?.matched.size).toBe(0);
    expect(matches?.countsByCriterion.get("teacher:ghost")).toBe(0);
  });

  it("never matches teacher/student criteria for a placement whose course is uncataloged", () => {
    const orphaned = [...placed, placement("p4", "phantom", 4, 1)];
    const matches = deriveLensMatches(orphaned, byId, [crit("teacher", "kk"), crit("student", "s2")]);
    expect(matches?.matched).toEqual(new Set(["p1", "p2"]));
  });

  it("matches pending placements like any other", () => {
    const withPending: LocalPlacement[] = [...placed, { ...placement("p5", "math-aa", 5, 1), pending: true }];
    const matches = deriveLensMatches(withPending, byId, [crit("course", "math-aa")]);
    expect(matches?.matched).toEqual(new Set(["p1", "p5"]));
    expect(matches?.countsByCriterion.get("course:math-aa")).toBe(2);
  });
});

describe("criterionId", () => {
  it("derives the stable kind:key identity", () => {
    expect(criterionId(crit("teacher", "kk"))).toBe("teacher:kk");
  });
});

// Picker-source fixtures: dp1 has one teacher (t1) + one student; dp2 has t2 and a same-named course.
const dp1Source: LensCohortSource = {
  cohort: "dp1",
  courseDisplay: { "c-math": { name: "Math_AA-HL", color: "sky" }, "c-bio": { name: "Biology-SL", color: null } },
  catalog: [course("c-math", "t1"), course("c-bio", "t1")],
  studentNames: { s1: "Ada Byron" },
};

const dp2Source: LensCohortSource = {
  cohort: "dp2",
  courseDisplay: { "c-math-2": { name: "Math_AA-HL", color: null } },
  catalog: [course("c-math-2", "t2")],
  studentNames: { s2: "Grace Hopper" },
};

const teacherNames = { t1: "Kay Kay", t2: "Lin Lee", t3: "Unassigned Teacher" };

describe("buildLensOptions", () => {
  it("lists only the visible cohorts' courses and students, sorted by label", () => {
    const groups = buildLensOptions([dp1Source], teacherNames, false);
    expect(groups.courses.map((o) => o.label)).toEqual(["Biology-SL", "Math_AA-HL"]);
    expect(groups.students.map((o) => o.label)).toEqual(["Ada Byron"]);
    expect(groups.courses.map((o) => o.criterion.key)).toEqual(["c-bio", "c-math"]);
  });

  it("filters teachers to those appearing in a visible catalog's teacherKeys", () => {
    const focused = buildLensOptions([dp1Source], teacherNames, false);
    expect(focused.teachers.map((o) => o.criterion.key)).toEqual(["t1"]);
    const combined = buildLensOptions([dp1Source, dp2Source], teacherNames, true);
    expect(combined.teachers.map((o) => o.criterion.key)).toEqual(["t1", "t2"]);
  });

  it("cohort-tags course/student labels on the combined view, never teachers", () => {
    const groups = buildLensOptions([dp1Source, dp2Source], teacherNames, true);
    expect(groups.courses.map((o) => o.cohortTag)).toEqual(["DP1", "DP1", "DP2"]);
    expect(groups.students.map((o) => o.cohortTag)).toEqual(["DP1", "DP2"]);
    expect(groups.teachers.every((o) => o.cohortTag === undefined)).toBe(true);
  });

  it("leaves labels untagged on a focused view and carries the course color swatch", () => {
    const groups = buildLensOptions([dp1Source], teacherNames, false);
    expect(groups.courses.every((o) => o.cohortTag === undefined)).toBe(true);
    expect(groups.courses.find((o) => o.criterion.key === "c-math")?.color).toBe("sky");
  });
});

describe("mergeEffectiveCriteria", () => {
  const committed = [crit("course", "c-math"), crit("teacher", "t1")];

  it("passes committed through untouched when there is no preview", () => {
    expect(mergeEffectiveCriteria(committed, null)).toBe(committed);
  });

  it("appends a previewed criterion not yet committed", () => {
    expect(mergeEffectiveCriteria(committed, crit("student", "s1"))).toEqual([...committed, crit("student", "s1")]);
  });

  it("dedups a preview that is already committed (stable identity)", () => {
    expect(mergeEffectiveCriteria(committed, crit("teacher", "t1"))).toBe(committed);
  });
});

describe("combineLensCounts", () => {
  const dp1Matches: LensMatches = {
    matched: new Set(["p1", "p2"]),
    countsByCriterion: new Map([
      ["teacher:kk", 2],
      ["course:c-x", 1],
    ]),
  };
  const dp2Matches: LensMatches = {
    matched: new Set(["p9"]),
    countsByCriterion: new Map([["teacher:kk", 1]]),
  };

  it("sums per-criterion counts and union totals across visible cohorts", () => {
    const counts = combineLensCounts([dp1Matches, dp2Matches], [crit("teacher", "kk"), crit("course", "c-x")]);
    expect(counts.total).toBe(3);
    expect(counts.byCriterion.get("teacher:kk")).toBe(3);
    expect(counts.byCriterion.get("course:c-x")).toBe(1);
  });

  it("yields 0 for a criterion absent from every visible cohort (the ·0 chip)", () => {
    const counts = combineLensCounts([dp1Matches], [crit("student", "s-offscreen")]);
    expect(counts.byCriterion.get("student:s-offscreen")).toBe(0);
  });

  it("ignores inactive (null) cohort derivations", () => {
    const counts = combineLensCounts([dp1Matches, null], [crit("teacher", "kk")]);
    expect(counts.total).toBe(2);
    expect(counts.byCriterion.get("teacher:kk")).toBe(2);
  });
});

describe("pruneCriteria", () => {
  it("keeps criteria whose entity still exists and drops the rest", () => {
    const universe = {
      course: new Set(["c-math"]),
      teacher: new Set(["t1"]),
      student: new Set<string>(),
    };
    const pruned = pruneCriteria(
      [crit("course", "c-math"), crit("course", "c-gone"), crit("teacher", "t1"), crit("student", "s-gone")],
      universe,
    );
    expect(pruned).toEqual([crit("course", "c-math"), crit("teacher", "t1")]);
  });
});

describe("buildLensUniverse", () => {
  it("spans BOTH cohorts' courses, catalog teachers, and students", () => {
    const universe = buildLensUniverse([dp1Source, dp2Source]);
    expect(universe.course).toEqual(new Set(["c-math", "c-bio", "c-math-2"]));
    expect(universe.teacher).toEqual(new Set(["t1", "t2"]));
    expect(universe.student).toEqual(new Set(["s1", "s2"]));
  });
});
