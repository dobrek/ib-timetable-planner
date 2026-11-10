import { actions } from "astro:actions";
import { callAction } from "@/shared/lib/forms";
import type { ChangeUserRoleInput, CreateAccountInput, ReissuePasswordInput } from "../model/schemas";

/** Typed one-line wrappers over the generated action clients — the slice's api seam. */

export const changeUserRole = (values: ChangeUserRoleInput) => callAction(actions.changeUserRole, values);

// These two return the action's `data` too, which `callAction` drops: the one-time password is the
// whole point of the call. A JSON call from the island, not a form post, so the result never
// travels through a redirect or a cookie.
export const createAccount = (values: CreateAccountInput) => actions.createAccount(values);

export const reissueTemporaryPassword = (values: ReissuePasswordInput) => actions.reissueTemporaryPassword(values);
