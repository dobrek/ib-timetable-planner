import { NO_ACCESS_LABEL } from "./role-labels";
import type { UserStatus } from "./user-rows";

/** The Status column's wording. A `Record`, so a status added to `UserStatus` does not compile until it is named. */
export const STATUS_LABELS: Record<UserStatus, string> = {
  active: "Active",
  no_access: NO_ACCESS_LABEL,
  temporary_password: "Temporary password",
  invited: "Invited",
  invitation_expired: "Invitation expired",
  invitation_accepted: "Invitation accepted",
};
