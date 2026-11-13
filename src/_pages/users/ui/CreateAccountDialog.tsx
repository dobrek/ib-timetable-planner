import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
} from "@/shared/ui";
import {
  createAccountFormSchema,
  type CreateAccountFormOutput,
  type CreateAccountFormValues,
  type PasswordReveal,
} from "../model/schemas";
import { submitCreateAccount } from "../model/submit-create-account";
import RoleSelect from "./RoleSelect";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called with the one-time password once the account exists; the dialog's job ends there. */
  onCreated: (reveal: PasswordReveal) => void;
};

// The least privilege: an admin chooses to give more.
const EMPTY_VALUES: CreateAccountFormValues = { email: "", confirmEmail: "", role: "viewer" };

/**
 * Create an account with a temporary password (S-409, FR-403). The address is typed twice so a typo
 * is caught before the account exists. The shared
 * `createAccountFormSchema` drives validation (`mode: "onTouched"`); the action runs the same
 * `createAccountInput` on the server.
 */
export default function CreateAccountDialog({ open, onClose, onCreated }: Props) {
  const { form, onSubmit } = useCreateAccountForm(open, onCreated);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !form.formState.isSubmitting) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create account</DialogTitle>
          <DialogDescription>
            For someone who cannot use an email invitation. You will be shown a temporary password once; give it to them
            yourself. They choose their own when they first sign in.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate autoComplete="off">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
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
                  <FormDescription>Type it again, so a typo is caught before the account is created.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <div className="space-y-2">
                  <Label>Role</Label>
                  <RoleSelect
                    name="the new account"
                    role={field.value}
                    disabled={form.formState.isSubmitting}
                    onChange={field.onChange}
                  />
                  <p className="text-muted-foreground text-sm">
                    Takes effect once they have chosen their own password.
                  </p>
                </div>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Create account
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function useCreateAccountForm(open: boolean, onCreated: (reveal: PasswordReveal) => void) {
  const form = useForm<CreateAccountFormValues, unknown, CreateAccountFormOutput>({
    resolver: zodResolver(createAccountFormSchema),
    mode: "onTouched",
    defaultValues: EMPTY_VALUES,
  });

  // A fresh form each time the dialog opens: a typed address never outlives the dialog.
  useEffect(() => {
    if (open) form.reset(EMPTY_VALUES);
  }, [open, form]);

  const onSubmit = (values: CreateAccountFormOutput) =>
    submitCreateAccount({ values, setError: form.setError, onCreated });

  return { form, onSubmit };
}
