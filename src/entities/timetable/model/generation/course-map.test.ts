import { describe, expect, it } from "vitest";
import type { CourseNaturalKey } from "@/shared/lib/catalog-hash";
import { buildCourseIdMap, translateCourseIds, type CourseIdentityIndex } from "./course-map";
import type { GeneratedPlacement } from "./types";

const key = (name: string, level = "HL", groupIndex = 0): CourseNaturalKey => ({ name, level, groupIndex });

const index = (
  dp1: Record<string, CourseNaturalKey>,
  dp2: Record<string, CourseNaturalKey> = {},
): CourseIdentityIndex => ({
  dp1: new Map(Object.entries(dp1)),
  dp2: new Map(Object.entries(dp2)),
});

const placement = (courseId: string): GeneratedPlacement => ({
  cohort: "dp1",
  courseId,
  day: 1,
  period: 1,
  week: "both",
});

describe("buildCourseIdMap", () => {
  it("maps source ids to clone ids through the natural key", () => {
    const source = index({ "src-math": key("Math"), "src-bio": key("Biology") });
    const clone = index({ "cln-math": key("Math"), "cln-bio": key("Biology") });

    expect(buildCourseIdMap(source, clone)).toEqual(
      new Map([
        ["src-math", "cln-math"],
        ["src-bio", "cln-bio"],
      ]),
    );
  });

  it("keys on the whole tuple — same name, different level or group index are different courses", () => {
    const source = index({ a: key("Math", "HL", 0), b: key("Math", "SL", 0), c: key("Math", "HL", 1) });
    const clone = index({ x: key("Math", "HL", 0), y: key("Math", "SL", 0), z: key("Math", "HL", 1) });

    expect(buildCourseIdMap(source, clone)).toEqual(
      new Map([
        ["a", "x"],
        ["b", "y"],
        ["c", "z"],
      ]),
    );
  });

  it("keeps the cohorts apart — an identical course in dp2 is not the dp1 one", () => {
    const source = index({ "src-dp1": key("Math") }, { "src-dp2": key("Math") });
    const clone = index({ "cln-dp1": key("Math") }, { "cln-dp2": key("Math") });

    expect(buildCourseIdMap(source, clone)).toEqual(
      new Map([
        ["src-dp1", "cln-dp1"],
        ["src-dp2", "cln-dp2"],
      ]),
    );
  });

  it("throws when the SOURCE catalog has two courses under one natural key", () => {
    // The key is only usable because it is unique (measured 84/84). If it ever is not, the map would
    // silently pick one — so it refuses instead.
    const source = index({ a: key("Math"), b: key("Math") });

    expect(() => buildCourseIdMap(source, index({ x: key("Math") }))).toThrow(/two courses with the natural key/);
  });

  it("throws when the CLONE catalog has two courses under one natural key", () => {
    expect(() => buildCourseIdMap(index({ a: key("Math") }), index({ x: key("Math"), y: key("Math") }))).toThrow(
      /two courses with the natural key/,
    );
  });

  it("omits a source course the clone does not carry rather than mapping it to nothing", () => {
    // Not itself an error — the result may simply never place that course. `translateCourseIds` is
    // where an actually-referenced missing id becomes loud.
    const map = buildCourseIdMap(index({ a: key("Math"), b: key("Gone") }), index({ x: key("Math") }));

    expect(map).toEqual(new Map([["a", "x"]]));
  });
});

describe("translateCourseIds", () => {
  it("re-points every placement, leaving the rest of the row untouched", () => {
    const map = new Map([["src", "cln"]]);

    expect(translateCourseIds([{ cohort: "dp2", courseId: "src", day: 3, period: 4, week: "a" }], map)).toEqual([
      { cohort: "dp2", courseId: "cln", day: 3, period: 4, week: "a" },
    ]);
  });

  it("throws naming the unmapped id — a partial apply would corrupt the proposal silently", () => {
    expect(() => translateCourseIds([placement("ghost")], new Map([["src", "cln"]]))).toThrow(/ghost/);
  });

  it("is a no-op on an empty board", () => {
    expect(translateCourseIds([], new Map())).toEqual([]);
  });
});
