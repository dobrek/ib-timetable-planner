import { isInputError, type ActionError } from "astro:actions";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { applyActionFieldErrors } from "./apply-action-errors";
import type { ActionCallResult } from "./call-action";
import { refreshPage } from "./refresh-page";

type SubmitFormOptions<TValues extends FieldValues, TInput extends Record<string, unknown>> = {
  call: () => Promise<ActionCallResult<TInput>>;
  setError: UseFormSetError<TValues>;
  /** Field that receives a conflict-coded server error as an inline message. */
  conflictField?: Path<TValues>;
  /** Error codes mapped onto `conflictField`. Default: ["CONFLICT"]. */
  conflictCodes?: readonly string[];
  successMessage: string;
  onClose: () => void;
  /** Post-success navigation override (e.g. into a freshly created plan). Default: `refreshPage()`. */
  refresh?: () => Promise<void>;
};

/**
 * The standard dialog submit flow: input errors land on their fields, conflict-coded
 * errors land on `conflictField`, anything else toasts; success toasts, closes the
 * dialog, and re-runs the page loader via `refreshPage()` (or the `refresh` override).
 */
export async function submitForm<TValues extends FieldValues, TInput extends Record<string, unknown>>(
  options: SubmitFormOptions<TValues, TInput>,
): Promise<void> {
  const { error } = await options.call();
  if (error) {
    applyActionError(error, options);
    return;
  }
  toast.success(options.successMessage);
  options.onClose();
  await (options.refresh ?? refreshPage)();
}

function applyActionError<TValues extends FieldValues, TInput extends Record<string, unknown>>(
  error: ActionError,
  options: SubmitFormOptions<TValues, TInput>,
): void {
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
