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
import type { UserRow } from "../model/user-rows";

type Props = {
  /** The pending account whose password would be replaced, or null when closed. */
  target: UserRow | null;
  isBusy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Asks before a new temporary password: it stops the old one working at once. */
export default function ConfirmReissueDialog({ target, isBusy, onConfirm, onClose }: Props) {
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Issue a new password for {target?.label.primary}?</AlertDialogTitle>
          <AlertDialogDescription>
            Their current temporary password stops working. You will be shown the new one once.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            disabled={isBusy}
          >
            Issue new password
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
