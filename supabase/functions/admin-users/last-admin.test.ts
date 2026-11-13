import assert from "node:assert/strict";
import { type AdminStanding, isLastActiveAdmin } from "./last-admin.ts";

const ACTIVE: AdminStanding = { role: "admin", deactivatedAt: null, mustChangePassword: false };
const PAUSED: AdminStanding = { ...ACTIVE, deactivatedAt: "2026-11-13T12:00:00.000Z" };
const PENDING: AdminStanding = { ...ACTIVE, mustChangePassword: true };
const AUTHOR: AdminStanding = { ...ACTIVE, role: "author" };

Deno.test("the only admin who counts is the last", () => {
  assert.equal(isLastActiveAdmin(ACTIVE, []), true);
});

Deno.test("another admin who counts means the target is not the last", () => {
  assert.equal(isLastActiveAdmin(ACTIVE, [ACTIVE]), false);
  assert.equal(isLastActiveAdmin(ACTIVE, [PAUSED, ACTIVE]), false);
});

Deno.test("paused, pending and non-admin others do not count, so the target is still the last", () => {
  assert.equal(isLastActiveAdmin(ACTIVE, [PAUSED, PENDING, AUTHOR]), true);
});

Deno.test("a target who does not count is never the last", () => {
  for (const target of [null, PAUSED, PENDING, AUTHOR]) {
    assert.equal(isLastActiveAdmin(target, []), false, JSON.stringify(target));
  }
});
