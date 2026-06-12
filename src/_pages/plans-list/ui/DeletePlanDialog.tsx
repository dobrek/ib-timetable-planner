import { useConfirmAction } from "@/shared/lib/forms";
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
import { deletePlan } from "../api/plans-client";
import type { PlanRow } from "../api/loader";

type Props = {
  /** The plan pending deletion, or null when closed. */
  plan: PlanRow | null;
  onClose: () => void;
};

/**
 * Confirms the catastrophic-by-design delete: a plan cascade removes the entire
 * scenario, so the dialog names the blast radius with real entity counts.
 */
export default function DeletePlanDialog({ plan, onClose }: Props) {
  const { confirm, isBusy } = useConfirmAction(() => deletePlan({ id: plan?.id ?? "" }), {
    successMessage: "Plan deleted",
    onDone: onClose,
  });

  return (
    <AlertDialog
      open={plan !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {plan?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the whole scenario —{" "}
            <span className="text-foreground font-medium">{countsSummary(plan)}</span> — along with its teachers,
            choices, dependencies, and groupings. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              if (plan) void confirm();
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

const countsSummary = (plan: PlanRow | null): string => {
  if (!plan) return "";
  const { students, courses, placements } = plan.counts;
  return `${pluralize(students, "student")}, ${pluralize(courses, "course")}, and ${pluralize(placements, "placement")}`;
};

const pluralize = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
