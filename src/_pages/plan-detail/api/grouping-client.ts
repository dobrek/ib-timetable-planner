import { actions } from "astro:actions";
import type { Cohort } from "@/shared/config";

export async function computeGroupings(args: { planId: string; cohort: Cohort }): Promise<{
  error: string | undefined;
}> {
  const { error } = await actions.computeGroupings(args);
  return { error: error?.message };
}
