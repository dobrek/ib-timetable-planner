import { describe, expect, it } from "vitest";
import { readActiveJobCount } from "./solver-container-active";

/**
 * The stay-awake decision, pinned as a pure function. The `onActivityExpired` override around it is
 * proven by tier 3 and the production drill — what is testable here is the part that decides, and it
 * is the part with the failure mode: a body this reads as "1" when it is not keeps a container alive
 * forever, and one it reads as "0" when it is not kills a twenty-minute solve.
 */
describe("readActiveJobCount", () => {
  it("reads a live solve out of the container's own answer", () => {
    expect(readActiveJobCount('{"active":1}')).toBe(1);
    expect(readActiveJobCount('{"active":2}')).toBe(2);
  });

  it("reads an idle container as zero — the container may sleep", () => {
    expect(readActiveJobCount('{"active":0}')).toBe(0);
  });

  it.each([
    ["non-JSON", "not json at all"],
    ["an empty body", ""],
    ["HTML from a proxy", "<html>502</html>"],
    ["a missing field", "{}"],
    ["a null field", '{"active":null}'],
    ["a stringified count", '{"active":"1"}'],
    ["a JSON array", "[1]"],
    ["a bare number", "3"],
    ["NaN-ish nonsense", '{"active":"NaN"}'],
    ["a negative count", '{"active":-1}'],
  ])("treats %s as zero rather than as a reason to stay awake", (_why, body) => {
    // Fail-towards-stopping on purpose: a container that cannot say it is solving is one we cannot
    // keep alive indefinitely, and the cost of that guess is a solve that reaches `interrupted` with
    // its last checkpoint intact. The opposite guess is a container that never sleeps.
    expect(readActiveJobCount(body)).toBe(0);
  });

  it("floors a fractional count rather than propagating it", () => {
    // Nothing legitimate sends one; the point is that the caller compares against 0 and never has to
    // reason about what `1.5 > 0` means downstream.
    expect(readActiveJobCount('{"active":1.9}')).toBe(1);
  });
});
