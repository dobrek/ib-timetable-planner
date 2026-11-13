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
import type { ConfirmedAccountAction } from "../model/use-account-actions";
import { emailOf, type UserRow } from "../model/user-rows";

type Props = {
  action: ConfirmedAccountAction;
  /** The account the action would apply to, or null when closed. */
  target: UserRow | null;
  isBusy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

type Copy = { verb: string; description: string; destructive: boolean };

/** One dialog's wording per action. The verb titles it ("Ban …?") and labels its button. */
const COPY: Readonly<Record<ConfirmedAccountAction, Copy>> = {
  ban: { verb: "Ban", description: "Sign-in stops, and their access ends on their next action.", destructive: true },
  unban: {
    verb: "Unban",
    description: "They can sign in again. A pause that was already in place stays.",
    destructive: false,
  },
  delete: { verb: "Delete", description: "The account is removed. Their plans stay.", destructive: true },
};

/**
 * Asks before a ban, an unban or a delete (S-411). The page renders one per action, so a closing
 * dialog keeps its own wording while it fades.
 */
export default function ConfirmAccountActionDialog({ action, target, isBusy, onConfirm, onClose }: Props) {
  const { verb, description, destructive } = COPY[action];
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`${verb} ${target ? emailOf(target.label) : ""}?`}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            disabled={isBusy}
          >
            {verb}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
