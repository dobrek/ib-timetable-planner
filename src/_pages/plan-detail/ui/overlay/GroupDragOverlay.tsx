import { DragOverlay } from "@dnd-kit/react";
import { GripVertical } from "lucide-react";
import type { Cohort } from "@/shared/config";
import type { DragData } from "../../model/drag";
import type { PlannerGrouping } from "../../model/grouping/grouping";
import type { LocalParkedBundle } from "../../model/placement/parked";
import type { LocalPlacement } from "../../model/placement/placement";

type Props = {
  groupings: PlannerGrouping[];
  names: Record<string, string>;
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
export default function GroupDragOverlay({ groupings, names, placements, parkedBundles, placementsByCohort }: Props) {
  return (
    <DragOverlay dropAnimation={null} disabled={(source) => !isOverlayKind(source?.data)}>
      {(source) => {
        const data = source.data as DragData;
        if (data.kind === "grouping") {
          const grouping = groupings.find((candidate) => candidate.id === data.groupingId);
          return grouping ? <OverlayCard memberIds={grouping.memberIds} names={names} /> : null;
        }
        if (data.kind === "bundle") {
          // In the combined view, resolve the dragged cell within its OWN cohort so the overlay
          // never merges the sibling column's courses at the same day/period.
          const cellPlacements = (data.cohort ? placementsByCohort?.[data.cohort] : undefined) ?? placements;
          const memberIds = cellPlacements
            .filter((placement) => placement.day === data.day && placement.period === data.period)
            .map((placement) => placement.courseId);
          return memberIds.length > 0 ? <OverlayCard memberIds={memberIds} names={names} /> : null;
        }
        if (data.kind === "parked") {
          const parked = parkedBundles.find((bundle) => bundle.id === data.shelfBundleId);
          return parked ? <OverlayCard memberIds={parked.members.map((m) => m.courseId)} names={names} /> : null;
        }
        return null;
      }}
    </DragOverlay>
  );
}

function OverlayCard({ memberIds, names }: { memberIds: string[]; names: Record<string, string> }) {
  return (
    <div data-slot="group-drag-overlay" className="bg-background w-56 rounded-lg border shadow-lg">
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium">
        <GripVertical className="text-muted-foreground size-4" />
        <span>{memberIds.length} courses</span>
      </div>
      <ul className="space-y-1 px-2 pb-2">
        {memberIds.map((courseId) => (
          <li key={courseId} className="truncate rounded-md border px-1.5 py-1 text-xs">
            {names[courseId] ?? courseId}
          </li>
        ))}
      </ul>
    </div>
  );
}

function isOverlayKind(data: unknown): boolean {
  const kind = (data as DragData | undefined)?.kind;
  return kind === "grouping" || kind === "bundle" || kind === "parked";
}
