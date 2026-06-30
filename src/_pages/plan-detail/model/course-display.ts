import type { CourseDisplay } from "@/shared/lib/catalog-hash";

// The display value type lives in shared (next to `CohortCatalog`, which carries the map); re-exported
// here as the plan-detail render-edge home alongside the resolver.
export type { CourseDisplay };

/**
 * Canonical render-edge resolver for the course-display side map — replaces the scattered
 * `names[id] ?? id` fallbacks. A missing id resolves to its bare id as the name and no color, so a
 * placement whose course dropped out of the catalog still renders legibly.
 */
export const resolveCourseDisplay = (map: Record<string, CourseDisplay>, id: string): CourseDisplay =>
  map[id] ?? { name: id, color: null };
