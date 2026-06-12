import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { navigate } from "astro:transitions/client";
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
import { clonePlan } from "../api/plans-client";
import { clonePlanInput, type ClonePlanFormValues, type ClonePlanInput } from "../model/schemas";
import type { PlanRow } from "../api/loader";

type Props = {
  /** The plan to clone, or null when closed. */
  source: PlanRow | null;
  onClose: () => void;
};

/**
 * Clone a whole scenario — catalog, placements, groupings — under a new name
 * (prefilled "<source> (copy)"). The primary plan-creation path: on success the
 * author lands directly on the clone's board, warm and ready to edit.
 */
export default function ClonePlanDialog({ source, onClose }: Props) {
  return (
    <Dialog
      open={source !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        {source && (
          <>
            <DialogHeader>
              <DialogTitle>Clone {source.name}</DialogTitle>
              <DialogDescription>
                Deep-copies the whole scenario — students, teachers, courses, placements, and groupings. The copy is
                fully independent.
              </DialogDescription>
            </DialogHeader>
            <CloneForm key={source.id} source={source} onClose={onClose} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CloneForm({ source, onClose }: { source: PlanRow; onClose: () => void }) {
  const form = useForm<ClonePlanFormValues, unknown, ClonePlanInput>({
    resolver: zodResolver(clonePlanInput),
    mode: "onTouched",
    defaultValues: { sourcePlanId: source.id, name: `${source.name} (copy)` },
  });

  const onSubmit = (values: ClonePlanInput) => {
    let newPlanId: string | undefined;
    return submitForm({
      call: async () => {
        const { id, error } = await clonePlan(values);
        newPlanId = id;
        return { error };
      },
      setError: form.setError,
      conflictField: "name",
      successMessage: "Plan cloned",
      onClose,
      refresh: () => navigate(`/plans/${newPlanId ?? ""}`),
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate autoComplete="off">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New plan name</FormLabel>
              <FormControl>
                <Input autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Cloning…" : "Clone plan"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
