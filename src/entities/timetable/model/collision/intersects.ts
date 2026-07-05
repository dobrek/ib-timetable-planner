import { violatesAny } from "./constraints";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";

/**
 * Registry-derived fast path: true iff `course` violates any registered cell
 * constraint against `list` (duplicate id, shared teacher, shared students).
 * Short-circuits — the combinatorial grouping enumerator depends on this staying
 * a cheap boolean; the enumerating `explain` path must never run there.
 */
export const hasIntersection = (course: GroupingCourse, list: GroupingCourse[]): boolean => violatesAny(course, list);
