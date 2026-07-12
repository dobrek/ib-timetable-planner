import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { Cohort } from "@/shared/config";
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
} from "@/shared/ui";
import { bulkEditChoices } from "../api/student-client";
import { bulkChoiceInput, type BulkChoiceFormValues, type BulkChoiceInput } from "../model/schemas";
import type { CourseOption, StudentRow } from "../model/student";
import { summarizeBulkChoices } from "../model/summarize-bulk-choices";

type Props = {
  open: boolean;
  onClose: () => void;
  planId: string;
  cohort: Cohort;
  /** The selected students (resolved from the selection against the active cohort's rows). */
  students: StudentRow[];
  /** The active cohort's real (non-merge-parent) courses — both pickers offer the full list. */
  courses: CourseOption[];
};

/**
 * Bulk add/remove course choices for the selected students, in two steps: pick courses
 * (either picker alone is valid), then review the computed effect before applying. The
 * shared `bulkChoiceInput` schema drives both client validation and the server gate; on
 * apply, `submitForm` runs the atomic action and refreshes via a full navigation (which
 * remounts the island and clears the selection). The success toast is only a pre-navigation
 * flash, so the drift hint lives in the confirmation step, not the toast.
 */
export default function BulkChoiceDialog({ open, onClose, planId, cohort, students, courses }: Props) {
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [wasOpen, setWasOpen] = useState(open);
  const { form, onSubmit } = useBulkChoiceForm(open, planId, cohort, students, onClose);

  // Reset to the picker step each time the dialog opens — adjusted during render (no effect).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setStep("edit");
  }

  const courseItems = useMemo(() => courses.map((course) => ({ id: course.id, label: course.label })), [courses]);
  const labelById = useMemo(() => new Map(courses.map((course) => [course.id, course.label])), [courses]);

  const watchedAdd = useWatch({ control: form.control, name: "addCourseIds" });
  const watchedRemove = useWatch({ control: form.control, name: "removeCourseIds" });
  const summary = useMemo(
    () => summarizeBulkChoices(students, watchedAdd ?? [], watchedRemove ?? []),
    [students, watchedAdd, watchedRemove],
  );

  const goToConfirm = async () => {
    if (await form.trigger()) setStep("confirm");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit choices for {students.length} students</DialogTitle>
          <DialogDescription>
            {step === "edit"
              ? "Add courses to every selected student and/or ensure a course is absent."
              : "Review the effect before applying — this cannot be undone."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate autoComplete="off">
            <div className={step === "edit" ? "space-y-4" : "hidden"}>
              <FormField
                control={form.control}
                name="addCourseIds"
                render={({ field }) => (
                  <BulkCoursePicker
                    label="Add courses"
                    field={field}
                    items={courseItems}
                    placeholder="Select courses to add…"
                  />
                )}
              />
              <FormField
                control={form.control}
                name="removeCourseIds"
                render={({ field }) => (
                  <BulkCoursePicker
                    label="Remove courses"
                    field={field}
                    items={courseItems}
                    placeholder="Select courses to remove…"
                  />
                )}
              />
              <p className="text-muted-foreground text-xs">
                Both lists are limited to the active cohort&apos;s courses.
              </p>
            </div>

            {step === "confirm" && <ConfirmationSummary summary={summary} labelById={labelById} />}

            <DialogFooter>
              {/* Distinct keys per step: without them React reuses the second button's DOM node
                  across the edit→confirm swap, mutating the clicked type="button" "Review…" into a
                  type="submit" "Apply changes" in place — and because goToConfirm is async, the type
                  flips before the click's default action resolves, firing a phantom submit that
                  applies the edit and skips confirmation. Distinct keys force fresh nodes instead. */}
              {step === "edit" ? (
                <>
                  <Button key="cancel" type="button" variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button key="review" type="button" onClick={goToConfirm}>
                    Review…
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    key="back"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setStep("edit");
                    }}
                  >
                    Back
                  </Button>
                  <Button key="apply" type="submit" disabled={form.formState.isSubmitting}>
                    Apply changes
                  </Button>
                </>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function BulkCoursePicker({
  label,
  field,
  items,
  placeholder,
}: {
  label: string;
  field: {
    value?: string[];
    onChange: (ids: string[]) => void;
    onBlur: () => void;
  };
  items: { id: string; label: string }[];
  placeholder: string;
}) {
  const selectedIds = field.value ?? [];
  return (
    <FormItem className="flex flex-col">
      <FormLabel>{label}</FormLabel>
      <FormControl>
        <MultiSelect
          modal
          items={items}
          selectedIds={selectedIds}
          onChange={field.onChange}
          onBlur={field.onBlur}
          trigger={selectedIds.length > 0 ? `${selectedIds.length} selected` : placeholder}
          triggerClassName="justify-between font-normal"
          searchPlaceholder="Search courses…"
          emptyText="No courses found."
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}

function ConfirmationSummary({
  summary,
  labelById,
}: {
  summary: ReturnType<typeof summarizeBulkChoices>;
  labelById: Map<string, string>;
}) {
  const label = (id: string) => labelById.get(id) ?? "Unknown course";
  return (
    <div className="space-y-3">
      <ul className="space-y-1 text-sm">
        {summary.adds.map((add) => (
          <li key={`add-${add.courseId}`}>
            <span className="font-medium">Add {label(add.courseId)}</span> — {add.gains} of {summary.studentCount}{" "}
            students will gain it
          </li>
        ))}
        {summary.removes.map((remove) => (
          <li key={`remove-${remove.courseId}`}>
            <span className="font-medium">Remove {label(remove.courseId)}</span> — {remove.losses} of{" "}
            {summary.studentCount} students will lose it
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground border-border border-t pt-3 text-xs">
        Applying may create new conflicts on plan boards — review them afterwards.
      </p>
    </div>
  );
}

function useBulkChoiceForm(open: boolean, planId: string, cohort: Cohort, students: StudentRow[], onClose: () => void) {
  const form = useForm<BulkChoiceFormValues, unknown, BulkChoiceInput>({
    resolver: zodResolver(bulkChoiceInput),
    mode: "onTouched",
    defaultValues: emptyBulkChoiceValues(planId, cohort, students),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(emptyBulkChoiceValues(planId, cohort, students));
  }, [open, planId, cohort, students, form]);

  const onSubmit = (values: BulkChoiceInput) =>
    submitForm({
      call: () => bulkEditChoices(values),
      setError: form.setError,
      successMessage: `Choices updated for ${students.length} students`,
      onClose,
    });

  return { form, onSubmit };
}

const emptyBulkChoiceValues = (planId: string, cohort: Cohort, students: StudentRow[]): BulkChoiceFormValues => ({
  planId,
  cohort,
  studentIds: students.map((student) => student.id),
  addCourseIds: [],
  removeCourseIds: [],
});
