// Type declarations for the JS transcode module, so the TS test factory can
// import it with full types under the project's strict type-check.

export type Cohort = "dp1" | "dp2";

export type CatalogCourse = {
  name: string;
  level: string;
  group_index: number;
  hours_per_week: number;
  teacher_code: string | null;
};

export type CohortData = {
  catalog: Map<string, CatalogCourse>;
  studentRows: string[][];
  choiceResolution: Map<string, string>;
};

export type Fixtures = {
  dp1Overlaps: string[][];
  dp1Merges: string[][];
  dp2Overlaps: string[][];
  dp2Merges: string[][];
};

export type PlanRow = { id: string; name: string; slot_grid_preset: string };
export type TeacherRow = { id: string; plan_id: string; code: string };
export type CourseRow = {
  id: string;
  plan_id: string;
  cohort: Cohort;
  teacher_id: string | null;
  name: string;
  level: string;
  group_index: number;
  hours_per_week: number;
};
export type OverlapRow = { id: string; plan_id: string; base_course_id: string; dependent_course_id: string };
export type MergeRow = { id: string; plan_id: string; parent_course_id: string; child_course_id: string };
export type StudentRow = { id: string; plan_id: string; cohort: Cohort; full_name: string };
export type ChoiceRow = { id: string; plan_id: string; student_id: string; course_id: string };

export type PlanCatalogRows = {
  plans: PlanRow[];
  teachers: TeacherRow[];
  courses: CourseRow[];
  course_overlaps: OverlapRow[];
  course_merges: MergeRow[];
  students: StudentRow[];
  student_choices: ChoiceRow[];
};

export type PlanStats = {
  teachers: number;
  coursesY1: number;
  coursesY2: number;
  studentsY1: number;
  studentsY2: number;
  choicesY1: number;
  choicesY2: number;
  overlapsY1: number;
  overlapsY2: number;
  mergesY1: number;
  mergesY2: number;
};

export function parseCSV(filepath: string): string[][];
export function buildCohort(label: string, studentsFile: string, teachersFile: string): CohortData;
export function enrichFromMergesAndOverlaps(
  catalog: Map<string, CatalogCourse>,
  overlapRows: string[][],
  mergeRows: string[][],
  label: string,
): void;
export function verifyChoices(
  studentRows: string[][],
  catalog: Map<string, CatalogCourse>,
  choiceResolution: Map<string, string>,
  label: string,
): void;
export function loadCohortFixtures(): { dp1Data: CohortData; dp2Data: CohortData; fixtures: Fixtures };
export function buildPlanRows(
  planName: string,
  dp1Data: CohortData,
  dp2Data: CohortData,
  fixtures: Fixtures,
): { rows: PlanCatalogRows; stats: PlanStats };
