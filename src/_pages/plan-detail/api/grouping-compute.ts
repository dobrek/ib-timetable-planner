import { z } from "zod";
import { computeGroupings } from "../model/compute-groupings";
import { EnumerationCapError } from "../model/enumerate";
import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { computeCatalogHash, persistGroupings } from "./persist";
import { loadCohortCourses } from "./load-cohort-catalog";

type Supabase = SupabaseClient;

export const computeGroupingsInput = z.object({
  planId: z.uuid(),
  cohortId: z.uuid(),
});

export type ComputeGroupingsInput = z.infer<typeof computeGroupingsInput>;

export type ComputeGroupingsResult = Awaited<ReturnType<typeof computeAndPersistGroupings>>;

/**
 * One-shot compute: load the cohort catalog → enumerate groupings → hash the catalog
 * → persist (atomic replace) → return the ranked list. Runs in handler scope, never at
 * module load (workerd may freeze Math.random globally).
 */
export const computeAndPersistGroupings = async (supabase: Supabase, input: ComputeGroupingsInput) => {
  const { planId, cohortId } = input;

  const [planResult, cohortResult] = await Promise.all([
    supabase.from("plans").select("id").eq("id", planId).maybeSingle(),
    supabase.from("cohorts").select("id").eq("id", cohortId).maybeSingle(),
  ]);
  if (planResult.error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Plan lookup failed: ${planResult.error.message}`);
  }
  if (cohortResult.error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Cohort lookup failed: ${cohortResult.error.message}`);
  }
  if (!planResult.data) {
    throw new DomainError("NOT_FOUND", `Plan ${planId} not found`);
  }
  if (!cohortResult.data) {
    throw new DomainError("NOT_FOUND", `Cohort ${cohortId} not found`);
  }

  const { courses, names, warnings } = await loadCohortCourses(supabase, cohortId);

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
  await persistGroupings(supabase, { planId, cohortId, catalogHash, results });

  return { groupings: results, names, catalogHash, warnings };
};
