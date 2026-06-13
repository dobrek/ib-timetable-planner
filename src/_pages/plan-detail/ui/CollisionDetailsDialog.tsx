import { Fragment } from "react";
import { cn } from "@/shared/lib/cn";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui";
import { dayLabel, periodLabel } from "@/shared/config";
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
}: {
  target: CollisionInspectionTarget;
  violations: CollisionViolation[];
  names: Record<string, string>;
  teacherNames: Record<string, string>;
  studentNames: Record<string, string>;
}) {
  const grouped = groupByKind(violations);

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
                </li>
              ))}
            </ul>
          </section>
        )}

        {grouped["teacher-unavailable"].length > 0 && (
          <section data-slot="collision-section-unavailable" className="space-y-1">
            <h3 className="text-foreground text-sm font-semibold">Teacher unavailable</h3>
            <ul className="space-y-1">
              {grouped["teacher-unavailable"].map((violation) => (
                <li key={`${violation.teacherKey}:${violation.courseIds.join(":")}`}>
                  {teacherNames[violation.teacherKey] ?? violation.teacherKey} cannot teach this slot:{" "}
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
