import type { Cohort } from "@/shared/config";

/**
 * Raw badge/display fields for EVERY course row in the plan — including merge children
 * absent from the grouping catalog (no direct choices), which the course list still
 * renders. Widget-owned prop shape: the perspective loaders fetch it, the course list
 * consumes it for badge titles.
 */
export type CourseInfo = {
  name: string;
  level: string;
  groupIndex: number;
  cohort: Cohort;
  hoursPerWeek: number;
};
