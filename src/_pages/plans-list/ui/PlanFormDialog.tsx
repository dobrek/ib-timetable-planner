import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { navigate } from "astro:transitions/client";
import { DEFAULT_GRID_PRESET, GRID_PRESETS } from "@/shared/config";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { createPlan, renamePlan } from "../api/plans-client";
import {
  createPlanInput,
  renamePlanInput,
  type CreatePlanFormValues,
  type CreatePlanInput,
  type RenamePlanFormValues,
  type RenamePlanInput,
} from "../model/schemas";
import type { PlanRow } from "../api/loader";

type Props = {
  open: boolean;
  onClose: () => void;
  /** The plan to rename, or null to create a blank plan. */
  plan: PlanRow | null;
};

/**
 * Create a blank plan (name + grid preset — the preset is fixed for the plan's
 * lifetime, FR-008) or rename an existing one. Create navigates into the new plan's
 * board; rename stays on the hub and refreshes the list.
 */
export default function PlanFormDialog({ open, onClose, plan }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{plan ? "Rename plan" : "New plan"}</DialogTitle>
          <DialogDescription>
            {plan ? "Give this plan a new name." : "Start a blank plan — its catalog begins empty."}
          </DialogDescription>
        </DialogHeader>
        {plan ? <RenameForm key={plan.id} plan={plan} onClose={onClose} /> : <CreateForm onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const form = useForm<CreatePlanFormValues, unknown, CreatePlanInput>({
    resolver: zodResolver(createPlanInput),
    mode: "onTouched",
    defaultValues: { name: "", slotGridPreset: DEFAULT_GRID_PRESET },
  });

  const onSubmit = (values: CreatePlanInput) => {
    let newPlanId: string | undefined;
    return submitForm({
      call: async () => {
        const { id, error } = await createPlan(values);
        newPlanId = id;
        return { error };
      },
      setError: form.setError,
      conflictField: "name",
      successMessage: "Plan created",
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
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. September v1" autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slotGridPreset"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Slot grid</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a grid preset" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {GRID_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">The grid is fixed for the lifetime of the plan.</p>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Create plan
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function RenameForm({ plan, onClose }: { plan: PlanRow; onClose: () => void }) {
  const form = useForm<RenamePlanFormValues, unknown, RenamePlanInput>({
    resolver: zodResolver(renamePlanInput),
    mode: "onTouched",
    defaultValues: { id: plan.id, name: plan.name },
  });

  useEffect(() => {
    form.reset({ id: plan.id, name: plan.name });
  }, [plan, form]);

  const onSubmit = (values: RenamePlanInput) =>
    submitForm({
      call: () => renamePlan(values),
      setError: form.setError,
      conflictField: "name",
      successMessage: "Plan renamed",
      onClose,
    });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate autoComplete="off">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
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
            Save changes
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
