import { describe, expect, it } from "vitest";
import { decideStop } from "./solver-container-ops";

describe("decideStop", () => {
  it("does nothing to a container that is not running — probing it would start it", () => {
    expect(decideStop(false, null)).toBe("not-running");
    expect(decideStop(false, 0)).toBe("not-running");
  });

  it("refuses to stop a container that is solving", () => {
    expect(decideStop(true, 1)).toBe("busy");
  });

  it("refuses when the probe could not tell — unlike the sleep path, which would stop", () => {
    expect(decideStop(true, null)).toBe("unknown");
  });

  it("stops a running container that reports no solve in flight", () => {
    expect(decideStop(true, 0)).toBe("stop");
  });
});
