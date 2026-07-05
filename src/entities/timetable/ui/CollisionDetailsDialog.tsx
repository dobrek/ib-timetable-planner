import { Fragment } from "react";
import { cohortLabel, siblingCohort, type Cohort, type PlacementWeek } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import { resolveCourseDisplay, type CourseDisplay } from "../model/course-display";
import type { CollisionViolation } from "../model/collision/constraints";
import { otherWeek, sharedSingleWeek, weekLabel } from "../model/week";

/** The inspected cell plus the course whose badge was clicked (emphasized in the body). */
export type CollisionInspectionTarget = { day: number; period: number; courseId: string };

type Props = {
  /** Inspection target, or null when closed. */
  target: CollisionInspectionTarget | null;
  /** All violations in the inspected cell; ids are resolved through the display/name records below. */
  violations: CollisionViolation[];
  courseDisplay: Record<string, CourseDisplay>;
  teacherNames: Record<string, string>;
  studentNames: Record<string, string>;
  /** Inspected cell's placement weeks (courseId → week) — drives the same-week clash hint. */
  weekByCourseId: Record<string, PlacementWeek>;
  /** The active cohort — names the *other* cohort in a cross-cohort violation message. */
  cohort: Cohort;
  onClose: () => void;
};

/**
 * Explains every collision in one cell, grouped by cause (Teacher / Students /
 * Duplicate). Pure declarative view: state lives in the board's inspection hook,
 * which also closes the dialog when the cell's violations vanish.
 */
export default function CollisionDetailsDialog({
  target,
  violations,
  courseDisplay,
  teacherNames,
  studentNames,
  weekByCourseId,
  cohort,
  onClose,
}: Props) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        {target && (
          <DetailsBody
            target={target}
            violations={violations}
            courseDisplay={courseDisplay}
            teacherNames={teacherNames}
            studentNames={studentNames}
            weekByCourseId={weekByCourseId}
            cohort={cohort}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailsBody({
  target,
  violations,
  courseDisplay,
  teacherNames,
  studentNames,
  weekByCourseId,
  cohort,
}: {
  target: CollisionInspectionTarget;
  violations: CollisionViolation[];
  courseDisplay: Record<string, CourseDisplay>;
  teacherNames: Record<string, string>;
  studentNames: Record<string, string>;
  weekByCourseId: Record<string, PlacementWeek>;
  cohort: Cohort;
}) {
  const grouped = groupByKind(violations);
  const unavailableBlock = grouped["teacher-unavailable"].filter((violation) => violation.severity === "block");
  const unavailableWarn = grouped["teacher-unavailable"].filter((violation) => violation.severity === "warn");

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Collisions — {dayLabel(target.day)} {periodLabel(target.period)}
        </DialogTitle>
        <DialogDescription>
          Every constraint violation among the courses in this slot;{" "}
          {resolveCourseDisplay(courseDisplay, target.courseId).name} is highlighted.
        </DialogDescription>
      </DialogHeader>

      <div className="text-muted-foreground max-h-[60vh] space-y-4 overflow-y-auto text-sm">
        {grouped.teacher.length > 0 && (
          <section data-slot="collision-section-teacher" className="space-y-1">
            <h3 className="text-foreground text-sm font-semibold">Teacher</h3>
            <ul className="space-y-1">
              {grouped.teacher.map((violation) => (
                <li key={violation.teacherKey}>
                  {teacherNames[violation.teacherKey] ?? violation.teacherKey} teaches{" "}
                  {violation.courseIds.length === 2 ? "both" : "all"} of:{" "}
                  <CourseNameList
                    courseIds={violation.courseIds}
                    courseDisplay={courseDisplay}
                    emphasizedId={target.courseId}
                  />
                  <SameWeekHint courseIds={violation.courseIds} weekByCourseId={weekByCourseId} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {grouped["cross-cohort-teacher"].length > 0 && (
          <section data-slot="collision-section-cross-cohort" className="space-y-1">
            <h3 className="text-foreground text-sm font-semibold">Other cohort</h3>
            <ul className="space-y-1">
              {grouped["cross-cohort-teacher"].map((violation) => (
                <li key={`${violation.teacherKey}:${violation.courseIds.join(":")}`}>
                  {teacherNames[violation.teacherKey] ?? violation.teacherKey} is also teaching in{" "}
                  {cohortLabel(siblingCohort(cohort))} at this time:{" "}
                  <CourseNameList
                    courseIds={violation.courseIds}
                    courseDisplay={courseDisplay}
                    emphasizedId={target.courseId}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {unavailableBlock.length > 0 && (
          <section data-slot="collision-section-unavailable" className="space-y-1">
            <h3 className="text-foreground text-sm font-semibold">Teacher unavailable</h3>
            <ul className="space-y-1">
              {unavailableBlock.map((violation) => (
                <li key={`${violation.teacherKey}:${violation.courseIds.join(":")}`}>
                  {teacherNames[violation.teacherKey] ?? violation.teacherKey} cannot teach this slot:{" "}
                  <CourseNameList
                    courseIds={violation.courseIds}
                    courseDisplay={courseDisplay}
                    emphasizedId={target.courseId}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {unavailableWarn.length > 0 && (
          <section
            data-slot="collision-section-soft"
            className="border-warning/50 bg-warning/10 text-warning space-y-1 rounded-md border px-3 py-2"
          >
            <h3 className="text-warning text-sm font-semibold">Teacher prefers not</h3>
            <ul className="space-y-1">
              {unavailableWarn.map((violation) => (
                <li key={`${violation.teacherKey}:${violation.courseIds.join(":")}`}>
                  {teacherNames[violation.teacherKey] ?? violation.teacherKey} prefers not to teach this slot:{" "}
                  <CourseNameList
                    courseIds={violation.courseIds}
                    courseDisplay={courseDisplay}
                    emphasizedId={target.courseId}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {grouped.student.length > 0 && (
          <section data-slot="collision-section-student" className="space-y-1">
            <h3 className="text-foreground text-sm font-semibold">Students</h3>
            <ul className="space-y-2">
              {grouped.student.map((violation) => (
                <li key={violation.courseIds.join(":")}>
                  <CourseName
                    id={violation.courseIds[0]}
                    courseDisplay={courseDisplay}
                    emphasizedId={target.courseId}
                  />{" "}
                  ↔{" "}
                  <CourseName
                    id={violation.courseIds[1]}
                    courseDisplay={courseDisplay}
                    emphasizedId={target.courseId}
                  />{" "}
                  — {violation.studentKeys.length} shared student{violation.studentKeys.length === 1 ? "" : "s"}:
                  <p>{violation.studentKeys.map((key) => studentNames[key] ?? key).join(", ")}</p>
                  <SameWeekHint courseIds={violation.courseIds} weekByCourseId={weekByCourseId} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {grouped["duplicate-course"].length > 0 && (
          <section data-slot="collision-section-duplicate" className="space-y-1">
            <h3 className="text-foreground text-sm font-semibold">Duplicate</h3>
            <ul className="space-y-1">
              {grouped["duplicate-course"].map((violation) => (
                <li key={violation.courseId}>
                  <CourseName id={violation.courseId} courseDisplay={courseDisplay} emphasizedId={target.courseId} /> is
                  placed more than once in this slot.
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function CourseName({
  id,
  courseDisplay,
  emphasizedId,
}: {
  id: string;
  courseDisplay: Record<string, CourseDisplay>;
  emphasizedId: string;
}) {
  return (
    <span className={cn(id === emphasizedId && "text-foreground font-medium")}>
      {resolveCourseDisplay(courseDisplay, id).name}
    </span>
  );
}

function CourseNameList({
  courseIds,
  courseDisplay,
  emphasizedId,
}: {
  courseIds: string[];
  courseDisplay: Record<string, CourseDisplay>;
  emphasizedId: string;
}) {
  return (
    <>
      {courseIds.map((id, index) => (
        <Fragment key={id}>
          {index > 0 && ", "}
          <CourseName id={id} courseDisplay={courseDisplay} emphasizedId={emphasizedId} />
        </Fragment>
      ))}
    </>
  );
}

/**
 * When every course in a clash runs on the same single fortnightly week (A or B), they are
 * all bi-weekly and the fix is to move one to the other week. Surfaces that legibly. Renders
 * nothing for week-agnostic (`both`) clashes — those run every week, so there's no other week.
 */
function SameWeekHint({
  courseIds,
  weekByCourseId,
}: {
  courseIds: string[];
  weekByCourseId: Record<string, PlacementWeek>;
}) {
  const week = sharedSingleWeek(courseIds, weekByCourseId);
  if (!week) return null;
  return (
    <p className="text-muted-foreground text-xs">
      Both run on {weekLabel(week)} — move one to {weekLabel(otherWeek(week))} to resolve.
    </p>
  );
}

/**
 * Keyed by violation kind so each cause renders as its own section. The initializer
 * is exhaustive over the union — adding a `CollisionViolation` kind fails to compile
 * here until its section exists, rather than silently omitting it.
 */
type ViolationsByKind = { [K in CollisionViolation["kind"]]: Extract<CollisionViolation, { kind: K }>[] };

const groupByKind = (violations: CollisionViolation[]): ViolationsByKind => {
  const groups: ViolationsByKind = {
    teacher: [],
    student: [],
    "duplicate-course": [],
    "teacher-unavailable": [],
    "cross-cohort-teacher": [],
  };
  for (const violation of violations) {
    switch (violation.kind) {
      case "teacher":
        groups.teacher.push(violation);
        break;
      case "student":
        groups.student.push(violation);
        break;
      case "duplicate-course":
        groups["duplicate-course"].push(violation);
        break;
      case "teacher-unavailable":
        groups["teacher-unavailable"].push(violation);
        break;
      case "cross-cohort-teacher":
        groups["cross-cohort-teacher"].push(violation);
        break;
    }
  }
  return groups;
};
