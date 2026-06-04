import type { GroupingCourse, GroupingVariant } from "./types";

export const scoreVariant = (set: GroupingCourse[], seed: GroupingCourse): GroupingVariant => {
  const maxHours = Math.max(...set.map((c) => c.hours));
  const score =
    Math.round(set.map((c) => Math.round((c.hours / maxHours) * 100)).reduce((a, b) => a + b, 0) / set.length) / 100;
  const coverageCount = set.reduce((acc, c) => acc + c.studentKeys.length, 0);
  const rank = set.reduce((acc, c) => acc + c.hours * c.studentKeys.length, 0);
  const memberIds = [
    seed.id,
    ...set
      .filter((c) => c.id !== seed.id)
      .toSorted((a, b) => a.id.localeCompare(b.id))
      .map((c) => c.id),
  ];

  return { size: set.length, coverageCount, rank, score, memberIds };
};
