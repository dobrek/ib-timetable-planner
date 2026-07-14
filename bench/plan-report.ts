/* eslint-disable no-console -- the printed report IS this module's product (bench precedent). */
import { COHORT_VALUES, type Cohort } from "@/shared/config";
import {
  analyzePlan,
  verifyGeneration,
  type Distribution,
  type GenerationVerdict,
  type PlanQualityFeatures,
} from "@/entities/timetable";
import type { LoadedPlan } from "@/_pages/plan-comparison/api";

/**
 * The plan-comparison renderer, shared by `pnpm analyze:plans` and `pnpm experiment:generation`.
 * One renderer, so an experiment's tables are diffable against the recorded run-1 tables *by
 * construction* rather than by convention — a second copy would drift the moment a column moved.
 *
 * It reports; it never judges. No pass/fail bar on any metric lives here — that would smuggle back
 * the scalar score the analyzer exists to avoid.
 *
 * Invariant, enforced in the renderer rather than left to convention: **no slot count is ever
 * printed without that cohort's unplaced hours beside it.** An incomplete board trivially uses fewer
 * slots, which is exactly how the engine's 5 abandoned hours once read as a "better" slot count.
 */
export type Report = { plan: LoadedPlan; verdict: GenerationVerdict; features: PlanQualityFeatures };

/** Judge the plan's board against the engine's own oracle, then extract its feature vector. */
export const buildReport = (plan: LoadedPlan): Report => ({
  plan,
  verdict: verifyGeneration(plan.snapshot, plan.board),
  features: analyzePlan(plan.input),
});

export const printPlanReports = (reports: Report[]): void => {
  for (const report of reports) printVerdict(report.plan, report.verdict);
  printCohortScoreboard(reports);
  printGoldenCensus(reports);
  printBoardWide(reports);
  printCrossCohort(reports);
  for (const report of reports) printFixtures(report.plan, report.features);
  for (const report of reports) printGradient(report.plan, report.features);
};

/** The tier-0 question: is this board even legal under the engine's own oracle? */
const printVerdict = (plan: LoadedPlan, verdict: GenerationVerdict): void => {
  console.log(`\n=== Rule verdict — ${label(plan)} ===`);
  console.log(`oracle-valid: ${verdict.ok ? "YES" : "NO"} · soft-availability warns: ${verdict.softWarnCount}`);
  for (const reason of verdict.reasons) console.log(`  ✗ ${reason}`);
  if (verdict.reasons.length === 0) console.log("  (no blocking violations, no generated-row stacking)");
  printCatalogWarnings(plan);
};

/** Catalog anomalies distort every number downstream of them, so they are named next to the verdict
 *  rather than left in the loader — an unflagged `zero-hours` course reads as a complete one. */
const printCatalogWarnings = (plan: LoadedPlan): void => {
  if (plan.warnings.length === 0) return;
  console.log(`catalog warnings: ${plan.warnings.length} — these rows distort the metrics below`);
  for (const warning of plan.warnings) console.log(`  ! [${warning.cohort}] ${warning.kind}: ${warning.message}`);
};

const printCohortScoreboard = (reports: Report[]): void => {
  console.log("\n=== Cohort scoreboard ===");
  const columns = reports.flatMap((report) =>
    COHORT_VALUES.map((cohort) => ({ header: `${short(report.plan)} ${cohort}`, cohort, report })),
  );
  const rows: [string, (report: Report, cohort: Cohort) => string][] = [
    ["UNPLACED HOURS", (report, cohort) => `${report.features.cohorts[cohort].completeness.unplacedHours}`],
    ["OVER-PLACED HOURS", (report, cohort) => `${report.features.cohorts[cohort].completeness.overplacedHours}`],
    ["Uncatalogued rows", (report, cohort) => `${report.features.cohorts[cohort].completeness.uncataloguedRows}`],
    ["Occupied slots", (report, cohort) => `${report.features.cohorts[cohort].board.occupiedSlots}`],
    ["Placement rows", (report, cohort) => `${report.features.cohorts[cohort].board.placementRows}`],
    ["Interior holes", (report, cohort) => `${report.features.cohorts[cohort].board.interiorHoles}`],
    // Empty days sit beside the edge counts for the same reason unplaced hours sit beside the slot
    // count: a wholly empty day pours all its periods into "free at day START" and would otherwise
    // read as packed-morning failure rather than as a day nobody scheduled.
    ["Free at day START", (report, cohort) => `${report.features.cohorts[cohort].board.freeSlotsAtDayStart}`],
    ["Free at day END", (report, cohort) => `${report.features.cohorts[cohort].board.freeSlotsAtDayEnd}`],
    ["— of which EMPTY days", (report, cohort) => `${report.features.cohorts[cohort].board.emptyDays}`],
    ["Same-course adjacent pairs", (report, cohort) => `${report.features.cohorts[cohort].adjacency.adjacentPairs}`],
    ["Same-course same-day SPLITS", (report, cohort) => `${report.features.cohorts[cohort].adjacency.sameDaySplits}`],
    [
      "Students/slot median",
      (report, cohort) => num(report.features.cohorts[cohort].slotCensus.studentsPerSlot.median),
    ],
    ["Thin slots (≤25% cohort)", (report, cohort) => `${report.features.cohorts[cohort].slotCensus.thinSlots.length}`],
    ["Courses/slot avg", (report, cohort) => num(report.features.cohorts[cohort].slotCensus.coursesPerSlot.mean)],
    ["Multi-day courses", (report, cohort) => `${report.features.cohorts[cohort].spread.multiDayCourses}`],
    ["Student gap-slots", (report, cohort) => `${report.features.cohorts[cohort].students.gapSlots}`],
    ["Single-lesson student-days", (report, cohort) => `${report.features.cohorts[cohort].students.singleLessonDays}`],
    ["Week A/B slot delta", (report, cohort) => `${report.features.cohorts[cohort].weekSymmetry.slotDelta}`],
  ];

  printTable(
    ["Metric", ...columns.map((column) => column.header)],
    rows.map(([metric, read]) => [metric, ...columns.map((column) => read(column.report, column.cohort))]),
  );
  // The invariant, spelled out: the slot counts above are only readable next to the hour accounting.
  for (const report of reports) {
    for (const cohort of COHORT_VALUES) {
      const { unplaced, overplaced } = report.features.cohorts[cohort].completeness;
      if (unplaced.length > 0) {
        console.log(
          `  ! ${short(report.plan)} ${cohort} is INCOMPLETE — its slot count is flattered: ` +
            unplaced.map((deficit) => `${courseName(report, deficit.courseId)} −${deficit.missing}h`).join(", "),
        );
      }
      if (overplaced.length > 0) {
        console.log(
          `  ~ ${short(report.plan)} ${cohort} carries hours beyond the catalog's requirement: ` +
            overplaced
              .map((course) => `${courseName(report, course.courseId)} ${course.placed}/${course.required}h`)
              .join(", "),
        );
      }
    }
  }
};

/**
 * The coverage census: cells where every student of the cohort is in class. Rendered as its own
 * section because the headline is NOT the count — expert and engine assemble near the same number of
 * golden cells (the English A+B and TOK unions are the only student-disjoint exhaustive families, so
 * they arise incidentally). The signal is the last three rows: the expert centres her golden cells
 * mid-day, the engine parks them at the day tail.
 */
const printGoldenCensus = (reports: Report[]): void => {
  if (reports.length === 0) return;
  console.log("\n=== Golden slots (whole-cohort coverage, scored per week lane) ===");
  const { band, missShare } = reports[0].features.cohorts[COHORT_VALUES[0]].slotCensus.goldenCensus;
  const bandLabel = `P${band.first}–P${band.last}`;
  const columns = reports.flatMap((report) =>
    COHORT_VALUES.map((cohort) => ({ header: `${short(report.plan)} ${cohort}`, cohort, report })),
  );
  const rows: [string, (report: Report, cohort: Cohort) => string][] = [
    ["Golden cells", (report, cohort) => `${golden(report, cohort).golden.length}`],
    ["— of which composite (3+ courses)", (report, cohort) => `${golden(report, cohort).composites}`],
    [
      `Near-golden cells (≤${pct(missShare)} missing)`,
      (report, cohort) => `${golden(report, cohort).nearGolden.length}`,
    ],
    ["MEAN PERIOD of golden cells", (report, cohort) => num(golden(report, cohort).meanPeriod)],
    [
      `Golden inside the mid-day band (${bandLabel})`,
      (report, cohort) => `${golden(report, cohort).goldenInBand} / ${golden(report, cohort).golden.length}`,
    ],
    ["— band share", (report, cohort) => pct(golden(report, cohort).bandShare)],
  ];

  printTable(
    ["Metric", ...columns.map((column) => column.header)],
    rows.map(([metric, read]) => [metric, ...columns.map((column) => read(column.report, column.cohort))]),
  );
};

const golden = (report: Report, cohort: Cohort): PlanQualityFeatures["cohorts"][Cohort]["slotCensus"]["goldenCensus"] =>
  report.features.cohorts[cohort].slotCensus.goldenCensus;

const printBoardWide = (reports: Report[]): void => {
  console.log("\n=== Board-wide (both cohorts) ===");
  const rows: [string, (report: Report) => string][] = [
    ["TEACHER gap-slots", (report) => `${report.features.teachers.gapSlots}`],
    ["Worst teacher (gaps)", (report) => extreme(report.features.teachers.worstTeacherGaps)],
    ["Avg teaching days / teacher", (report) => num(report.features.teachers.teachingDays.mean)],
    ["Avg hours / teaching day", (report) => num(report.features.teachers.hoursPerTeachingDay.mean)],
    ["Max consecutive teaching", (report) => `${report.features.teachers.maxConsecutiveTeaching.max}`],
    ["Soft-availability hits", (report) => `${report.features.teachers.softAvailabilityHits}`],
    ["Strong-availability hits", (report) => `${report.features.teachers.strongAvailabilityHits}`],
    ["Student gap-slots", (report) => `${sumCohorts(report, (features) => features.students.gapSlots)}`],
    ["Worst student (gaps)", (report) => worstStudent(report)],
    [
      "Avg hours / student-day",
      (report) => num(pooledMean(report, (features) => features.students.hoursPerStudentDay)),
    ],
    [
      "Single-lesson student-days",
      (report) => `${sumCohorts(report, (features) => features.students.singleLessonDays)}`,
    ],
    ["Unplaced hours (total)", (report) => `${sumCohorts(report, (features) => features.completeness.unplacedHours)}`],
  ];
  printTable(
    ["Metric", ...reports.map((report) => short(report.plan))],
    rows.map(([metric, read]) => [metric, ...reports.map(read)]),
  );

  console.log("\n--- Distributions (the signal totals hide) ---");
  for (const report of reports) {
    console.log(`  ${short(report.plan)}`);
    console.log(`    ${distributionLine("teacher gaps", report.features.teachers.gapsPerTeacher)}`);
    console.log(`    ${distributionLine("teacher day span", report.features.teachers.daySpan)}`);
    for (const cohort of COHORT_VALUES) {
      const { students } = report.features.cohorts[cohort];
      console.log(`    ${distributionLine(`${cohort} student gaps`, students.gapsPerStudent)}`);
      console.log(`    ${distributionLine(`${cohort} span efficiency`, students.spanEfficiency)}`);
      console.log(`    ${distributionLine(`${cohort} late finishes`, students.lateFinishes)}`);
    }
  }
};

const printCrossCohort = (reports: Report[]): void => {
  console.log("\n=== Cross-cohort weave ===");
  const rows: [string, (report: Report) => string][] = [
    [
      "Teachers (both cohorts / all)",
      (report) => `${report.features.crossCohort.teachersInBothCohorts} / ${report.features.crossCohort.teachers}`,
    ],
    [
      "Cohort-pure teacher-days",
      (report) =>
        `${report.features.crossCohort.cohortPureTeacherDays} / ${report.features.crossCohort.teacherDays} (${pct(report.features.crossCohort.cohortPureShare)})`,
    ],
    ["Cohort switches (within a day)", (report) => `${report.features.crossCohort.cohortSwitches}`],
    [
      "— of which seamless",
      (report) => `${report.features.crossCohort.seamlessSwitches} (${pct(report.features.crossCohort.seamlessShare)})`,
    ],
    ["Shared subject-edition days", (report) => `${report.features.crossCohort.sharedSubjectEditionDays}`],
    ["Mirrored cells (fixtures)", (report) => `${report.features.crossCohort.mirroredCells.length}`],
  ];
  printTable(
    ["Metric", ...reports.map((report) => short(report.plan))],
    rows.map(([metric, read]) => [metric, ...reports.map(read)]),
  );
};

/** The fixture detector's output — on an expert plan these are the school's synchronized skeleton. */
const printFixtures = (plan: LoadedPlan, features: PlanQualityFeatures): void => {
  const { mirroredCells } = features.crossCohort;
  console.log(`\n=== Mirrored cells — ${label(plan)} (${mirroredCells.length}) ===`);
  for (const cell of mirroredCells) {
    console.log(`  d${cell.day} P${cell.period}  ${cell.name}${cell.level === "none" ? "" : ` ${cell.level}`}`);
  }
  if (mirroredCells.length === 0) console.log("  (none — no cross-cohort synchronization)");
};

/** Mean period per subject: the expert's heaviness-labeling input. */
const printGradient = (plan: LoadedPlan, features: PlanQualityFeatures): void => {
  console.log(`\n=== Time-of-day gradient — ${label(plan)} ===`);
  console.log(
    features.subjects.map((subject) => `${subject.subject} ${num(subject.meanPeriod)}`).join(" · ") ||
      "  (no subjects)",
  );
};

const sumCohorts = (report: Report, read: (features: PlanQualityFeatures["cohorts"][Cohort]) => number): number =>
  COHORT_VALUES.reduce((sum, cohort) => sum + read(report.features.cohorts[cohort]), 0);

/** Both cohorts' samples pooled — averaging two cohort means would weight a 27-student cohort
 *  the same as a 34-student one. */
const pooledMean = (
  report: Report,
  read: (features: PlanQualityFeatures["cohorts"][Cohort]) => Distribution,
): number => {
  const parts = COHORT_VALUES.map((cohort) => read(report.features.cohorts[cohort]));
  const samples = parts.reduce((sum, part) => sum + part.count, 0);
  return samples === 0 ? 0 : parts.reduce((sum, part) => sum + part.mean * part.count, 0) / samples;
};

const worstStudent = (report: Report): string => {
  const ranked = COHORT_VALUES.map((cohort) => report.features.cohorts[cohort].students.worstStudentGaps)
    .filter((entry) => entry !== null)
    .sort((a, b) => b.value - a.value);
  return ranked.length === 0 ? "—" : extreme(ranked[0]);
};

const courseName = (report: Report, courseId: string): string => {
  const course = COHORT_VALUES.flatMap((cohort) => report.plan.input.courses[cohort]).find(
    (candidate) => candidate.id === courseId,
  );
  return course ? `${course.name}${course.level === "none" ? "" : ` ${course.level}`}` : courseId;
};

const label = (plan: LoadedPlan): string => `${plan.name} (${plan.id})`;

const short = (plan: LoadedPlan): string => plan.name;

const extreme = (entry: { key: string; value: number } | null): string =>
  entry === null ? "—" : `${entry.key}: ${entry.value}`;

const num = (value: number): string => (Number.isInteger(value) ? `${value}` : value.toFixed(2));

const pct = (share: number): string => `${Math.round(share * 100)}%`;

const distributionLine = (name: string, values: Distribution): string =>
  `${name}: min ${num(values.min)} · p10 ${num(values.p10)} · median ${num(values.median)} · mean ${num(values.mean)} · max ${num(values.max)}`;

const printTable = (headers: string[], rows: string[][]): void => {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column])))
      .join("  ");
  console.log(line(headers));
  console.log(widths.map((width) => "─".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row));
};
