import { z } from "zod";
import type { Database } from "@/shared/api/database.types";

/**
 * The fortnightly (bi-weekly) week vocabulary, single-sourced from the generated DB enums —
 * mirroring the cohort / availability-severity config precedent, and living in `shared/config`
 * so every layer (the courses slice, the catalog-hash projection, the plan-detail board) can
 * reach the primitive types without a same-layer cross-slice import.
 *
 * Two homes, one invariant:
 *   - `WeekMode` (course eligibility): `agnostic` (every week) | `biweekly` (week A or B only).
 *   - `PlacementWeek` (placement assignment): `both` (every week) | `a` | `b`.
 *   - Invariant (app-enforced): an `agnostic` course is always `both`; a `biweekly` course is `a`/`b`.
 *
 * The `weeksDisjoint` predicate that the board / enumeration / drag paths share lives in
 * `entities/timetable/model/week.ts` (the constraint core), built on these types.
 */

export type WeekMode = Database["public"]["Enums"]["course_week_mode"];
export type PlacementWeek = Database["public"]["Enums"]["placement_week"];

export const WEEK_MODE_VALUES = ["agnostic", "biweekly"] as const satisfies readonly WeekMode[];
export const PLACEMENT_WEEK_VALUES = ["both", "a", "b"] as const satisfies readonly PlacementWeek[];

/** Shared Zod fields — the authoritative gates mirror the DB enums. */
export const weekModeSchema = z.enum(WEEK_MODE_VALUES);
export const placementWeekSchema = z.enum(PLACEMENT_WEEK_VALUES);
