import assert from "node:assert/strict";
import { parseRequest } from "./request.ts";

const USER_ID = "3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b";

Deno.test("create: an address and a role parse, and the address is trimmed and lowercased", () => {
  assert.deepEqual(parseRequest({ op: "create", email: "  New.Person@School.Example ", role: "author" }), {
    op: "create",
    email: "new.person@school.example",
    role: "author",
  });
});

Deno.test("create: every role and null are accepted", () => {
  for (const role of ["viewer", "author", "admin", null]) {
    assert.notEqual(parseRequest({ op: "create", email: "a@b.co", role }), null, String(role));
  }
});

Deno.test("create: a role outside the set, or a missing one, is refused", () => {
  for (const role of ["owner", "ADMIN", "", 1, undefined, {}]) {
    assert.equal(parseRequest({ op: "create", email: "a@b.co", role }), null, String(role));
  }
  assert.equal(parseRequest({ op: "create", email: "a@b.co" }), null);
});

Deno.test("create: an address that is not one is refused", () => {
  for (const email of ["", "plain", "a@b", "a b@c.co", "@b.co", 42, null, `${"a".repeat(250)}@b.co`]) {
    assert.equal(parseRequest({ op: "create", email, role: null }), null, String(email));
  }
});

Deno.test("an unknown key is refused, app_metadata first among them", () => {
  assert.equal(
    parseRequest({
      op: "create",
      email: "a@b.co",
      role: "viewer",
      app_metadata: { machine_role: "solver_job_writer" },
    }),
    null,
  );
  assert.equal(parseRequest({ op: "create", email: "a@b.co", role: "viewer", password: "chosen" }), null);
  assert.equal(parseRequest({ op: "reissue", userId: USER_ID, password: "chosen" }), null);
});

Deno.test("reissue: a UUID parses, anything else is refused", () => {
  assert.deepEqual(parseRequest({ op: "reissue", userId: USER_ID.toUpperCase() }), { op: "reissue", userId: USER_ID });
  for (const userId of ["", "not-a-uuid", USER_ID.slice(1), 7, null, undefined]) {
    assert.equal(parseRequest({ op: "reissue", userId }), null, String(userId));
  }
});

Deno.test("invite: an address and a role parse, and the address is trimmed and lowercased", () => {
  assert.deepEqual(parseRequest({ op: "invite", email: " Colleague@School.Example  ", role: "viewer" }), {
    op: "invite",
    email: "colleague@school.example",
    role: "viewer",
  });
  for (const role of ["viewer", "author", "admin"]) {
    assert.notEqual(parseRequest({ op: "invite", email: "a@b.co", role }), null, role);
  }
});

Deno.test("invite: a role is required, never null, missing or outside the set", () => {
  for (const role of [null, undefined, "owner", "", 1]) {
    assert.equal(parseRequest({ op: "invite", email: "a@b.co", role }), null, String(role));
  }
  assert.equal(parseRequest({ op: "invite", email: "a@b.co" }), null);
});

Deno.test("invite: an address that is not one is refused", () => {
  for (const email of ["", "plain", "a@b", "@b.co", null, `${"a".repeat(250)}@b.co`]) {
    assert.equal(parseRequest({ op: "invite", email, role: "viewer" }), null, String(email));
  }
});

Deno.test("invite: user metadata, app_metadata and a redirect are refused", () => {
  const base = { op: "invite", email: "a@b.co", role: "viewer" };
  assert.equal(parseRequest({ ...base, data: { role: "admin" } }), null);
  assert.equal(parseRequest({ ...base, app_metadata: { machine_role: "solver_job_writer" } }), null);
  assert.equal(parseRequest({ ...base, redirectTo: "https://evil.example" }), null);
});

Deno.test("resend and revoke: a UUID parses, anything else or an extra key is refused", () => {
  for (const op of ["resend", "revoke"] as const) {
    assert.deepEqual(parseRequest({ op, userId: USER_ID.toUpperCase() }), { op, userId: USER_ID });
    for (const userId of ["", "not-a-uuid", USER_ID.slice(1), 7, null, undefined]) {
      assert.equal(parseRequest({ op, userId }), null, `${op} ${String(userId)}`);
    }
    assert.equal(parseRequest({ op, userId: USER_ID, role: "admin" }), null, op);
    assert.equal(parseRequest({ op, userId: USER_ID, email: "a@b.co" }), null, op);
  }
});

Deno.test("the op must be one of the five, and the body an object", () => {
  for (const body of [
    { op: "delete", userId: USER_ID },
    { op: "ban", userId: USER_ID },
    { op: "" },
    {},
    [],
    null,
    "create",
    3,
  ]) {
    assert.equal(parseRequest(body), null, JSON.stringify(body));
  }
});
