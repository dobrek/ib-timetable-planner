import { defineDomainAction } from "@/shared/lib/actions";
import {
  changeUserEmailInput,
  changeUserRoleInput,
  createAccountInput,
  inviteUserInput,
  setUserActiveInput,
  userTargetInput,
} from "../model/schemas";
import { banUser } from "./ban-user";
import { changeUserEmail } from "./change-user-email";
import { changeUserRole } from "./change-user-role";
import { createAccount } from "./create-account";
import { deleteAccount } from "./delete-account";
import { inviteUser } from "./invite-user";
import { reissueTemporaryPassword } from "./reissue-temporary-password";
import { resendInvitation } from "./resend-invitation";
import { revokeInvitation } from "./revoke-invitation";
import { setUserActive } from "./set-user-active";
import { unbanUser } from "./unban-user";

// `manage_users`, more than the `edit` default (S-406): only an admin changes anyone's role, and
// only an admin creates an account, issues a password (S-409), invites, re-sends and revokes
// (S-410), deactivates and reactivates someone (S-408), or bans, unbans, deletes and changes an
// email (S-411). The account actions are couriers to the `admin-users` function, which checks the
// admin again, live, before it touches a secret key.
export const userActions = {
  changeUserRole: defineDomainAction({ input: changeUserRoleInput, run: changeUserRole, requires: "manage_users" }),
  setUserActive: defineDomainAction({ input: setUserActiveInput, run: setUserActive, requires: "manage_users" }),
  createAccount: defineDomainAction({ input: createAccountInput, run: createAccount, requires: "manage_users" }),
  reissueTemporaryPassword: defineDomainAction({
    input: userTargetInput,
    run: reissueTemporaryPassword,
    requires: "manage_users",
  }),
  inviteUser: defineDomainAction({ input: inviteUserInput, run: inviteUser, requires: "manage_users" }),
  resendInvitation: defineDomainAction({
    input: userTargetInput,
    run: resendInvitation,
    requires: "manage_users",
  }),
  revokeInvitation: defineDomainAction({
    input: userTargetInput,
    run: revokeInvitation,
    requires: "manage_users",
  }),
  banUser: defineDomainAction({ input: userTargetInput, run: banUser, requires: "manage_users" }),
  unbanUser: defineDomainAction({ input: userTargetInput, run: unbanUser, requires: "manage_users" }),
  deleteAccount: defineDomainAction({ input: userTargetInput, run: deleteAccount, requires: "manage_users" }),
  changeUserEmail: defineDomainAction({
    input: changeUserEmailInput,
    run: changeUserEmail,
    requires: "manage_users",
  }),
};
