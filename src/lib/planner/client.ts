import type { PlannerPlacement } from "@/components/planner/types";

type CreateArgs = { variantId: string; cohortId: string; courseId: string; day: number; period: number };

type PlacementRow = { id: string; course_id: string; day: number; period: number };

/**
 * Persist a single course-hour. Returns the server row (with its real `id`) so the
 * caller can reconcile the optimistic placement. Throws on any non-2xx so the caller
 * can roll back the optimistic state.
 */
export const createPlacement = async (args: CreateArgs): Promise<PlannerPlacement> => {
  const response = await fetch("/api/placements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Create placement failed"));

  const { placement } = (await response.json()) as { placement: PlacementRow };
  return { id: placement.id, courseId: placement.course_id, day: placement.day, period: placement.period };
};

/** Remove a single placement row by its server id. Throws on any non-2xx. */
export const deletePlacement = async (id: string): Promise<void> => {
  const response = await fetch("/api/placements", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Delete placement failed"));
};

const errorMessage = async (response: Response, fallback: string): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${fallback} (${response.status})`;
};
