import { describe, expect, it } from "vitest";
import { classifyCall, classifyRead, classifyWrite, type ProbeError } from "./access-probe";

/**
 * Every branch of the role matrix's classification, pinned without a stack. Two rules carry the
 * weight: RLS's silent denials (an empty read, a 0-row write) must count as "denied", and an error
 * that is not an access denial must never count as one. Get the second wrong and every denied cell
 * in the matrix passes on a malformed payload or a 502.
 */
const GRANT_DENIAL: ProbeError = { code: "42501", message: 'permission denied for table "plans"' };
const RLS_INSERT_DENIAL: ProbeError = {
  code: "42501",
  message: 'new row violates row-level security policy for table "plans"',
};
const CLONE_SOURCE_HIDDEN: ProbeError = {
  code: "P0001",
  message: "clone_plan: source plan 6f1c9a52-6b0e-4a43-9d1e-3c6f6d0b8a11 not found",
};
const CLONE_NOT_FOUND = /source plan .* not found/;
const NO_EXECUTE: ProbeError = { code: "42501", message: "permission denied for function own_app_role" };

const NON_ACCESS_ERRORS: [string, ProbeError][] = [
  ["a foreign-key violation (23503)", { code: "23503", message: 'insert or update on table "courses" violates…' }],
  ["a unique violation (23505)", { code: "23505", message: 'duplicate key value violates unique constraint "…"' }],
  ["a bad uuid (22P02)", { code: "22P02", message: 'invalid input syntax for type uuid: "x"' }],
  ["a rejected JWT (PGRST301)", { code: "PGRST301", message: "JWT expired" }],
  ["a fetch failure (empty code)", { code: "", message: "TypeError: fetch failed" }],
  ["a non-JSON 502 (no code)", { message: "An invalid response was received from the upstream server" }],
];

describe("classifyRead", () => {
  it("reads a missing grant (42501) as denied", () => {
    expect(classifyRead({ error: GRANT_DENIAL, seesFixtureRows: false, seesAnyRow: false })).toBe("denied");
  });

  it("reads an empty table as denied — RLS's silent SELECT denial", () => {
    expect(classifyRead({ error: null, seesFixtureRows: false, seesAnyRow: false })).toBe("denied");
  });

  it("reads visible fixture rows as allowed", () => {
    expect(classifyRead({ error: null, seesFixtureRows: true, seesAnyRow: true })).toBe("allowed");
  });

  it("refuses partial visibility — other plans' rows but none of the fixture's", () => {
    expect(() => classifyRead({ error: null, seesFixtureRows: false, seesAnyRow: true })).toThrow(/partial visibility/);
  });

  it.each(NON_ACCESS_ERRORS)("throws on %s instead of calling it denied", (_why, error) => {
    expect(() => classifyRead({ error, seesFixtureRows: false, seesAnyRow: false })).toThrow(/not an access denial/);
  });
});

describe("classifyCall", () => {
  it("reads any answer as allowed, a null value included", () => {
    expect(classifyCall(null)).toBe("allowed");
  });

  it("reads a missing EXECUTE grant (42501) as denied", () => {
    expect(classifyCall(NO_EXECUTE)).toBe("denied");
  });

  it.each(NON_ACCESS_ERRORS)("throws on %s instead of calling it denied", (_why, error) => {
    expect(() => classifyCall(error)).toThrow(/not an access denial/);
  });
});

describe("classifyWrite", () => {
  it("reads a write whose effect landed as allowed", () => {
    expect(classifyWrite({ error: null, effectObserved: true })).toBe("allowed");
  });

  it("reads a silent 0-row UPDATE or DELETE as denied — no error, no effect", () => {
    expect(classifyWrite({ error: null, effectObserved: false })).toBe("denied");
  });

  it.each([
    ["a missing grant", GRANT_DENIAL],
    ["an RLS INSERT denial", RLS_INSERT_DENIAL],
  ])("reads %s (42501) with no effect as denied", (_why, error) => {
    expect(classifyWrite({ error, effectObserved: false })).toBe("denied");
  });

  it("throws on an error that comes with an effect — a contradiction, not an outcome", () => {
    expect(() => classifyWrite({ error: GRANT_DENIAL, effectObserved: true })).toThrow(/contradiction/);
  });

  it.each(NON_ACCESS_ERRORS)("throws on %s instead of calling it denied", (_why, error) => {
    expect(() => classifyWrite({ error, effectObserved: false })).toThrow(/not an access denial/);
  });

  describe("deniedWhen", () => {
    it("reads an RPC's own denial as denied when the message matches", () => {
      expect(classifyWrite({ error: CLONE_SOURCE_HIDDEN, effectObserved: false, deniedWhen: CLONE_NOT_FOUND })).toBe(
        "denied",
      );
    });

    it("throws on the same error when the call declares no matcher", () => {
      expect(() => classifyWrite({ error: CLONE_SOURCE_HIDDEN, effectObserved: false })).toThrow(
        /not an access denial/,
      );
    });

    it("throws on a non-matching message even with a matcher declared", () => {
      const otherRaise: ProbeError = { code: "P0001", message: "clone_plan: something else went wrong" };
      expect(() => classifyWrite({ error: otherRaise, effectObserved: false, deniedWhen: CLONE_NOT_FOUND })).toThrow(
        /not an access denial/,
      );
    });
  });
});
