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
import { deleteStudent } from "../api/student-client";
import type { StudentRow } from "../model/student";

type Props = {
  /** The student pending deletion, or null when closed. */
  student: StudentRow | null;
  onClose: () => void;
};

/**
 * Confirms a destructive delete and names the choice cascade impact.
 */
export default function DeleteStudentDialog({ student, onClose }: Props) {
  const { confirm, isBusy } = useConfirmAction(() => deleteStudent({ id: student?.id ?? "" }), {
    successMessage: "Student deleted",
    onDone: onClose,
  });
  const choiceCount = student?.choiceCourseIds.length ?? 0;

  return (
    <AlertDialog
      open={student !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {student?.fullName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {choiceCount > 0
              ? `This permanently removes the student and its ${choiceCount} course choice${choiceCount === 1 ? "" : "s"}.`
              : "This permanently removes the student from the catalog."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              if (student) void confirm();
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
