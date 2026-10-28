import { Home } from "lucide-react";
import { describe, expect, it } from "vitest";
import type { AccessState } from "./access-state";
import { GLOBAL_NAV_ITEMS, visibleNavItems, type NavItem } from "./nav";

const labels = (items: readonly NavItem[]) => items.map((item) => item.label);

describe("visibleNavItems", () => {
  it.each([
    ["an admin", { status: "granted", role: "admin" }],
    ["an author", { status: "granted", role: "author" }],
    ["a viewer", { status: "granted", role: "viewer" }],
  ] as const)("shows %s every global section", (_label, access) => {
    expect(labels(visibleNavItems(GLOBAL_NAV_ITEMS, access))).toEqual(["Home", "Plans"]);
  });

  it.each([
    ["a role-less user", { status: "none" }],
    ["a failed lookup", { status: "unavailable" }],
  ] as const)("hides Plans from %s and keeps Home", (_label, access) => {
    expect(labels(visibleNavItems(GLOBAL_NAV_ITEMS, access))).toEqual(["Home"]);
  });

  it("filters by each item's own capability", () => {
    const items: NavItem[] = [
      { href: "/a", label: "Open", icon: Home },
      { href: "/b", label: "Session", icon: Home, requires: "session" },
      { href: "/c", label: "Edit", icon: Home, requires: "edit" },
    ];
    const viewer: AccessState = { status: "granted", role: "viewer" };

    expect(labels(visibleNavItems(items, viewer))).toEqual(["Open", "Session"]);
    expect(labels(visibleNavItems(items, { status: "granted", role: "author" }))).toEqual(["Open", "Session", "Edit"]);
  });
});
