import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui";
import { emailOf, type UserRow } from "../model/user-rows";

type Props = {
  /** The invitation that would be withdrawn, or null when closed. */
  target: UserRow | null;
  isBusy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Asks before revoking an invitation (S-410): the link stops working and the account is deleted. */
export default function ConfirmRevokeDialog({ target, isBusy, onConfirm, onClose }: Props) {
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke the invitation for {target ? emailOf(target.label) : ""}?</AlertDialogTitle>
          <AlertDialogDescription>Their link stops working and the account is removed.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            disabled={isBusy}
          >
            Revoke invitation
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
