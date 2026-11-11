import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { EMAIL_LINK_LIFETIME } from "@/shared/config";
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
  Label,
} from "@/shared/ui";
import { inviteUserInput, type InviteUserFormValues, type InviteUserInput } from "../model/schemas";
import { submitInvite } from "../model/submit-invite";
import RoleSelect from "./RoleSelect";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called once the invitation is on its way: the page closes the dialog and reloads the list. */
  onSent: () => void;
};

// The least privilege: an admin chooses to give more.
const EMPTY_VALUES: InviteUserFormValues = { email: "", role: "viewer" };

/**
 * Invite a colleague by email (S-410, FR-401): the primary way in. The address is typed once, since
 * a mistyped invitation is revoked from the list. The shared `inviteUserInput` drives validation
 * (`mode: "onTouched"`); the action runs the same schema on the server.
 */
export default function InviteDialog({ open, onClose, onSent }: Props) {
  const { form, onSubmit } = useInviteForm(open, onSent);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !form.formState.isSubmitting) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a colleague</DialogTitle>
          <DialogDescription>
            They get an email with a link that works once, for {EMAIL_LINK_LIFETIME}. They choose their own password,
            and the role applies once they have.
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
              name="role"
              render={({ field }) => (
                <div className="space-y-2">
                  <Label>Role</Label>
                  <RoleSelect
                    name="the invitation"
                    role={field.value}
                    disabled={form.formState.isSubmitting}
                    onChange={field.onChange}
                    withNoAccess={false}
                  />
                </div>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function useInviteForm(open: boolean, onSent: () => void) {
  const form = useForm<InviteUserFormValues, unknown, InviteUserInput>({
    resolver: zodResolver(inviteUserInput),
    mode: "onTouched",
    defaultValues: EMPTY_VALUES,
  });

  // A fresh form each time the dialog opens: a typed address never outlives the dialog.
  useEffect(() => {
    if (open) form.reset(EMPTY_VALUES);
  }, [open, form]);

  const onSubmit = (values: InviteUserInput) => submitInvite({ values, setError: form.setError, onSent });

  return { form, onSubmit };
}
