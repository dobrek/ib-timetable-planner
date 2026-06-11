import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { COHORTS, type Cohort } from "@/shared/config";
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
  Input,
  MultiSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { createStudent, updateStudent } from "../api/student-client";
import { studentInput, type StudentFormValues, type StudentInput } from "../model/schemas";
import type { CourseOption, StudentRow } from "../model/student";

type Props = {
  open: boolean;
  onClose: () => void;
  planId: string;
  /** The row to edit, or null to create. */
  student: StudentRow | null;
  /** Real courses (merge parents flagged) — the choice picker is scoped per cohort. */
  courses: CourseOption[];
  /** Cohort prefilled in create mode (the active tab). */
  defaultCohort: Cohort;
};

/**
 * Create/edit a student and its full course-choice set in one submit. The shared `studentInput`
 * schema drives both client validation (RHF `zodResolver`, `mode: "onTouched"`) and the server
 * action gate; the choices picker is scoped to the selected cohort and clears when the cohort
 * changes (handler-scoped so `form.reset` on open can never misfire it).
 */
export default function StudentFormDialog({ open, onClose, planId, student, courses, defaultCohort }: Props) {
  const { form, onSubmit } = useStudentForm(open, planId, student, defaultCohort, courses, onClose);

  const watchedCohort = useWatch({ control: form.control, name: "cohort" });
  const choiceItems = useMemo(
    () =>
      courses
        .filter((course) => course.cohort === watchedCohort && !course.isMergeParent)
        .map((course) => ({ id: course.id, label: course.label })),
    [courses, watchedCohort],
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
          <DialogTitle>{student ? "Edit student" : "New student"}</DialogTitle>
          <DialogDescription>
            {student ? "Update this student's details." : "Add a student to the catalog."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate autoComplete="off">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Alice Parker" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="cohort"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cohort</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(next) => {
                      // Clear choices on an actual cohort change only — handler-scoped so the
                      // reset can't misfire during form.reset on open/edit-prefill.
                      if (next !== field.value) form.setValue("choiceCourseIds", [], { shouldDirty: true });
                      field.onChange(next);
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a cohort" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {COHORTS.map((cohort) => (
                        <SelectItem key={cohort.value} value={cohort.value}>
                          {cohort.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="choiceCourseIds"
              render={({ field }) => {
                const selectedIds = field.value ?? [];
                return (
                  <FormItem className="flex flex-col">
                    <FormLabel>Course choices</FormLabel>
                    <MultiSelect
                      modal
                      items={choiceItems}
                      selectedIds={selectedIds}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      trigger={selectedIds.length > 0 ? `${selectedIds.length} selected` : "Select courses…"}
                      triggerClassName="justify-between font-normal"
                      searchPlaceholder="Search courses…"
                      emptyText="No courses found."
                    />
                    <p className="text-muted-foreground text-xs">Choices are limited to the selected cohort.</p>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {student ? "Save changes" : "Create student"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function useStudentForm(
  open: boolean,
  planId: string,
  student: StudentRow | null,
  defaultCohort: Cohort,
  courses: CourseOption[],
  onClose: () => void,
) {
  const form = useForm<StudentFormValues, unknown, StudentInput>({
    resolver: zodResolver(studentInput),
    mode: "onTouched",
    defaultValues: emptyStudentFormValues(planId, defaultCohort),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(student ? studentFormValues(planId, student, courses) : emptyStudentFormValues(planId, defaultCohort));
  }, [open, planId, student, defaultCohort, courses, form]);

  const onSubmit = (values: StudentInput) =>
    submitForm({
      call: () => (student ? updateStudent({ ...values, id: student.id }) : createStudent(values)),
      setError: form.setError,
      successMessage: student ? "Student updated" : "Student created",
      onClose,
    });

  return { form, onSubmit };
}

const studentFormValues = (planId: string, student: StudentRow, courses: CourseOption[]): StudentFormValues => {
  // Prune choice ids the picker can't render (course became a merge parent or moved cohort) —
  // they'd be counted in the trigger but show no removable chip.
  const renderable = new Set(
    courses.filter((course) => course.cohort === student.cohort && !course.isMergeParent).map((course) => course.id),
  );
  return {
    planId,
    fullName: student.fullName,
    cohort: student.cohort,
    choiceCourseIds: student.choiceCourseIds.filter((id) => renderable.has(id)),
  };
};

const emptyStudentFormValues = (planId: string, cohort: Cohort): StudentFormValues => ({
  planId,
  fullName: "",
  cohort,
  choiceCourseIds: [],
});
