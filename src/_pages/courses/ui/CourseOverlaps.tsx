import { useMemo, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/class-names";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui";
import { createOverlap, deleteOverlap } from "../api/course-client";
import { formatCourseLabel } from "../lib/labels";
import type { CourseRow } from "../model/course";

type Props = {
  planId: string;
  /** The dependent course whose overlaps are being managed, or null when closed. */
  course: CourseRow | null;
  /** All courses (resolves base-course labels and the candidate base list). */
  courses: CourseRow[];
  coursesById: Map<string, CourseRow>;
  /** Apply an overlap change to the island's in-memory state (keeps the dialog open). */
  onOverlapsChange: (courseId: string, nextOverlaps: string[]) => void;
  onClose: () => void;
  /** Without it the dialog only lists the course's overlaps — no add, no remove (S-405). */
  canEdit: boolean;
};

/**
 * Author the directed `course_overlaps` relation: the managed course's students also
 * attend each linked base course. Bases are picked from the same cohort (excluding self
 * and already-linked); self-links and duplicates are rejected by the schema + DB unique.
 * Mutations update island state in place (no page reload) so the dialog stays open across
 * repeated edits.
 *
 * Without `canEdit` the dialog is the read-only view of the same relation (S-405): the row's overlap
 * badge is the only place overlaps are shown, so a viewer still needs it to open something. Both
 * bodies render the list through `LinkedBaseList`, so what a viewer reads cannot drift from what an
 * author manages — the read-only one simply never mounts the write path.
 */
export default function CourseOverlaps({
  planId,
  course,
  courses,
  coursesById,
  onOverlapsChange,
  onClose,
  canEdit,
}: Props) {
  return (
    <Dialog
      open={course !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        {course &&
          (canEdit ? (
            <OverlapsBody
              key={course.id}
              planId={planId}
              course={course}
              courses={courses}
              coursesById={coursesById}
              onOverlapsChange={onOverlapsChange}
            />
          ) : (
            <ReadOnlyOverlapsBody key={course.id} course={course} coursesById={coursesById} />
          ))}
      </DialogContent>
    </Dialog>
  );
}

type OverlapsBodyProps = {
  planId: string;
  course: CourseRow;
  courses: CourseRow[];
  coursesById: Map<string, CourseRow>;
  onOverlapsChange: (courseId: string, nextOverlaps: string[]) => void;
};

function OverlapsBody({ planId, course, courses, coursesById, onOverlapsChange }: OverlapsBodyProps) {
  const { selectedBaseId, setSelectedBaseId, busy, linkedBases, candidates, addOverlap, removeOverlap } =
    useOverlapActions(planId, course, courses, coursesById, onOverlapsChange);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Overlaps — {course.name}</DialogTitle>
        <DialogDescription>
          Link base courses that share students with this one. Both courses must be in the same cohort.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <LinkedBaseList bases={linkedBases} busy={busy} onRemove={removeOverlap} />
        </div>

        <div className={cn("flex items-end gap-2", candidates.length === 0 && "hidden")}>
          <div className="flex-1 space-y-1">
            <span className="text-sm font-medium">Add overlap</span>
            <Select value={selectedBaseId || undefined} onValueChange={setSelectedBaseId} disabled={busy}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a base course" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {formatCourseLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void addOverlap()} disabled={busy || !selectedBaseId}>
            Add
          </Button>
        </div>

        {candidates.length === 0 && (
          <p className="text-muted-foreground text-sm">No other courses in this cohort to link.</p>
        )}
      </div>
    </>
  );
}

function ReadOnlyOverlapsBody({ course, coursesById }: { course: CourseRow; coursesById: Map<string, CourseRow> }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Overlaps — {course.name}</DialogTitle>
        <DialogDescription>Base courses that share students with this one.</DialogDescription>
      </DialogHeader>

      <LinkedBaseList bases={linkedBasesOf(course, coursesById)} />
    </>
  );
}

/**
 * The course's linked bases, one row each. The remove control renders only with `onRemove` — the
 * absent-handler idiom (S-405) — so the read-only body passes none and gets the same rows without it.
 */
function LinkedBaseList({
  bases,
  busy = false,
  onRemove,
}: {
  bases: CourseRow[];
  busy?: boolean;
  onRemove?: (baseCourseId: string) => Promise<void>;
}) {
  if (bases.length === 0) return <p className="text-muted-foreground text-sm">No overlaps yet.</p>;
  return (
    <ul className="space-y-2">
      {bases.map((base) => (
        <li
          key={base.id}
          className="border-border flex items-center justify-between rounded-md border px-3 py-2 text-sm"
        >
          <span>{formatCourseLabel(base)}</span>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove overlap with ${base.name}`}
              disabled={busy}
              onClick={() => void onRemove(base.id)}
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function useOverlapActions(
  planId: string,
  course: CourseRow,
  courses: CourseRow[],
  coursesById: Map<string, CourseRow>,
  onOverlapsChange: (courseId: string, nextOverlaps: string[]) => void,
) {
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [busy, setBusy] = useState(false);

  const linkedBases = linkedBasesOf(course, coursesById);

  const candidates = useMemo(
    () => courses.filter((c) => c.cohort === course.cohort && c.id !== course.id && !course.overlaps.includes(c.id)),
    [courses, course],
  );

  const addOverlap = async () => {
    if (!selectedBaseId) return;
    setBusy(true);
    const { error } = await createOverlap({ planId, baseCourseId: selectedBaseId, dependentCourseId: course.id });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    onOverlapsChange(course.id, [...course.overlaps, selectedBaseId]);
    setSelectedBaseId("");
    toast.success("Overlap added");
  };

  const removeOverlap = async (baseCourseId: string) => {
    setBusy(true);
    const { error } = await deleteOverlap({ planId, baseCourseId, dependentCourseId: course.id });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    onOverlapsChange(
      course.id,
      course.overlaps.filter((id) => id !== baseCourseId),
    );
    toast.success("Overlap removed");
  };

  return { selectedBaseId, setSelectedBaseId, busy, linkedBases, candidates, addOverlap, removeOverlap };
}

/** The course's overlap targets as rows, in link order; a dangling id (no such course) is skipped. */
const linkedBasesOf = (course: CourseRow, coursesById: Map<string, CourseRow>): CourseRow[] =>
  course.overlaps.map((id) => coursesById.get(id)).filter((c): c is CourseRow => c !== undefined);
