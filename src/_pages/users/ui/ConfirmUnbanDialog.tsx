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

/** Asks before unbanning someone (S-411). A pause that was already in place stays. */
export default function ConfirmUnbanDialog({ target, isBusy, onConfirm, onClose }: Props) {
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
          <AlertDialogTitle>Unban {email}?</AlertDialogTitle>
          <AlertDialogDescription>
            They can sign in again. A pause that was already in place stays.
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
            Unban
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
