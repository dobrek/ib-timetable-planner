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
import { deleteTeacher } from "../api/teacher-client";
import type { TeacherRow } from "../model/teacher";

type Props = {
  /** The teacher pending deletion, or null when closed. */
  teacher: TeacherRow | null;
  onClose: () => void;
};

/**
 * Confirms a destructive delete and names the assignment cascade impact.
 */
export default function DeleteTeacherDialog({ teacher, onClose }: Props) {
  const { confirm, isBusy } = useConfirmAction(() => deleteTeacher({ id: teacher?.id ?? "" }), {
    successMessage: "Teacher deleted",
    onDone: onClose,
  });
  const assignmentCount = teacher?.assignments.length ?? 0;

  return (
    <AlertDialog
      open={teacher !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {teacher?.code}?</AlertDialogTitle>
          <AlertDialogDescription>
            {assignmentCount > 0
              ? `This teacher is assigned to ${assignmentCount} course${assignmentCount === 1 ? "" : "s"}. Deleting will remove their assignment from those courses.`
              : "This permanently removes the teacher from the catalog."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              if (teacher) void confirm();
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
