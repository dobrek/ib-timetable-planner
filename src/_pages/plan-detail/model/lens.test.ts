import { describe, expect, it } from "vitest";
import { catalog, course, placement } from "./__fixtures__/builders";
import { criterionId, deriveLensMatches, type LensCriterion } from "./lens";
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
