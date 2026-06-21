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
  planId: string;
  /** The teacher pending deletion, or null when closed. */
  teacher: TeacherRow | null;
  onClose: () => void;
};

/**
 * Confirms a destructive delete. Co-teacher links just drop; deleting the SOLE teacher of
 * any course is blocked server-side (the ≥1-teacher guard names the orphaned courses).
 */
export default function DeleteTeacherDialog({ planId, teacher, onClose }: Props) {
  const { confirm, isBusy } = useConfirmAction(() => deleteTeacher({ planId, id: teacher?.id ?? "" }), {
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
              ? `This teacher co-teaches ${assignmentCount} course${assignmentCount === 1 ? "" : "s"}. Deleting drops them as a co-teacher; if they are the only teacher on any course, the deletion is blocked — reassign that course first.`
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
