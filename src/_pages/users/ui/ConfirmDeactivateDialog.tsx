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
import { ROLE_LABELS } from "../model/role-labels";
import { emailOf, type UserRow } from "../model/user-rows";

type Props = {
  /** The person who would be deactivated, or null when closed. */
  target: UserRow | null;
  isBusy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Asks before deactivating someone (S-408): they lose access from their next page load, and their
 * role is kept, so reactivating restores it.
 */
export default function ConfirmDeactivateDialog({ target, isBusy, onConfirm, onClose }: Props) {
  const role = target?.role ? ROLE_LABELS[target.role] : null;
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate {target ? emailOf(target.label) : ""}?</AlertDialogTitle>
          <AlertDialogDescription>
            They lose access to every plan from their next page load. Their role{role ? ` (${role})` : ""} is kept, so
            reactivating restores it.
          </AlertDialogDescription>
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
            Deactivate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
