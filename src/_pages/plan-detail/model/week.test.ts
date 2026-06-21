import { describe, expect, it } from "vitest";
import type { PlacementWeek } from "@/shared/config";
import { weeksDisjoint } from "./week";

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
