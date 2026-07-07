import { DragOverlay } from "@dnd-kit/react";
import { GripVertical } from "lucide-react";
import { subjectChipClass, type Cohort } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";
import { type CourseDisplay, type LocalPlacement, resolveCourseDisplay } from "@/entities/timetable";
import type { DragData } from "../../model/drag";
import type { PlannerGrouping } from "../../model/grouping/grouping";
import type { LocalParkedBundle } from "../../model/placement/parked";

type Props = {
  groupings: PlannerGrouping[];
  courseDisplay: Record<string, CourseDisplay>;
  placements: LocalPlacement[];
  parkedBundles: LocalParkedBundle[];
  /** Combined view (S-06): per-cohort placements so a bundle overlay resolves the right cohort's
   *  cell — both cohorts can occupy the same `day:period`. Absent on the single-cohort board. */
  placementsByCohort?: Partial<Record<Cohort, LocalPlacement[]>>;
};

/**
 * Pointer-following feedback for whole-group and whole-slot drags: a compact clone of the
 * dragged set (header + member names). While this overlay is mounted, the Feedback plugin
 * uses it as the moving element and leaves the source in place (no placeholder gap).
 * Course/placement drags keep their default source-element feedback — the overlay disables
 * itself for those kinds.
 */
export default function GroupDragOverlay({
  groupings,
  courseDisplay,
  placements,
  parkedBundles,
  placementsByCohort,
}: Props) {
  return (
    <DragOverlay dropAnimation={null} disabled={(source) => !isOverlayKind(source?.data)}>
      {(source) => {
        const data = source.data as DragData;
        if (data.kind === "grouping") {
          const grouping = groupings.find((candidate) => candidate.id === data.groupingId);
          // A palette grouping was never placed, so its members carry no pending optional decision.
          return grouping ? (
            <OverlayCard
              members={grouping.memberIds.map((courseId) => ({ courseId, isOptional: false }))}
              courseDisplay={courseDisplay}
            />
          ) : null;
        }
        if (data.kind === "bundle") {
          // In the combined view, resolve the dragged cell within its OWN cohort so the overlay
          // never merges the sibling column's courses at the same day/period. The single board has no
          // `placementsByCohort`, so it falls back to its one `placements` set.
          const cellPlacements = placementsByCohort?.[data.cohort] ?? placements;
          const members = cellPlacements
            .filter((placement) => placement.day === data.day && placement.period === data.period)
            .map((placement) => ({ courseId: placement.courseId, isOptional: placement.isOptional }));
          return members.length > 0 ? <OverlayCard members={members} courseDisplay={courseDisplay} /> : null;
        }
        if (data.kind === "parked") {
          const parked = parkedBundles.find((bundle) => bundle.id === data.shelfBundleId);
          return parked ? (
            <OverlayCard
              members={parked.members.map((m) => ({ courseId: m.courseId, isOptional: m.isOptional }))}
              courseDisplay={courseDisplay}
            />
          ) : null;
        }
        return null;
      }}
    </DragOverlay>
  );
}

function OverlayCard({
  members,
  courseDisplay,
}: {
  members: { courseId: string; isOptional: boolean }[];
  courseDisplay: Record<string, CourseDisplay>;
}) {
  return (
    <div data-slot="group-drag-overlay" className="bg-background w-56 rounded-lg border shadow-lg">
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium">
        <GripVertical className="text-muted-foreground size-4" />
        <span>{members.length} courses</span>
      </div>
      <ul className="space-y-1 px-2 pb-2">
        {members.map((member) => {
          const display = resolveCourseDisplay(courseDisplay, member.courseId);
          return (
            <li
              key={member.courseId}
              className={cn(
                "truncate rounded-md border px-1.5 py-1 text-xs",
                subjectChipClass(display.color),
                // A dragged set keeps its optional cues — same dashed+dim axis as the chips.
                member.isOptional && "border-dashed saturate-75",
              )}
            >
              {display.name}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function isOverlayKind(data: unknown): boolean {
  const kind = (data as DragData | undefined)?.kind;
  return kind === "grouping" || kind === "bundle" || kind === "parked";
}
