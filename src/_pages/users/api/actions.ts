import { defineDomainAction } from "@/shared/lib/actions";
import { changeUserRoleInput, createAccountInput, reissuePasswordInput } from "../model/schemas";
import { changeUserRole } from "./change-user-role";
import { createAccount } from "./create-account";
import { reissueTemporaryPassword } from "./reissue-temporary-password";

// `manage_users`, more than the `edit` default (S-406): only an admin changes anyone's role, and
// only an admin creates an account or issues a password (S-409). The two account actions are couriers
// to the `admin-users` function, which checks the admin again, live, before it touches a secret key.
export const userActions = {
  changeUserRole: defineDomainAction({ input: changeUserRoleInput, run: changeUserRole, requires: "manage_users" }),
  createAccount: defineDomainAction({ input: createAccountInput, run: createAccount, requires: "manage_users" }),
  reissueTemporaryPassword: defineDomainAction({
    input: reissuePasswordInput,
    run: reissueTemporaryPassword,
    requires: "manage_users",
  }),
};
