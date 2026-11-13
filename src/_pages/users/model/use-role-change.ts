import type { ActionErrorCode } from "astro:actions";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { AppRole } from "@/shared/config";
import { refreshPage } from "@/shared/lib/forms";
import { changeUserRole } from "../api/user-client";
import { goToDashboard } from "../lib/go-to-dashboard";
import { needsConfirmation, type ConfirmationReason } from "./needs-confirmation";
import type { UserRow } from "./user-rows";

/** A role change waiting for the admin's confirmation. */
export type PendingConfirmation = { row: UserRow; role: AppRole | null; reason: ConfirmationReason };

/**
 * Refusals that mean the page is out of date: the role was already removed (`NOT_FOUND`), or the
 * caller is no longer an admin (`FORBIDDEN`). The page reloads, so it shows what the database holds.
 *
 * The last-admin refusal (`CONFLICT`) is not among them. Nothing changed, so the picker reverts on
 * its own, and the page stays, because a reload would take the explanation with it:
 * `refreshPage()` is a full page load while no layout mounts Astro's `<ClientRouter />`, and a
 * toast does not survive one.
 */
const REFRESH_ON: readonly ActionErrorCode[] = ["NOT_FOUND", "FORBIDDEN"];

/** The request never completed (a network drop, a Worker restart), so nothing is known to have saved. */
const UNREACHABLE_MESSAGE = "Role change failed — try again.";

/**
 * The Users page's role-change flow (S-406). A choice saves at once, unless it is the admin's own
 * role or No access: those wait for `confirm`. While a row saves, `saving` holds the role chosen
 * for it, so its picker shows that role and stays disabled. On a refusal the entry goes, and the
 * picker falls back to the row's own role.
 *
 * - Saved for another user: "Role changed", then reload. The row's new role and "Changed by" line are
 *   what the admin sees, since the toast goes with the reload, as on every page today.
 * - Saved for yourself: a full load of `/dashboard`, since this page is no longer yours.
 * - Refused: the server's message, and a reload only for the codes in `REFRESH_ON`.
 * - Never answered (the request rejected): a generic failure and no reload. The row is freed and
 *   its picker falls back, so the admin can try again.
 */
export function useRoleChange() {
  const [saving, setSaving] = useState<ReadonlyMap<string, AppRole | null>>(new Map());
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  // Read synchronously, so a double click cannot save twice before `saving` re-renders.
  const inFlight = useRef<ReadonlySet<string>>(new Set());

  const save = async (row: UserRow, role: AppRole | null): Promise<void> => {
    if (inFlight.current.has(row.userId)) return;
    inFlight.current = new Set([...inFlight.current, row.userId]);
    setSaving((current) => new Map([...current, [row.userId, role]]));

    // A rejected request (it never completed) becomes null: Astro's action client does not catch one.
    const result = await changeUserRole({ userId: row.userId, role }).catch(() => null);
    // Leaving at once, so the picker keeps showing the new role until the page goes.
    if (result && !result.error && row.isSelf) {
      goToDashboard();
      return;
    }

    inFlight.current = new Set([...inFlight.current].filter((userId) => userId !== row.userId));
    setSaving((current) => new Map([...current].filter(([userId]) => userId !== row.userId)));
    setConfirmation((current) => (current?.row.userId === row.userId ? null : current));
    if (!result) {
      toast.error(UNREACHABLE_MESSAGE);
      return;
    }
    if (result.error) {
      toast.error(result.error.message);
      if (REFRESH_ON.includes(result.error.code)) await refreshPage();
      return;
    }
    toast.success("Role changed");
    await refreshPage();
  };

  const choose = (row: UserRow, role: AppRole | null): void => {
    if (role === row.role) return;
    const reason = needsConfirmation({ targetIsSelf: row.isSelf, newRole: role });
    if (reason) setConfirmation({ row, role, reason });
    else void save(row, role);
  };

  const confirm = (): void => {
    if (confirmation) void save(confirmation.row, confirmation.role);
  };

  const cancel = (): void => {
    if (confirmation && !saving.has(confirmation.row.userId)) setConfirmation(null);
  };

  return { saving, confirmation, choose, confirm, cancel };
}
