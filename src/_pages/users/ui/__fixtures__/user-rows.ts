import type { UserRow } from "../../model/user-rows";

/** Rows for the component tests: the signed-in admin, a named author, and a role-less user. */
export const ADMIN_ID = "00000000-0000-4000-8000-00000000000a";
export const AUTHOR_ID = "00000000-0000-4000-8000-00000000000b";
export const NO_ROLE_ID = "00000000-0000-4000-8000-00000000000c";

export const ADMIN_ROW: UserRow = {
  userId: ADMIN_ID,
  label: { primary: "admin@example.test", secondary: null },
  role: "admin",
  status: "active",
  canReissuePassword: false,
  isServiceAccount: false,
  lastChange: { by: { kind: "operator" }, at: "2026-11-05T12:00:00+00:00" },
};

export const AUTHOR_ROW: UserRow = {
  userId: AUTHOR_ID,
  label: { primary: "Bea Author", secondary: "bea@example.test" },
  role: "author",
  status: "active",
  canReissuePassword: false,
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
  canReissuePassword: false,
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
  canReissuePassword: true,
  isServiceAccount: false,
  lastChange: {
    by: { kind: "user", label: { primary: "admin@example.test", secondary: null } },
    at: "2026-11-09T09:00:00+00:00",
  },
};

export const ROWS = [ADMIN_ROW, AUTHOR_ROW, NO_ROLE_ROW, PENDING_ROW];
