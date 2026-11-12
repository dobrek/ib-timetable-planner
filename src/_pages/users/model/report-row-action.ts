import type { ActionErrorCode } from "astro:actions";
import { toast } from "sonner";
import { refreshPage } from "@/shared/lib/forms";
import { ACCOUNT_UNREACHABLE_MESSAGE } from "../api/constants";

/** A row action's answer, or null when the request never completed (it was rejected). */
export type RowActionOutcome = { error: { code: ActionErrorCode; message: string } | undefined } | null;

/**
 * How the Users page answers a row action (S-410's invitations, S-408's deactivation). Success toasts
 * and reloads, so the row shows its new state. A refusal toasts, and reloads for the codes in
 * `REFRESH_ON`. A request that never completed toasts and changes nothing.
 */
export async function reportRowAction(result: RowActionOutcome, success: string): Promise<void> {
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
}

/**
 * Refusals that mean the page is out of date: the row's state already changed (`NOT_FOUND`), or the
 * caller is no longer an admin (`FORBIDDEN`). The page reloads, so it shows what the database holds.
 *
 * A conflict (`CONFLICT`: no longer pending, or the last admin) and the cooldown (`TOO_MANY_REQUESTS`)
 * are not among them, as in `use-role-change.ts`: `refreshPage()` is a full page load, and the toast
 * saying why would go with it.
 */
const REFRESH_ON: readonly ActionErrorCode[] = ["NOT_FOUND", "FORBIDDEN"];
