import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import { submitChangeEmail } from "../model/submit-change-email";
import { emailOf, type UserRow } from "../model/user-rows";

type Props = {
  /** The account whose address changes, or null when closed. */
  target: UserRow | null;
  onClose: () => void;
};

const EMPTY_VALUES: ChangeUserEmailFormValues = { email: "", confirmEmail: "" };

/**
 * A new address, typed twice (S-411). The current address is named, so it is clear what is replaced.
 * The shared `changeUserEmailFormSchema` drives validation (`mode: "onTouched"`), so a mismatch never
 * submits; the action runs `changeUserEmailInput` on the server.
 */
export default function ChangeEmailDialog({ target, onClose }: Props) {
  const { form, onSubmit } = useChangeEmailForm(target, onClose);
  const current = target ? emailOf(target.label) : "";
  const replacement = useWatch({ control: form.control, name: "email" }).trim();

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
          <DialogDescription>
            {replacement ? `${replacement} replaces ${current}.` : `The new address replaces ${current}.`} It is used at
            once.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate autoComplete="off">
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
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Change email
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function useChangeEmailForm(target: UserRow | null, onDone: () => void) {
  const form = useForm<ChangeUserEmailFormValues, unknown, ChangeUserEmailFormOutput>({
    resolver: zodResolver(changeUserEmailFormSchema),
    mode: "onTouched",
    defaultValues: EMPTY_VALUES,
  });

  // A fresh form each time the dialog opens: a typed address never outlives the dialog.
  useEffect(() => {
    if (target) form.reset(EMPTY_VALUES);
  }, [target, form]);

  const onSubmit = async (values: ChangeUserEmailFormOutput): Promise<void> => {
    if (target) await submitChangeEmail({ row: target, values, setError: form.setError, onDone });
  };

  return { form, onSubmit };
}
