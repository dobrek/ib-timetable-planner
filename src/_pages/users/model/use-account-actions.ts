import { useRef, useState } from "react";
import type { UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { ACCOUNT_UNREACHABLE_MESSAGE } from "../api/constants";
import { banUser, changeUserEmail, deleteAccount, unbanUser } from "../api/user-client";
import type { ChangeUserEmailFormValues } from "./schemas";
import { reportRowAction, type RowActionOutcome } from "./report-row-action";
import { emailOf, type UserRow } from "./user-rows";

/**
 * Ban, unban, delete and change email from the Users table (S-411). Each one waits for a dialog
 * that names the address. Success toasts and reloads, as deactivation does. A conflict on the new
 * address stays on the field, so the dialog can show it.
 */
export function useAccountActions() {
  const [banTarget, setBanTarget] = useState<UserRow | null>(null);
  const [unbanTarget, setUnbanTarget] = useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [emailTarget, setEmailTarget] = useState<UserRow | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const inFlight = useRef(false);

  const askBan = (row: UserRow): void => {
    if (row.canBan) setBanTarget(row);
  };
  const askUnban = (row: UserRow): void => {
    if (row.canUnban) setUnbanTarget(row);
  };
  const askDelete = (row: UserRow): void => {
    if (row.canDelete) setDeleteTarget(row);
  };
  const askChangeEmail = (row: UserRow): void => {
    if (row.canChangeEmail) setEmailTarget(row);
  };

  const cancel = (): void => {
    if (inFlight.current) return;
    setBanTarget(null);
    setUnbanTarget(null);
    setDeleteTarget(null);
    setEmailTarget(null);
  };

  const run = async (row: UserRow, work: () => Promise<RowActionOutcome>, success: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsBusy(true);
    const result = await work().catch(() => null);
    inFlight.current = false;
    setIsBusy(false);
    setBanTarget(null);
    setUnbanTarget(null);
    setDeleteTarget(null);
    await reportRowAction(result, success);
    return row;
  };

  const confirmBan = (): void => {
    const row = banTarget;
    if (!row) return;
    void run(row, () => banUser({ userId: row.userId }), `${emailOf(row.label)} banned`);
  };

  const confirmUnban = (): void => {
    const row = unbanTarget;
    if (!row) return;
    void run(row, () => unbanUser({ userId: row.userId }), `${emailOf(row.label)} unbanned`);
  };

  const confirmDelete = (): void => {
    const row = deleteTarget;
    if (!row) return;
    void run(row, () => deleteAccount({ userId: row.userId }), `${emailOf(row.label)} deleted`);
  };

  const submitEmail = async (email: string, setError: UseFormSetError<ChangeUserEmailFormValues>): Promise<void> => {
    const row = emailTarget;
    if (!row || inFlight.current) return;
    inFlight.current = true;
    setIsBusy(true);
    const result = await changeUserEmail({ userId: row.userId, email }).catch(() => null);
    inFlight.current = false;
    setIsBusy(false);
    if (!result) {
      toast.error(ACCOUNT_UNREACHABLE_MESSAGE);
      return;
    }
    if (result.error?.code === "CONFLICT") {
      setError("email", { message: result.error.message });
      return;
    }
    setEmailTarget(null);
    await reportRowAction(result, `${emailOf(row.label)} is now ${email}`);
  };

  return {
    banTarget,
    unbanTarget,
    deleteTarget,
    emailTarget,
    isBusy,
    askBan,
    askUnban,
    askDelete,
    askChangeEmail,
    cancel,
    confirmBan,
    confirmUnban,
    confirmDelete,
    submitEmail,
  };
}
