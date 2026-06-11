import { z } from "zod";
import { computeGroupings } from "../model/compute-groupings";
import { EnumerationCapError } from "../model/enumerate";
import type { SupabaseClient } from "@/shared/api";
import { cohortSchema } from "@/shared/config";
import { computeCatalogHash, loadCohortCourses } from "@/shared/lib/catalog-hash";
import { DomainError } from "@/shared/lib/errors";
import { persistGroupings } from "./persist";

type Supabase = SupabaseClient;

export const computeGroupingsInput = z.object({
  planId: z.uuid(),
  cohort: cohortSchema,
});

export type ComputeGroupingsInput = z.infer<typeof computeGroupingsInput>;

export type ComputeGroupingsResult = Awaited<ReturnType<typeof computeAndPersistGroupings>>;

/**
 * One-shot compute: load the plan-cohort catalog → enumerate groupings → hash the
 * catalog → persist (atomic replace) → return the ranked list. Runs in handler scope,
 * never at module load (workerd may freeze Math.random globally).
 */
export const computeAndPersistGroupings = async (supabase: Supabase, input: ComputeGroupingsInput) => {
  const { planId, cohort } = input;

  const { data: plan, error: planError } = await supabase.from("plans").select("id").eq("id", planId).maybeSingle();
  if (planError) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Plan lookup failed: ${planError.message}`);
  }
  if (!plan) {
    throw new DomainError("NOT_FOUND", `Plan ${planId} not found`);
  }

  const { courses, names, warnings } = await loadCohortCourses(supabase, planId, cohort);

  let results;
  try {
    results = computeGroupings(courses);
  } catch (err) {
    if (err instanceof EnumerationCapError) {
      throw new DomainError("UNPROCESSABLE_CONTENT", err.message);
    }
    throw err;
  }

  const catalogHash = await computeCatalogHash(courses);
  await persistGroupings(supabase, { planId, cohort, catalogHash, results });

  return { groupings: results, names, catalogHash, warnings };
};
