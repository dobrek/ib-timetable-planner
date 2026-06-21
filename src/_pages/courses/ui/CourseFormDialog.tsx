import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, type DefaultValues } from "react-hook-form";
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
  NumberField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { COHORTS, type Cohort } from "@/shared/config";
import { createCourse, updateCourse } from "../api/course-client";
import { GROUP_OPTIONS } from "../lib/labels";
import type { CourseRow, TeacherOption } from "../model/course";
import { courseInput, toGroupIndex, type CourseFormValues, type CourseInput } from "../model/schemas";

type Props = {
  open: boolean;
  onClose: () => void;
  planId: string;
  teachers: TeacherOption[];
  /** The row to edit, or null to create. */
  course: CourseRow | null;
  /** Cohort prefilled in create mode (the active tab). */
  defaultCohort: Cohort;
};

/**
 * Create/edit an atomic course. The shared `courseInput` schema drives both client
 * validation (RHF `zodResolver`, `mode: "onTouched"`) and the server action gate, so
 * field errors surface inline first and server `isInputError` mapping backs them up.
 */
export default function CourseFormDialog({ open, onClose, planId, teachers, course, defaultCohort }: Props) {
  const { form, onSubmit } = useCourseForm(open, planId, course, defaultCohort, onClose);
  const noTeachers = teachers.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{course ? "Edit course" : "New course"}</DialogTitle>
          <DialogDescription>
            {course ? "Update this course's details." : "Add a course to the catalog."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate autoComplete="off">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Mathematics" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="level"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Level</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional — e.g. SL, HL, AB+SL" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="groupIndex"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group</FormLabel>
                    <Select
                      value={String(field.value)}
                      onValueChange={(value) => {
                        field.onChange(Number(value));
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {GROUP_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={String(option.value)}>
                            {option.label}
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
                name="cohort"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cohort</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
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
            </div>

            <FormField
              control={form.control}
              name="teacherIds"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Teachers</FormLabel>
                  <MultiSelect
                    modal
                    items={teachers}
                    selectedIds={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    trigger={field.value.length > 0 ? `${field.value.length} selected` : "Select teachers…"}
                    triggerClassName="w-full justify-between font-normal"
                    searchPlaceholder="Search teachers…"
                    emptyText="No teachers found."
                  />
                  {noTeachers && (
                    <p className="text-muted-foreground text-sm">
                      No teachers exist yet — add a teacher (S-03) before creating a course.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting || noTeachers}>
                {course ? "Save changes" : "Create course"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function useCourseForm(
  open: boolean,
  planId: string,
  course: CourseRow | null,
  defaultCohort: Cohort,
  onClose: () => void,
) {
  const form = useForm<CourseFormValues, unknown, CourseInput>({
    resolver: zodResolver(courseInput),
    mode: "onTouched",
    defaultValues: emptyCourseFormValues(planId, defaultCohort),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(course ? courseFormValues(planId, course) : emptyCourseFormValues(planId, defaultCohort));
  }, [open, planId, course, defaultCohort, form]);

  const onSubmit = (values: CourseInput) =>
    submitForm({
      call: () => (course ? updateCourse({ ...values, id: course.id }) : createCourse(values)),
      setError: form.setError,
      conflictField: "name",
      successMessage: course ? "Course updated" : "Course created",
      onClose,
    });

  return { form, onSubmit };
}

const courseFormValues = (planId: string, course: CourseRow): DefaultValues<CourseFormValues> => ({
  planId,
  name: course.name,
  level: course.level,
  groupIndex: toGroupIndex(course.groupIndex),
  hoursPerWeek: course.hours,
  teacherIds: course.teacherIds,
  cohort: course.cohort,
});

const emptyCourseFormValues = (planId: string, cohort: Cohort): DefaultValues<CourseFormValues> => ({
  planId,
  name: "",
  level: "",
  groupIndex: 0,
  hoursPerWeek: undefined,
  teacherIds: [],
  cohort,
});
