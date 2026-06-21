import { Fragment } from "react";
import type { PlacementWeek } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import type { CollisionViolation } from "../model/constraints";

/** The inspected cell plus the course whose badge was clicked (emphasized in the body). */
export type CollisionInspectionTarget = { day: number; period: number; courseId: string };

type Props = {
  /** Inspection target, or null when closed. */
  target: CollisionInspectionTarget | null;
  /** All violations in the inspected cell; ids are resolved through the name records below. */
  violations: CollisionViolation[];
  names: Record<string, string>;
  teacherNames: Record<string, string>;
  studentNames: Record<string, string>;
  /** Inspected cell's placement weeks (courseId → week) — drives the same-week clash hint. */
  weekByCourseId: Record<string, PlacementWeek>;
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
  names,
  teacherNames,
  studentNames,
  weekByCourseId,
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
            names={names}
            teacherNames={teacherNames}
            studentNames={studentNames}
            weekByCourseId={weekByCourseId}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailsBody({
  target,
  violations,
  names,
  teacherNames,
  studentNames,
  weekByCourseId,
}: {
  target: CollisionInspectionTarget;
  violations: CollisionViolation[];
  names: Record<string, string>;
  teacherNames: Record<string, string>;
  studentNames: Record<string, string>;
  weekByCourseId: Record<string, PlacementWeek>;
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
          Every constraint violation among the courses in this slot; {names[target.courseId] ?? target.courseId} is
          highlighted.
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
                  <CourseNameList courseIds={violation.courseIds} names={names} emphasizedId={target.courseId} />
                  <SameWeekHint courseIds={violation.courseIds} weekByCourseId={weekByCourseId} />
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
                  <CourseNameList courseIds={violation.courseIds} names={names} emphasizedId={target.courseId} />
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
                  <CourseNameList courseIds={violation.courseIds} names={names} emphasizedId={target.courseId} />
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
                  <CourseName id={violation.courseIds[0]} names={names} emphasizedId={target.courseId} /> ↔{" "}
                  <CourseName id={violation.courseIds[1]} names={names} emphasizedId={target.courseId} /> —{" "}
                  {violation.studentKeys.length} shared student{violation.studentKeys.length === 1 ? "" : "s"}:
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
                  <CourseName id={violation.courseId} names={names} emphasizedId={target.courseId} /> is placed more
                  than once in this slot.
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function CourseName({ id, names, emphasizedId }: { id: string; names: Record<string, string>; emphasizedId: string }) {
  return <span className={cn(id === emphasizedId && "text-foreground font-medium")}>{names[id] ?? id}</span>;
}

function CourseNameList({
  courseIds,
  names,
  emphasizedId,
}: {
  courseIds: string[];
  names: Record<string, string>;
  emphasizedId: string;
}) {
  return (
    <>
      {courseIds.map((id, index) => (
        <Fragment key={id}>
          {index > 0 && ", "}
          <CourseName id={id} names={names} emphasizedId={emphasizedId} />
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

/** The single fortnightly week shared by every course id, or null if any is `both`/differs/absent. */
const sharedSingleWeek = (courseIds: string[], weekByCourseId: Record<string, PlacementWeek>): "a" | "b" | null => {
  const first = weekByCourseId[courseIds[0]];
  if (first !== "a" && first !== "b") return null;
  return courseIds.every((id) => weekByCourseId[id] === first) ? first : null;
};

const weekLabel = (week: "a" | "b"): string => (week === "a" ? "week A" : "week B");
const otherWeek = (week: "a" | "b"): "a" | "b" => (week === "a" ? "b" : "a");

/**
 * Keyed by violation kind so each cause renders as its own section. The initializer
 * is exhaustive over the union — adding a `CollisionViolation` kind fails to compile
 * here until its section exists, rather than silently omitting it.
 */
type ViolationsByKind = { [K in CollisionViolation["kind"]]: Extract<CollisionViolation, { kind: K }>[] };

const groupByKind = (violations: CollisionViolation[]): ViolationsByKind => {
  const groups: ViolationsByKind = { teacher: [], student: [], "duplicate-course": [], "teacher-unavailable": [] };
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
    }
  }
  return groups;
};
