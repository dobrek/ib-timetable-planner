import { COHORT_VALUES, type Cohort } from "@/shared/config";
import {
  assembleGeneratorSnapshot,
  autoParkPhantomCourses,
  deriveGenerationDeficits,
  isActiveJobStatus,
  isStaleActiveJob,
  type ActiveJobTimestamps,
  type AnalyzerRow,
  type CohortSnapshotInput,
  type PlanAnalysisInput,
  type PlannerPlacement,
} from "@/entities/timetable";
import type { ActiveJobEntry } from "./analyzer-lines";

/**
 * The questions the campaign asks before it acts — pure, so their answers are tested here and the
 * analyzer only loads rows for them.
 */
export type ActiveRow = ActiveJobTimestamps & { readonly id: string; readonly plan_id: string };

/**
 * Every active row, split into the ones that block a deploy and the ones that have gone quiet.
 *
 * A live row blocks: a deploy now would roll the container under it. A stale row is reported but
 * does not block — it is exactly what the app's own reclaim will flip to `interrupted` on the next
 * visit, and a guard that waited on it would wait forever. The verdict is the entity's
 * `isStaleActiveJob`, the same one the app reclaims by, so the two cannot disagree.
 */
export const classifyActiveJobs = (
  rows: readonly ActiveRow[],
  nowMs: number,
): { blocking: ActiveJobEntry[]; stale: ActiveJobEntry[] } => {
  const entries = rows.filter(isActive).map((row) => ({ row, entry: toEntry(row) }));
  return {
    blocking: entries.filter(({ row }) => !isStaleActiveJob(row, nowMs)).map(({ entry }) => entry),
    stale: entries.filter(({ row }) => isStaleActiveJob(row, nowMs)).map(({ entry }) => entry),
  };
};

/**
 * The one job id a recorded prefix names (S-302's job is recorded as `386b9d35` only). No match and
 * more than one match are both errors: guessing between two ids is how a ledger row ends up describing
 * the wrong solve.
 */
export const resolveJobIdPrefix = (ids: readonly string[], prefix: string): string => {
  const wanted = prefix.trim().toLowerCase();
  if (!/^[0-9a-f-]+$/.test(wanted)) throw new Error(`"${prefix}" is not a job id prefix (hex digits and dashes).`);
  const matches = ids.filter((id) => id.toLowerCase().startsWith(wanted));
  if (matches.length === 0) throw new Error(`No job id starts with "${wanted}".`);
  if (matches.length > 1) throw new Error(`"${wanted}" is ambiguous — it prefixes ${matches.join(", ")}.`);
  return matches[0];
};

/**
 * The hours a Generate on this plan would hand the solver: the board's placements become pins, the
 * snapshot is auto-parked exactly as the enqueue path does (zero-student courses drop out), and what
 * remains is the generator's own deficit figure.
 *
 * Generate's loader is not importable from `bench/`, so this shares the entity primitives rather than
 * the loader — `assembleGeneratorSnapshot`, `autoParkPhantomCourses` and `deriveGenerationDeficits`
 * are the same three the app runs. Zero means the server would answer "no placements".
 */
export const remainingHoursOf = (input: PlanAnalysisInput): number => {
  const { snapshot } = autoParkPhantomCourses(
    assembleGeneratorSnapshot(
      { days: input.days, periods: input.periods, availability: input.availability, finishesEarlyByCourseId: [] },
      {
        dp1: cohortInput(input, "dp1"),
        dp2: cohortInput(input, "dp2"),
      },
    ),
  );
  return COHORT_VALUES.flatMap((cohort) => {
    const { pins, courses, parkedCourseIds } = snapshot.cohorts[cohort];
    return deriveGenerationDeficits(pins, courses, parkedCourseIds);
  }).reduce((total, deficit) => total + deficit.missing, 0);
};

/** The entity's definition of active, narrowed so the entry's status type can say so. */
const isActive = (row: ActiveRow): row is ActiveRow & { status: "queued" | "running" } => isActiveJobStatus(row.status);

const toEntry = (row: ActiveRow & { status: "queued" | "running" }): ActiveJobEntry => ({
  jobId: row.id,
  planId: row.plan_id,
  status: row.status,
  since: row.status === "running" ? row.heartbeat_at : row.created_at,
});

const cohortInput = (input: PlanAnalysisInput, cohort: Cohort): CohortSnapshotInput => ({
  courses: input.courses[cohort],
  placements: input.rows.filter((row) => row.cohort === cohort).map(toPlacement),
  parkedCourseIds: input.parkedCourseIds[cohort],
});

/** Analyzer rows carry no ids; the hour derivations read only `courseId`, so synthetic ids are safe. */
const toPlacement = (row: AnalyzerRow, index: number): PlannerPlacement => ({
  id: `remaining:${row.cohort}:${index}`,
  courseId: row.courseId,
  day: row.day,
  period: row.period,
  week: row.week,
  isOptional: false,
});
