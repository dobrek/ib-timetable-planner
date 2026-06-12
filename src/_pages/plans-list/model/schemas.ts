import { z } from "zod";
import { gridPresetSchema } from "@/shared/config";

/**
 * Single source of truth for plan-hub validation, imported by both the Astro Actions
 * (`input` — the authoritative server gate) and the react-hook-form resolvers.
 */

export const createPlanInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  slotGridPreset: gridPresetSchema,
});

export const clonePlanInput = z.object({
  sourcePlanId: z.uuid(),
  name: z.string().trim().min(1, "Name is required"),
});

export const renamePlanInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Name is required"),
});

export const deletePlanInput = z.object({
  id: z.uuid(),
});

/** Raw form field shapes before Zod transforms — what the RHF forms hold. */
export type CreatePlanFormValues = z.input<typeof createPlanInput>;
export type ClonePlanFormValues = z.input<typeof clonePlanInput>;
export type RenamePlanFormValues = z.input<typeof renamePlanInput>;

export type CreatePlanInput = z.output<typeof createPlanInput>;
export type ClonePlanInput = z.output<typeof clonePlanInput>;
export type RenamePlanInput = z.output<typeof renamePlanInput>;
export type DeletePlanInput = z.infer<typeof deletePlanInput>;
