import type { ActionErrorCode } from "astro:actions";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ActionCallResult } from "./call-action";
import { refreshPage } from "./refresh-page";

/**
 * The standard confirm-dialog flow (delete/dissolve): busy flag around the call,
 * error toast on failure; success toasts, closes, and refreshes. Re-entry is guarded
 * (a rapid double-click can't double-submit) and post-`await` state updates bail when
 * the dialog has already unmounted (it unmounts on success). An error whose code is in
 * `refreshOn` means the page is out of date: it toasts and refreshes too, so the user
 * sees what changed.
 */
export function useConfirmAction<TInput extends Record<string, unknown>>(
  call: () => Promise<ActionCallResult<TInput>>,
  options: { successMessage: string; onDone: () => void; refreshOn?: readonly ActionErrorCode[] },
): { confirm: () => Promise<void>; isBusy: boolean } {
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const confirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);

    const { error } = await call();

    if (!mountedRef.current) return;
    busyRef.current = false;
    setIsBusy(false);

    if (error) {
      toast.error(error.message);
      if (options.refreshOn?.includes(error.code)) await refreshPage();
      return;
    }

    toast.success(options.successMessage);
    options.onDone();
    await refreshPage();
  };

  return { confirm, isBusy };
}
