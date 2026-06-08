import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { actions, isInputError } from "astro:actions";
import { navigate } from "astro:transitions/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { courseInput, type CourseInput } from "@/lib/schemas/course";
import type { CohortTab, CourseRow, TeacherOption } from "@/components/courses/types";

type CourseFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cohorts: CohortTab[];
  teachers: TeacherOption[];
  /** The row to edit, or null to create. */
  course: CourseRow | null;
  /** Cohort prefilled in create mode (the active tab). */
  defaultCohortId: string;
};

const GROUP_OPTIONS = [
  { value: 0, label: "None" },
  { value: 1, label: "Group 1" },
  { value: 2, label: "Group 2" },
  { value: 3, label: "Group 3" },
] as const;

/** Empty number field → undefined so the resolver reports "required" rather than NaN. */
const toNumberOrUndefined = (raw: string): number | undefined => (raw === "" ? undefined : Number(raw));

/** Coerce a stored group_index to one of the authorable options (defaults to 0 / none). */
const toGroupIndex = (value: number): 0 | 1 | 2 | 3 => (value === 1 || value === 2 || value === 3 ? value : 0);

/**
 * Create/edit an atomic course. The shared `courseInput` schema drives both client
 * validation (RHF `zodResolver`, `mode: "onTouched"`) and the server action gate, so
 * field errors surface inline first and server `isInputError` mapping backs them up.
 * Tokens only (lessons rule #2).
 */
export default function CourseFormDialog({
  open,
  onOpenChange,
  cohorts,
  teachers,
  course,
  defaultCohortId,
}: CourseFormDialogProps) {
  const form = useForm<CourseInput>({
    resolver: zodResolver(courseInput),
    mode: "onTouched",
    defaultValues: {
      name: "",
      level: "",
      groupIndex: 0,
      hoursPerWeek: undefined,
      cohortId: defaultCohortId,
      teacherId: undefined,
    },
  });

  // Re-seed whenever the dialog opens (create defaults, or the row being edited).
  useEffect(() => {
    if (!open) return;
    form.reset(
      course
        ? {
            name: course.name,
            level: course.level,
            groupIndex: toGroupIndex(course.groupIndex),
            hoursPerWeek: course.hours,
            cohortId: course.cohortId,
            teacherId: course.teacherId ?? undefined,
          }
        : {
            name: "",
            level: "",
            groupIndex: 0,
            hoursPerWeek: undefined,
            cohortId: defaultCohortId,
            teacherId: undefined,
          },
    );
  }, [open, course, defaultCohortId, form]);

  const noTeachers = teachers.length === 0;

  const onSubmit = async (values: CourseInput) => {
    const { error } = course
      ? await actions.updateCourse({ ...values, id: course.id })
      : await actions.createCourse(values);

    if (error) {
      if (isInputError(error)) {
        for (const [field, messages] of Object.entries(error.fields)) {
          if (messages.length > 0) {
            form.setError(field as keyof CourseInput, { message: messages[0] });
          }
        }
      } else if (error.code === "CONFLICT") {
        form.setError("name", { message: error.message });
      } else {
        toast.error(error.message);
      }
      return;
    }

    toast.success(course ? "Course updated" : "Course created");
    onOpenChange(false);
    await navigate(window.location.pathname + window.location.search);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                      <Input
                        type="number"
                        min={0}
                        autoComplete="off"
                        // field.value is typed number but is undefined/NaN before entry — keep the
                        // input controlled with "" in those cases (a plain ?? would be type-pruned).
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
                name="cohortId"
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
                        {cohorts.map((cohort) => (
                          <SelectItem key={cohort.id} value={cohort.id}>
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
              name="teacherId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Teacher</FormLabel>
                  <Select value={field.value || undefined} onValueChange={field.onChange} disabled={noTeachers}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a teacher" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {teachers.map((teacher) => (
                        <SelectItem key={teacher.id} value={teacher.id}>
                          {teacher.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
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
