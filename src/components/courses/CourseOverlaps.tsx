import { useState } from "react";
import { actions } from "astro:actions";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatCourseLabel } from "@/components/courses/labels";
import type { CourseRow } from "@/components/courses/types";

type CourseOverlapsProps = {
  /** The dependent course whose overlaps are being managed, or null when closed. */
  course: CourseRow | null;
  /** All courses (resolves base-course labels and the candidate base list). */
  courses: CourseRow[];
  /** Apply an overlap change to the island's in-memory state (keeps the dialog open). */
  onOverlapsChange: (courseId: string, nextOverlaps: string[]) => void;
  onOpenChange: (open: boolean) => void;
};

/**
 * Author the directed `course_overlaps` relation: the managed course's students also
 * attend each linked base course. Bases are picked from the same cohort (excluding self
 * and already-linked); self-links and duplicates are rejected by the schema + DB unique.
 * Mutations update island state in place (no page reload) so the dialog stays open across
 * repeated edits. Tokens only (lessons rule #2).
 */
export default function CourseOverlaps({ course, courses, onOverlapsChange, onOpenChange }: CourseOverlapsProps) {
  return (
    <Dialog open={course !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {course && (
          <OverlapsBody key={course.id} course={course} courses={courses} onOverlapsChange={onOverlapsChange} />
        )}
      </DialogContent>
    </Dialog>
  );
}

type OverlapsBodyProps = {
  course: CourseRow;
  courses: CourseRow[];
  onOverlapsChange: (courseId: string, nextOverlaps: string[]) => void;
};

function OverlapsBody({ course, courses, onOverlapsChange }: OverlapsBodyProps) {
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [busy, setBusy] = useState(false);

  const byId = new Map(courses.map((c) => [c.id, c]));
  const linkedBases = course.overlaps.map((id) => byId.get(id)).filter((c): c is CourseRow => c !== undefined);

  const candidates = courses.filter(
    (c) => c.cohortId === course.cohortId && c.id !== course.id && !course.overlaps.includes(c.id),
  );

  const handleAdd = async () => {
    if (!selectedBaseId) return;
    setBusy(true);
    const { error } = await actions.createOverlap({ baseCourseId: selectedBaseId, dependentCourseId: course.id });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    onOverlapsChange(course.id, [...course.overlaps, selectedBaseId]);
    setSelectedBaseId("");
    toast.success("Overlap added");
  };

  const handleRemove = async (baseCourseId: string) => {
    setBusy(true);
    const { error } = await actions.deleteOverlap({ baseCourseId, dependentCourseId: course.id });
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
                    onClick={() => void handleRemove(base.id)}
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
          <Button onClick={() => void handleAdd()} disabled={busy || !selectedBaseId}>
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
