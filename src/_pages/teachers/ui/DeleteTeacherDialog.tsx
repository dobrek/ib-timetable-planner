import { useState } from "react";
import { deleteTeacher } from "@/_pages/teachers/api/teacher-client";
import { navigate } from "astro:transitions/client";
import { toast } from "sonner";
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
import type { TeacherRow } from "@/_pages/teachers/model/teacher";

type Props = {
  /** The teacher pending deletion, or null when closed. */
  teacher: TeacherRow | null;
  onClose: () => void;
};

/**
 * Confirms a destructive delete and names the assignment cascade impact.
 */
export default function DeleteTeacherDialog({ teacher, onClose }: Props) {
  const { confirm, isDeleting } = useDeleteTeacher(teacher?.id, onClose);
  const assignmentCount = teacher?.assignments.length ?? 0;

  return (
    <AlertDialog
      open={teacher !== null}
      onOpenChange={() => {
        onClose();
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
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
            disabled={isDeleting}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function useDeleteTeacher(teacherId: string | undefined, closeDialog: () => void) {
  const [isDeleting, setIsDeleting] = useState(false);

  const confirm = async () => {
    if (!teacherId) return;
    setIsDeleting(true);
    const { error } = await deleteTeacher({ id: teacherId });
    setIsDeleting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Teacher deleted");
    closeDialog();
    await navigate(window.location.pathname + window.location.search);
  };

  return { confirm, isDeleting };
}
