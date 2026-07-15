import type { SupabaseClient } from "@/shared/api";
import { loadPlacements, unwrapMany } from "@/shared/api";
import { COHORT_VALUES, type Cohort } from "@/shared/config";
import { assembleGeneratorSnapshot, type GeneratorSnapshot, type PlannerPlacement } from "@/entities/timetable";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { LoadedPlan } from "@/_pages/plan-comparison/api";
import type { CourseIdentity, SkeletonRow } from "./fixture-courses";

/**
 * The DB-touching harness shared by the on-demand experiments (`generation`, `export-snapshot`,
 * `import-generated`). Extracted so the CP-SAT POC's export and import build the SAME snapshot and
 * persist through the SAME region-replace as the greedy loop: the whole POC rests on the exported
 * instance being byte-for-byte what the import later verifies and persists, and a second private
 * copy of `toSnapshot`/`persistRegion` would let the two drift apart silently.
 *
 * Dev tooling — the Workers-runtime constraints do not apply here (`fs`, service-role client). All
 * runners refuse a non-local Supabase host (`local-supabase.ts`), so this module never touches
 * production data.
 */

/** Catalog-only clone (`p_include_board = false`): courses, teachers, availability, choices,
 *  overlaps, merges — everything the catalog settings carry — with an empty board. */
export const clonePlanCatalogOnly = async (
  supabase: SupabaseClient,
  sourcePlanId: string,
  name: string,
): Promise<string> => {
  const { data, error } = await supabase.rpc("clone_plan", {
    p_source_plan_id: sourcePlanId,
    p_name: name,
    p_include_board: false,
  });
  if (error) throw new Error(`clone_plan failed for ${sourcePlanId}: ${error.message}`);
  // Typed `string` by the generated client, but a `null` here would sail into `persistRegion` as the
  // target plan id — fail loudly instead, like every other identity the harness resolves.
  if (!data) throw new Error(`clone_plan returned no plan id for ${sourcePlanId}`);
  return data;
};

/** The clone's board as pins — `PlannerPlacement` rows, the shape `assembleGeneratorSnapshot` takes. */
export const loadPins = async (
  supabase: SupabaseClient,
  planId: string,
): Promise<Record<Cohort, PlannerPlacement[]>> => {
  const perCohort = await Promise.all(
    COHORT_VALUES.map(async (cohort) => {
      const rows = unwrapMany(
        await loadPlacements(supabase, planId, cohort),
        `Failed to load ${cohort} placements for plan ${planId}`,
      );
      return [
        cohort,
        rows.map(
          (row): PlannerPlacement => ({
            id: row.id,
            courseId: row.course_id,
            day: row.day,
            period: row.period,
            week: row.week,
            isOptional: row.is_optional,
          }),
        ),
      ] as const;
    }),
  );
  return Object.fromEntries(perCohort) as Record<Cohort, PlannerPlacement[]>;
};

/** The exact assembly the app runs at Generate-click, fed from DB rows instead of board state —
 *  so a harness board is indistinguishable from an in-app generation by construction. The loader
 *  hands `AnalyzerCourse[]` (a `GroupingCourse` superset carrying name/level/groupIndex for the
 *  analyzer); `toWireCourse` projects each back to the bare `GroupingCourse` the app's own snapshot
 *  courses carry, so display fields never enter the snapshot (and thus never enter the export dump —
 *  UUIDs only, display stays at the edges). */
export const toSnapshot = (clone: LoadedPlan, pins: Record<Cohort, PlannerPlacement[]>): GeneratorSnapshot =>
  assembleGeneratorSnapshot(
    {
      days: clone.input.days,
      periods: clone.input.periods,
      availability: clone.input.availability,
      finishesEarlyByCourseId: clone.snapshot.finishesEarlyByCourseId,
    },
    {
      dp1: {
        courses: clone.input.courses.dp1.map(toWireCourse),
        placements: pins.dp1,
        parkedCourseIds: clone.input.parkedCourseIds.dp1,
      },
      dp2: {
        courses: clone.input.courses.dp2.map(toWireCourse),
        placements: pins.dp2,
        parkedCourseIds: clone.input.parkedCourseIds.dp2,
      },
    },
  );

/** Project a loader course down to the constraint-relevant `GroupingCourse` fields — opaque ids
 *  only, no display. */
const toWireCourse = ({ id, teacherKeys, studentKeys, hours, weekMode }: GroupingCourse): GroupingCourse => ({
  id,
  teacherKeys,
  studentKeys,
  hours,
  weekMode,
});

/**
 * Region replace over the rows' own cells — the same RPC the app's apply path uses. `existing` are
 * the rows already on the board that must SURVIVE: a generated row can land in a cell a pin already
 * occupies, and a region replace states the cell's COMPLETE final content, so omitting the pin would
 * delete it.
 */
export const persistRegion = async (
  supabase: SupabaseClient,
  planId: string,
  rows: SkeletonRow[],
  existing: SkeletonRow[],
): Promise<void> => {
  if (rows.length === 0) return;
  const cellKeys = new Set(rows.map(cellOf));
  const survivors = existing.filter(
    (row) => cellKeys.has(cellOf(row)) && !rows.some((target) => rowKey(target) === rowKey(row)),
  );
  const { error } = await supabase.rpc("apply_generated_placements", {
    p_plan_id: planId,
    p_cells: [...cellKeys].map((key) => {
      const [cohort, day, period] = key.split("|");
      return { cohort, day: Number(day), period: Number(period) };
    }),
    p_placements: [...rows, ...survivors].map((row) => ({
      cohort: row.cohort,
      course_id: row.courseId,
      day: row.day,
      period: row.period,
      week: row.week,
      is_optional: false,
    })),
  });
  if (error) throw new Error(`apply_generated_placements failed for plan ${planId}: ${error.message}`);
};

/** Every course's cross-plan identity, both cohorts — the natural key `copyFixtureSkeleton` maps on. */
export const identitiesOf = (plan: LoadedPlan): CourseIdentity[] =>
  COHORT_VALUES.flatMap((cohort) =>
    plan.input.courses[cohort].map((course) => ({
      id: course.id,
      cohort,
      name: course.name,
      level: course.level,
      groupIndex: course.groupIndex,
    })),
  );

/** Pins flattened to `SkeletonRow`s — the survivors a generated region-replace must preserve. */
export const pinRows = (pins: Record<Cohort, PlannerPlacement[]>): SkeletonRow[] =>
  COHORT_VALUES.flatMap((cohort) =>
    pins[cohort].map((pin) => ({
      cohort,
      courseId: pin.courseId,
      day: pin.day,
      period: pin.period,
      week: pin.week,
    })),
  );

/** Reasons a verdict rejected, one indented line each — for the harness's fail-loudly messages. */
export const verdictReasons = (outcome: { verdict: { reasons: string[] } }): string =>
  outcome.verdict.reasons.map((reason) => `  ✗ ${reason}`).join("\n");

const cellOf = (row: { cohort: Cohort; day: number; period: number }): string =>
  `${row.cohort}|${row.day}|${row.period}`;

const rowKey = (row: SkeletonRow): string => `${cellOf(row)}|${row.courseId}`;
