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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Switch,
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
 * Clone a scenario under a new name (prefilled "<source> (copy)"). The catalog always
 * travels; the "Include board" toggle (default on) chooses whether placements, groupings,
 * and bundles come too. The primary plan-creation path: on success the author lands on the
 * clone's board — warm when the board is included, on the compute-groupings empty state
 * when it is not.
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
                Copies the catalog — students, teachers, courses, availability, colors, and rules. Turn off
                &ldquo;Include board&rdquo; to leave out placements, groupings, and bundles. The copy is fully
                independent.
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
    defaultValues: { sourcePlanId: source.id, name: `${source.name} (copy)`, includeBoard: true },
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

        <FormField
          control={form.control}
          name="includeBoard"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between gap-4">
              <div className="space-y-1">
                <FormLabel>Include board (placements &amp; groupings)</FormLabel>
                <FormDescription>
                  On, the copy opens warm. Off, only the catalog travels and the board starts empty.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value ?? true}
                  onCheckedChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              </FormControl>
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
