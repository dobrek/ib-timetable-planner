import { describe, expect, it } from "vitest";
import { needsConfirmation } from "./needs-confirmation";

describe("needsConfirmation", () => {
  it.each([
    ["your own new role", { targetIsSelf: true, newRole: "viewer" }, "self"],
    ["removing your own access", { targetIsSelf: true, newRole: null }, "self"],
    ["removing someone else's access", { targetIsSelf: false, newRole: null }, "remove"],
    ["someone else's new role", { targetIsSelf: false, newRole: "author" }, null],
  ] as const)("%s → %s", (_label, change, expected) => {
    expect(needsConfirmation(change)).toBe(expected);
  });
});
