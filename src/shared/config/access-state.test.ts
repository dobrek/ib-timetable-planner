import { describe, expect, it } from "vitest";
import { allows, type AccessState } from "./access-state";

const ADMIN: AccessState = { status: "granted", role: "admin" };
const AUTHOR: AccessState = { status: "granted", role: "author" };
const VIEWER: AccessState = { status: "granted", role: "viewer" };
const NONE: AccessState = { status: "none" };
const UNAVAILABLE: AccessState = { status: "unavailable" };

describe("allows", () => {
  it.each([
    ["admin", ADMIN, { session: true, read: true, edit: true }],
    ["author", AUTHOR, { session: true, read: true, edit: true }],
    ["viewer", VIEWER, { session: true, read: true, edit: false }],
    ["no role", NONE, { session: true, read: false, edit: false }],
    ["a failed lookup", UNAVAILABLE, { session: true, read: false, edit: false }],
  ] as const)("%s", (_label, access, expected) => {
    expect(allows(access, "session")).toBe(expected.session);
    expect(allows(access, "read")).toBe(expected.read);
    expect(allows(access, "edit")).toBe(expected.edit);
  });
});
