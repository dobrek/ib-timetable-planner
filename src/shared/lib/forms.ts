import { isInputError, type ActionError } from "astro:actions";
import { navigate } from "astro:transitions/client";
import { useState } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { applyActionFieldErrors } from "./apply-action-errors";

/**
 * Client-only mutation-flow helpers (value imports from `astro:*` virtual modules).
 * Deliberately NOT re-exported from the `shared/lib` barrel: these modules don't resolve
 * under Vitest, so anything astro-value-importing must be deep-imported by ui code only.
 */

type SubmitFormOptions<TValues extends FieldValues> = {
  call: () => Promise<{ error: ActionError | undefined }>;
  setError: UseFormSetError<TValues>;
  /** Field that receives a conflict-coded server error as an inline message. */
  conflictField?: Path<TValues>;
  /** Error codes mapped onto `conflictField`. Default: ["CONFLICT"]. */
  conflictCodes?: readonly string[];
  successMessage: string;
  onClose: () => void;
};

/**
 * The standard dialog submit flow: input errors land on their fields, conflict-coded
 * errors land on `conflictField`, anything else toasts; success toasts, closes the
 * dialog, and re-runs the page loader via `refreshPage()`.
 */
export async function submitForm<TValues extends FieldValues>(options: SubmitFormOptions<TValues>): Promise<void> {
  const { error } = await options.call();
  if (error) {
    applyActionError(error, options);
    return;
  }
  toast.success(options.successMessage);
  options.onClose();
  await refreshPage();
}

/**
 * The standard confirm-dialog flow (delete/dissolve): busy flag around the call,
 * error toast on failure; success toasts, closes, and refreshes.
 */
export function useConfirmAction(
  call: () => Promise<{ error: { message: string } | undefined }>,
  options: { successMessage: string; onDone: () => void },
): { confirm: () => Promise<void>; isBusy: boolean } {
  const [isBusy, setIsBusy] = useState(false);

  const confirm = async () => {
    setIsBusy(true);
    const { error } = await call();
    setIsBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(options.successMessage);
    options.onDone();
    await refreshPage();
  };

  return { confirm, isBusy };
}

/** Re-run the current route's loader, preserving the query string. */
export function refreshPage(): Promise<void> {
  return navigate(window.location.pathname + window.location.search);
}

function applyActionError<TValues extends FieldValues>(error: ActionError, options: SubmitFormOptions<TValues>): void {
  if (isInputError(error)) {
    applyActionFieldErrors(error, options.setError);
    return;
  }
  const conflictCodes = options.conflictCodes ?? ["CONFLICT"];
  if (options.conflictField && conflictCodes.includes(error.code)) {
    options.setError(options.conflictField, { message: error.message });
    return;
  }
  toast.error(error.message);
}
