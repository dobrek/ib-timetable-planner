import {
  buildPerspectiveCourseItems,
  deriveHours,
  groupCellOccupants,
  perspectivePlacements,
  studentCourses,
} from "@/entities/timetable";
import { PerspectiveCourseList, ScheduleGrid, type PerspectiveCard } from "@/widgets/timetable-board";
import type { StudentPlanViewData } from "../api/loader";
import StudentSwitcher from "./StudentSwitcher";

type Props = { data: StudentPlanViewData };

/**
 * The read-only student perspective: a static print-viable single-cohort grid of the
 * student's placed courses over a course list with occurrence times and a Teachers roster
 * per card. Schedule-only — no collision badges, no dialog, no availability shading. The
 * page is static after hydration; every derivation is a plain render-time call into the
 * pure `entities/timetable` functions over serialized props (no memoization needed; the
 * dataset is one cohort's board data).
 */
export default function StudentPlanPage({ data }: Props) {
  const { student, planName } = data;

  const mineIds = new Set(studentCourses(data.courses, student.id).map((course) => course.id));
  // The grid narrows placements to the student; the course-item builder gets the FULL
  // cohort placements because a merge child's schedule lives on its parent's placements.
  const placements = perspectivePlacements(data.placements, mineIds);
  const occupantsByCell = groupCellOccupants(placements, data.courseDisplay, new Map());

  // Post-filter to direct membership: a merge parent resolves to ALL its children (the
  // teacher teaches the whole merged session), but a student attends only the child they
  // chose — the sibling child's card must not appear on their list.
  const items = buildPerspectiveCourseItems({
    cohort: student.cohort,
    courses: data.courses,
    placements: data.placements,
    merges: data.merges,
    hours: deriveHours(data.placements, data.courses),
    memberOf: (course) => course.studentKeys.includes(student.id),
  }).filter((item) => mineIds.has(item.courseId));
  const cards: PerspectiveCard[] = items.map((item) => ({
    item,
    roster: {
      label: "Teachers",
      names: item.teacherKeys.map((key) => data.teacherNames[key] ?? key).sort((a, b) => a.localeCompare(b)),
      emptyMessage: "No teachers assigned.",
    },
  }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{student.fullName}</h1>
          <p className="text-muted-foreground text-sm">{planName} — student schedule</p>
        </div>
        <StudentSwitcher planId={data.planId} students={data.students} current={student} />
      </header>

      <ScheduleGrid
        days={data.days}
        periods={data.periods}
        gridLabel={`${student.fullName} timetable`}
        occupantsByCell={occupantsByCell}
      />

      <PerspectiveCourseList
        cards={cards}
        courseInfo={data.courseInfo}
        courseDisplay={data.courseDisplay}
        emptyMessage="This student has no courses in this plan."
      />
    </div>
  );
}
