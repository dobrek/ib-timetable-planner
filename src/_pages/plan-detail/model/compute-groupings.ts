import { enumerateVariants } from "./enumerate";
import { scoreVariant } from "./score";
import type { GroupingCourse, GroupingResult, GroupingVariant } from "./grouping";

const DEFAULT_CAP = 10_000;

export const computeGroupings = (courses: GroupingCourse[], opts?: { cap?: number }): GroupingResult[] => {
  const cap = opts?.cap ?? DEFAULT_CAP;
  return courses.map((seed) => ({
    seedId: seed.id,
    variants: enumerateVariants(seed, courses, cap)
      .map((set) => scoreVariant(set, seed))
      .toSorted(compareVariants),
  }));
};

const compareVariants = (a: GroupingVariant, b: GroupingVariant): number => {
  if (b.score !== a.score) return b.score - a.score;
  if (b.coverageCount !== a.coverageCount) return b.coverageCount - a.coverageCount;
  return a.memberIds.join(",").localeCompare(b.memberIds.join(","));
};
