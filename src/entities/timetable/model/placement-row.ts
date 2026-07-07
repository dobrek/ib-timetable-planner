import type { PlacementWeek } from "@/shared/config";
import type { PlannerPlacement } from "./placement";

/**
 * The raw `placements` row shape every read path shares — the `shared/api/load-placements`
 * select and the placement RPCs' RETURNING projection carry exactly these columns.
 */
export type PlacementRow = {
  id: string;
  course_id: string;
  day: number;
  period: number;
  week: PlacementWeek;
  is_optional: boolean;
  bundle_id: string;
};

/**
 * The one row→domain mapper. It lives here, beside `PlannerPlacement`, because every consumer
 * slice (plan-detail, student-plan-view, teacher-plan-view) hydrates the same domain shape and
 * FSD forbids page slices importing each other's copy — the private per-slice mappers this
 * replaces each had to be hand-edited to thread `is_optional`, and a copy that misses the next
 * column silently drops it in that perspective.
 */
export const toPlannerPlacement = (row: PlacementRow): PlannerPlacement => ({
  id: row.id,
  courseId: row.course_id,
  day: row.day,
  period: row.period,
  week: row.week,
  isOptional: row.is_optional,
  bundleId: row.bundle_id,
});
