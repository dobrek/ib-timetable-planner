export type { ComputeWarning, GroupingCourse, GroupingResult, GroupingVariant, PlannerGrouping } from "./model/types";
export { hasIntersection } from "./model/collision";
export { EnumerationCapError, enumerateVariants } from "./model/enumerate";
export { scoreVariant } from "./model/score";
export { groupBy, unique, type GroupedArray } from "./model/utils";
export { computeGroupings } from "./model/compute";
