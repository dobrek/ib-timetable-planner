import { useState } from "react";
import { actions } from "astro:actions";
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
import type { CourseRow } from "@/_pages/courses/model/course";

type DeleteCourseDialogProps = {
  /** The course pending deletion, or null when closed. */
  course: CourseRow | null;
  onOpenChange: (open: boolean) => void;
};

/**
 * Confirms a destructive delete and names the FK cascade so the consequence is explicit.
 * Deleting a course removes everything that references it.
 */
export default function DeleteCourseDialog({ course, onOpenChange }: DeleteCourseDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (!course) return;
    setIsDeleting(true);
    const { error } = await actions.deleteCourse({ id: course.id });
    setIsDeleting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Course deleted");
    onOpenChange(false);
    await navigate(window.location.pathname + window.location.search);
  };

  return (
    <AlertDialog open={course !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {course?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the course and everything that references it — its placements, student choices,
            course overlaps, and grouping memberships. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
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
