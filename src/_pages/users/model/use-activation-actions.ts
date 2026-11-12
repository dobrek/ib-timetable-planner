import { useRef, useState } from "react";
import { setUserActive } from "../api/user-client";
import { reportRowAction } from "./report-row-action";
import { emailOf, type UserRow } from "./user-rows";

/**
 * The Users page's row actions on a person's access (S-408).
 *
 * - **Deactivate** names a row and waits for the admin's confirmation, because it takes access away.
 *   It is never offered on the admin's own row (`currentUserId`): "No access" there already covers
 *   stepping down, and the database would refuse the last active admin anyway.
 * - **Reactivate** goes at once, like Re-send: it only restores the role the row still holds. While a
 *   row's reactivation is in flight, `reactivating` holds it, so its button stays disabled.
 *
 * Each answer is reported as every row action is (`reportRowAction`): the last-admin refusal toasts
 * and keeps the page, so its message stays.
 */
export function useActivationActions(currentUserId: string) {
  const [reactivating, setReactivating] = useState<ReadonlySet<string>>(new Set());
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null);
  const [isDeactivating, setIsDeactivating] = useState(false);
  // Read synchronously, so a double click cannot send twice before the state re-renders.
  const reactivateInFlight = useRef<ReadonlySet<string>>(new Set());
  const deactivateInFlight = useRef(false);

  const reactivate = (row: UserRow): void => {
    void restore(row);
  };

  const restore = async (row: UserRow): Promise<void> => {
    if (!row.canReactivate || reactivateInFlight.current.has(row.userId)) return;
    reactivateInFlight.current = new Set([...reactivateInFlight.current, row.userId]);
    setReactivating(reactivateInFlight.current);

    // A rejected request (it never completed) becomes null: Astro's action client does not catch one.
    const result = await setUserActive({ userId: row.userId, active: true }).catch(() => null);
    reactivateInFlight.current = new Set([...reactivateInFlight.current].filter((userId) => userId !== row.userId));
    setReactivating(reactivateInFlight.current);

    await reportRowAction(result, `${emailOf(row.label)} reactivated`);
  };

  const askDeactivate = (row: UserRow): void => {
    if (row.canDeactivate && row.userId !== currentUserId) setDeactivateTarget(row);
  };

  const cancelDeactivate = (): void => {
    if (!deactivateInFlight.current) setDeactivateTarget(null);
  };

  const confirmDeactivate = (): void => {
    void deactivate();
  };

  const deactivate = async (): Promise<void> => {
    if (!deactivateTarget || deactivateInFlight.current) return;
    deactivateInFlight.current = true;
    setIsDeactivating(true);
    const row = deactivateTarget;

    const result = await setUserActive({ userId: row.userId, active: false }).catch(() => null);
    deactivateInFlight.current = false;
    setIsDeactivating(false);
    setDeactivateTarget(null);

    await reportRowAction(result, `${emailOf(row.label)} deactivated`);
  };

  return {
    reactivating,
    reactivate,
    deactivateTarget,
    isDeactivating,
    askDeactivate,
    cancelDeactivate,
    confirmDeactivate,
  };
}
