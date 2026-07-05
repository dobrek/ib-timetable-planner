import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { CellConstraint } from "./types";

/** A course id appearing more than once among the cell's occupants — one violation per duplicated id. */
export const duplicateCourse: CellConstraint = {
  id: "duplicate-course",
  explain: (occupants) => duplicatedIds(occupants).map((courseId) => ({ kind: "duplicate-course", courseId })),
  test: (course, others) => others.some((item) => item.id === course.id),
};

const duplicatedIds = (occupants: GroupingCourse[]): string[] => {
  const counts = new Map<string, number>();
  for (const { id } of occupants) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([id]) => id);
};
