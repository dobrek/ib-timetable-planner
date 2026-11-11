import type { ActionErrorCode } from "astro:actions";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { refreshPage } from "@/shared/lib/forms";
import { ACCOUNT_UNREACHABLE_MESSAGE } from "../api/constants";
import { resendInvitation, revokeInvitation } from "../api/user-client";
import { emailOf, type UserRow } from "./user-rows";

/**
 * Refusals that mean the page is out of date: the account is gone (`NOT_FOUND`), or the caller is no
 * longer an admin (`FORBIDDEN`). The page reloads, so it shows what the database holds.
 *
 * "No longer pending" (`CONFLICT`) and the cooldown (`TOO_MANY_REQUESTS`) are not among them, as in
 * `use-role-change.ts`: `refreshPage()` is a full page load, and the toast saying why would go with it.
 */
const REFRESH_ON: readonly ActionErrorCode[] = ["NOT_FOUND", "FORBIDDEN"];

/**
 * The Users page's row actions on an invitation (S-410).
 *
 * - **Re-send** goes at once: a new email, and the old link stops working. While a row's re-send is
 *   in flight, `resending` holds it, so its button stays disabled.
 * - **Revoke** names a row and waits for the admin's confirmation, because it deletes the account.
 *
 * Success toasts and reloads, so the row shows its new state. A refusal toasts, and reloads for the
 * codes in `REFRESH_ON`. A request that never completed toasts and changes nothing.
 */
export function useInvitationActions() {
  const [resending, setResending] = useState<ReadonlySet<string>>(new Set());
  const [revokeTarget, setRevokeTarget] = useState<UserRow | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  // Read synchronously, so a double click cannot send twice before the state re-renders.
  const resendInFlight = useRef<ReadonlySet<string>>(new Set());
  const revokeInFlight = useRef(false);

  const resend = (row: UserRow): void => {
    void sendAgain(row);
  };

  const sendAgain = async (row: UserRow): Promise<void> => {
    if (!row.canResendInvitation || resendInFlight.current.has(row.userId)) return;
    resendInFlight.current = new Set([...resendInFlight.current, row.userId]);
    setResending(resendInFlight.current);

    // A rejected request (it never completed) becomes null: Astro's action client does not catch one.
    const result = await resendInvitation({ userId: row.userId }).catch(() => null);
    resendInFlight.current = new Set([...resendInFlight.current].filter((userId) => userId !== row.userId));
    setResending(resendInFlight.current);

    await report(result, `Invitation re-sent to ${emailOf(row.label)}`);
  };

  const askRevoke = (row: UserRow): void => {
    if (row.canRevokeInvitation) setRevokeTarget(row);
  };

  const cancelRevoke = (): void => {
    if (!revokeInFlight.current) setRevokeTarget(null);
  };

  const confirmRevoke = (): void => {
    void revoke();
  };

  const revoke = async (): Promise<void> => {
    if (!revokeTarget || revokeInFlight.current) return;
    revokeInFlight.current = true;
    setIsRevoking(true);
    const row = revokeTarget;

    const result = await revokeInvitation({ userId: row.userId }).catch(() => null);
    revokeInFlight.current = false;
    setIsRevoking(false);
    setRevokeTarget(null);

    await report(result, `Invitation for ${emailOf(row.label)} revoked`);
  };

  return { resending, resend, revokeTarget, isRevoking, askRevoke, cancelRevoke, confirmRevoke };
}

type ActionOutcome = { error: { code: ActionErrorCode; message: string } | undefined } | null;

const report = async (result: ActionOutcome, success: string): Promise<void> => {
  if (!result) {
    toast.error(ACCOUNT_UNREACHABLE_MESSAGE);
    return;
  }
  if (result.error) {
    toast.error(result.error.message);
    if (REFRESH_ON.includes(result.error.code)) await refreshPage();
    return;
  }
  toast.success(success);
  await refreshPage();
};
