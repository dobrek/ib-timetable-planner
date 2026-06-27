import { describe, expect, it } from "vitest";
import type { WeekMode } from "@/shared/config";
import { defaultParkedWeek, groupingParkedMembers } from "./parked-members";
import type { PlannerGrouping } from "../grouping/grouping";

const weekModes = (entries: Record<string, WeekMode>): Map<string, WeekMode> => new Map(Object.entries(entries));

const grouping = (
  overrides: Partial<PlannerGrouping> & Pick<PlannerGrouping, "id" | "memberIds">,
): PlannerGrouping => ({
  coverageCount: 0,
  score: 0,
  oppositeWeek: false,
  ...overrides,
});

describe("defaultParkedWeek", () => {
  it("parks a bi-weekly course on week a", () => {
    expect(defaultParkedWeek("c1", weekModes({ c1: "biweekly" }))).toBe("a");
  });

  it("parks an agnostic course on both weeks", () => {
    expect(defaultParkedWeek("c1", weekModes({ c1: "agnostic" }))).toBe("both");
  });

  it("defaults to both for an unknown course (no week mode)", () => {
    expect(defaultParkedWeek("missing", weekModes({}))).toBe("both");
  });
});

describe("groupingParkedMembers", () => {
  it("alternates an opposite-week grouping's members a/b (sorted by id)", () => {
    const groupings = [grouping({ id: "g1", memberIds: ["c2", "c1"], oppositeWeek: true })];
    expect(groupingParkedMembers("g1", groupings, weekModes({ c1: "biweekly", c2: "biweekly" }))).toEqual([
      { courseId: "c2", week: "b" },
      { courseId: "c1", week: "a" },
    ]);
  });

  it("resolves each member of a plain grouping by its own default week", () => {
    const groupings = [grouping({ id: "g1", memberIds: ["c1", "c2"] })];
    expect(groupingParkedMembers("g1", groupings, weekModes({ c1: "biweekly", c2: "agnostic" }))).toEqual([
      { courseId: "c1", week: "a" },
      { courseId: "c2", week: "both" },
    ]);
  });

  it("returns no members for an unknown grouping id", () => {
    expect(groupingParkedMembers("missing", [], weekModes({}))).toEqual([]);
  });
});
