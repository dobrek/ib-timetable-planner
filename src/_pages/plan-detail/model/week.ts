import type { PlacementWeek } from "@/shared/config";

/**
 * The single shared week primitive for the constraint core. The board relaxation, the
 * enumeration soft-edge classifier, and the soft-aware drag hint all derive from this one
 * helper (plus the rule: soft edge = conflict AND both courses `biweekly`; hard edge =
 * conflict AND ≥1 course `agnostic`). Kept a named export here — not inlined into
 * `teacher-conflict.explain` — because S-04's cross-cohort occupancy check reuses it.
 *
 * The `PlacementWeek` / `WeekMode` primitive types live in `@/shared/config` (DB-enum-sourced,
 * reachable from every layer); they are re-exported here for ergonomic use across the slice.
 */
export type { PlacementWeek, WeekMode } from "@/shared/config";

/**
 * Two placement weeks are disjoint iff they never coincide: both are single weeks (`a`/`b`)
 * and they differ. A `both` (agnostic) placement runs every week, so it overlaps everything.
 */
export const weeksDisjoint = (a: PlacementWeek, b: PlacementWeek): boolean => a !== "both" && b !== "both" && a !== b;

/** A bi-weekly placement resolves to a single fortnightly week (`a`/`b`); agnostic stays `both`. */
export const isBiweekly = (week: PlacementWeek): boolean => week === "a" || week === "b";

/** Any occupant biweekly → the cell needs A/B lanes. */
export const hasBiweekly = (occupants: { week: PlacementWeek }[]): boolean =>
  occupants.some((occupant) => isBiweekly(occupant.week));

/**
 * Split occupants into the three week groups in one pass, replacing repeated `.filter()`
 * re-scans. Agnostic (`both`) occupants run every week and render above the lanes; `a`/`b`
 * occupants fall into their lane. Input order is preserved within each group.
 */
export const partitionByWeek = <T extends { week: PlacementWeek }>(occupants: T[]): { both: T[]; a: T[]; b: T[] } => {
  const groups: { both: T[]; a: T[]; b: T[] } = { both: [], a: [], b: [] };
  for (const occupant of occupants) {
    if (occupant.week === "a") groups.a.push(occupant);
    else if (occupant.week === "b") groups.b.push(occupant);
    else groups.both.push(occupant);
  }
  return groups;
};

/** The single fortnightly week shared by every course id, or null if any is `both`/differs/absent. */
export const sharedSingleWeek = (
  courseIds: string[],
  weekByCourseId: Record<string, PlacementWeek>,
): "a" | "b" | null => {
  const first = weekByCourseId[courseIds[0]];
  if (first !== "a" && first !== "b") return null;
  return courseIds.every((id) => weekByCourseId[id] === first) ? first : null;
};

export const weekLabel = (week: "a" | "b"): string => (week === "a" ? "week A" : "week B");

export const otherWeek = (week: "a" | "b"): "a" | "b" => (week === "a" ? "b" : "a");
