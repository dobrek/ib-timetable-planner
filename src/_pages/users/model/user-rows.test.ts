import { describe, expect, it } from "vitest";
import { EMAIL_LINK_LIFETIME_MS } from "@/shared/config";
import { buildUserRows, type UserDirectoryInput } from "./user-rows";

const ADA = "00000000-0000-4000-8000-00000000000a";
const BEA = "00000000-0000-4000-8000-00000000000b";
const CAL = "00000000-0000-4000-8000-00000000000c";
const GONE = "00000000-0000-4000-8000-0000000000ff";

const NOON = "2026-11-05T12:00:00+00:00";
const LATER = "2026-11-05T13:00:00+00:00";
/** When the page loads, unless a test says otherwise: an hour after LATER. */
const NOW = Date.parse("2026-11-05T14:00:00+00:00");

const ADA_LABEL = { primary: "Ada Lovelace", secondary: "ada@example.test" };

type Change = UserDirectoryInput["changes"][number];
type DirectoryEntry = UserDirectoryInput["directory"][number];
type HeldRole = UserDirectoryInput["roles"][number];

/** A role row, active unless a deactivation time is given (S-408). */
const held = (user_id: string, role: HeldRole["role"], deactivated_at: string | null = null): HeldRole => ({
  user_id,
  role,
  deactivated_at,
});

/** A directory entry for a person, with every flag a test does not name off. */
const entry = (user_id: string, email: string, overrides: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  user_id,
  email,
  is_service_account: false,
  must_change_password: false,
  invited_at: null,
  email_confirmed_at: NOON,
  ...overrides,
});

/** A user change by `actor`, with every field a test does not name defaulted. */
const change = (overrides: Partial<Change> & Pick<Change, "id" | "target_id">): Change => ({
  actor_id: ADA,
  actor_kind: "user",
  occurred_at: NOON,
  ...overrides,
});

const input = (overrides: Partial<UserDirectoryInput> = {}): UserDirectoryInput => ({
  directory: [entry(ADA, "ada@example.test"), entry(BEA, "bea@example.test")],
  profiles: [],
  roles: [],
  changes: [],
  ...overrides,
});

describe("buildUserRows", () => {
  it("names a user by display name with the email beneath, or by the email alone", () => {
    const rows = build(input({ profiles: [{ user_id: ADA, display_name: "Ada Lovelace" }] }));

    expect(rows.map(({ userId, label }) => ({ userId, label }))).toEqual([
      { userId: ADA, label: ADA_LABEL },
      { userId: BEA, label: { primary: "bea@example.test", secondary: null } },
    ]);
  });

  it("reads a user with a role as active, and one without as no access", () => {
    const rows = build(input({ roles: [held(ADA, "admin")] }));

    expect(rows.map(({ role, status }) => ({ role, status }))).toEqual([
      { role: "admin", status: "active" },
      { role: null, status: "no_access" },
    ]);
  });

  it("reads a deactivated role row as deactivated, keeping its role: only it offers Reactivate, only an active row Deactivate", () => {
    const rows = build(
      input({
        directory: [entry(ADA, "ada@example.test"), entry(BEA, "bea@example.test"), entry(CAL, "cal@example.test")],
        roles: [held(ADA, "admin"), held(BEA, "author", LATER)],
      }),
    );

    expect(activationOf(rows)).toEqual([
      { role: "admin", status: "active", canDeactivate: true, canReactivate: false },
      { role: "author", status: "deactivated", canDeactivate: false, canReactivate: true },
      { role: null, status: "no_access", canDeactivate: false, canReactivate: false },
    ]);
  });

  it("reads a pending row as pending even when its role is deactivated: pending wins, and neither is offered", () => {
    const rows = build(
      input({
        directory: [
          entry(ADA, "ada@example.test", { must_change_password: true }),
          entry(BEA, "bea@example.test", { invited_at: NOON, email_confirmed_at: null, must_change_password: true }),
          entry(CAL, "cal@example.test", { invited_at: NOON, email_confirmed_at: LATER, must_change_password: true }),
        ],
        roles: [held(ADA, "viewer", LATER), held(BEA, "viewer", LATER), held(CAL, "author", LATER)],
      }),
    );

    expect(activationOf(rows)).toEqual([
      { role: "viewer", status: "temporary_password", canDeactivate: false, canReactivate: false },
      { role: "viewer", status: "invited", canDeactivate: false, canReactivate: false },
      { role: "author", status: "invitation_accepted", canDeactivate: false, canReactivate: false },
    ]);
  });

  it("reads a user on a temporary password as such, with or without a role, and only that row can be re-issued", () => {
    const rows = build(
      input({
        directory: [
          entry(ADA, "ada@example.test", { must_change_password: true }),
          entry(BEA, "bea@example.test", { must_change_password: true }),
          entry(CAL, "cal@example.test"),
        ],
        roles: [held(ADA, "viewer")],
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

  it("reads an unaccepted invitation as invited, with its role waiting, offering re-send and revoke", () => {
    const rows = build(
      input({
        directory: [
          entry(ADA, "ada@example.test", { invited_at: NOON, email_confirmed_at: null, must_change_password: true }),
        ],
        roles: [held(ADA, "viewer")],
      }),
    );

    expect(actionsOf(rows)).toEqual([
      {
        role: "viewer",
        status: "invited",
        canResendInvitation: true,
        canRevokeInvitation: true,
        canReissuePassword: false,
      },
    ]);
  });

  it("keeps an invitation invited at exactly its lifetime, and expired one millisecond later, as GoTrue judges it", () => {
    const given = input({
      directory: [
        entry(ADA, "ada@example.test", { invited_at: NOON, email_confirmed_at: null, must_change_password: true }),
      ],
    });
    const deadline = Date.parse(NOON) + EMAIL_LINK_LIFETIME_MS;

    expect(build(given, deadline)[0]?.status).toBe("invited");
    expect(build(given, deadline + 1)[0]).toMatchObject({
      status: "invitation_expired",
      canResendInvitation: true,
      canRevokeInvitation: true,
    });
  });

  it("reads an accepted invitation without a password yet as accepted: revocable, but no longer re-sendable", () => {
    const rows = build(
      input({
        directory: [
          entry(ADA, "ada@example.test", { invited_at: NOON, email_confirmed_at: LATER, must_change_password: true }),
        ],
        roles: [held(ADA, "admin")],
      }),
    );

    expect(actionsOf(rows)).toEqual([
      {
        role: "admin",
        status: "invitation_accepted",
        canResendInvitation: false,
        canRevokeInvitation: true,
        canReissuePassword: false,
      },
    ]);
  });

  it("reads a dashboard-era invitee, unaccepted and never flagged, as invited too", () => {
    const rows = build(
      input({ directory: [entry(ADA, "ada@example.test", { invited_at: NOON, email_confirmed_at: null })] }),
    );

    expect(rows[0]?.status).toBe("invited");
  });

  it("reads an invitee who chose a password as any other account, with nothing left to re-send or revoke", () => {
    const rows = build(
      input({
        directory: [
          entry(ADA, "ada@example.test", { invited_at: NOON, email_confirmed_at: LATER }),
          entry(BEA, "bea@example.test", { invited_at: NOON, email_confirmed_at: LATER }),
        ],
        roles: [held(ADA, "viewer")],
      }),
    );

    expect(actionsOf(rows)).toEqual([
      {
        role: "viewer",
        status: "active",
        canResendInvitation: false,
        canRevokeInvitation: false,
        canReissuePassword: false,
      },
      {
        role: null,
        status: "no_access",
        canResendInvitation: false,
        canRevokeInvitation: false,
        canReissuePassword: false,
      },
    ]);
  });

  it("never offers a re-send or a revoke for an account on a temporary password", () => {
    const rows = build(input({ directory: [entry(ADA, "ada@example.test", { must_change_password: true })] }));

    expect(actionsOf(rows)).toEqual([
      {
        role: null,
        status: "temporary_password",
        canResendInvitation: false,
        canRevokeInvitation: false,
        canReissuePassword: true,
      },
    ]);
  });

  it("never offers a re-issue for an active or role-less user", () => {
    const rows = build(input({ roles: [held(ADA, "admin")] }));

    expect(rows.map(({ canReissuePassword }) => canReissuePassword)).toEqual([false, false]);
  });

  it("carries the service-account flag", () => {
    const rows = build(
      input({
        directory: [entry(CAL, "campaign@example.test", { is_service_account: true })],
      }),
    );

    expect(rows[0]?.isServiceAccount).toBe(true);
  });

  it("has no last change for a user no record names", () => {
    const rows = build(input({ changes: [change({ id: 1, target_id: BEA })] }));

    expect(rows.find(({ userId }) => userId === ADA)?.lastChange).toBeNull();
  });

  it("takes the latest record per user, whatever order the records arrive in", () => {
    const changes = [
      change({ id: 3, target_id: BEA, occurred_at: NOON }),
      change({ id: 2, target_id: BEA, occurred_at: LATER, actor_kind: "operator", actor_id: null }),
      change({ id: 1, target_id: BEA, occurred_at: NOON }),
    ];

    expect(lastChangeOf(BEA, build(input({ changes })))).toEqual({ by: { kind: "operator" }, at: LATER });
  });

  it("breaks a tie on the time with the greater id, for two records in one transaction", () => {
    const changes = [
      change({ id: 8, target_id: BEA, actor_kind: "operator", actor_id: null }),
      change({ id: 7, target_id: BEA }),
      change({ id: 9, target_id: BEA, actor_id: null }),
    ];

    expect(lastChangeOf(BEA, build(input({ changes })))).toEqual({ by: { kind: "deleted" }, at: NOON });
  });

  it.each([
    ["a user on file, by their label", { actor_kind: "user", actor_id: ADA }, { kind: "user", label: ADA_LABEL }],
    ["the operator", { actor_kind: "operator", actor_id: null }, { kind: "operator" }],
    ["a deleted user, whose id was nulled", { actor_kind: "user", actor_id: null }, { kind: "deleted" }],
    ["a user missing from the directory as deleted", { actor_kind: "user", actor_id: GONE }, { kind: "deleted" }],
  ] as const)("names the actor: %s", (_label, actor, expected) => {
    const rows = build(
      input({
        profiles: [{ user_id: ADA, display_name: "Ada Lovelace" }],
        changes: [change({ id: 1, target_id: BEA, ...actor })],
      }),
    );

    expect(lastChangeOf(BEA, rows)?.by).toEqual(expected);
  });

  it("sorts by label ignoring case, then by email", () => {
    const rows = build({
      directory: [entry(CAL, "zed@example.test"), entry(BEA, "bea@example.test"), entry(ADA, "amy@example.test")],
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
      directory: [entry(BEA, "bea@example.test"), entry(ADA, "ada@example.test")],
      profiles: [{ user_id: ADA, display_name: "Ada" }],
      roles: [held(ADA, "viewer")],
      changes: [change({ id: 1, target_id: ADA }), change({ id: 2, target_id: ADA, occurred_at: LATER })],
    });
    const before = structuredClone(given);

    build(deepFreeze(given));

    expect(given).toEqual(before);
  });
});

const actionsOf = (rows: ReturnType<typeof buildUserRows>) =>
  rows.map(({ role, status, canResendInvitation, canRevokeInvitation, canReissuePassword }) => ({
    role,
    status,
    canResendInvitation,
    canRevokeInvitation,
    canReissuePassword,
  }));

const activationOf = (rows: ReturnType<typeof buildUserRows>) =>
  rows.map(({ role, status, canDeactivate, canReactivate }) => ({ role, status, canDeactivate, canReactivate }));

/** The rows as the page would load them at `now`. */
const build = (given: UserDirectoryInput, now = NOW) => buildUserRows(given, now);

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
