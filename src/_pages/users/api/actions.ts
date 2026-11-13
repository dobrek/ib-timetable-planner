import { defineDomainAction } from "@/shared/lib/actions";
import {
  accountTargetInput,
  changeUserEmailInput,
  changeUserRoleInput,
  createAccountInput,
  invitationTargetInput,
  inviteUserInput,
  reissuePasswordInput,
  setUserActiveInput,
} from "../model/schemas";
import { banUser, changeUserEmail, deleteAccount, unbanUser } from "./account-operations";
import { changeUserRole } from "./change-user-role";
import { createAccount } from "./create-account";
import { inviteUser } from "./invite-user";
import { reissueTemporaryPassword } from "./reissue-temporary-password";
import { resendInvitation } from "./resend-invitation";
import { revokeInvitation } from "./revoke-invitation";
import { setUserActive } from "./set-user-active";

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
    input: reissuePasswordInput,
    run: reissueTemporaryPassword,
    requires: "manage_users",
  }),
  inviteUser: defineDomainAction({ input: inviteUserInput, run: inviteUser, requires: "manage_users" }),
  resendInvitation: defineDomainAction({
    input: invitationTargetInput,
    run: resendInvitation,
    requires: "manage_users",
  }),
  revokeInvitation: defineDomainAction({
    input: invitationTargetInput,
    run: revokeInvitation,
    requires: "manage_users",
  }),
  banUser: defineDomainAction({ input: accountTargetInput, run: banUser, requires: "manage_users" }),
  unbanUser: defineDomainAction({ input: accountTargetInput, run: unbanUser, requires: "manage_users" }),
  deleteAccount: defineDomainAction({ input: accountTargetInput, run: deleteAccount, requires: "manage_users" }),
  changeUserEmail: defineDomainAction({
    input: changeUserEmailInput,
    run: changeUserEmail,
    requires: "manage_users",
  }),
};
