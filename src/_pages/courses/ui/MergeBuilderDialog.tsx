import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { submitForm } from "@/shared/lib/forms";
import {
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
  MultiSelect,
  NumberField,
} from "@/shared/ui";
import type { Cohort } from "@/shared/config";
import { createMerge } from "../api/course-client";
import { formatCourseLabel } from "../lib/labels";
import type { CourseRow, TeacherOption } from "../model/course";
import { deriveMergeParent, mergeReasonMessage } from "../model/merge";
import { mergeInput, type MergeFormValues, type MergeInput } from "../model/schemas";

type Props = {
  open: boolean;
  onClose: () => void;
  planId: string;
  courses: CourseRow[];
  coursesById: Map<string, CourseRow>;
  teachers: TeacherOption[];
  /** The active cohort the merge is scoped to. */
  cohort: Cohort;
};

/**
 * Author a new composite merge for the active cohort. The parent name/level/teacher are
 * derived live and read-only via `deriveMergeParent` — the same pure module the server
 * re-checks — so the preview can never drift from what's stored.
 */
export default function MergeBuilderDialog({ open, onClose, planId, courses, coursesById, teachers, cohort }: Props) {
  const { form, onSubmit, candidates, selectedChildren, derivation, teacherLabelById } = useMergeBuilder(
    open,
    planId,
    courses,
    coursesById,
    teachers,
    cohort,
    onClose,
  );

  const candidateItems = useMemo(
    () => candidates.map((course) => ({ id: course.id, label: formatCourseLabel(course) })),
    [candidates],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New merge</DialogTitle>
          <DialogDescription>
            Combine 2+ courses that share a name and teacher into a composite session.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate autoComplete="off">
            <FormField
              control={form.control}
              name="childCourseIds"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Courses to merge</FormLabel>
                  <MultiSelect
                    modal
                    items={candidateItems}
                    selectedIds={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    trigger={field.value.length > 0 ? `${field.value.length} selected` : "Select courses…"}
                    triggerClassName="justify-between font-normal"
                    searchPlaceholder="Search courses…"
                    emptyText="No courses found."
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="border-border bg-muted/40 rounded-md border p-3 text-sm">
              {selectedChildren.length < 2 ? (
                <p className="text-muted-foreground">Select at least 2 courses to preview the composite.</p>
              ) : derivation.ok ? (
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Composite preview</p>
                  <p className="text-foreground font-medium">
                    {derivation.parent.name} <span className="text-muted-foreground">({derivation.parent.level})</span>
                  </p>
                  <p className="text-muted-foreground">
                    {derivation.parent.teacherIds.length === 1 ? "Teacher" : "Teachers"}:{" "}
                    {derivation.parent.teacherIds.map((id) => teacherLabelById.get(id) ?? id).join(", ")}
                  </p>
                </div>
              ) : (
                <p className="text-destructive">{mergeReasonMessage(derivation.reason)}</p>
              )}
            </div>

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

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!derivation.ok || form.formState.isSubmitting}>
                Create merge
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function useMergeBuilder(
  open: boolean,
  planId: string,
  courses: CourseRow[],
  coursesById: Map<string, CourseRow>,
  teachers: TeacherOption[],
  cohort: Cohort,
  onClose: () => void,
) {
  const form = useForm<MergeFormValues, unknown, MergeInput>({
    resolver: zodResolver(mergeInput),
    mode: "onTouched",
    defaultValues: { planId, childCourseIds: [], hoursPerWeek: undefined, cohort },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({ planId, childCourseIds: [], hoursPerWeek: undefined, cohort });
  }, [open, planId, cohort, form]);

  const candidates = useMemo(
    () => courses.filter((course) => course.cohort === cohort && !course.isMerged),
    [courses, cohort],
  );
  const teacherLabelById = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacher.label])), [teachers]);

  const selectedIds = useWatch({ control: form.control, name: "childCourseIds" });
  const selectedChildren = selectedIds
    .map((id) => coursesById.get(id))
    .filter((course): course is CourseRow => Boolean(course));
  const derivation = deriveMergeParent(
    selectedChildren.map((course) => ({
      id: course.id,
      name: course.name,
      level: course.level,
      cohort: course.cohort,
      teacherIds: course.teacherIds,
    })),
  );

  const onSubmit = (values: MergeInput) =>
    submitForm({
      call: () => createMerge(values),
      setError: form.setError,
      conflictField: "childCourseIds",
      conflictCodes: ["CONFLICT", "BAD_REQUEST"],
      successMessage: "Merge created",
      onClose,
    });

  return { form, onSubmit, candidates, selectedChildren, derivation, teacherLabelById };
}
