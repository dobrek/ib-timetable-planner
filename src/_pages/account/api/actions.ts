import { defineDomainAction } from "@/shared/lib/actions";
import { updateDisplayNameInput, updatePasswordInput } from "../model/schemas";
import { updateDisplayName } from "./update-display-name";
import { updatePassword } from "./update-password";

// `session`, not the `edit` default (S-403, FR-410): a user without a role still manages their own
// account, and both writes touch only the caller's own Auth user and `profiles` row.
export const accountActions = {
  updatePassword: defineDomainAction({ input: updatePasswordInput, run: updatePassword, requires: "session" }),
  updateDisplayName: defineDomainAction({ input: updateDisplayNameInput, run: updateDisplayName, requires: "session" }),
};
