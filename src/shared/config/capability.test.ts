import { describe, expect, it } from "vitest";
import { grants } from "./capability";

// Every role × capability pair, so a change to the map is a reviewable diff here. The SQL side of
// the same map (`private.can_read` / `can_edit`) is pinned by the role matrix.
describe("grants", () => {
  it.each([
    ["admin", "session", true],
    ["admin", "read", true],
    ["admin", "edit", true],
    ["author", "session", true],
    ["author", "read", true],
    ["author", "edit", true],
    ["viewer", "session", true],
    ["viewer", "read", true],
    ["viewer", "edit", false],
  ] as const)("%s holds %s: %s", (role, capability, expected) => {
    expect(grants(role, capability)).toBe(expected);
  });
});
