import { COHORT_VALUES } from "@/shared/config";
import type { Extreme, PlanQualityFeatures } from "@/entities/timetable";
import type { PlanNaturalKeys } from "../api/load-plan-analysis";

/**
 * The two "worst case" rows, resolved from the analyzer's opaque keys into a person you can click.
 *
 * The analyzer speaks in ids — `worstTeacherGaps.key` is a teacher UUID, and both the CLI and the first
 * cut of this table printed those raw, which is the single most-cited defect of the analyzer's output.
 * The loader already holds full id→natural-key maps (the fingerprint needs them), so the name costs
 * nothing extra — and the id it replaces is exactly the id the entity's plan view is keyed by, so the
 * row can carry a link straight to the timetable that *explains* the number. "Ada Byron: 14" answers
 * who; the link answers why.
 */
export const worstTeacherCell = (features: PlanQualityFeatures, plan: PlanContext): MetricCell =>
  toCell(features.teachers.worstTeacherGaps, teacherName(plan.naturalKeys), (id) => teacherHref(plan.planId, id));

/** The worst student across BOTH cohorts — the student lens is per-cohort, but "who eats the worst
 *  timetable in this school" is not. */
export const worstStudentCell = (features: PlanQualityFeatures, plan: PlanContext): MetricCell =>
  toCell(worstStudentAcrossCohorts(features), studentName(plan.naturalKeys), (id) => studentHref(plan.planId, id));

/** What a metric row renders: a formatted value, and — for the rows that name a person — where to go to
 *  see the timetable behind it. Never a delta, a direction or a verdict; see `scoreboard.ts`. */
export type MetricCell = { text: string; href?: string };

/** A column's plan, as the linkable rows need it: the id the route is keyed by, plus the names. */
export type PlanContext = { planId: string; naturalKeys: PlanNaturalKeys };

export const teacherHref = (planId: string, teacherId: string): string => `/plans/${planId}/teachers/${teacherId}`;

export const studentHref = (planId: string, studentId: string): string => `/plans/${planId}/students/${studentId}`;

/**
 * `null` — nobody has any gaps at all — renders as an em dash, never as `0`: an absent worst case is not
 * a worst case of zero. It carries no link either; there is no one to go and look at.
 */
const toCell = (entry: Extreme | null, name: (key: string) => string, href: (key: string) => string): MetricCell =>
  entry === null ? { text: "—" } : { text: `${name(entry.key)}: ${String(entry.value)}`, href: href(entry.key) };

/** Teachers resolve to their full name, falling back to the `code` — itself a natural key a timetabler
 *  reads fluently, unlike a UUID. */
const teacherName =
  (keys: PlanNaturalKeys) =>
  (key: string): string => {
    const teacher = keys.teachers[key];
    return teacher?.fullName ?? teacher?.code ?? key;
  };

const studentName =
  (keys: PlanNaturalKeys) =>
  (key: string): string =>
    keys.students[key] ?? key;

const worstStudentAcrossCohorts = (features: PlanQualityFeatures): Extreme | null =>
  COHORT_VALUES.map((cohort) => features.cohorts[cohort].students.worstStudentGaps)
    .filter((entry) => entry !== null)
    .sort((a, b) => b.value - a.value)[0] ?? null;
