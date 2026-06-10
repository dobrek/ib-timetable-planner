import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
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
} from "@/shared/ui";
import { createTeacher, updateTeacher } from "../api/teacher-client";
import { teacherInput, type TeacherFormValues, type TeacherInput } from "../model/schemas";
import type { TeacherRow } from "../model/teacher";

type Props = {
  open: boolean;
  onClose: () => void;
  /** The row to edit, or null to create. */
  teacher: TeacherRow | null;
};

/**
 * Create/edit a teacher. The shared `teacherInput` schema drives both client validation
 * (RHF `zodResolver`, `mode: "onTouched"`) and the server action gate.
 */
export default function TeacherFormDialog({ open, teacher, onClose }: Props) {
  const { form, onSubmit } = useTeacherForm(open, teacher, onClose);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{teacher ? "Edit teacher" : "New teacher"}</DialogTitle>
          <DialogDescription>
            {teacher ? "Update this teacher's details." : "Add a teacher to the catalog."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate autoComplete="off">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. AP" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Alice Parker" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {teacher ? "Save changes" : "Create teacher"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function useTeacherForm(open: boolean, teacher: TeacherRow | null, onClose: () => void) {
  const form = useForm<TeacherFormValues, unknown, TeacherInput>({
    resolver: zodResolver(teacherInput),
    mode: "onTouched",
    defaultValues: emptyTeacherFormValues(),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(teacher ? teacherFormValues(teacher) : emptyTeacherFormValues());
  }, [open, teacher, form]);

  const onSubmit = (values: TeacherInput) =>
    submitForm({
      call: () => (teacher ? updateTeacher({ ...values, id: teacher.id }) : createTeacher(values)),
      setError: form.setError,
      conflictField: "code",
      successMessage: teacher ? "Teacher updated" : "Teacher created",
      onClose,
    });

  return { form, onSubmit };
}

const teacherFormValues = (teacher: TeacherRow): TeacherFormValues => ({
  code: teacher.code,
  fullName: teacher.fullName ?? "",
});

const emptyTeacherFormValues = (): TeacherFormValues => ({
  code: "",
  fullName: "",
});
