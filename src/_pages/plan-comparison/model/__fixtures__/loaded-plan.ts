import type { AnalyzerCourse, AnalyzerRow, PlanAnalysisInput } from "@/entities/timetable";
import type { LoadedPlan } from "../../api/load-plan-analysis";

/**
 * A `LoadedPlan` builder for the drift and scoreboard models. Deliberately hand-built rather than
 * loaded: the whole point of the fingerprint is that plan-local UUIDs are noise, so the fixtures make
 * the ids *deliberately ugly and different* between two otherwise-identical plans — which is exactly
 * the clone case the module exists to get right.
 */
export type PlanSpec = {
  id?: string;
  name?: string;
  days?: number;
  periods?: number;
  /** id prefix for every course/teacher/student — vary it to simulate a clone's re-minted UUIDs. */
  idPrefix?: string;
  teachers?: TeacherSpec[];
  students?: StudentSpec[];
  courses?: CourseSpec[];
  availability?: AvailabilitySpec[];
  rows?: AnalyzerRow[];
};

export type TeacherSpec = { code: string; fullName?: string | null };
export type StudentSpec = { name: string };
export type CourseSpec = {
  cohort?: "dp1" | "dp2";
  name: string;
  level?: string;
  groupIndex?: number;
  hours?: number;
  weekMode?: "agnostic" | "biweekly";
  /** Teacher codes and student names — natural keys, resolved to ids by the builder. */
  teachers?: string[];
  students?: string[];
};
export type AvailabilitySpec = {
  teacher: string;
  day: number;
  period: number;
  severity?: "soft" | "strong";
};

export const buildLoadedPlan = (spec: PlanSpec = {}): LoadedPlan => {
  const prefix = spec.idPrefix ?? "p1";
  const teacherSpecs = spec.teachers ?? [];
  const studentSpecs = spec.students ?? [];
  const courseSpecs = spec.courses ?? [];

  const teacherId = (code: string) => `${prefix}-t-${code}`;
  // Students are keyed by INDEX, not name — `students.full_name` carries no unique constraint, so two
  // same-named students are two rows with two ids, and a name-keyed fixture could not express the very
  // weak-key case the fingerprint has to get right. Choices resolve a name to its first bearer.
  const idOfIndex = (index: number) => `${prefix}-s-${String(index)}`;
  const studentId = (name: string) =>
    idOfIndex(
      Math.max(
        0,
        studentSpecs.findIndex((student) => student.name === name),
      ),
    );

  const courses: Record<"dp1" | "dp2", AnalyzerCourse[]> = { dp1: [], dp2: [] };
  courseSpecs.forEach((course, index) => {
    const cohort = course.cohort ?? "dp1";
    courses[cohort].push({
      id: `${prefix}-c-${String(index)}`,
      name: course.name,
      level: course.level ?? "none",
      groupIndex: course.groupIndex ?? 0,
      hours: course.hours ?? 2,
      weekMode: course.weekMode ?? "agnostic",
      teacherKeys: (course.teachers ?? []).map(teacherId),
      studentKeys: (course.students ?? []).map(studentId),
    });
  });

  const input: PlanAnalysisInput = {
    days: spec.days ?? 5,
    periods: spec.periods ?? 10,
    courses,
    rows: spec.rows ?? [],
    availability: (spec.availability ?? []).map((cell) => ({
      teacherKey: teacherId(cell.teacher),
      day: cell.day,
      period: cell.period,
      severity: cell.severity ?? "soft",
    })),
    parkedCourseIds: { dp1: [], dp2: [] },
  };

  return {
    id: spec.id ?? `${prefix}-plan`,
    name: spec.name ?? "Plan",
    input,
    snapshot: {
      days: input.days,
      periods: input.periods,
      availability: input.availability,
      finishesEarlyByCourseId: [],
      cohorts: {
        dp1: { courses: courses.dp1, pins: [], parkedCourseIds: [] },
        dp2: { courses: courses.dp2, pins: [], parkedCourseIds: [] },
      },
    },
    board: input.rows,
    naturalKeys: {
      teachers: Object.fromEntries(
        teacherSpecs.map((teacher) => [
          teacherId(teacher.code),
          { code: teacher.code, fullName: teacher.fullName ?? null },
        ]),
      ),
      students: Object.fromEntries(studentSpecs.map((student, index) => [idOfIndex(index), student.name])),
    },
    warnings: [],
  };
};

/** The canonical two-cohort scenario the drift tests vary one field at a time from. */
export const SAMPLE: PlanSpec = {
  teachers: [{ code: "AB", fullName: "Ada Byron" }, { code: "CD" }],
  students: [{ name: "Alan Turing" }, { name: "Grace Hopper" }],
  courses: [
    { name: "Maths", level: "HL", groupIndex: 5, hours: 4, teachers: ["AB"], students: ["Alan Turing"] },
    { name: "Physics", level: "SL", groupIndex: 4, hours: 2, teachers: ["CD"], students: ["Grace Hopper"] },
    { cohort: "dp2", name: "History", level: "SL", groupIndex: 3, hours: 3, teachers: ["AB"], students: [] },
  ],
  availability: [{ teacher: "AB", day: 1, period: 2, severity: "soft" }],
};
