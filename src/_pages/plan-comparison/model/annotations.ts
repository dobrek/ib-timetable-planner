import { COHORT_VALUES, type Cohort } from "@/shared/config";
import type { AnalyzerCourse, Extreme, PlanQualityFeatures } from "@/entities/timetable";
import type { LoadedPlan, PlanNaturalKeys } from "../api/load-plan-analysis";
import { subjectLabel } from "./format";

/**
 * The two load-bearing rendering invariants, carried across as **data** so the UI cannot forget them,
 * plus the name resolution that turns the analyzer's opaque keys into people.
 *
 * These are not style preferences. Each encodes a bug that shipped.
 */

/**
 * **A slot count never renders without its cohort's hour accounting beside it.**
 *
 * An incomplete board trivially uses fewer slots — which is exactly how the engine's 5 abandoned hours
 * once read as a "better" slot count than the expert's complete board. The bench enforces this with
 * post-table annotation loops (`plan-report.ts:97-115`); here the annotations are part of the
 * scoreboard's data, so a section carrying slot counts always ships the sentence that makes them
 * readable.
 *
 * The two totals stay **separate, never netted**: a course carrying more hours than the catalog asks
 * for does not cancel another's shortfall. In the gold plan, dp1's Chemistry runs as an overlap pair,
 * so the expert's six placed hours read as +4 over-placed while the engine's two read as complete.
 * Netting would erase the very gap the comparison exists to expose.
 */
export const completenessAnnotations = (plan: LoadedPlan, features: PlanQualityFeatures): CompletenessAnnotation[] =>
  COHORT_VALUES.flatMap((cohort) => {
    const { unplaced, overplaced } = features.cohorts[cohort].completeness;
    const name = (courseId: string) => courseName(plan, courseId);

    return [
      ...(unplaced.length > 0
        ? [
            {
              kind: "incomplete" as const,
              planId: plan.id,
              planName: plan.name,
              cohort,
              message:
                `${plan.name} ${cohort} is INCOMPLETE — its slot count is flattered: ` +
                unplaced.map((deficit) => `${name(deficit.courseId)} −${String(deficit.missing)}h`).join(", "),
            },
          ]
        : []),
      ...(overplaced.length > 0
        ? [
            {
              kind: "overplaced" as const,
              planId: plan.id,
              planName: plan.name,
              cohort,
              message:
                `${plan.name} ${cohort} carries hours beyond the catalog's requirement: ` +
                overplaced
                  .map((course) => `${name(course.courseId)} ${String(course.placed)}/${String(course.required)}h`)
                  .join(", "),
            },
          ]
        : []),
    ];
  });

export type CompletenessAnnotation = {
  kind: "incomplete" | "overplaced";
  planId: string;
  planName: string;
  cohort: Cohort;
  message: string;
};

/**
 * The analyzer speaks in ids — `worstTeacherGaps.key` is a teacher UUID. The CLI printed those raw,
 * which is the single most-cited defect of the analyzer's real output. The loader already holds full
 * id→natural-key maps (the fingerprint needs them), so resolving the extremes costs nothing extra.
 */
export const resolveExtremes = (features: PlanQualityFeatures, keys: PlanNaturalKeys): ResolvedExtremes => ({
  worstTeacherGaps: namedTeacher(features.teachers.worstTeacherGaps, keys),
  worstStudentGaps: namedStudent(worstStudentAcrossCohorts(features), keys),
  softHitsByTeacher: features.teachers.softHitsByTeacher
    .map((entry) => namedTeacher(entry, keys))
    .filter((entry) => entry !== null),
});

export type ResolvedExtremes = {
  worstTeacherGaps: NamedExtreme | null;
  worstStudentGaps: NamedExtreme | null;
  softHitsByTeacher: NamedExtreme[];
};

/** An extreme with its key resolved to something a human recognizes. */
export type NamedExtreme = { name: string; value: number };

/** The worst student is per-cohort in the feature vector, but "who eats the worst timetable in this
 *  school" is not a per-cohort question. */
const worstStudentAcrossCohorts = (features: PlanQualityFeatures): Extreme | null =>
  COHORT_VALUES.map((cohort) => features.cohorts[cohort].students.worstStudentGaps)
    .filter((entry) => entry !== null)
    .sort((a, b) => b.value - a.value)[0] ?? null;

/** Teachers resolve to their full name, falling back to the `code` — which is itself a natural key a
 *  timetabler reads fluently, unlike a UUID. */
const namedTeacher = (entry: Extreme | null, keys: PlanNaturalKeys): NamedExtreme | null => {
  if (entry === null) return null;
  const teacher = keys.teachers[entry.key];
  return { name: teacher?.fullName ?? teacher?.code ?? entry.key, value: entry.value };
};

const namedStudent = (entry: Extreme | null, keys: PlanNaturalKeys): NamedExtreme | null => {
  if (entry === null) return null;
  return { name: keys.students[entry.key] ?? entry.key, value: entry.value };
};

/** `Chemistry HL`, from the analyzer catalog the loader already carries. */
const courseName = (plan: LoadedPlan, courseId: string): string => {
  const course: AnalyzerCourse | undefined = COHORT_VALUES.flatMap((cohort) => plan.input.courses[cohort]).find(
    (candidate) => candidate.id === courseId,
  );
  return course ? subjectLabel(course.name, course.level) : courseId;
};
