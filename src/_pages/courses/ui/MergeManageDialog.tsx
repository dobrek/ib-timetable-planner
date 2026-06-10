import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { submitForm, useConfirmAction } from "@/shared/lib/forms";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  NumberField,
} from "@/shared/ui";
import { dissolveMerge, updateMergeHours } from "../api/course-client";
import { formatCourseLabel } from "../lib/labels";
import type { CourseRow } from "../model/course";
import { updateMergeHoursInput, type UpdateMergeHoursInput } from "../model/schemas";

type Props = {
  /** The composite merge parent being managed, or null when closed. */
  course: CourseRow | null;
  coursesById: Map<string, CourseRow>;
  onClose: () => void;
};

/**
 * Manage an existing composite merge parent: list its (read-only) children, edit the
 * authored weekly hours, or dissolve the merge. Dissolve uses the `alert-dialog` confirm
 * pattern naming the consequence (parent + links removed, atomic children kept).
 */
export default function MergeManageDialog({ course, coursesById, onClose }: Props) {
  return (
    <Dialog
      open={course !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        {course && <ManageBody key={course.id} course={course} coursesById={coursesById} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

type ManageBodyProps = {
  course: CourseRow;
  coursesById: Map<string, CourseRow>;
  onClose: () => void;
};

function ManageBody({ course, coursesById, onClose }: ManageBodyProps) {
  const { form, onSubmit } = useMergeHoursForm(course, onClose);
  const { confirm: dissolve, isBusy: isDissolving } = useConfirmAction(
    () => dissolveMerge({ parentCourseId: course.id }),
    { successMessage: "Merge deleted", onDone: onClose },
  );
  const children = course.mergeChildIds.map((id) => coursesById.get(id)).filter((c): c is CourseRow => c !== undefined);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Manage merge — {formatCourseLabel(course)}</DialogTitle>
        <DialogDescription>
          Edit the composite&apos;s weekly hours, or delete the merge — its courses stay in the catalog.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <span className="text-sm font-medium">Merged courses</span>
        {children.length === 0 ? (
          <p className="text-muted-foreground text-sm">No child courses found.</p>
        ) : (
          <ul className="space-y-2">
            {children.map((child) => (
              <li key={child.id} className="border-border rounded-md border px-3 py-2 text-sm">
                {formatCourseLabel(child)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate autoComplete="off">
          <FormField
            control={form.control}
            name="hoursPerWeek"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Weekly hours</FormLabel>
                <FormControl>
                  <NumberField min={0} autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <DialogFooter className="sm:justify-between">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={isDissolving}>
                  Delete merge
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {formatCourseLabel(course)}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the composite parent and its merge links. The {children.length} atomic course
                    {children.length === 1 ? "" : "s"} stay in the catalog untouched. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDissolving}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      event.preventDefault();
                      void dissolve();
                    }}
                    disabled={isDissolving}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button type="submit" disabled={form.formState.isSubmitting}>
              Save hours
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  );
}

function useMergeHoursForm(course: CourseRow, onClose: () => void) {
  const form = useForm<UpdateMergeHoursInput>({
    resolver: zodResolver(updateMergeHoursInput),
    mode: "onTouched",
    defaultValues: { parentCourseId: course.id, hoursPerWeek: course.hours },
  });

  const onSubmit = (values: UpdateMergeHoursInput) =>
    submitForm({
      call: () => updateMergeHours(values),
      setError: form.setError,
      successMessage: "Merge hours updated",
      onClose,
    });

  return { form, onSubmit };
}
