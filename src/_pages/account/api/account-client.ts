import { actions } from "astro:actions";
import { callAction } from "@/shared/lib/forms";
import type { UpdateDisplayNameInput, UpdatePasswordInput } from "../model/schemas";

/** Typed one-line wrappers over the generated action clients — the slice's api seam. */

export const updatePassword = (values: UpdatePasswordInput) => callAction(actions.updatePassword, values);

export const updateDisplayName = (values: UpdateDisplayNameInput) => callAction(actions.updateDisplayName, values);
