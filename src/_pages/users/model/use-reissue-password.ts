import type { ActionErrorCode } from "astro:actions";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { refreshPage } from "@/shared/lib/forms";
import { reissueTemporaryPassword } from "../api/user-client";
import { UNREACHABLE_MESSAGE } from "./submit-create-account";
import type { PasswordReveal } from "./temporary-password-reveal";
import type { UserRow } from "./user-rows";

/** Refusals that mean the page is out of date: the account is gone, already active, or no longer yours to manage. */
const REFRESH_ON: readonly ActionErrorCode[] = ["NOT_FOUND", "CONFLICT", "FORBIDDEN"];

/**
 * The Users page's re-issue flow (S-409). Asking names a row and waits for the admin's confirmation,
 * because a new password stops the old one working. Confirming calls the function and hands the
 * one-time password to `onRevealed`. A refusal toasts, and reloads for the codes in `REFRESH_ON` so
 * the row shows what the database holds.
 */
export function useReissuePassword(onRevealed: (reveal: PasswordReveal) => void) {
  const [target, setTarget] = useState<UserRow | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  // Read synchronously, so a double click cannot issue two passwords before `isBusy` re-renders.
  const inFlight = useRef(false);

  const ask = (row: UserRow): void => {
    if (row.canReissuePassword) setTarget(row);
  };

  const cancel = (): void => {
    if (!inFlight.current) setTarget(null);
  };

  const confirm = async (): Promise<void> => {
    if (!target || inFlight.current) return;
    inFlight.current = true;
    setIsBusy(true);
    const row = target;

    // A rejected request (it never completed) becomes null: Astro's action client does not catch one.
    const result = await reissueTemporaryPassword({ userId: row.userId }).catch(() => null);
    inFlight.current = false;
    setIsBusy(false);
    setTarget(null);

    if (!result) {
      toast.error(UNREACHABLE_MESSAGE);
      return;
    }
    if (result.error) {
      toast.error(result.error.message);
      if (REFRESH_ON.includes(result.error.code)) await refreshPage();
      return;
    }
    onRevealed({ email: row.label.secondary ?? row.label.primary, password: result.data.password });
  };

  return { target, isBusy, ask, cancel, confirm };
}
