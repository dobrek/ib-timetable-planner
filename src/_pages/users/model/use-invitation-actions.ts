import { useRef, useState } from "react";
import { resendInvitation, revokeInvitation } from "../api/user-client";
import { reportRowAction } from "./report-row-action";
import { emailOf, type UserRow } from "./user-rows";

/**
 * The Users page's row actions on an invitation (S-410).
 *
 * - **Re-send** goes at once: a new email, and the old link stops working. While a row's re-send is
 *   in flight, `resending` holds it, so its button stays disabled.
 * - **Revoke** names a row and waits for the admin's confirmation, because it deletes the account.
 *
 * Each answer is reported as every row action is (`reportRowAction`): "no longer pending" and the
 * cooldown toast and keep the page, so the message saying why stays.
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
    if (!row.actions.includes("resend") || resendInFlight.current.has(row.userId)) return;
    resendInFlight.current = new Set([...resendInFlight.current, row.userId]);
    setResending(resendInFlight.current);

    // A rejected request (it never completed) becomes null: Astro's action client does not catch one.
    const result = await resendInvitation({ userId: row.userId }).catch(() => null);
    resendInFlight.current = new Set([...resendInFlight.current].filter((userId) => userId !== row.userId));
    setResending(resendInFlight.current);

    await reportRowAction(result, `Invitation re-sent to ${emailOf(row.label)}`);
  };

  const askRevoke = (row: UserRow): void => {
    if (row.actions.includes("revoke")) setRevokeTarget(row);
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

    await reportRowAction(result, `Invitation for ${emailOf(row.label)} revoked`);
  };

  return { resending, resend, revokeTarget, isRevoking, askRevoke, cancelRevoke, confirmRevoke };
}
