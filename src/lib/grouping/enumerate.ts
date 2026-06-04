import { hasIntersection } from "./collision";
import type { GroupingCourse } from "./types";

export const enumerateVariants = (seed: GroupingCourse, all: GroupingCourse[], cap: number): GroupingCourse[][] => {
  const sortedCandidates = all.filter((c) => c.id !== seed.id).toSorted((a, b) => a.id.localeCompare(b.id));

  return deduplicate(expand([seed], sortedCandidates), cap, seed.id);
};

const expand = (current: GroupingCourse[], candidates: GroupingCourse[]): GroupingCourse[][] => {
  const compatible = candidates.filter((c) => !hasIntersection(c, current));
  if (compatible.length === 0) return [current];

  return compatible.flatMap((next) =>
    expand(
      [...current, next],
      compatible.filter((c) => !hasIntersection(c, [next])),
    ),
  );
};

const deduplicate = (sets: GroupingCourse[][], cap: number, seedId: string): GroupingCourse[][] => {
  const seen = new Set<string>();
  return sets.filter((set) => {
    const key = setKey(set);
    if (seen.has(key)) return false;
    if (seen.size >= cap)
      throw new Error(`Enumeration cap of ${cap} exceeded for seed "${seedId}". Reduce catalog size or raise the cap.`);
    seen.add(key);
    return true;
  });
};

const setKey = (set: GroupingCourse[]): string =>
  set
    .map((c) => c.id)
    .toSorted()
    .join(",");
