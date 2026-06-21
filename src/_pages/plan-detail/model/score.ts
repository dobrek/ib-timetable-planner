import { unique } from "@/shared/lib/collections";
import type { GroupingCourse, GroupingVariant } from "./grouping";

export const scoreVariant = (
  set: GroupingCourse[],
  seed: GroupingCourse,
  opts?: { oppositeWeek?: boolean },
): GroupingVariant => {
  const maxHours = Math.max(...set.map((c) => c.hours));
  // All-zero-hours sets (e.g. only virtual merge-children) would make hours/maxHours
  // 0/0 = NaN, which corrupts the sort and is rejected by the RPC's numeric cast.
  const score =
    maxHours === 0
      ? 0
      : Math.round(set.map((c) => Math.round((c.hours / maxHours) * 100)).reduce((a, b) => a + b, 0) / set.length) /
        100;
  // A true-parallel set is student-disjoint, so summing is exact; an opposite-week pair shares
  // students by construction (that shared set IS the conflict), so summing would double-count
  // and inflate its rank/displayed count — use the distinct student union for those.
  const coverageCount = opts?.oppositeWeek
    ? unique(set.flatMap((c) => c.studentKeys)).length
    : set.reduce((acc, c) => acc + c.studentKeys.length, 0);
  const rank = set.reduce((acc, c) => acc + c.hours * c.studentKeys.length, 0);
  const memberIds = [
    seed.id,
    ...set
      .filter((c) => c.id !== seed.id)
      .toSorted((a, b) => a.id.localeCompare(b.id))
      .map((c) => c.id),
  ];

  return { size: set.length, coverageCount, rank, score, memberIds, ...(opts?.oppositeWeek && { oppositeWeek: true }) };
};
