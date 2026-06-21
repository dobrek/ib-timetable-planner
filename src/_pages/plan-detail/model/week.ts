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
