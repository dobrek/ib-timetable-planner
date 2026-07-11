import { useState } from "react";
import type { Cohort, PlacementWeek } from "@/shared/config";
import {
  buildAvailabilityIndex,
  buildCrossCohortIndex,
  buildPerspectiveCourseItems,
  CollisionDetailsDialog,
  cellKey,
  deriveCellViolations,
  deriveHours,
  groupCellOccupants,
  narrowViolationsToTeacher,
  perspectivePlacements,
  projectFromPlacements,
  teacherCourses,
  teacherUnavailableCells,
  type AvailabilityIndex,
  type CellCollisions,
  type CellOccupant,
  type CollisionInspectionTarget,
  type HoursStat,
  type PlannerPlacement,
} from "@/entities/timetable";
import { PrintButton } from "@/shared/ui";
import {
  PerspectiveCourseList,
  ScheduleGrid,
  type GridOccupant,
  type PerspectiveCard,
} from "@/widgets/timetable-board";
import type { TeacherPlanViewData, TeacherViewCohortData } from "../api/loader";
import ExportTeacherPlanButton from "./ExportTeacherPlanButton";
import TeacherSwitcher from "./TeacherSwitcher";

type Props = { data: TeacherPlanViewData };

/**
 * The read-only teacher perspective: a static print-viable grid of the teacher's placed
 * courses (availability shading + inspectable collision badges) over a course list with
 * occurrence times and always-visible rosters. The page is static after hydration — every
 * derivation is a plain render-time call into the pure `entities/timetable` functions over
 * serialized props (no memoization needed; the dataset is the same board data the author
 * already loads on the board page).
 */
export default function TeacherPlanPage({ data }: Props) {
  const { teacher, planName } = data;
  const [inspection, setInspection] = useState<{ cohort: Cohort; target: CollisionInspectionTarget } | null>(null);

  const availabilityIndex = buildAvailabilityIndex(data.availability);
  const unavailable = teacherUnavailableCells(availabilityIndex, teacher.id);
  const dp1 = deriveCohortView(data.dp1, data.dp2, teacher.id, availabilityIndex);
  const dp2 = deriveCohortView(data.dp2, data.dp1, teacher.id, availabilityIndex);
  const occupantsByCell = mergeCohortOccupants([
    { cohort: "dp1", view: dp1 },
    { cohort: "dp2", view: dp2 },
  ]);

  const taughtByTeacher = (candidate: { teacherKeys: string[] }): boolean => candidate.teacherKeys.includes(teacher.id);
  const items = [
    ...buildPerspectiveCourseItems({
      cohort: "dp1",
      courses: data.dp1.courses,
      placements: data.dp1.placements,
      merges: data.merges,
      hours: dp1.hours,
      memberOf: taughtByTeacher,
    }),
    ...buildPerspectiveCourseItems({
      cohort: "dp2",
      courses: data.dp2.courses,
      placements: data.dp2.placements,
      merges: data.merges,
      hours: dp2.hours,
      memberOf: taughtByTeacher,
    }),
  ];

  const courseDisplay = { ...data.dp1.courseDisplay, ...data.dp2.courseDisplay };
  const studentNames = { ...data.dp1.studentNames, ...data.dp2.studentNames };
  // The persona's card decorations: a co-teachers note (the viewed teacher excluded) and
  // the always-visible student roster — names resolved here so the widget stays generic.
  const cards: PerspectiveCard[] = items.map((item) => {
    const coTeachers = item.teacherKeys.filter((key) => key !== teacher.id).map((key) => data.teacherNames[key] ?? key);
    return {
      item,
      ...(coTeachers.length > 0 ? { inlineNote: `Co-teachers: ${coTeachers.join(", ")}` } : {}),
      roster: {
        label: "Students",
        names: item.studentKeys.map((key) => studentNames[key] ?? key).sort((a, b) => a.localeCompare(b)),
        emptyMessage: "No students assigned.",
      },
    };
  });
  const inspected = inspection
    ? ((inspection.cohort === "dp1" ? dp1 : dp2).collisions.get(
        cellKey(inspection.target.day, inspection.target.period),
      ) ?? null)
    : null;

  const teacherTitle = teacher.fullName ? `${teacher.fullName} (${teacher.code})` : teacher.code;

  // Export inputs: level per course (structural, not the widget CourseInfo) and the teacher-narrowed
  // placements per cohort — mirroring `deriveCohortView`'s narrowing so the grid sheet shows only the
  // viewed teacher's courses, not the whole school's.
  const courseLevels: Record<string, string> = Object.fromEntries(
    Object.entries(data.courseInfo).map(([id, info]) => [id, info.level] as const),
  );
  const dp1CourseIds = new Set(teacherCourses(data.dp1.courses, teacher.id).map((course) => course.id));
  const dp2CourseIds = new Set(teacherCourses(data.dp2.courses, teacher.id).map((course) => course.id));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{teacherTitle}</h1>
          <p className="text-muted-foreground text-sm">{planName} — teacher schedule</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <TeacherSwitcher planId={data.planId} teachers={data.teachers} current={teacher} />
          <ExportTeacherPlanButton
            planName={planName}
            teacherCode={teacher.code}
            days={data.days}
            periods={data.periods}
            dp1={{
              cohort: "dp1",
              placements: perspectivePlacements(data.dp1.placements, dp1CourseIds),
              courseDisplay: data.dp1.courseDisplay,
            }}
            dp2={{
              cohort: "dp2",
              placements: perspectivePlacements(data.dp2.placements, dp2CourseIds),
              courseDisplay: data.dp2.courseDisplay,
            }}
            courseDisplay={courseDisplay}
            courseLevels={courseLevels}
            items={items}
            teacherNames={data.teacherNames}
            studentNames={studentNames}
            viewerTeacherId={teacher.id}
          />
          <PrintButton />
        </div>
      </header>

      <ScheduleGrid
        days={data.days}
        periods={data.periods}
        gridLabel={`${teacherTitle} timetable`}
        occupantsByCell={occupantsByCell}
        unavailable={unavailable}
        onInspect={(cohort, target) => {
          setInspection({ cohort, target });
        }}
      />

      <PerspectiveCourseList
        cards={cards}
        courseInfo={data.courseInfo}
        courseDisplay={courseDisplay}
        emptyMessage="This teacher conducts no courses in this plan."
      />

      <CollisionDetailsDialog
        target={inspection?.target ?? null}
        violations={inspected?.violations ?? []}
        courseDisplay={courseDisplay}
        teacherNames={data.teacherNames}
        studentNames={studentNames}
        weekByCourseId={inspection ? inspectedWeeks(inspection.cohort === "dp1" ? dp1 : dp2, inspection.target) : {}}
        cohort={inspection?.cohort ?? "dp1"}
        onClose={() => {
          setInspection(null);
        }}
      />
    </div>
  );
}

type CohortView = {
  collisions: Map<string, CellCollisions>;
  occupants: Map<string, CellOccupant[]>;
  /** FULL cohort placements — the dialog's week hints may cite other teachers' courses. */
  allPlacements: PlannerPlacement[];
  hours: Map<string, HoursStat>;
};

/**
 * One cohort's teacher-perspective derivation. Order matters: violations come from the
 * FULL cohort placements (plus availability and the sibling's cross-cohort projection),
 * and only then narrow to the teacher — pre-filtering would silently drop student-overlap
 * and cross-cohort conflicts with other teachers' courses.
 */
const deriveCohortView = (
  own: TeacherViewCohortData,
  sibling: TeacherViewCohortData,
  teacherKey: string,
  availabilityIndex: AvailabilityIndex,
): CohortView => {
  const catalogById = new Map(own.courses.map((course) => [course.id, course]));
  const siblingTeacherKeys = new Map(sibling.courses.map((course) => [course.id, course.teacherKeys]));
  const crossIndex = buildCrossCohortIndex(projectFromPlacements(sibling.placements, siblingTeacherKeys));
  // Deliver the flag set so the read-only perspective flags the early-finish edge rule identically
  // to the editing board (per-cohort ids are enough — the derivation only reads own.placements).
  const finishesEarly = new Set(own.finishesEarlyCourseIds);
  const violations = deriveCellViolations(own.placements, catalogById, availabilityIndex, crossIndex, finishesEarly);

  const courseIds = new Set(teacherCourses(own.courses, teacherKey).map((course) => course.id));
  const collisions = narrowViolationsToTeacher(violations, teacherKey, courseIds);
  const placements = perspectivePlacements(own.placements, courseIds);

  return {
    collisions,
    occupants: groupCellOccupants(placements, own.courseDisplay, collisions),
    allPlacements: own.placements,
    hours: deriveHours(own.placements, own.courses),
  };
};

const mergeCohortOccupants = (views: { cohort: Cohort; view: CohortView }[]): Map<string, GridOccupant[]> => {
  const merged = new Map<string, GridOccupant[]>();
  for (const { cohort, view } of views) {
    for (const [key, occupants] of view.occupants) {
      const tagged = occupants.map((occupant) => ({ ...occupant, cohort }));
      merged.set(key, [...(merged.get(key) ?? []), ...tagged]);
    }
  }
  return merged;
};

const inspectedWeeks = (view: CohortView, target: CollisionInspectionTarget): Record<string, PlacementWeek> =>
  Object.fromEntries(
    view.allPlacements
      .filter((placement) => placement.day === target.day && placement.period === target.period)
      .map((placement) => [placement.courseId, placement.week]),
  );
