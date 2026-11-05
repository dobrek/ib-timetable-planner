import { defineDomainAction } from "@/shared/lib/actions";
import { changeUserRoleInput } from "../model/schemas";
import { changeUserRole } from "./change-user-role";

// `manage_users`, more than the `edit` default (S-406): only an admin changes anyone's role.
export const userActions = {
  changeUserRole: defineDomainAction({ input: changeUserRoleInput, run: changeUserRole, requires: "manage_users" }),
};
