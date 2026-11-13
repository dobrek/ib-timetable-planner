import type { UserRow } from "../../model/user-rows";

/**
 * Rows for the component tests: the signed-in admin, a named author who is the service account, a
 * role-less user, an account on a temporary password, two invitations (S-410), one unaccepted and
 * one accepted, a deactivated viewer (S-408), an active colleague and a banned account (S-411). Each
 * row's `actions` is what `buildUserRows` derives for it.
 */
export const ADMIN_ID = "00000000-0000-4000-8000-00000000000a";
export const AUTHOR_ID = "00000000-0000-4000-8000-00000000000b";
export const NO_ROLE_ID = "00000000-0000-4000-8000-00000000000c";

export const ADMIN_ROW: UserRow = {
  userId: ADMIN_ID,
  label: { primary: "admin@example.test", secondary: null },
  role: "admin",
  status: "active",
  isSelf: true,
  actions: ["change_email"],
  canChangeRole: true,
  isServiceAccount: false,
  lastChange: { by: { kind: "operator" }, at: "2026-11-05T12:00:00+00:00" },
};

export const AUTHOR_ROW: UserRow = {
  userId: AUTHOR_ID,
  label: { primary: "Bea Author", secondary: "bea@example.test" },
  role: "author",
  status: "active",
  isSelf: false,
  actions: ["deactivate"],
  canChangeRole: true,
  isServiceAccount: true,
  lastChange: {
    by: { kind: "user", label: { primary: "admin@example.test", secondary: null } },
    at: "2026-11-05T13:00:00+00:00",
  },
};

export const NO_ROLE_ROW: UserRow = {
  userId: NO_ROLE_ID,
  label: { primary: "cal@example.test", secondary: null },
  role: null,
  status: "no_access",
  isSelf: false,
  actions: [],
  canChangeRole: true,
  isServiceAccount: false,
  lastChange: null,
};

export const PENDING_ID = "00000000-0000-4000-8000-00000000000d";

/** An account an admin created and who has not yet chosen a password: a role waits, access does not. */
export const PENDING_ROW: UserRow = {
  userId: PENDING_ID,
  label: { primary: "dee@example.test", secondary: null },
  role: "viewer",
  status: "temporary_password",
  isSelf: false,
  actions: ["reissue", "ban", "delete", "change_email"],
  canChangeRole: true,
  isServiceAccount: false,
  lastChange: {
    by: { kind: "user", label: { primary: "admin@example.test", secondary: null } },
    at: "2026-11-09T09:00:00+00:00",
  },
};

export const INVITED_ID = "00000000-0000-4000-8000-00000000000e";

/** An invitation not yet accepted (S-410): it can be re-sent and revoked. */
export const INVITED_ROW: UserRow = {
  userId: INVITED_ID,
  label: { primary: "eve@example.test", secondary: null },
  role: "viewer",
  status: "invited",
  isSelf: false,
  actions: ["resend", "revoke"],
  canChangeRole: true,
  isServiceAccount: false,
  lastChange: {
    by: { kind: "user", label: { primary: "admin@example.test", secondary: null } },
    at: "2026-11-11T09:00:00+00:00",
  },
};

export const ACCEPTED_ID = "00000000-0000-4000-8000-00000000000f";

/** An invitation accepted by a person who has not chosen a password yet: revocable, not re-sendable. */
export const ACCEPTED_ROW: UserRow = {
  userId: ACCEPTED_ID,
  label: { primary: "fay@example.test", secondary: null },
  role: "author",
  status: "invitation_accepted",
  isSelf: false,
  actions: ["revoke"],
  canChangeRole: true,
  isServiceAccount: false,
  lastChange: {
    by: { kind: "user", label: { primary: "admin@example.test", secondary: null } },
    at: "2026-11-11T08:00:00+00:00",
  },
};

export const DEACTIVATED_ID = "00000000-0000-4000-8000-000000000010";

/** A viewer an admin deactivated (S-408): the role is kept, and Reactivate restores it. */
export const DEACTIVATED_ROW: UserRow = {
  userId: DEACTIVATED_ID,
  label: { primary: "gil@example.test", secondary: null },
  role: "viewer",
  status: "deactivated",
  isSelf: false,
  actions: ["ban", "delete", "change_email", "reactivate"],
  canChangeRole: true,
  isServiceAccount: false,
  lastChange: {
    by: { kind: "user", label: { primary: "admin@example.test", secondary: null } },
    at: "2026-11-12T09:00:00+00:00",
  },
};

export const COLLEAGUE_ID = "00000000-0000-4000-8000-000000000011";

/** An active colleague who is not the signed-in admin and not the service account (S-411). */
export const COLLEAGUE_ROW: UserRow = {
  userId: COLLEAGUE_ID,
  label: { primary: "Ida Colleague", secondary: "ida@example.test" },
  role: "author",
  status: "active",
  isSelf: false,
  actions: ["deactivate", "ban", "delete", "change_email"],
  canChangeRole: true,
  isServiceAccount: false,
  lastChange: null,
};

export const BANNED_ID = "00000000-0000-4000-8000-000000000012";

/** A banned account (S-411): Unban, Delete and Change email, and nothing that would lift the pause. */
export const BANNED_ROW: UserRow = {
  userId: BANNED_ID,
  label: { primary: "jo@example.test", secondary: null },
  role: "viewer",
  status: "banned",
  isSelf: false,
  actions: ["unban", "delete", "change_email"],
  canChangeRole: false,
  isServiceAccount: false,
  lastChange: null,
};

export const ROWS = [
  ADMIN_ROW,
  AUTHOR_ROW,
  NO_ROLE_ROW,
  PENDING_ROW,
  INVITED_ROW,
  ACCEPTED_ROW,
  DEACTIVATED_ROW,
  COLLEAGUE_ROW,
  BANNED_ROW,
];
