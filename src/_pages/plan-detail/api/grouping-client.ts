import { actions } from "astro:actions";
import type { Cohort } from "@/shared/config";
import { callAction } from "@/shared/lib/forms";

/**
 * Recompute + persist the cohort's groupings, surfacing only the `{ error }` channel (the fresh
 * palette arrives via `refreshPage()` in the caller — the success signal). Aligned to the shared
 * `callAction` `{ error }` shape used across the app, replacing the former ad-hoc
 * `{ error: string | undefined }` (`ui-conventions.md` §"Applicability to plan-detail").
 */
export function computeGroupings(args: { planId: string; cohort: Cohort }) {
  return callAction(actions.computeGroupings, args);
}
