import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { dissolveMerge, updateMergeHours } from "@/_pages/courses/api/course-client";
import { isInputError } from "astro:actions";
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
  AlertDialogTrigger,
} from "@/shared/ui";
import { Button } from "@/shared/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/shared/ui";
import { Input } from "@/shared/ui";
import { toNumberOrUndefined } from "@/_pages/courses/lib/coerce";
import { formatCourseLabel } from "@/_pages/courses/lib/labels";
import { updateMergeHoursInput, type UpdateMergeHoursInput } from "@/_pages/courses/model/schemas";
import type { CourseRow } from "@/_pages/courses/model/course";
import { applyActionFieldErrors } from "@/shared/lib/apply-action-errors";

type MergeManageDialogProps = {
  /** The composite merge parent being managed, or null when closed. */
  course: CourseRow | null;
  coursesById: Map<string, CourseRow>;
  onOpenChange: (open: boolean) => void;
};

/**
 * Manage an existing composite merge parent: list its (read-only) children, edit the
 * authored weekly hours, or dissolve the merge. Dissolve uses the `alert-dialog` confirm
 * pattern naming the consequence (parent + links removed, atomic children kept). Both
 * actions `navigate()` on success. Tokens only (lessons rule #2).
 */
export default function MergeManageDialog({ course, coursesById, onOpenChange }: MergeManageDialogProps) {
  return (
    <Dialog open={course !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {course && <ManageBody key={course.id} course={course} coursesById={coursesById} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  );
}

type ManageBodyProps = {
  course: CourseRow;
  coursesById: Map<string, CourseRow>;
  onOpenChange: (open: boolean) => void;
};

function ManageBody({ course, coursesById, onOpenChange }: ManageBodyProps) {
  const { form, onSubmit } = useMergeHoursForm(course, onOpenChange);
  const { dissolve, isDissolving } = useDissolve(course.id, onOpenChange);
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
                  <Input
                    type="number"
                    min={0}
                    autoComplete="off"
                    value={Number.isFinite(field.value) ? field.value : ""}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                    onChange={(event) => {
                      field.onChange(toNumberOrUndefined(event.target.value));
                    }}
                  />
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

function useMergeHoursForm(course: CourseRow, onOpenChange: (open: boolean) => void) {
  const form = useForm<UpdateMergeHoursInput>({
    resolver: zodResolver(updateMergeHoursInput),
    mode: "onTouched",
    defaultValues: { parentCourseId: course.id, hoursPerWeek: course.hours },
  });

  const onSubmit = async (values: UpdateMergeHoursInput) => {
    const { error } = await updateMergeHours(values);
    if (error) {
      if (isInputError(error)) {
        applyActionFieldErrors(error, form.setError);
      } else {
        toast.error(error.message);
      }
      return;
    }

    toast.success("Merge hours updated");
    onOpenChange(false);
    await navigate(window.location.pathname + window.location.search);
  };

  return { form, onSubmit };
}

function useDissolve(courseId: string, onOpenChange: (open: boolean) => void) {
  const [isDissolving, setIsDissolving] = useState(false);

  const dissolve = async () => {
    setIsDissolving(true);
    const { error } = await dissolveMerge({ parentCourseId: courseId });
    setIsDissolving(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Merge deleted");
    onOpenChange(false);
    await navigate(window.location.pathname + window.location.search);
  };

  return { dissolve, isDissolving };
}
