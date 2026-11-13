import { isInputError } from "astro:actions";
import type { UseFormSetError } from "react-hook-form";
import { applyActionFieldErrors } from "@/shared/lib/forms";
import { changeUserEmail } from "../api/user-client";
import type { ChangeUserEmailFormOutput, ChangeUserEmailFormValues } from "./schemas";
import { reportRowAction } from "./report-row-action";
import { emailOf, type UserRow } from "./user-rows";

type Options = {
  row: UserRow;
  values: ChangeUserEmailFormOutput;
  setError: UseFormSetError<ChangeUserEmailFormValues>;
  /** Called once the function has answered with anything the form cannot show; the dialog closes. */
  onDone: () => void;
};

/**
 * The change-email dialog's submit (S-411): input errors land on their fields, an address already on
 * the list lands on the email field, and the dialog stays open for both. Anything else closes it and
 * is reported as every row action is (`reportRowAction`): success toasts and reloads. A request that
 * never completed keeps the dialog too, so the admin can try again.
 */
export async function submitChangeEmail({ row, values, setError, onDone }: Options): Promise<void> {
  // A rejected request (it never completed) becomes null: Astro's action client does not catch one.
  const result = await changeUserEmail({ userId: row.userId, email: values.email }).catch(() => null);
  if (result?.error && isInputError(result.error)) {
    applyActionFieldErrors(result.error, setError);
    return;
  }
  if (result?.error?.code === "CONFLICT") {
    setError("email", { message: result.error.message });
    return;
  }
  if (result) onDone();
  await reportRowAction(result, `${emailOf(row.label)} is now ${values.email}`);
}
