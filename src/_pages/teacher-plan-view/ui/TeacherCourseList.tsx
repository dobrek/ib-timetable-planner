import { cohortLabel } from "@/shared/config";
import { Badge } from "@/shared/ui";
import { formatCourseBadgeLabel } from "@/shared/lib/course-label";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import type { CourseDisplay } from "@/shared/lib/catalog-hash";
import { periodTimeRange, resolveCourseDisplay, weekLabel, type PlannerPlacement } from "@/entities/timetable";
import type { CourseInfo } from "../api/loader";
import type { TeacherCourseItem } from "../model/course-list";

type Props = {
  /** Real courses the teacher conducts (both cohorts, composites resolved to children). */
  items: TeacherCourseItem[];
  courseInfo: Record<string, CourseInfo>;
  courseDisplay: Record<string, CourseDisplay>;
  studentNames: Record<string, string>;
  teacherNames: Record<string, string>;
};

/**
 * The course list below the grid: one card per real course, with occurrence times
 * ("Mon P3 · 09:55–10:40 · week A"), hours placed/required, co-teachers, cohort/level
 * badges, and an always-visible compact multi-column roster — never conditional-rendered
 * (per-teacher volume is small, and collapsed-out-of-DOM content would break every
 * future print path).
 */
export default function TeacherCourseList({ items, courseInfo, courseDisplay, studentNames, teacherNames }: Props) {
  if (items.length === 0) {
    return (
      <section aria-label="Courses">
        <h2 className="text-lg font-medium">Courses</h2>
        <p className="text-muted-foreground mt-2 text-sm">This teacher conducts no courses in this plan.</p>
      </section>
    );
  }

  const sorted = [...items].sort((a, b) => titleOf(a).localeCompare(titleOf(b)));

  return (
    <section aria-label="Courses" className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Courses</h2>
      {sorted.map((item) => (
        <CourseCard
          key={item.courseId}
          item={item}
          title={titleOf(item)}
          mergedIntoName={item.mergedIntoId ? resolveCourseDisplay(courseDisplay, item.mergedIntoId).name : null}
          studentNames={studentNames}
          teacherNames={teacherNames}
        />
      ))}
    </section>
  );

  function titleOf(item: TeacherCourseItem): string {
    // Every plan course row should be in `courseInfo` (fetched plan-wide, incl. merge
    // children), but the catalog and course queries are not snapshot-isolated — degrade,
    // don't crash, if a course landed between them.
    return formatCourseBadgeLabel(courseInfo[item.courseId] ?? { name: item.courseId, level: "none", groupIndex: 0 });
  }
}

function CourseCard({
  item,
  title,
  mergedIntoName,
  studentNames,
  teacherNames,
}: {
  item: TeacherCourseItem;
  title: string;
  mergedIntoName: string | null;
  studentNames: Record<string, string>;
  teacherNames: Record<string, string>;
}) {
  const coTeachers = item.coTeacherKeys.map((key) => teacherNames[key] ?? key);
  const roster = item.studentKeys.map((key) => studentNames[key] ?? key).sort((a, b) => a.localeCompare(b));

  return (
    <article aria-label={title} className="border-border bg-background rounded-lg border p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="outline">{cohortLabel(item.cohort)}</Badge>
        {mergedIntoName && (
          <span className="text-muted-foreground text-xs">taught within the merged session {mergedIntoName}</span>
        )}
        {item.hours && (
          <span className="text-muted-foreground ml-auto text-xs" aria-label="Hours placed / required">
            {item.hours.placed}/{item.hours.required} h
          </span>
        )}
      </header>

      <div className="mt-2 flex flex-col gap-2 text-sm">
        {item.occurrences.length > 0 ? (
          <ul aria-label="Occurrences" className="flex flex-wrap gap-x-4 gap-y-1">
            {item.occurrences.map((occurrence) => (
              <li key={occurrence.id} className="text-foreground text-xs">
                {occurrenceLabel(occurrence)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">Not scheduled yet</p>
        )}

        {coTeachers.length > 0 && <p className="text-muted-foreground text-xs">Co-teachers: {coTeachers.join(", ")}</p>}

        <div>
          <h4 className="text-muted-foreground text-xs font-medium">Students ({roster.length})</h4>
          {roster.length > 0 ? (
            <ul
              aria-label={`Students of ${title}`}
              className="mt-1 columns-2 gap-x-6 text-xs sm:columns-3 lg:columns-4"
            >
              {roster.map((name, index) => (
                <li key={`${name}-${String(index)}`} className="break-inside-avoid">
                  {name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground mt-1 text-xs">No students assigned.</p>
          )}
        </div>
      </div>
    </article>
  );
}

/** "Mon P3 · 09:55–10:40 · week A" — clock times through the `periodTimeRange` seam only. */
const occurrenceLabel = (placement: PlannerPlacement): string => {
  const range = periodTimeRange(placement.period);
  const parts = [
    `${dayLabel(placement.day)} ${periodLabel(placement.period)}`,
    ...(range ? [`${range.start}–${range.end}`] : []),
    ...(placement.week !== "both" ? [weekLabel(placement.week)] : []),
  ];
  return parts.join(" · ");
};
