import { describe, expect, it } from "vitest";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { biweekly, course } from "../../../__fixtures__/builders";
import { backboneCliques, interiorFirstCellOrder, maxWeightCliqueWeight } from "./problem";

/** A course with an explicit hour count (the builders default to 4). */
const hc = (id: string, teacher: string, students: string[], hours: number): GroupingCourse => ({
  ...course(id, teacher, students),
  hours,
});

describe("maxWeightCliqueWeight", () => {
  it("returns the exact max-weight clique on a crafted conflict graph", () => {
    // A(3)–B(2) share teacher t1; A(3)–C(2) share student s1; B–C are independent.
    // Cliques: {A,B}=5, {A,C}=5 (B–C is not an edge, so {A,B,C} is not a clique) → max = 5.
    const courses = [hc("A", "t1", ["s1"], 3), hc("B", "t1", ["s2"], 2), hc("C", "t2", ["s1"], 2)];
    expect(maxWeightCliqueWeight(courses, new Set())).toBe(5);
  });

  it("sums all hours when every course mutually conflicts (complete graph)", () => {
    const courses = [hc("A", "t", ["s1"], 3), hc("B", "t", ["s2"], 2), hc("C", "t", ["s3"], 2)];
    expect(maxWeightCliqueWeight(courses, new Set())).toBe(7);
  });

  it("falls to the single largest node when courses are independent", () => {
    const courses = [hc("A", "t1", ["s1"], 3), hc("B", "t2", ["s2"], 2)];
    expect(maxWeightCliqueWeight(courses, new Set())).toBe(3);
  });

  it("excludes flagged courses from the bound", () => {
    const courses = [hc("A", "t", ["s1"], 3), hc("flag", "t", ["s2"], 5)];
    expect(maxWeightCliqueWeight(courses, new Set(["flag"]))).toBe(3);
  });
});

describe("backboneCliques", () => {
  /** Flatten the returned cliques to sorted-id strings for order-independent comparison. */
  const asKeys = (cliques: Set<string>[]): string[] => cliques.map((c) => [...c].sort().join(",")).sort();

  it("collapses the identical clique every seed finds into one (dedup)", () => {
    // A, B, C mutually conflict (shared teacher) — every seed grows the same {A,B,C} clique.
    const courses = [hc("A", "t", ["s1"], 2), hc("B", "t", ["s2"], 2), hc("C", "t", ["s3"], 2)];
    expect(asKeys(backboneCliques(courses, new Set()))).toEqual(["A,B,C"]);
  });

  it("keeps cliques within 2 hours of the best and drops the rest (near-max window)", () => {
    // Three disjoint conflict pairs: {A,B}=10, {C,D}=8 (within 2 of 10 → kept), {E,F}=6 (dropped).
    const courses = [
      hc("A", "t1", ["s1"], 5),
      hc("B", "t1", ["s2"], 5),
      hc("C", "t2", ["s3"], 4),
      hc("D", "t2", ["s4"], 4),
      hc("E", "t3", ["s5"], 3),
      hc("F", "t3", ["s6"], 3),
    ];
    expect(asKeys(backboneCliques(courses, new Set()))).toEqual(["A,B", "C,D"]);
  });

  it("excludes biweekly and flagged courses from the backbone", () => {
    // Only A is a placeable non-flagged, non-biweekly node; bio (biweekly) and flag (flagged) drop out.
    const courses = [
      hc("A", "t", ["s1"], 3),
      { ...biweekly("bio", "t", ["s1"]), hours: 3 },
      hc("flag", "t", ["s1"], 3),
    ];
    const cliques = backboneCliques(courses, new Set(["flag"]));
    const ids = new Set(cliques.flatMap((c) => [...c]));
    expect(ids.has("bio")).toBe(false);
    expect(ids.has("flag")).toBe(false);
    expect(ids.has("A")).toBe(true);
  });
});

describe("interiorFirstCellOrder", () => {
  /** The distinct period visitation order (each period emits all days consecutively). */
  const periodSequence = (days: number, periods: number): number[] => [
    ...new Set(interiorFirstCellOrder(days, periods).map((c) => c.p)),
  ];

  it("orders interior periods centre-out, then the two day edges last", () => {
    // periods 5: centre 3 first, then 2 and 4 (equidistant), then the edges 1 and 5.
    expect(periodSequence(1, 5)).toEqual([3, 2, 4, 1, 5]);
  });

  it("has no interior periods when periods = 2 (both are edges)", () => {
    expect(periodSequence(1, 2)).toEqual([1, 2]);
  });

  it("degenerates to the single period when periods = 1", () => {
    expect(periodSequence(3, 1)).toEqual([1]);
    expect(interiorFirstCellOrder(3, 1)).toHaveLength(3); // one cell per day
  });

  it("emits every (day, period) cell exactly once — days × periods total", () => {
    expect(interiorFirstCellOrder(3, 4)).toHaveLength(12);
  });
});
