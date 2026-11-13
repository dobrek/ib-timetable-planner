import { useRef, useState } from "react";
import { banUser, deleteAccount, unbanUser } from "../api/user-client";
import type { UserTargetInput } from "./schemas";
import { reportRowAction, type RowActionOutcome } from "./report-row-action";
import { emailOf, type UserRow } from "./user-rows";

/** The S-411 actions that wait for a confirmation dialog. Change email has its own form. */
export const CONFIRMED_ACCOUNT_ACTIONS = ["ban", "unban", "delete"] as const;
export type ConfirmedAccountAction = (typeof CONFIRMED_ACCOUNT_ACTIONS)[number];

/** A confirmation waiting on the admin: which action, on which row. */
export type PendingAccountAction = { action: ConfirmedAccountAction; row: UserRow };

/**
 * Ban, unban, delete and change email from the Users table (S-411).
 *
 * - **Ban, Unban and Delete** name a row and wait for the admin's confirmation. Each answer is
 *   reported as every row action is (`reportRowAction`): success toasts and reloads.
 * - **Change email** opens its form on a row. The form submits on its own (`submit-change-email.ts`).
 */
export function useAccountActions() {
  const [pending, setPending] = useState<PendingAccountAction | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [emailTarget, setEmailTarget] = useState<UserRow | null>(null);
  // Read synchronously, so a double click cannot send twice before `isBusy` re-renders.
  const inFlight = useRef(false);

  const ask = (action: ConfirmedAccountAction, row: UserRow): void => {
    if (row.actions.includes(action)) setPending({ action, row });
  };

  const cancel = (): void => {
    if (!inFlight.current) setPending(null);
  };

  const confirm = (): void => {
    void run();
  };

  const run = async (): Promise<void> => {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setIsBusy(true);
    const { action, row } = pending;

    // A rejected request (it never completed) becomes null: Astro's action client does not catch one.
    const result = await CALLS[action]({ userId: row.userId }).catch(() => null);
    inFlight.current = false;
    setIsBusy(false);
    setPending(null);

    await reportRowAction(result, `${emailOf(row.label)} ${DONE[action]}`);
  };

  const askChangeEmail = (row: UserRow): void => {
    if (row.actions.includes("change_email")) setEmailTarget(row);
  };

  const closeChangeEmail = (): void => {
    setEmailTarget(null);
  };

  return { pending, isBusy, ask, cancel, confirm, emailTarget, askChangeEmail, closeChangeEmail };
}

const CALLS: Readonly<Record<ConfirmedAccountAction, (values: UserTargetInput) => Promise<RowActionOutcome>>> = {
  ban: banUser,
  unban: unbanUser,
  delete: deleteAccount,
};

/** The success toast's verb, after the address. */
const DONE: Readonly<Record<ConfirmedAccountAction, string>> = {
  ban: "banned",
  unban: "unbanned",
  delete: "deleted",
};
