import { actions } from "astro:actions";
import { callAction } from "@/shared/lib/forms";
import type { ChangeUserRoleInput } from "../model/schemas";

/** Typed one-line wrappers over the generated action clients — the slice's api seam. */

export const changeUserRole = (values: ChangeUserRoleInput) => callAction(actions.changeUserRole, values);
