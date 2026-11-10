import { describe, expect, it } from "vitest";
import { buildUserRows, type UserDirectoryInput } from "./user-rows";

const ADA = "00000000-0000-4000-8000-00000000000a";
const BEA = "00000000-0000-4000-8000-00000000000b";
const CAL = "00000000-0000-4000-8000-00000000000c";
const GONE = "00000000-0000-4000-8000-0000000000ff";

const NOON = "2026-11-05T12:00:00+00:00";
const LATER = "2026-11-05T13:00:00+00:00";

const ADA_LABEL = { primary: "Ada Lovelace", secondary: "ada@example.test" };

type Change = UserDirectoryInput["changes"][number];

/** A user change by `actor`, with every field a test does not name defaulted. */
const change = (overrides: Partial<Change> & Pick<Change, "id" | "target_id">): Change => ({
  actor_id: ADA,
  actor_kind: "user",
  occurred_at: NOON,
  ...overrides,
});

const input = (overrides: Partial<UserDirectoryInput> = {}): UserDirectoryInput => ({
  directory: [
    { user_id: ADA, email: "ada@example.test", is_service_account: false, must_change_password: false },
    { user_id: BEA, email: "bea@example.test", is_service_account: false, must_change_password: false },
  ],
  profiles: [],
  roles: [],
  changes: [],
  ...overrides,
});

describe("buildUserRows", () => {
  it("names a user by display name with the email beneath, or by the email alone", () => {
    const rows = buildUserRows(input({ profiles: [{ user_id: ADA, display_name: "Ada Lovelace" }] }));

    expect(rows.map(({ userId, label }) => ({ userId, label }))).toEqual([
      { userId: ADA, label: ADA_LABEL },
      { userId: BEA, label: { primary: "bea@example.test", secondary: null } },
    ]);
  });

  it("reads a user with a role as active, and one without as no access", () => {
    const rows = buildUserRows(input({ roles: [{ user_id: ADA, role: "admin" }] }));

    expect(rows.map(({ role, status }) => ({ role, status }))).toEqual([
      { role: "admin", status: "active" },
      { role: null, status: "no_access" },
    ]);
  });

  it("reads a user on a temporary password as such, with or without a role, and only that row can be re-issued", () => {
    const rows = buildUserRows(
      input({
        directory: [
          { user_id: ADA, email: "ada@example.test", is_service_account: false, must_change_password: true },
          { user_id: BEA, email: "bea@example.test", is_service_account: false, must_change_password: true },
          { user_id: CAL, email: "cal@example.test", is_service_account: false, must_change_password: false },
        ],
        roles: [{ user_id: ADA, role: "viewer" }],
      }),
    );

    expect(
      rows.map(({ userId, role, status, canReissuePassword }) => ({ userId, role, status, canReissuePassword })),
    ).toEqual([
      { userId: ADA, role: "viewer", status: "temporary_password", canReissuePassword: true },
      { userId: BEA, role: null, status: "temporary_password", canReissuePassword: true },
      { userId: CAL, role: null, status: "no_access", canReissuePassword: false },
    ]);
  });

  it("never offers a re-issue for an active or role-less user", () => {
    const rows = buildUserRows(input({ roles: [{ user_id: ADA, role: "admin" }] }));

    expect(rows.map(({ canReissuePassword }) => canReissuePassword)).toEqual([false, false]);
  });

  it("carries the service-account flag", () => {
    const rows = buildUserRows(
      input({
        directory: [
          { user_id: CAL, email: "campaign@example.test", is_service_account: true, must_change_password: false },
        ],
      }),
    );

    expect(rows[0]?.isServiceAccount).toBe(true);
  });

  it("has no last change for a user no record names", () => {
    const rows = buildUserRows(input({ changes: [change({ id: 1, target_id: BEA })] }));

    expect(rows.find(({ userId }) => userId === ADA)?.lastChange).toBeNull();
  });

  it("takes the latest record per user, whatever order the records arrive in", () => {
    const changes = [
      change({ id: 3, target_id: BEA, occurred_at: NOON }),
      change({ id: 2, target_id: BEA, occurred_at: LATER, actor_kind: "operator", actor_id: null }),
      change({ id: 1, target_id: BEA, occurred_at: NOON }),
    ];

    expect(lastChangeOf(BEA, buildUserRows(input({ changes })))).toEqual({ by: { kind: "operator" }, at: LATER });
  });

  it("breaks a tie on the time with the greater id, for two records in one transaction", () => {
    const changes = [
      change({ id: 8, target_id: BEA, actor_kind: "operator", actor_id: null }),
      change({ id: 7, target_id: BEA }),
      change({ id: 9, target_id: BEA, actor_id: null }),
    ];

    expect(lastChangeOf(BEA, buildUserRows(input({ changes })))).toEqual({ by: { kind: "deleted" }, at: NOON });
  });

  it.each([
    ["a user on file, by their label", { actor_kind: "user", actor_id: ADA }, { kind: "user", label: ADA_LABEL }],
    ["the operator", { actor_kind: "operator", actor_id: null }, { kind: "operator" }],
    ["a deleted user, whose id was nulled", { actor_kind: "user", actor_id: null }, { kind: "deleted" }],
    ["a user missing from the directory as deleted", { actor_kind: "user", actor_id: GONE }, { kind: "deleted" }],
  ] as const)("names the actor: %s", (_label, actor, expected) => {
    const rows = buildUserRows(
      input({
        profiles: [{ user_id: ADA, display_name: "Ada Lovelace" }],
        changes: [change({ id: 1, target_id: BEA, ...actor })],
      }),
    );

    expect(lastChangeOf(BEA, rows)?.by).toEqual(expected);
  });

  it("sorts by label ignoring case, then by email", () => {
    const rows = buildUserRows({
      directory: [
        { user_id: CAL, email: "zed@example.test", is_service_account: false, must_change_password: false },
        { user_id: BEA, email: "bea@example.test", is_service_account: false, must_change_password: false },
        { user_id: ADA, email: "amy@example.test", is_service_account: false, must_change_password: false },
      ],
      profiles: [
        { user_id: CAL, display_name: "alex" },
        { user_id: ADA, display_name: "Alex" },
      ],
      roles: [],
      changes: [],
    });

    expect(rows.map(({ label }) => [label.primary, label.secondary])).toEqual([
      ["Alex", "amy@example.test"],
      ["alex", "zed@example.test"],
      ["bea@example.test", null],
    ]);
  });

  it("never mutates its input", () => {
    const given = input({
      directory: [
        { user_id: BEA, email: "bea@example.test", is_service_account: false, must_change_password: false },
        { user_id: ADA, email: "ada@example.test", is_service_account: false, must_change_password: false },
      ],
      profiles: [{ user_id: ADA, display_name: "Ada" }],
      roles: [{ user_id: ADA, role: "viewer" }],
      changes: [change({ id: 1, target_id: ADA }), change({ id: 2, target_id: ADA, occurred_at: LATER })],
    });
    const before = structuredClone(given);

    buildUserRows(deepFreeze(given));

    expect(given).toEqual(before);
  });
});

const lastChangeOf = (userId: string, rows: ReturnType<typeof buildUserRows>) =>
  rows.find((row) => row.userId === userId)?.lastChange;

/** Freeze every array and object, so a mutation throws instead of passing silently. */
const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
