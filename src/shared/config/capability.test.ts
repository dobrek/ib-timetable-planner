import { describe, expect, it } from "vitest";
import { grants } from "./capability";

// Every role × capability pair, so a change to the map is a reviewable diff here. The SQL side of
// the same map (`private.can_read` / `can_edit` / `can_manage_users` / `can_stop_any_job`) is
// pinned by the role matrix.
describe("grants", () => {
  it.each([
    ["admin", "session", true],
    ["admin", "read", true],
    ["admin", "edit", true],
    ["admin", "manage_users", true],
    ["admin", "stop_any_job", true],
    ["author", "session", true],
    ["author", "read", true],
    ["author", "edit", true],
    ["author", "manage_users", false],
    ["author", "stop_any_job", false],
    ["viewer", "session", true],
    ["viewer", "read", true],
    ["viewer", "edit", false],
    ["viewer", "manage_users", false],
    ["viewer", "stop_any_job", false],
  ] as const)("%s holds %s: %s", (role, capability, expected) => {
    expect(grants(role, capability)).toBe(expected);
  });
});
