import { useMemo, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/cn";
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
};

/**
 * Author the directed `course_overlaps` relation: the managed course's students also
 * attend each linked base course. Bases are picked from the same cohort (excluding self
 * and already-linked); self-links and duplicates are rejected by the schema + DB unique.
 * Mutations update island state in place (no page reload) so the dialog stays open across
 * repeated edits.
 */
export default function CourseOverlaps({ planId, course, courses, coursesById, onOverlapsChange, onClose }: Props) {
  return (
    <Dialog
      open={course !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        {course && (
          <OverlapsBody
            key={course.id}
            planId={planId}
            course={course}
            courses={courses}
            coursesById={coursesById}
            onOverlapsChange={onOverlapsChange}
          />
        )}
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
          {linkedBases.length === 0 ? (
            <p className="text-muted-foreground text-sm">No overlaps yet.</p>
          ) : (
            <ul className="space-y-2">
              {linkedBases.map((base) => (
                <li
                  key={base.id}
                  className="border-border flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span>{formatCourseLabel(base)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove overlap with ${base.name}`}
                    disabled={busy}
                    onClick={() => void removeOverlap(base.id)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
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

function useOverlapActions(
  planId: string,
  course: CourseRow,
  courses: CourseRow[],
  coursesById: Map<string, CourseRow>,
  onOverlapsChange: (courseId: string, nextOverlaps: string[]) => void,
) {
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [busy, setBusy] = useState(false);

  const linkedBases = course.overlaps.map((id) => coursesById.get(id)).filter((c): c is CourseRow => c !== undefined);

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
