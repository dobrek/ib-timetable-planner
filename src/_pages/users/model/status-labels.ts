import type { UserStatus } from "./user-rows";

/** The Status column's wording. A `Record`, so a status added to `UserStatus` does not compile until it is named. */
export const STATUS_LABELS: Record<UserStatus, string> = {
  active: "Active",
  no_access: "No access",
  temporary_password: "Temporary password",
};
