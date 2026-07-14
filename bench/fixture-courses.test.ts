import { describe, expect, it } from "vitest";
import { copyFixtureSkeleton, mapCourseIdentities, type CourseIdentity, type SkeletonRow } from "./fixture-courses";

/**
 * Pure unit coverage for the identity mapping and skeleton copy — no Supabase, no env (the unit
 * project has no `load-test-env` setup, so a DB-reaching test here would fail loudly in CI rather
 * than be quietly absorbed into `pnpm test`).
 */
const identity = (id: string, name: string, groupIndex = 0, level = "none"): CourseIdentity => ({
  id,
  cohort: "dp1",
  name,
  level,
  groupIndex,
});

const row = (courseId: string, day: number, period: number): SkeletonRow => ({
  cohort: "dp1",
  courseId,
  day,
  period,
  week: "both",
});

describe("mapCourseIdentities", () => {
  it("maps source ids to clone ids by (cohort, name, level, group_index)", () => {
    const source = [identity("s1", "CAS", 1), identity("s2", "CAS", 2)];
    const clone = [identity("c2", "CAS", 2), identity("c1", "CAS", 1)];

    expect(mapCourseIdentities(source, clone)).toEqual(
      new Map([
        ["s1", "c1"],
        ["s2", "c2"],
      ]),
    );
  });

  it("distinguishes the same name across cohorts", () => {
    const source = [identity("s1", "Advisory"), { ...identity("s2", "Advisory"), cohort: "dp2" as const }];
    const clone = [{ ...identity("c2", "Advisory"), cohort: "dp2" as const }, identity("c1", "Advisory")];

    expect(mapCourseIdentities(source, clone).get("s2")).toBe("c2");
  });

  it("throws when an identity is ambiguous on either side", () => {
    const twins = [identity("s1", "CAS", 1), identity("s2", "CAS", 1)];

    expect(() => mapCourseIdentities(twins, [identity("c1", "CAS", 1)])).toThrow(/ambiguous/i);
    expect(() => mapCourseIdentities([identity("s1", "CAS", 1)], twins)).toThrow(/ambiguous/i);
  });

  it("throws when a source course has no clone counterpart", () => {
    expect(() => mapCourseIdentities([identity("s1", "CAS", 1)], [identity("c1", "CAS", 2)])).toThrow(
      /no identity match/i,
    );
  });
});

describe("copyFixtureSkeleton", () => {
  const source = [identity("s-adv", "Advisory"), identity("s-cas", "CAS", 1), identity("s-math", "Math AA")];
  const clone = [identity("c-adv", "Advisory"), identity("c-cas", "CAS", 1), identity("c-math", "Math AA")];
  const board = [row("s-adv", 3, 7), row("s-cas", 3, 8), row("s-math", 1, 1)];

  it("copies only the roster's rows, translated onto the clone's course ids", () => {
    const skeleton = copyFixtureSkeleton(source, clone, board, ["Advisory", "CAS"]);

    expect(skeleton).toEqual([row("c-adv", 3, 7), row("c-cas", 3, 8)]);
  });

  it("keeps each row's position and week verbatim — positions are never hardcoded", () => {
    const biweekly: SkeletonRow = { cohort: "dp1", courseId: "s-cas", day: 5, period: 7, week: "b" };

    const skeleton = copyFixtureSkeleton(source, clone, [biweekly], ["CAS"]);

    expect(skeleton).toEqual([{ ...biweekly, courseId: "c-cas" }]);
  });

  it("throws when a roster name is missing from either catalog", () => {
    expect(() => copyFixtureSkeleton(source, clone, board, ["Advisory", "SSSTS"])).toThrow(/missing/i);
    expect(() => copyFixtureSkeleton(source, [identity("c-adv", "Advisory")], board, ["Advisory", "CAS"])).toThrow(
      /missing/i,
    );
  });

  it("throws when a fixture course carries no placements in the source board", () => {
    expect(() => copyFixtureSkeleton(source, clone, [row("s-adv", 3, 7)], ["Advisory", "CAS"])).toThrow(
      /no placements/i,
    );
  });
});
