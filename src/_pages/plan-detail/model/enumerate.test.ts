import { describe, expect, it } from "vitest";
import type { WeekMode } from "@/shared/config";
import { enumerateOppositeWeekPairs, enumerateVariants } from "./enumerate";
import type { GroupingCourse } from "./grouping";

const course = (
  id: string,
  teacher: string | null,
  studentKeys: string[],
  weekMode: WeekMode = "agnostic",
): GroupingCourse => ({
  id,
  teacherKeys: teacher === null ? [] : [teacher],
  studentKeys,
  hours: 4,
  weekMode,
});

// A conflicts with B (shared teacher t1); A and C are compatible; B and C are compatible
const A = course("A", "t1", ["s1"]);
const B = course("B", "t1", ["s2"]);
const C = course("C", "t2", ["s3"]);

describe("enumerateVariants", () => {
  it("returns all maximal independent sets containing seed", () => {
    const keys = enumerateVariants(A, [A, B, C], 100).map((set) =>
      set
        .map((c) => c.id)
        .toSorted()
        .join(","),
    );
    expect(keys).toContain("A,C");
    expect(keys).not.toContain("A,B");
  });

  it("is deterministic across two runs", () => {
    const toKeys = (sets: GroupingCourse[][]) =>
      sets.map((set) =>
        set
          .map((c) => c.id)
          .toSorted()
          .join(","),
      );
    expect(toKeys(enumerateVariants(A, [A, B, C], 100))).toEqual(toKeys(enumerateVariants(A, [A, B, C], 100)));
  });

  it("throws when cap is exceeded", () => {
    const courses = [course("X", null, ["s1"]), course("Y", null, ["s2"]), course("Z", null, ["s3"])];
    expect(() => enumerateVariants(courses[0], courses, 0)).toThrow(/cap/i);
  });

  it("throws on a dense clique before the traversal explodes (bounds nodes, not just results)", () => {
    // 8 mutually-compatible courses: one distinct maximal set, but factorially many
    // orderings. seen.size stays at 1, so the result cap never fires — the traversal
    // node guard must. With cap=2 the node budget is 2*1000=2000, tripped well before
    // the ~7! orderings are exhausted.
    const clique = Array.from({ length: 8 }, (_, i) => course(`c${i}`, `t${i}`, [`s${i}`]));
    expect(() => enumerateVariants(clique[0], clique, 2)).toThrow(/cap/i);
  });

  it("returns a set with only the seed when all others conflict", () => {
    const seed = course("S", "t1", ["s1"]);
    const results = enumerateVariants(seed, [seed, course("X", "t1", ["s2"]), course("Y", null, ["s1"])], 100);
    expect(results).toHaveLength(1);
    expect(results[0].map((c) => c.id)).toEqual(["S"]);
  });
});

describe("enumerateOppositeWeekPairs", () => {
  it("emits each both-bi-weekly conflicting pair, sorted first-member-first", () => {
    // A and B share teacher t1 and are both bi-weekly → a soft (opposite-week) edge.
    const A = course("A", "t1", ["s1"], "biweekly");
    const B = course("B", "t1", ["s2"], "biweekly");
    const C = course("C", "t2", ["s3"], "agnostic");
    const pairs = enumerateOppositeWeekPairs([B, A, C]).map(([a, b]) => [a.id, b.id]);
    expect(pairs).toEqual([["A", "B"]]);
  });

  it("excludes a conflicting pair when either course is agnostic (hard edge)", () => {
    const A = course("A", "t1", ["s1"], "biweekly");
    const B = course("B", "t1", ["s2"], "agnostic"); // agnostic ⇒ hard edge, never opposite-week
    expect(enumerateOppositeWeekPairs([A, B])).toEqual([]);
  });

  it("excludes a both-bi-weekly pair that does not conflict (no edge)", () => {
    const A = course("A", "t1", ["s1"], "biweekly");
    const B = course("B", "t2", ["s2"], "biweekly"); // disjoint teacher + students → no conflict
    expect(enumerateOppositeWeekPairs([A, B])).toEqual([]);
  });
});
