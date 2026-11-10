import { describe, expect, it } from "vitest";
import { allows, type AccessState } from "./access-state";

const ADMIN: AccessState = { status: "granted", role: "admin" };
const AUTHOR: AccessState = { status: "granted", role: "author" };
const VIEWER: AccessState = { status: "granted", role: "viewer" };
const NONE: AccessState = { status: "none" };
const PENDING: AccessState = { status: "password_change_required" };
const UNAVAILABLE: AccessState = { status: "unavailable" };

describe("allows", () => {
  it.each([
    ["admin", ADMIN, { session: true, read: true, edit: true, manage_users: true, stop_any_job: true }],
    ["author", AUTHOR, { session: true, read: true, edit: true, manage_users: false, stop_any_job: false }],
    ["viewer", VIEWER, { session: true, read: true, edit: false, manage_users: false, stop_any_job: false }],
    ["no role", NONE, { session: true, read: false, edit: false, manage_users: false, stop_any_job: false }],
    [
      "a temporary password",
      PENDING,
      { session: true, read: false, edit: false, manage_users: false, stop_any_job: false },
    ],
    [
      "a failed lookup",
      UNAVAILABLE,
      { session: true, read: false, edit: false, manage_users: false, stop_any_job: false },
    ],
  ] as const)("%s", (_label, access, expected) => {
    expect(allows(access, "session")).toBe(expected.session);
    expect(allows(access, "read")).toBe(expected.read);
    expect(allows(access, "edit")).toBe(expected.edit);
    expect(allows(access, "manage_users")).toBe(expected.manage_users);
    expect(allows(access, "stop_any_job")).toBe(expected.stop_any_job);
  });
});
