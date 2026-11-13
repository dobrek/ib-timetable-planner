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
  target: UserRow | null;
  isBusy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Asks before removing an account (S-411). The plans that person created stay. */
export default function ConfirmDeleteAccountDialog({ target, isBusy, onConfirm, onClose }: Props) {
  const email = target ? emailOf(target.label) : "";
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {email}?</AlertDialogTitle>
          <AlertDialogDescription>The account is removed. Their plans stay.</AlertDialogDescription>
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
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
