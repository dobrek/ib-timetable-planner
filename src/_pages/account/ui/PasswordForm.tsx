import { zodResolver } from "@hookform/resolvers/zod";
import { navigate } from "astro:transitions/client";
import { useForm } from "react-hook-form";
import { submitForm } from "@/shared/lib/forms";
import {
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  PasswordInput,
} from "@/shared/ui";
import { updatePassword } from "../api/account-client";
import { passwordFormSchema, type PasswordFormOutput, type PasswordFormValues } from "../model/schemas";

type Props = {
  /** Fills the hidden username field, so a password manager files the new password under it. */
  email: string;
};

/**
 * Change the caller's password, typed twice; no current password is asked (PRD FR-411). A change
 * reloads into `/account?saved=password` and the page reports it above the forms, as a name save
 * does: a toast is easy to miss on a wide screen, and the reload also drops the reset-link banner.
 */
export default function PasswordForm({ email }: Props) {
  const { form, onSubmit } = usePasswordForm();

  return (
    <section className="border-border bg-card text-card-foreground rounded-lg border p-5">
      <Form {...form}>
        <form
          aria-labelledby="change-password-heading"
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <h2 id="change-password-heading" className="text-lg font-semibold">
            Change password
          </h2>
          <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <PasswordInput toggleLabel="new password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormDescription>At least 15 characters. Your other devices will be signed out.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm new password</FormLabel>
                <FormControl>
                  <PasswordInput toggleLabel="confirmation" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Change password
          </Button>
        </form>
      </Form>
    </section>
  );
}

function usePasswordForm() {
  const form = useForm<PasswordFormValues, unknown, PasswordFormOutput>({
    resolver: zodResolver(passwordFormSchema),
    mode: "onTouched",
    defaultValues: { password: "", confirm: "" },
  });

  const onSubmit = (values: PasswordFormOutput) =>
    submitForm({
      call: () => updatePassword({ password: values.password }),
      setError: form.setError,
      conflictField: "password",
      conflictCodes: ["UNPROCESSABLE_CONTENT", "BAD_REQUEST", "TOO_MANY_REQUESTS"],
      successMessage: "Password changed",
      onClose: () => {
        // Clear both fields before the reload: navigate() returns once it sets the URL, and a
        // back-forward cache restore would otherwise bring the new password back.
        form.reset();
      },
      refresh: () => navigate("/account?saved=password"),
    });

  return { form, onSubmit };
}
