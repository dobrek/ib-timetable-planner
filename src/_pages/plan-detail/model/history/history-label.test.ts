import { describe, expect, it } from "vitest";
import { describeEdit } from "./history-label";

describe("describeEdit", () => {
  it("formats cell-anchored edits with the grid slot label", () => {
    expect(describeEdit("removeBundle", { day: 1, period: 3 })).toBe("Remove bundle at Mon · P3");
    expect(describeEdit("remove", { day: 1, period: 3 })).toBe("Remove course at Mon · P3");
    expect(describeEdit("addGroup", { day: 2, period: 4 })).toBe("Place group at Tue · P4");
    expect(describeEdit("add", { day: 1, period: 1 })).toBe("Place course at Mon · P1");
    expect(describeEdit("move", { day: 3, period: 2 })).toBe("Move course at Wed · P2");
    expect(describeEdit("moveBundle", { day: 3, period: 2 })).toBe("Move bundle at Wed · P2");
    expect(describeEdit("setWeek", { day: 5, period: 1 })).toBe("Flip week at Fri · P1");
    expect(describeEdit("lift", { day: 1, period: 3 })).toBe("Lift bundle at Mon · P3");
    expect(describeEdit("placeBack", { day: 2, period: 2 })).toBe("Place bundle at Tue · P2");
  });

  it("formats off-board shelf edits without a cell", () => {
    expect(describeEdit("parkMembers")).toBe("Park bundle");
    expect(describeEdit("discard")).toBe("Discard parked bundle");
  });
});
