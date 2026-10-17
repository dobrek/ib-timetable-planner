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
  Input,
} from "@/shared/ui";
import { updateDisplayName } from "../api/account-client";
import { updateDisplayNameInput, type DisplayNameFormValues, type UpdateDisplayNameInput } from "../model/schemas";

type Props = {
  displayName: string | null;
};

/**
 * Set, change or clear the caller's display name. A save reloads into `/account?saved=name`: the
 * server-rendered sidebar needs the reload to show the new name, and the reload would destroy a
 * toast, so the page reports the save itself.
 */
export default function DisplayNameForm({ displayName }: Props) {
  const { form, onSubmit } = useDisplayNameForm(displayName);

  return (
    <section className="border-border bg-card text-card-foreground rounded-lg border p-5">
      <Form {...form}>
        <form
          aria-labelledby="display-name-heading"
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <h2 id="display-name-heading" className="text-lg font-semibold">
            Display name
          </h2>
          <FormField
            control={form.control}
            name="displayName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Display name</FormLabel>
                <FormControl>
                  <Input autoComplete="name" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormDescription>Shown beside your email. Leave empty to show only your email.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Save name
          </Button>
        </form>
      </Form>
    </section>
  );
}

function useDisplayNameForm(displayName: string | null) {
  const form = useForm<DisplayNameFormValues, unknown, UpdateDisplayNameInput>({
    resolver: zodResolver(updateDisplayNameInput),
    mode: "onTouched",
    defaultValues: { displayName: displayName ?? "" },
  });

  const onSubmit = (values: UpdateDisplayNameInput) =>
    submitForm({
      call: () => updateDisplayName(values),
      setError: form.setError,
      conflictField: "displayName",
      conflictCodes: ["UNPROCESSABLE_CONTENT", "BAD_REQUEST"],
      successMessage: "Display name saved",
      onClose: () => {
        // Nothing to close: this form is not a dialog, and the reload below replaces the page.
      },
      refresh: () => navigate("/account?saved=name"),
    });

  return { form, onSubmit };
}
