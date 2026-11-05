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
import type { PendingConfirmation } from "../model/use-role-change";

type Props = {
  /** The change waiting for confirmation, or null when closed. */
  confirmation: PendingConfirmation | null;
  isBusy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Asks before a role change that costs access: your own role, or anyone's No access. */
export default function ConfirmRoleChangeDialog({ confirmation, isBusy, onConfirm, onClose }: Props) {
  const copy = confirmation ? copyFor(confirmation) : null;

  return (
    <AlertDialog
      open={confirmation !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy?.description}</AlertDialogDescription>
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
            {copy?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type Copy = { title: string; description: string; action: string };

const copyFor = ({ row, role, reason }: PendingConfirmation): Copy => {
  if (reason === "remove") {
    return {
      title: `Remove access for ${row.label.primary}?`,
      description: `${row.label.primary} will lose access to every plan. You can give them a role again at any time.`,
      action: "Remove access",
    };
  }
  if (role === null) {
    return {
      title: "Remove your own access?",
      description: "You will lose all access, to every plan and to this page. Only another admin can give it back.",
      action: "Remove my access",
    };
  }
  return {
    title: `Change your own role to ${ROLE_LABELS[role]}?`,
    description: "You will lose admin access, including this page. Only another admin can give it back.",
    action: "Change my role",
  };
};
