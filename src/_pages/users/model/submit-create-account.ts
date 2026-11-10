import { isInputError } from "astro:actions";
import type { UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { applyActionFieldErrors } from "@/shared/lib/forms";
import { ACCOUNT_UNREACHABLE_MESSAGE } from "../api/constants";
import { createAccount } from "../api/user-client";
import type { CreateAccountFormOutput, CreateAccountFormValues, PasswordReveal } from "./schemas";

type Options = {
  values: CreateAccountFormOutput;
  setError: UseFormSetError<CreateAccountFormValues>;
  /** Called with the one-time password once the account exists. */
  onCreated: (reveal: PasswordReveal) => void;
};

/**
 * The create dialog's submit: input errors land on their fields, "already exists" lands on the
 * email field, anything else toasts. Success hands the password to `onCreated` and does nothing
 * else: no toast, no refresh. The reveal dialog owns the password and refreshes the page when
 * the admin is done with it.
 */
export async function submitCreateAccount({ values, setError, onCreated }: Options): Promise<void> {
  // A rejected request (it never completed) becomes null: Astro's action client does not catch one.
  const result = await createAccount({ email: values.email, role: values.role }).catch(() => null);
  if (!result) {
    toast.error(ACCOUNT_UNREACHABLE_MESSAGE);
    return;
  }
  if (result.error) {
    if (isInputError(result.error)) applyActionFieldErrors(result.error, setError);
    else if (result.error.code === "CONFLICT") setError("email", { message: result.error.message });
    else toast.error(result.error.message);
    return;
  }
  onCreated({ email: values.email, password: result.data.password });
}
