import { actions } from "astro:actions";
import { callAction } from "@/shared/lib/forms";
import type {
  AccountTargetInput,
  ChangeUserEmailInput,
  ChangeUserRoleInput,
  CreateAccountInput,
  InvitationTargetInput,
  InviteUserInput,
  ReissuePasswordInput,
  SetUserActiveInput,
} from "../model/schemas";

/** Typed one-line wrappers over the generated action clients — the slice's api seam. */

export const changeUserRole = (values: ChangeUserRoleInput) => callAction(actions.changeUserRole, values);

export const setUserActive = (values: SetUserActiveInput) => callAction(actions.setUserActive, values);

// These two return the action's `data` too, which `callAction` drops: the one-time password is the
// whole point of the call. A JSON call from the island, not a form post, so the result never
// travels through a redirect or a cookie.
export const createAccount = (values: CreateAccountInput) => actions.createAccount(values);

export const reissueTemporaryPassword = (values: ReissuePasswordInput) => actions.reissueTemporaryPassword(values);

// The invite returns its `data` too: whether it re-sent a pending invitation decides the toast.
export const inviteUser = (values: InviteUserInput) => actions.inviteUser(values);

export const resendInvitation = (values: InvitationTargetInput) => callAction(actions.resendInvitation, values);

export const revokeInvitation = (values: InvitationTargetInput) => callAction(actions.revokeInvitation, values);

export const banUser = (values: AccountTargetInput) => callAction(actions.banUser, values);

export const unbanUser = (values: AccountTargetInput) => callAction(actions.unbanUser, values);

export const deleteAccount = (values: AccountTargetInput) => callAction(actions.deleteAccount, values);

export const changeUserEmail = (values: ChangeUserEmailInput) => callAction(actions.changeUserEmail, values);
