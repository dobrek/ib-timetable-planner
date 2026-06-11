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
import { deleteCourse } from "../api/course-client";
import type { CourseRow } from "../model/course";

type Props = {
  planId: string;
  /** The course pending deletion, or null when closed. */
  course: CourseRow | null;
  onClose: () => void;
};

/**
 * Confirms a destructive delete and names the FK cascade so the consequence is explicit.
 * Deleting a course removes everything that references it.
 */
export default function DeleteCourseDialog({ planId, course, onClose }: Props) {
  const { confirm, isBusy } = useConfirmAction(() => deleteCourse({ planId, id: course?.id ?? "" }), {
    successMessage: "Course deleted",
    onDone: onClose,
  });

  return (
    <AlertDialog
      open={course !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {course?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the course and everything that references it — its placements, student choices,
            course overlaps, and grouping memberships. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              if (course) void confirm();
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
