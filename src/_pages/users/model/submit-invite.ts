import { isInputError } from "astro:actions";
import type { UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { applyActionFieldErrors } from "@/shared/lib/forms";
import { ACCOUNT_UNREACHABLE_MESSAGE } from "../api/constants";
import { inviteUser } from "../api/user-client";
import type { InviteUserFormValues, InviteUserInput } from "./schemas";

type Options = {
  values: InviteUserInput;
  setError: UseFormSetError<InviteUserFormValues>;
  /** Called once the invitation is on its way; the dialog's job ends there. */
  onSent: () => void;
};

/**
 * The invite dialog's submit (S-410): input errors land on their fields, "already has an account"
 * lands on the email field, anything else (the re-send cooldown among them) toasts. Success toasts
 * whether it sent a new invitation or re-sent a pending one, then hands over to `onSent`.
 */
export async function submitInvite({ values, setError, onSent }: Options): Promise<void> {
  // A rejected request (it never completed) becomes null: Astro's action client does not catch one.
  const result = await inviteUser(values).catch(() => null);
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
  toast.success(result.data.resent ? `Invitation re-sent to ${values.email}` : `Invitation sent to ${values.email}`);
  onSent();
}
