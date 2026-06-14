import { useState } from "react";
import { toast } from "sonner";
import type { ActionCallResult } from "./call-action";
import { refreshPage } from "./refresh-page";

/**
 * The standard confirm-dialog flow (delete/dissolve): busy flag around the call,
 * error toast on failure; success toasts, closes, and refreshes.
 */
export function useConfirmAction<TInput extends Record<string, unknown>>(
  call: () => Promise<ActionCallResult<TInput>>,
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
