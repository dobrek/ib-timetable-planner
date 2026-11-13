import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, type UseFormSetError } from "react-hook-form";
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
import {
  changeUserEmailFormSchema,
  type ChangeUserEmailFormOutput,
  type ChangeUserEmailFormValues,
} from "../model/schemas";
import { emailOf, type UserRow } from "../model/user-rows";

type Props = {
  target: UserRow | null;
  isBusy: boolean;
  onSubmit: (email: string, setError: UseFormSetError<ChangeUserEmailFormValues>) => Promise<void>;
  onClose: () => void;
};

const EMPTY_VALUES: ChangeUserEmailFormValues = { email: "", confirmEmail: "" };

/**
 * A new address, typed twice (S-411). The current address is named, so it is clear what is replaced.
 * A mismatch never submits. `mode: "onTouched"` matches the other account forms.
 */
export default function ChangeEmailDialog({ target, isBusy, onSubmit, onClose }: Props) {
  const current = target ? emailOf(target.label) : "";
  const form = useForm<ChangeUserEmailFormValues, unknown, ChangeUserEmailFormOutput>({
    resolver: zodResolver(changeUserEmailFormSchema),
    mode: "onTouched",
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (target) form.reset(EMPTY_VALUES);
  }, [target, form]);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !form.formState.isSubmitting) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change email for {current}</DialogTitle>
          <DialogDescription>This replaces {current}. The new address is used at once.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => onSubmit(values.email, form.setError))}
            className="space-y-4"
            noValidate
            autoComplete="off"
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={isBusy || form.formState.isSubmitting}>
                Change email
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
