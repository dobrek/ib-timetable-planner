import { createTeacher, updateTeacher } from "@/_pages/teachers/api/teacher-client";
import type { TeacherRow } from "@/_pages/teachers/model/teacher";
import { teacherInput, type TeacherInput } from "@/_pages/teachers/model/schemas";
import { applyActionFieldErrors } from "@/shared/lib/apply-action-errors";
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
import { zodResolver } from "@hookform/resolvers/zod";
import { isInputError } from "astro:actions";
import { navigate } from "astro:transitions/client";
import { useEffect } from "react";
import { useForm, type DefaultValues } from "react-hook-form";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row to edit, or null to create. */
  teacher: TeacherRow | null;
};

/**
 * Create/edit a teacher. The shared `teacherInput` schema drives both client validation
 * (RHF `zodResolver`, `mode: "onTouched"`) and the server action gate.
 */
export default function TeacherFormDialog({ open, onOpenChange, teacher }: Props) {
  const { form, onSubmit } = useTeacherForm(open, teacher, onOpenChange);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                    <Input placeholder="e.g. Alice Parker" autoComplete="off" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit">{teacher ? "Save changes" : "Create teacher"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function useTeacherForm(open: boolean, teacher: TeacherRow | null, onOpenChange: (open: boolean) => void) {
  const form = useForm<TeacherInput>({
    resolver: zodResolver(teacherInput),
    mode: "onTouched",
    defaultValues: emptyTeacherInputValues(),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(teacher ? teacherInputValues(teacher) : emptyTeacherInputValues());
  }, [open, teacher, form]);

  const onSubmit = async (values: TeacherInput) => {
    const { error } = teacher ? await updateTeacher({ ...values, id: teacher.id }) : await createTeacher(values);

    if (error) {
      if (isInputError(error)) {
        applyActionFieldErrors(error, form.setError);
      } else if (error.code === "CONFLICT") {
        form.setError("code", { message: error.message });
      } else {
        toast.error(error.message);
      }
      return;
    }

    toast.success(teacher ? "Teacher updated" : "Teacher created");
    onOpenChange(false);
    await navigate(window.location.pathname + window.location.search);
  };

  return { form, onSubmit };
}

const teacherInputValues = (teacher: TeacherRow): DefaultValues<TeacherInput> => ({
  code: teacher.code,
  fullName: teacher.fullName ?? undefined,
});

const emptyTeacherInputValues = (): DefaultValues<TeacherInput> => ({
  code: "",
  fullName: undefined,
});
