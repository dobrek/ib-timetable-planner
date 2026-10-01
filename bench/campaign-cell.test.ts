import { describe, expect, it } from "vitest";
import { cellKeyOf, hostKeyOf } from "./campaign-cell";

/** The analyzer and the runner must spell a cell identically, or no run would ever count. */
describe("cellKeyOf", () => {
  it("names workers, stage budget and Mode A budget", () => {
    expect(cellKeyOf({ workers: 4, stageBudgetS: 120, modeABudgetS: 300 })).toBe("w4-s120-a300");
  });

  it("is the same with no targets as with an empty set", () => {
    expect(cellKeyOf({ workers: 8, stageBudgetS: 60, modeABudgetS: 300, targets: {} })).toBe("w8-s60-a300");
  });

  it("appends targets by tier when present, so a target run is never mistaken for a budget run", () => {
    expect(cellKeyOf({ workers: 4, stageBudgetS: 120, modeABudgetS: 300, targets: { "6": 900, "3": 95 } })).toBe(
      "w4-s120-a300-t3=95,6=900",
    );
  });
});

describe("hostKeyOf", () => {
  it("names the architecture and the CPU count, or ? when the platform did not say", () => {
    expect(hostKeyOf({ machine: "x86_64", cpuCount: 4 })).toBe("x86_64/4");
    expect(hostKeyOf({ machine: "arm64", cpuCount: null })).toBe("arm64/?");
  });
});
