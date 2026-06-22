import { describe, expect, it } from "vitest";
import type { PlacementWeek } from "@/shared/config";
import {
  hasBiweekly,
  isBiweekly,
  otherWeek,
  partitionByWeek,
  sharedSingleWeek,
  weekLabel,
  weeksDisjoint,
} from "./week";

describe("weeksDisjoint", () => {
  // `both` (agnostic) runs every week, so it overlaps every other week.
  it("treats `both` as overlapping everything", () => {
    const weeks: PlacementWeek[] = ["both", "a", "b"];
    for (const w of weeks) {
      expect(weeksDisjoint("both", w)).toBe(false);
      expect(weeksDisjoint(w, "both")).toBe(false);
    }
  });

  it("treats the same single week as overlapping", () => {
    expect(weeksDisjoint("a", "a")).toBe(false);
    expect(weeksDisjoint("b", "b")).toBe(false);
  });

  it("treats opposite single weeks as disjoint", () => {
    expect(weeksDisjoint("a", "b")).toBe(true);
    expect(weeksDisjoint("b", "a")).toBe(true);
  });
});

describe("isBiweekly", () => {
  it("is true for single weeks, false for agnostic", () => {
    expect(isBiweekly("a")).toBe(true);
    expect(isBiweekly("b")).toBe(true);
    expect(isBiweekly("both")).toBe(false);
  });
});

describe("hasBiweekly", () => {
  it("is true when any occupant is biweekly", () => {
    const occupants: { week: PlacementWeek }[] = [{ week: "both" }, { week: "a" }];
    expect(hasBiweekly(occupants, (o) => o.week)).toBe(true);
  });

  it("is false when every occupant is agnostic", () => {
    const occupants: { week: PlacementWeek }[] = [{ week: "both" }, { week: "both" }];
    expect(hasBiweekly(occupants, (o) => o.week)).toBe(false);
    expect(hasBiweekly([] as { week: PlacementWeek }[], (o) => o.week)).toBe(false);
  });
});

describe("partitionByWeek", () => {
  it("groups occupants by week and preserves input order within each group", () => {
    const occupants = [
      { id: "1", week: "a" as const },
      { id: "2", week: "both" as const },
      { id: "3", week: "b" as const },
      { id: "4", week: "a" as const },
      { id: "5", week: "both" as const },
    ];
    expect(partitionByWeek(occupants, (o) => o.week)).toEqual({
      both: [
        { id: "2", week: "both" },
        { id: "5", week: "both" },
      ],
      a: [
        { id: "1", week: "a" },
        { id: "4", week: "a" },
      ],
      b: [{ id: "3", week: "b" }],
    });
  });

  it("returns empty groups for empty input", () => {
    expect(partitionByWeek([] as { week: PlacementWeek }[], (o) => o.week)).toEqual({ both: [], a: [], b: [] });
  });
});

describe("sharedSingleWeek", () => {
  it("returns the shared week when every id runs that single week", () => {
    expect(sharedSingleWeek(["x", "y"], { x: "a", y: "a" })).toBe("a");
    expect(sharedSingleWeek(["x", "y"], { x: "b", y: "b" })).toBe("b");
  });

  it("returns null when any id is `both`", () => {
    expect(sharedSingleWeek(["x", "y"], { x: "a", y: "both" })).toBeNull();
  });

  it("returns null when ids differ in week", () => {
    expect(sharedSingleWeek(["x", "y"], { x: "a", y: "b" })).toBeNull();
  });

  it("returns null when an id is absent", () => {
    expect(sharedSingleWeek(["x", "y"], { x: "a" })).toBeNull();
  });
});

describe("weekLabel / otherWeek", () => {
  it("maps weeks to readable labels", () => {
    expect(weekLabel("a")).toBe("week A");
    expect(weekLabel("b")).toBe("week B");
  });

  it("returns the opposite week", () => {
    expect(otherWeek("a")).toBe("b");
    expect(otherWeek("b")).toBe("a");
  });
});
