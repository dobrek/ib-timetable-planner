import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import type { CohortOption } from "@/shared/api";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { createStudent, updateStudent } from "../api/student-client";
import { studentInput, type StudentFormValues, type StudentInput } from "../model/schemas";
import type { StudentRow } from "../model/student";

type Props = {
  open: boolean;
  onClose: () => void;
  /** The row to edit, or null to create. */
  student: StudentRow | null;
  cohorts: CohortOption[];
  /** Cohort prefilled in create mode (the active tab). */
  defaultCohortId: string;
};

/**
 * Create/edit a student. The shared `studentInput` schema drives both client validation
 * (RHF `zodResolver`, `mode: "onTouched"`) and the server action gate. (The choices editor
 * joins this dialog in Phase 2.)
 */
export default function StudentFormDialog({ open, onClose, student, cohorts, defaultCohortId }: Props) {
  const { form, onSubmit } = useStudentForm(open, student, defaultCohortId, onClose);

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

function useStudentForm(open: boolean, student: StudentRow | null, defaultCohortId: string, onClose: () => void) {
  const form = useForm<StudentFormValues, unknown, StudentInput>({
    resolver: zodResolver(studentInput),
    mode: "onTouched",
    defaultValues: emptyStudentFormValues(defaultCohortId),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(student ? studentFormValues(student) : emptyStudentFormValues(defaultCohortId));
  }, [open, student, defaultCohortId, form]);

  const onSubmit = (values: StudentInput) =>
    submitForm({
      call: () => (student ? updateStudent({ ...values, id: student.id }) : createStudent(values)),
      setError: form.setError,
      successMessage: student ? "Student updated" : "Student created",
      onClose,
    });

  return { form, onSubmit };
}

const studentFormValues = (student: StudentRow): StudentFormValues => ({
  fullName: student.fullName,
  cohortId: student.cohortId,
});

const emptyStudentFormValues = (cohortId: string): StudentFormValues => ({
  fullName: "",
  cohortId,
});
